"""PoultryGrid Twi voice for Ama, on the Raspberry Pi (GhanaNLP stable-twi-tts).

    python twi_tts.py                     # worker: take Twi replies from the app, speak them, send the audio back
    python twi_tts.py serve --port 5002   # or: a plain HTTP voice server (same network / tunnel)
    python twi_tts.py say "Akwaaba!" --out hello.wav
    python twi_tts.py bench               # how fast this Pi speaks

The worker needs no open ports: it polls the app with the Pi's device key
(PG_API_URL, PG_DEVICE_ID, PG_DEVICE_API_KEY, the same agent.env as agent.py).
It checks every 20 s, and every second while someone is talking to Ama in Twi.

Settings (env or agent.env):
  PG_TTS_VOICE    voice, default twi-6 (clearest for pure Twi; see `stable-twi-tts --list-voices`)
  PG_TTS_THREADS  CPU threads for synthesis, default 4 (a Pi 4/5 has 4 cores)
  PG_TTS_CACHE    where the 80 MB voice model is cached
  PG_TTS_TOKEN    bearer token required by `serve` (recommended whenever it is reachable)

The voice model is CC BY-NC 4.0 (non-commercial use only); the code is MIT.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import os
import re
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).parent
log = logging.getLogger("poultrygrid.tts")
MAX_CHARS = 2000


def _load_env_file(path: Path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# Text -> what the voice can say -------------------------------------------------
# The Twi voice drops digits silently, and Ama's replies are full of readings
# ("28.2°C", "65%"). Ghanaians say numbers in English inside Twi anyway, so
# numbers (with their unit) and quoted English phrases are marked [like this],
# which stable-twi-tts reads in English in "mixed" mode.

_UNITS = {"°c": "degrees", "℃": "degrees", "°": "degrees", "%": "percent", "rpm": "r p m"}
_NUM = re.compile(r"(\d+(?:[.,]\d+)?)\s*(°\s*c|℃|°|%|rpm)?", re.IGNORECASE)
_QUOTED_EN = re.compile(r"[\"“”']([A-Za-z][A-Za-z \-]{1,40})[\"“”']")


def prepare(text: str) -> str:
    text = text.replace("**", "")
    text = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", text, flags=re.M)  # list markers
    text = _QUOTED_EN.sub(lambda m: f"[{m.group(1)}]", text)

    def num(m: re.Match) -> str:
        n = m.group(1).replace(",", ".")
        unit = _UNITS.get(re.sub(r"\s", "", (m.group(2) or "").lower()), "")
        return f"[{n} {unit}]".replace(" ]", "]")

    text = _NUM.sub(num, text)
    return re.sub(r"\s+", " ", text).strip()[:MAX_CHARS]


def _lenient_symbols():
    """Let the voice say words whose phonemes it never saw in training.

    The Twi front-end sometimes writes a sound with a tie bar (t͡ɕʰ) that the
    model only knows without one (tɕʰ). Instead of failing the whole reply,
    drop the tie bar, else use the longest known prefix, else skip that sound.
    """
    import stable_twi_tts.tts as tts_mod

    original = tts_mod.to_ids
    if getattr(original, "_lenient", False):
        return

    def to_ids(units, id_map, language):
        fixed = []
        for u in units:
            if u in id_map:
                fixed.append(u)
                continue
            v = u.replace("͡", "")
            sub = v if v in id_map else next((v[:k] for k in range(len(v) - 1, 0, -1) if v[:k] in id_map), None)
            log.debug("phoneme %r -> %r", u, sub)
            if sub:
                fixed.append(sub)
        return original(fixed, id_map, language)

    to_ids._lenient = True
    tts_mod.to_ids = to_ids


class Voice:
    def __init__(self):
        from stable_twi_tts import StableTwiTTS
        from stable_twi_tts.download import ensure_model

        _lenient_symbols()
        cache = os.environ.get("PG_TTS_CACHE") or None
        self.voice = os.environ.get("PG_TTS_VOICE", "twi-6")
        self.tts = StableTwiTTS(ensure_model(cache), num_threads=int(os.environ.get("PG_TTS_THREADS", "4")))
        self.lock = threading.Lock()  # one synthesis at a time; the Pi has no cores to spare
        self.tts.synthesize("Akwaaba", voice=self.voice)  # warm up

    def wav(self, text: str, voice: str | None = None) -> tuple[bytes, float]:
        """Speak Twi text. Returns (WAV bytes, seconds of audio)."""
        said = prepare(text)
        if not said:
            raise ValueError("nothing to say")
        v = voice or self.voice
        with self.lock:
            try:
                s = self.tts.synthesize(said, voice=v, language="mixed")
            except Exception as e:  # English support (espeak) missing, or an odd symbol
                log.warning("mixed synthesis failed (%s); retrying as plain Twi", e)
                s = self.tts.synthesize(re.sub(r"[\[\]]", "", said), voice=v, language="twi")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(s.sample_rate)
            pcm = (s.audio.clip(-1, 1) * 32767).astype("<i2")
            w.writeframes(pcm.tobytes())
        return buf.getvalue(), s.duration


# Worker: the app hands out jobs -------------------------------------------------

class Worker:
    def __init__(self, voice: Voice):
        self.voice = voice
        self.api = os.environ.get("PG_API_URL", "").rstrip("/")
        self.headers = {
            "x-device-id": os.environ.get("PG_DEVICE_ID", ""),
            "x-api-key": os.environ.get("PG_DEVICE_API_KEY", ""),
        }
        self.running = True

    def _request(self, method: str, path: str, body: dict | None = None, timeout: float = 30):
        req = urllib.request.Request(
            self.api + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={**self.headers, "content-type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read() or b"{}")

    def run(self):
        if not (self.api and self.headers["x-device-id"] and self.headers["x-api-key"]):
            sys.exit("Set PG_API_URL, PG_DEVICE_ID and PG_DEVICE_API_KEY (the same values as agent.py).")
        log.info("Twi voice worker polling %s as %s", self.api, self.headers["x-device-id"])
        backoff = 5
        while self.running:
            try:
                res = self._request("GET", "/api/public/devices/tts?wait=1", timeout=30)
                backoff = 5
                job = res.get("job")
                if job:
                    self.handle(job)
                    continue
                if not res.get("hot"):
                    self._sleep(20)  # nobody is talking to Ama: check occasionally
            except urllib.error.HTTPError as e:
                log.warning("app said %s: %s", e.code, e.read()[:200])
                self._sleep(backoff)
                backoff = min(backoff * 2, 120)
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                log.warning("app unreachable (%s); retrying in %ss", e, backoff)
                self._sleep(backoff)
                backoff = min(backoff * 2, 120)

    def handle(self, job: dict):
        t = time.perf_counter()
        try:
            audio, secs = self.voice.wav(job["text"], job.get("voice"))
            body = {"audio": base64.b64encode(audio).decode()}
            log.info("spoke %.1fs of audio in %.1fs (%d chars)", secs, time.perf_counter() - t, len(job["text"]))
        except Exception as e:
            log.exception("synthesis failed")
            body = {"error": str(e)[:400]}
        try:
            self._request("POST", f"/api/public/devices/tts?job={job['id']}", body, timeout=60)
        except Exception as e:
            log.warning("couldn't upload job %s: %s", job["id"], e)

    def _sleep(self, s: float):
        end = time.time() + s
        while self.running and time.time() < end:
            time.sleep(0.5)


# Server: direct HTTP ---------------------------------------------------------------

def serve(voice: Voice, host: str, port: int):
    token = os.environ.get("PG_TTS_TOKEN", "")
    if host not in ("127.0.0.1", "localhost") and not token:
        log.warning("serving on %s without PG_TTS_TOKEN: anyone who can reach it can use it", host)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            log.info("%s %s", self.address_string(), fmt % args)

        def _send(self, code: int, body: bytes, ctype="application/json"):
            try:
                self.send_response(code)
                self.send_header("content-type", ctype)
                self.send_header("content-length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionError):
                log.info("caller hung up before the audio was ready")

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, json.dumps({"ok": True, "voice": voice.voice}).encode())
            self._send(404, b'{"error":"not found"}')

        def do_POST(self):
            if self.path != "/synthesize":
                return self._send(404, b'{"error":"not found"}')
            if token and self.headers.get("authorization") != f"Bearer {token}":
                return self._send(401, b'{"error":"unauthorized"}')
            try:
                n = int(self.headers.get("content-length") or 0)
                data = json.loads(self.rfile.read(min(n, 64_000)) or b"{}")
                audio, _ = voice.wav(str(data.get("text", "")), data.get("voice"))
            except Exception as e:
                return self._send(400, json.dumps({"error": str(e)[:300]}).encode())
            self._send(200, audio, "audio/wav")

    httpd = ThreadingHTTPServer((host, port), Handler)
    log.info("Twi voice server on http://%s:%d (POST /synthesize, GET /health)", host, port)
    httpd.serve_forever()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="worker", choices=["worker", "serve", "say", "bench"])
    ap.add_argument("text", nargs="?", default="Wo nkokɔ no ho yɛ hyew. Bue fan no na ma wɔn nsuo.")
    ap.add_argument("--env", default=os.environ.get("PG_ENV_FILE", str(HERE / "agent.env")))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5002)
    ap.add_argument("--out", default="twi.wav")
    args = ap.parse_args()
    _load_env_file(Path(args.env))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    t = time.perf_counter()
    voice = Voice()
    log.info("voice %s loaded in %.1fs", voice.voice, time.perf_counter() - t)

    if args.command == "say":
        audio, secs = voice.wav(args.text)
        Path(args.out).write_bytes(audio)
        print(f"wrote {args.out} ({secs:.1f}s): {prepare(args.text)}")
    elif args.command == "bench":
        for text in ["Akwaaba.", args.text, " ".join([args.text] * 4)]:
            t = time.perf_counter()
            _, secs = voice.wav(text)
            dt = time.perf_counter() - t
            print(f"{secs:5.1f}s of audio in {dt:4.1f}s  ->  {secs / dt:4.1f}x realtime")
    elif args.command == "serve":
        serve(voice, args.host, args.port)
    else:
        w = Worker(voice)
        signal.signal(signal.SIGTERM, lambda *_: setattr(w, "running", False))
        w.run()


if __name__ == "__main__":
    main()
