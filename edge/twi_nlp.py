"""Twi word helper for Ama's chat, using GhanaNLP's DistilABENA v2 (a Twi BERT).

    python twi_nlp.py serve --port 5003      # HTTP server for the app (TWI_NLP_URL)
    python twi_nlp.py "Me nkokɔ no ho yɛ ___"  # try it in the terminal

DistilABENA can't chat. It predicts Twi words: the next word of a sentence, or
the word in a blank (___). In a test against GPT-4o-mini on GhanaNLP's own Twi
sentences it guessed hidden words better (65% vs 52% first guess).

POST /suggest {"text": "...", "k": 5}  ->  {"words": [{"word": "...", "score": 0.4}], "mode": "next"|"blank"}
GET  /health

Runs on a PC (PyTorch). Set PG_NLP_TOKEN to require "authorization: Bearer <token>".
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import threading
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("poultrygrid.nlp")
MODEL = os.environ.get("PG_NLP_MODEL", "Ghana-NLP/distilabena-base-v2-asante-twi-uncased")
# The model repo only has pickle weights; Hugging Face's converter bot published a
# safetensors copy on this branch, which loads without running pickled code.
REVISION = os.environ.get("PG_NLP_REVISION", "refs/pr/1")
BLANK = re.compile(r"_{2,}")


class Helper:
    def __init__(self):
        import torch
        from transformers import AutoModelForMaskedLM, AutoTokenizer

        self.torch = torch
        self.tok = AutoTokenizer.from_pretrained(MODEL)
        self.model = AutoModelForMaskedLM.from_pretrained(MODEL, revision=REVISION, use_safetensors=True).eval()
        self.lock = threading.Lock()
        # Ids that are punctuation, digits, sub-word pieces or special tokens: never suggest them.
        vocab = self.tok.get_vocab()
        self.bad = torch.tensor([
            i for t, i in vocab.items()
            if t.startswith("##") or t.startswith("[") or not re.fullmatch(r"[^\W\d_]{2,}", t)
        ])

    def suggest(self, text: str, k: int = 5):
        text = unicodedata.normalize("NFC", text).lower()[-600:]
        mode = "blank" if BLANK.search(text) else "next"
        mask = self.tok.mask_token
        if mode == "blank":
            masked = BLANK.sub(mask, text, count=1)
        else:
            # Predict the word after what's typed. A trailing full stop gives the
            # model a sentence frame, the way it saw text in training.
            masked = f"{text.rstrip()} {mask} ."
        enc = self.tok(masked, return_tensors="pt", truncation=True, max_length=128)
        pos = (enc.input_ids[0] == self.tok.mask_token_id).nonzero()
        if not len(pos):
            return {"words": [], "mode": mode}
        with self.lock, self.torch.no_grad():
            logits = self.model(**enc).logits[0, pos[0].item()]
        logits[self.bad] = -1e9
        probs = logits.softmax(-1)
        top = probs.topk(k)
        words = [{"word": self.tok.convert_ids_to_tokens([i])[0], "score": round(float(p), 3)}
                 for p, i in zip(top.values, top.indices)]
        return {"words": words, "mode": mode}


def serve(helper: Helper, host: str, port: int):
    token = os.environ.get("PG_NLP_TOKEN", "")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            log.debug("%s %s", self.address_string(), fmt % args)

        def _send(self, code: int, body: dict):
            data = json.dumps(body, ensure_ascii=False).encode()
            try:
                self.send_response(code)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionError):
                pass

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"ok": True, "model": MODEL})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/suggest":
                return self._send(404, {"error": "not found"})
            if token and self.headers.get("authorization") != f"Bearer {token}":
                return self._send(401, {"error": "unauthorized"})
            try:
                n = int(self.headers.get("content-length") or 0)
                data = json.loads(self.rfile.read(min(n, 16_000)) or b"{}")
                k = max(1, min(int(data.get("k", 5)), 10))
                self._send(200, helper.suggest(str(data.get("text", "")), k))
            except Exception as e:
                self._send(400, {"error": str(e)[:300]})

    httpd = ThreadingHTTPServer((host, port), Handler)
    log.info("Twi word helper (%s) on http://%s:%d", MODEL, host, port)
    httpd.serve_forever()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("text", nargs="?", default="serve")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5003)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    helper = Helper()
    if args.text == "serve":
        serve(helper, args.host, args.port)
    else:
        print(json.dumps(helper.suggest(args.text), ensure_ascii=False))


if __name__ == "__main__":
    main()
