"""Offline Twi for Ama: translation and speech recognition on this computer, free.

    python twi_offline.py setup            # one time: fetch + convert both models (~1.5 GB on disk)
    python twi_offline.py serve            # http://127.0.0.1:5004, what the app's TWI_OFFLINE_URL points at
    python twi_offline.py translate "Nkoko no ho yɛ hyew" --src twi_Latn --tgt eng_Latn
    python twi_offline.py hear sample.wav  # Twi / Ghanaian English speech to text

Translation: Meta's NLLB-200 (distilled 600M), converted to an int8 CTranslate2
model so it runs fast on a laptop CPU with no GPU. Twi, Ewe, Hausa and French
to and from English. Speech: GhanaNLP's Griot-Nano-1 (sherpa-onnx), trained on
Asante and Akuapem Twi, Fante, Ewe, Ga, Dagbani and Ghanaian English.

Endpoints (POST bodies are JSON unless noted):
  GET  /health      {"translate": bool, "asr": bool}
  POST /translate   {"text": "...", "src": "twi_Latn", "tgt": "eng_Latn"}  -> {"text": "..."}
                    or {"texts": [...], ...}                               -> {"texts": [...]}
  POST /transcribe  body: 16 kHz mono WAV                                  -> {"text": "..."}

Settings (env):
  PG_OFFLINE_DIR    where models live, default edge/offline-models
  PG_OFFLINE_TOKEN  bearer token required by `serve` (set it if other machines can reach it)
  PG_OFFLINE_THREADS CPU threads, default 4

Licences: NLLB-200 and the Griot models are for non-commercial use (CC BY-NC);
this code is MIT.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# A half-installed TensorFlow elsewhere on the machine breaks `transformers` imports
# (it tries TensorFlow first); the NLLB conversion only needs PyTorch.
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("USE_TORCH", "1")

HERE = Path(__file__).parent
MODELS = Path(os.environ.get("PG_OFFLINE_DIR", HERE / "offline-models"))
NLLB_DIR = MODELS / "nllb-200-600m-int8"
GRIOT_DIR = MODELS / "griot-asr-turbo"
THREADS = int(os.environ.get("PG_OFFLINE_THREADS", "4"))
log = logging.getLogger("twi-offline")


# ---------------------------------------------------------------- translation
class Translator:
    """NLLB-200 through CTranslate2. Long text is split into sentences first:
    the model is trained on sentences and drifts on whole paragraphs."""

    def __init__(self, model_dir: Path = NLLB_DIR):
        import ctranslate2
        import sentencepiece

        self.tr = ctranslate2.Translator(str(model_dir), device="cpu", compute_type="int8",
                                         intra_threads=THREADS)
        self.sp = sentencepiece.SentencePieceProcessor(model_file=str(model_dir / "sentencepiece.bpe.model"))
        self.lock = threading.Lock()

    @staticmethod
    def _sentences(text: str) -> list[str]:
        parts = re.split(r"(?<=[.!?])\s+|\n+", text.strip())
        return [p.strip() for p in parts if p.strip()]

    def translate_many(self, texts: list[str], src: str, tgt: str) -> list[str]:
        pieces, owner = [], []
        for i, t in enumerate(texts):
            for s in self._sentences(t) or [""]:
                pieces.append(s)
                owner.append(i)
        batch = [[src] + self.sp.encode(p, out_type=str) + ["</s>"] for p in pieces]
        with self.lock:  # one translation at a time keeps a laptop responsive
            res = self.tr.translate_batch(batch, target_prefix=[[tgt]] * len(batch), beam_size=2,
                                          max_decoding_length=256, max_batch_size=16)
        out = [""] * len(texts)
        for i, r in zip(owner, res):
            toks = [t for t in r.hypotheses[0] if t != tgt]
            sent = self.sp.decode(toks).strip()
            out[i] = f"{out[i]} {sent}".strip()
        return out


# ---------------------------------------------------------------- speech
class Hearer:
    """GhanaNLP Griot-Nano-1 (int8 sherpa-onnx), from the cloned griot-asr-turbo repo."""

    def __init__(self, repo: Path = GRIOT_DIR):
        sys.path.insert(0, str(repo))
        from sherpa_griot.recognizer import GriotRecognizer  # type: ignore

        cwd = os.getcwd()
        os.chdir(repo)  # the recognizer finds its exported models relative to the repo
        try:
            self.rec = GriotRecognizer()
        finally:
            os.chdir(cwd)
        self.lock = threading.Lock()

    def hear(self, wav: bytes) -> str:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav)
            path = f.name
        try:
            with self.lock:
                return str(self.rec.transcribe_file(path)).strip()
        finally:
            os.unlink(path)


_engines: dict[str, object | None] = {}


def engine(name: str):
    """Load an engine on first use; None if its model isn't set up."""
    if name not in _engines:
        try:
            _engines[name] = Translator() if name == "translate" else Hearer()
            log.info("%s ready", name)
        except Exception as e:  # missing model or package: report it, keep serving the other
            log.warning("%s unavailable: %s", name, e)
            _engines[name] = None
    return _engines[name]


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "pg-twi-offline/1"

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def _send(self, code: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self) -> bool:
        token = os.environ.get("PG_OFFLINE_TOKEN")
        if token and self.headers.get("authorization") != f"Bearer {token}":
            self._send(401, {"error": "bad token"})
            return False
        return True

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        if not self._authorised():
            return
        self._send(200, {"translate": engine("translate") is not None, "asr": engine("asr") is not None})

    def do_POST(self):
        if not self._authorised():
            return
        body = self.rfile.read(int(self.headers.get("content-length", "0")))
        try:
            if self.path == "/translate":
                tr = engine("translate")
                if tr is None:
                    return self._send(503, {"error": "translation model not set up: python twi_offline.py setup"})
                req = json.loads(body)
                if "texts" in req:
                    return self._send(200, {"texts": tr.translate_many(req["texts"][:200], req["src"], req["tgt"])})
                return self._send(200, {"text": tr.translate_many([req["text"]], req["src"], req["tgt"])[0]})
            if self.path == "/transcribe":
                he = engine("asr")
                if he is None:
                    return self._send(503, {"error": "speech model not set up: python twi_offline.py setup"})
                return self._send(200, {"text": he.hear(body)})
            self._send(404, {"error": "not found"})
        except Exception as e:
            log.exception("request failed")
            self._send(500, {"error": str(e)[:300]})


