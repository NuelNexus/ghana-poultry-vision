"""Ghana Voice: speak Twi, Ewe, Hausa, Dagbani, Ga and more, on your own machine.

    python serve.py list                                  # languages and where each voice comes from
    python serve.py say "Akwaaba!" --lang tw --out hi.wav
    python serve.py serve --port 5003                      # HTTP voice server for the app

HTTP API (the app calls it when GHANA_VOICE_URL is set, see src/lib/ghana-voice.server.ts):
    GET  /health      -> {"ok": true, "languages": ["tw", "ee", ...]}
    POST /synthesize  {"text": "...", "lang": "ee"} -> audio/wav (16 kHz mono)
                      404 when this server has no voice for the language

Settings (environment):
  GHANA_VOICE_MODELS   folder of fine-tuned voices, one sub-folder per language code
  GHANA_VOICE_LANGS    comma list of languages to serve (default: ready ones + fine-tuned ones)
  GHANA_VOICE_ENGLISH  1 (default) speaks numbers in English with facebook/mms-tts-eng; 0 skips them
  GHANA_VOICE_ENGLISH_MODEL  another English VitsModel (folder or Hub id) for the numbers
  GHANA_VOICE_THREADS  CPU threads (default: up to 4)
  GHANA_VOICE_TOKEN    bearer token required by `serve` (set it whenever the server is reachable
                       from other machines)

The MMS voices and the ghana-speech recordings are CC BY-NC 4.0 (non-commercial use);
the code is MIT.
"""

from __future__ import annotations

import argparse
import hmac
import json
import logging
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from ghana_voice import languages  # noqa: E402
from ghana_voice.text import MAX_CHARS  # noqa: E402

log = logging.getLogger("ghana_voice.serve")


def cmd_list(_args):
    from ghana_voice.synth import enabled_languages, voice_source

    md = os.environ.get("GHANA_VOICE_MODELS")
    models_dir = Path(md) if md else None
    on = set(enabled_languages(models_dir))
    print(f"{'code':5} {'language':15} {'status':7} {'served':6} voice")
    for code, l in languages.LANGS.items():
        served = "yes" if code in on else "no"
        print(f"{code:5} {l.name:15} {l.status:7} {served:6} {voice_source(code, models_dir)}")


def cmd_say(args):
    from ghana_voice.synth import GhanaVoice

    gv = GhanaVoice()
    t = time.time()
    wav = gv.speak_wav(args.text, args.lang, seed=args.seed)
    Path(args.out).write_bytes(wav)
    print(f"wrote {args.out} ({len(wav) // 1024} KB) in {time.time() - t:.1f} s")


def make_handler(gv, token: str | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "GhanaVoice/1"

        def _send(self, code: int, body: bytes, ctype: str):
            self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj):
            self._send(code, json.dumps(obj).encode(), "application/json")

        def _authorised(self) -> bool:
            if not token:
                return True
            got = self.headers.get("authorization", "")
            return hmac.compare_digest(got.encode(), f"Bearer {token}".encode())

        def do_GET(self):
            if self.path.rstrip("/") in ("", "/health"):
                return self._json(200, {"ok": True, "languages": gv.languages})
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path.rstrip("/") != "/synthesize":
                return self._json(404, {"error": "not found"})
            if not self._authorised():
                return self._json(401, {"error": "bad or missing token"})
            try:
                n = int(self.headers.get("content-length") or 0)
                if n > 64_000:
                    return self._json(413, {"error": "request too large"})
                body = json.loads(self.rfile.read(n) or b"{}")
                text = str(body.get("text") or "").strip()[:MAX_CHARS]
                lang = str(body.get("lang") or "")
            except (ValueError, TypeError):
                return self._json(400, {"error": "send JSON: {text, lang}"})
            if not text:
                return self._json(400, {"error": "text is empty"})
            if lang not in gv.languages:
                return self._json(404, {"error": f"no voice for {lang!r}", "languages": gv.languages})
            t = time.time()
            try:
                wav = gv.speak_wav(text, lang)
            except Exception as e:  # a model that fails to load or speak
                log.exception("synthesis failed")
                return self._json(500, {"error": str(e)[:200]})
            log.info("%s %d chars -> %.1f s audio in %.2f s", lang, len(text), (len(wav) - 44) / 32000, time.time() - t)
            self._send(200, wav, "audio/wav")

        def log_message(self, fmt, *a):
            log.debug(fmt, *a)

    return Handler


def cmd_serve(args):
    from ghana_voice.synth import GhanaVoice

    gv = GhanaVoice()
    token = os.environ.get("GHANA_VOICE_TOKEN") or None
    if not token and args.host not in ("127.0.0.1", "localhost"):
        log.warning("GHANA_VOICE_TOKEN is not set: anyone who can reach this port can use the voice")
    if args.preload:
        for code in gv.languages[: gv.max_loaded]:
            gv.speak("a", code)
    srv = ThreadingHTTPServer((args.host, args.port), make_handler(gv, token))
    log.info("Ghana Voice on http://%s:%d, languages: %s", args.host, args.port, ", ".join(gv.languages))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def main(argv=None):
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(name)s %(message)s")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="languages and their voices").set_defaults(fn=cmd_list)
    s = sub.add_parser("say", help="speak one text to a WAV file")
    s.add_argument("text")
    s.add_argument("--lang", required=True, choices=list(languages.LANGS))
    s.add_argument("--out", default="out.wav")
    s.add_argument("--seed", type=int, default=0)
    s.set_defaults(fn=cmd_say)
    v = sub.add_parser("serve", help="HTTP voice server")
    v.add_argument("--host", default="127.0.0.1")
    v.add_argument("--port", type=int, default=5003)
    v.add_argument("--preload", action="store_true", help="load voices at start instead of on first use")
    v.set_defaults(fn=cmd_serve)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
