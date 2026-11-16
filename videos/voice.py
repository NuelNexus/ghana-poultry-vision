"""Narration for the guide videos (called by videos/build.mjs).

    python videos/voice.py lines < lines.json   # [{"text", "lang"}] -> {"<lang>|<text>": {"wav", "dur"}}
    python videos/voice.py mix < mix.json       # {"out", "duration", "clips": [{"wav", "at"}]} -> one WAV

Lines are cached in videos/build/voice/, so a re-render only speaks lines that changed.
English lines are spoken by ElevenLabs (ELEVENLABS_API_KEY, from the environment or the
repo's .env; ELEVENLABS_MODEL / ELEVENLABS_VOICE to change model or voice). Twi lines are spoken by
NELVIN in mixed mode (numbers read in English), the same way Kofi speaks in the app.
Run it with .venv-twi's Python.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
ROOT = HERE.parent
CACHE = HERE / "build" / "voice"
SPEED = 0.85  # same as the app (PG_TTS_NELVIN_SPEED)
RATE = 22050

sys.path.insert(0, str(ROOT / "edge"))

ELEVEN_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
ELEVEN_VOICE = os.environ.get("ELEVENLABS_VOICE", "JBFqnCBsd6RMkjVDRZzb")  # George: warm storyteller


def eleven_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    env = ROOT / ".env"
    if not key and env.exists():
        m = re.search(r"^ELEVENLABS_API_KEY=(.+)$", env.read_text(encoding="utf-8"), re.M)
        key = m.group(1).strip().strip('"') if m else ""
    if not key:
        raise SystemExit("No ELEVENLABS_API_KEY (environment or .env) for the English narration")
    return key


def eleven_speak(text: str) -> np.ndarray:
    """One English line from ElevenLabs, as float audio at RATE (22.05 kHz PCM, no resampling)."""
    body = json.dumps({
        "text": text,
        "model_id": ELEVEN_MODEL,
        "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.15},
    }).encode()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVEN_VOICE}?output_format=pcm_{RATE}"
    for attempt in range(5):
        req = urllib.request.Request(url, data=body, headers={
            "xi-api-key": eleven_key(), "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 4:  # busy: wait and retry
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f"ElevenLabs failed: {e.code} {e.read()[:300]!r}")
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32767


def read_wav(p: Path) -> np.ndarray:
    with wave.open(str(p), "rb") as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32767


def write_wav(p: Path, audio: np.ndarray):
    p.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((audio.clip(-1, 1) * 32767).astype("<i2").tobytes())


def lines(items: list[dict]) -> dict:
    model = None
    out = {}
    for it in items:
        text, lang = it.get("say", it["text"]).strip(), it["lang"]
        engine = f"nelvin|{SPEED}" if lang == "tw" else f"eleven|{ELEVEN_MODEL}|{ELEVEN_VOICE}"
        h = hashlib.sha1(f"{engine}|{lang}|{text}".encode()).hexdigest()[:16]
        p = CACHE / f"{h}.wav"
        if not p.exists() and lang != "tw":
            a = eleven_speak(text)
        elif not p.exists():
            if model is None:
                import twi_tts
                from stable_twi_tts import StableTwiTTS

                twi_tts._lenient_symbols()
                model = (StableTwiTTS(ROOT / "edge" / "voices" / "nelvin", num_threads=4), twi_tts.prepare)
            tts, prepare = model
            # [bracketed] spans are English (build.mjs marks the app's English words);
            # prepare() marks numbers in the Twi between them.
            parts = re.split(r"(\[[^\]]*\])", text)
            said = " ".join(x if x.startswith("[") else prepare(x) for x in parts if x.strip())
            s = tts.synthesize(said, voice="nelvin", language="mixed", length_scale=1 / SPEED)
            assert s.sample_rate == RATE, s.sample_rate
            a = s.audio.astype(np.float32)
        if not p.exists():
            # Trim silence at the ends so timing is exact, then a short fade so nothing clicks.
            loud = np.nonzero(np.abs(a) > 0.02)[0]
            if len(loud):
                a = a[max(0, loud[0] - 400) : loud[-1] + 1600]
            n = min(220, len(a) // 4)
            a[:n] *= np.linspace(0, 1, n)
            a[-n:] *= np.linspace(1, 0, n)
            write_wav(p, a)
            print(f"  voiced: {text[:60]}", file=sys.stderr)
        with wave.open(str(p), "rb") as w:
            dur = w.getnframes() / RATE
        out[f"{lang}|{it['text']}"] = {"wav": str(p), "dur": round(dur, 3)}
    return out


def mix(job: dict):
    track = np.zeros(int(job["duration"] * RATE) + RATE, dtype=np.float32)
    for c in job["clips"]:
        a = read_wav(Path(c["wav"]))
        i = int(c["at"] * RATE)
        end = min(len(track), i + len(a))
        track[i:end] += a[: end - i]
    peak = float(np.abs(track).max()) or 1.0
    write_wav(Path(job["out"]), track * (0.89 / peak))  # about -1 dB


if __name__ == "__main__":
    cmd = sys.argv[1]
    data = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if cmd == "lines":
        sys.stdout.write(json.dumps(lines(data)))
    elif cmd == "mix":
        mix(data)
    else:
        raise SystemExit(f"unknown command {cmd}")
