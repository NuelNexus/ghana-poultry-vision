"""NELVIN narration for the guide videos (called by videos/build.mjs).

    python videos/voice.py lines < lines.json   # [{"text", "lang"}] -> {"<lang>|<text>": {"wav", "dur"}}
    python videos/voice.py mix < mix.json       # {"out", "duration", "clips": [{"wav", "at"}]} -> one WAV

Lines are cached in videos/build/voice/, so a re-render only speaks lines that changed.
English lines use NELVIN's English mode; Twi lines use mixed mode (numbers read in English),
the same way Ama speaks in the app. Run it with .venv-twi's Python.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
ROOT = HERE.parent
CACHE = HERE / "build" / "voice"
SPEED = 0.85  # same as the app (PG_TTS_NELVIN_SPEED)
RATE = 22050

sys.path.insert(0, str(ROOT / "edge"))


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
        h = hashlib.sha1(f"nelvin|{SPEED}|{lang}|{text}".encode()).hexdigest()[:16]
        p = CACHE / f"{h}.wav"
        if not p.exists():
            if model is None:
                import twi_tts
                from stable_twi_tts import StableTwiTTS

                twi_tts._lenient_symbols()
                model = (StableTwiTTS(ROOT / "edge" / "voices" / "nelvin", num_threads=4), twi_tts.prepare)
            tts, prepare = model
            if lang == "tw":
                # [bracketed] spans are English (build.mjs marks the app's English words);
                # prepare() marks numbers in the Twi between them.
                parts = re.split(r"(\[[^\]]*\])", text)
                said = " ".join(p if p.startswith("[") else prepare(p) for p in parts if p.strip())
                s = tts.synthesize(said, voice="nelvin", language="mixed", length_scale=1 / SPEED)
            else:
                s = tts.synthesize(text, voice="nelvin", language="eng", length_scale=1 / SPEED)
            assert s.sample_rate == RATE, s.sample_rate
            # Trim silence at the ends so timing is exact, then a short fade so nothing clicks.
            a = s.audio.astype(np.float32)
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