def serve(host: str, port: int):
    engine("translate")
    engine("asr")
    log.info("Offline Twi service on http://%s:%d", host, port)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


# ---------------------------------------------------------------- setup
def _run(cmd: list[str], cwd: Path | None = None):
    log.info("$ %s", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=cwd)


def setup_nllb():
    if (NLLB_DIR / "model.bin").exists():
        return log.info("NLLB already set up in %s", NLLB_DIR)
    _run([sys.executable, "-m", "pip", "install", "ctranslate2>=4.4", "sentencepiece", "transformers>=4.40,<5"])
    MODELS.mkdir(parents=True, exist_ok=True)
    # Converts Meta's official weights to int8 (~620 MB). The download (~2.5 GB) goes
    # to the Hugging Face cache; `setup --clean-cache` removes it afterwards.
    _run([sys.executable, "-m", "ctranslate2.converters.transformers", "--model", "facebook/nllb-200-distilled-600M",
          "--output_dir", str(NLLB_DIR), "--quantization", "int8", "--copy_files", "sentencepiece.bpe.model"])


def setup_griot():
    if not GRIOT_DIR.exists():
        MODELS.mkdir(parents=True, exist_ok=True)
        _run(["git", "clone", "--depth", "1", "https://github.com/GhanaNLP/griot-asr-turbo.git", str(GRIOT_DIR)])
    _run([sys.executable, "-m", "pip", "install", "-r", "requirements.txt"], cwd=GRIOT_DIR)
    out = GRIOT_DIR / "models" / "griot-nano-1"
    if not any(out.glob("*.onnx")):
        _run([sys.executable, "scripts/export_nano_onnx.py", "--output-dir", str(out)], cwd=GRIOT_DIR)
        _run([sys.executable, "scripts/quantize_onnx.py", str(out / "model.onnx")], cwd=GRIOT_DIR)


def clean_cache():
    """Remove the full-size NLLB download once it has been converted."""
    import shutil

    cache = Path(os.environ.get("HF_HOME", Path.home() / ".cache" / "huggingface")) / "hub"
    for d in cache.glob("models--facebook--nllb-200-distilled-600M"):
        shutil.rmtree(d, ignore_errors=True)
        log.info("removed %s", d)


def main():
    # Windows consoles default to cp1252, which has no ɛ or ɔ.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("setup")
    s.add_argument("--only", choices=["nllb", "griot"])
    s.add_argument("--clean-cache", action="store_true", help="delete the full-size NLLB download afterwards")
    v = sub.add_parser("serve")
    v.add_argument("--host", default="127.0.0.1")
    v.add_argument("--port", type=int, default=5004)
    t = sub.add_parser("translate")
    t.add_argument("text")
    t.add_argument("--src", default="eng_Latn")
    t.add_argument("--tgt", default="twi_Latn")
    h = sub.add_parser("hear")
    h.add_argument("wav", type=Path)
    a = ap.parse_args()

    if a.cmd == "setup":
        if a.only in (None, "nllb"):
            setup_nllb()
            if a.clean_cache:
                clean_cache()
        if a.only in (None, "griot"):
            setup_griot()
    elif a.cmd == "serve":
        serve(a.host, a.port)
    elif a.cmd == "translate":
        print(Translator().translate_many([a.text], a.src, a.tgt)[0])
    elif a.cmd == "hear":
        print(Hearer().hear(a.wav.read_bytes()))


if __name__ == "__main__":
    main()
