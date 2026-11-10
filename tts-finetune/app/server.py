"""Twi Voice: type Twi, hear it. A small local web app around the fine-tuned NELVIN voice.

    .venv\\Scripts\\python app\\server.py            # then open http://127.0.0.1:7860
    "Start Twi Voice.bat"                           # same, and opens the browser

Voices:
  NELVIN  the fine-tuned model: voices/nelvin (final) and each voices/nelvin-clean-epochNN snapshot
  twi-6   stock stable-twi-tts male voice
  twi-1   stock stable-twi-tts female voice
New snapshots show up on their own (the page re-checks every 30 s).
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import threading
import wave
import webbrowser
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
MAX_CHARS = 3000

# --- the same front-end fixes the app's Pi worker (edge/twi_tts.py) uses -----------------------

import stable_twi_tts.tts as tts_mod  # noqa: E402
from stable_twi_tts import StableTwiTTS  # noqa: E402

_orig_to_ids = tts_mod.to_ids


def _lenient(u: str, id_map: dict):
    """Drop the tie bar (t͡ɕʰ -> tɕʰ), else longest known prefix, else skip the sound."""
    if u in id_map:
        return u
    v = u.replace("͡", "")
    if v in id_map:
        return v
    return next((v[:k] for k in range(len(v) - 1, 0, -1) if v[:k] in id_map), None)


tts_mod.to_ids = lambda units, m, lang: _orig_to_ids(
    [x for x in (_lenient(u, m) for u in units) if x], m, lang)

# Numbers are read in English inside Twi (the Twi voice drops digits otherwise).
_UNITS = {"°c": "degrees", "℃": "degrees", "°": "degrees", "%": "percent"}
_NUM = re.compile(r"(\d+(?:[.,]\d+)?)\s*(°\s*c|℃|°|%)?", re.IGNORECASE)


def prepare(text: str) -> str:
    def num(m: re.Match) -> str:
        n = m.group(1).replace(",", ".")
        unit = _UNITS.get(re.sub(r"\s", "", (m.group(2) or "").lower()), "")
        return f"[{n} {unit}]".replace(" ]", "]")

    text = _NUM.sub(num, text.replace("**", ""))
    return re.sub(r"[ \t]+", " ", text).strip()[:MAX_CHARS]


# --- voices ------------------------------------------------------------------------------------

def find_nelvin() -> list[tuple[str, str, Path]]:
    """(id, label, dir) for the final voice and each clean snapshot, best guess first."""
    out = []
    final = ROOT / "voices" / "nelvin"
    if not (final / "model.onnx").exists():  # in the repo: the copy the site uses
        final = ROOT.parent / "edge" / "voices" / "nelvin"
    if (final / "model.onnx").exists():
        out.append(("nelvin", "NELVIN (final)", final))
    snaps = sorted(ROOT.glob("voices/nelvin-clean-epoch*/model.onnx"),
                   key=lambda p: -int(p.parent.name.split("epoch")[-1]))
    for p in snaps:
        ep = int(p.parent.name.split("epoch")[-1]) + 1
        out.append((p.parent.name, f"NELVIN (epoch {ep})", p.parent))
    old = ROOT / "voices" / "nelvin-epoch49"  # first run, before the pause fix: kept as a reference
    if (old / "model.onnx").exists():
        out.append(("nelvin-epoch49", "NELVIN (before pause fix)", old))
    return out


def training_status() -> dict:
    """Latest epoch from the training log, plus the auto-export log."""
    log = ROOT / "train-clean.log"
    st = {"running": False, "epoch": None, "max_epochs": 300, "done": False, "crashed": False, "exports": []}
    if log.exists():
        with open(log, "rb") as f:
            f.seek(max(0, log.stat().st_size - 4000))
            tail = f.read().decode("utf-8", "replace")
        eps = re.findall(r"Epoch (\d+):", tail)
        if eps:
            st["epoch"] = int(eps[-1])
        st["done"] = "Trainer.fit` stopped" in tail
        st["crashed"] = "Traceback" in tail
        import time
        st["running"] = not st["done"] and not st["crashed"] and time.time() - log.stat().st_mtime < 300
    ex = ROOT / "autoexport.log"
    if ex.exists():
        st["exports"] = ex.read_text(encoding="utf-8", errors="replace").strip().splitlines()[-5:]
    return st


def find_stock() -> Path | None:
    from stable_twi_tts.download import ensure_model
    try:
        return Path(ensure_model(None, quiet=True))
    except Exception:
        return None


class Voices:
    MAX_LOADED = 6  # each model is ~80 MB on disk, a few hundred MB in memory

    def __init__(self):
        self.lock = threading.Lock()  # onnxruntime sessions are not shared across threads
        self.dirs: dict[str, tuple[Path, str]] = {}  # id -> (model dir, voice name); loaded on first use
        self.loaded: "OrderedDict[Path, StableTwiTTS]" = OrderedDict()
        self.info: list[dict] = []
        self.stock = find_stock()
        self.rescan()
        if not self.dirs:
            raise SystemExit("No voices found. Export one into voices/ first.")
        self._model(self.info[0]["id"])  # load the default now so the first click is quick

    def rescan(self) -> list[dict]:
        """Pick up snapshots exported while the app is running."""
        dirs, info = {}, []
        for vid, label, d in find_nelvin():
            dirs[vid] = (d, "nelvin")
            info.append({"id": vid, "label": label, "detail": d.name, "group": "nelvin"})
        if self.stock:
            dirs["twi-6"] = (self.stock, "twi-6")
            dirs["twi-1"] = (self.stock, "twi-1")
            info += [{"id": "twi-6", "label": "Stock male (twi-6)", "detail": "stable-twi-tts", "group": "stock"},
                     {"id": "twi-1", "label": "Stock female (twi-1)", "detail": "stable-twi-tts", "group": "stock"}]
        with self.lock:
            self.dirs, self.info = dirs, info
        return info

    def _model(self, voice: str) -> StableTwiTTS:
        d, _ = self.dirs[voice]
        if d in self.loaded:
            self.loaded.move_to_end(d)
        else:
            self.loaded[d] = StableTwiTTS(d)
            while len(self.loaded) > self.MAX_LOADED:
                self.loaded.popitem(last=False)
        return self.loaded[d]

    def speak(self, text: str, voice: str, speed: float) -> tuple[bytes, float]:
        said = prepare(text)
        if not said:
            raise ValueError("Type some Twi first.")
        speed = min(max(speed, 0.5), 2.5)
        kw = dict(voice=self.dirs[voice][1], length_scale=1.0 / speed)
        with self.lock:
            model = self._model(voice)
            try:
                s = model.synthesize(said, language="mixed", **kw)
            except Exception:  # English needs espeak; fall back to plain Twi
                s = model.synthesize(re.sub(r"[\[\]]", "", said), language="twi", **kw)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(s.sample_rate)
            w.writeframes((np.clip(s.audio, -1, 1) * 32767).astype("<i2").tobytes())
        return buf.getvalue(), s.duration


# --- web ---------------------------------------------------------------------------------------

def make_handler(voices: Voices):
    page = (HERE / "index.html").read_bytes()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body: bytes, ctype: str, extra: dict | None = None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                self._send(200, page, "text/html; charset=utf-8")
            elif self.path == "/api/voices":
                self._send(200, json.dumps(voices.rescan()).encode(), "application/json")
            elif self.path == "/api/status":
                self._send(200, json.dumps(training_status()).encode(), "application/json")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self):
            if self.path != "/api/speak":
                return self._send(404, b"not found", "text/plain")
            try:
                n = int(self.headers.get("Content-Length", "0"))
                req = json.loads(self.rfile.read(min(n, 100_000)) or b"{}")
                voice = req.get("voice") or voices.info[0]["id"]
                if voice not in voices.dirs:
                    raise ValueError(f"Unknown voice {voice!r}")
                wav, dur = voices.speak(str(req.get("text", "")), voice, float(req.get("speed", 1.0)))
                self._send(200, wav, "audio/wav", {"X-Duration": f"{dur:.2f}"})
            except ValueError as e:
                self._send(400, json.dumps({"error": str(e)}).encode(), "application/json")
            except Exception as e:  # noqa: BLE001
                self._send(500, json.dumps({"error": f"{type(e).__name__}: {e}"}).encode(),
                           "application/json")

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7860)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    print("Loading voices...", flush=True)
    v = Voices()
    for i in v.info:
        print(f"  {i['label']}  [{i['detail']}]")
    url = f"http://{a.host}:{a.port}"
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(v))
    print(f"Twi Voice is running at {url}  (Ctrl+C to stop)", flush=True)
    if not a.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
