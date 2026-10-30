"""Load Ghana Voice models and turn text into speech.

    from ghana_voice.synth import GhanaVoice
    gv = GhanaVoice()
    wav_bytes = gv.speak_wav("Akwaaba! Ɛhɔ yɛ 28°C.", "tw")

Where each language's model comes from, first match wins:
  1. GHANA_VOICE_MODELS/<code>/   a fine-tuned voice from train.py (or any VitsModel folder)
  2. facebook/mms-tts-<base>      the MMS starting voice (status "ready", or "approx" when enabled)
"""

from __future__ import annotations

import io
import logging
import os
import threading
import wave
from collections import OrderedDict
from pathlib import Path

import numpy as np

from . import languages
from .text import clean, fit_to_vocab, segments, sentences

log = logging.getLogger("ghana_voice")

SENTENCE_PAUSE_S = 0.25
PART_PAUSE_S = 0.08


class UnknownLanguage(ValueError):
    pass


def enabled_languages(models_dir: Path | None) -> list[str]:
    """Languages this server will speak.

    GHANA_VOICE_LANGS (comma list) when set; otherwise every "ready" language plus
    any language with a fine-tuned folder in models_dir.
    """
    env = os.environ.get("GHANA_VOICE_LANGS", "").strip()
    if env:
        codes = [c.strip() for c in env.split(",") if c.strip()]
        for c in codes:
            languages.get(c)  # exits with a clear message on a typo
        return codes
    codes = [c for c, l in languages.LANGS.items() if l.status == "ready"]
    if models_dir and models_dir.is_dir():
        codes += [p.name for p in models_dir.iterdir() if p.name in languages.LANGS and (p / "config.json").exists()]
    return sorted(set(codes), key=list(languages.LANGS).index)


def voice_source(code: str, models_dir: Path | None) -> str:
    """Fine-tuned folder when there is one, else the MMS starting voice."""
    if models_dir and (models_dir / code / "config.json").exists():
        return str(models_dir / code)
    return languages.get(code).base_model


class _Model:
    def __init__(self, source: str, threads: int):
        import torch
        from transformers import AutoTokenizer, VitsModel

        torch.set_num_threads(threads)
        self.torch = torch
        self.model = VitsModel.from_pretrained(source).eval()
        self.tokenizer = AutoTokenizer.from_pretrained(source)
        self.rate = int(self.model.config.sampling_rate)
        self.vocab = set(self.tokenizer.get_vocab())
        self.lock = threading.Lock()

    def say(self, text: str, lookalikes: dict[str, str] | None, seed: int) -> np.ndarray:
        text = fit_to_vocab(text, self.vocab, lookalikes)
        if not text:
            return np.zeros(0, dtype=np.float32)
        inputs = self.tokenizer(text, return_tensors="pt")
        if inputs["input_ids"].shape[-1] == 0:
            return np.zeros(0, dtype=np.float32)
        with self.lock, self.torch.inference_mode():
            self.torch.manual_seed(seed)  # VITS durations are random; same text, same voice
            wav = self.model(**inputs).waveform[0]
        return wav.float().numpy()


class GhanaVoice:
    def __init__(
        self,
        models_dir: str | Path | None = None,
        threads: int | None = None,
        english: bool | None = None,
        max_loaded: int = 4,
    ):
        md = models_dir or os.environ.get("GHANA_VOICE_MODELS")
        self.models_dir = Path(md) if md else None
        self.threads = threads or int(os.environ.get("GHANA_VOICE_THREADS", str(min(4, os.cpu_count() or 1))))
        self.english = english if english is not None else os.environ.get("GHANA_VOICE_ENGLISH", "1") != "0"
        self.languages = enabled_languages(self.models_dir)
        self.max_loaded = max_loaded  # each voice is ~150 MB in memory
        self._models: OrderedDict[str, _Model] = OrderedDict()
        self._load_lock = threading.Lock()

    def source(self, code: str) -> str:
        return voice_source(code, self.models_dir)

    def _model(self, key: str, source: str) -> _Model:
        with self._load_lock:
            m = self._models.get(key)
            if m is None:
                log.info("loading %s voice from %s", key, source)
                m = _Model(source, self.threads)
                self._models[key] = m
                while len(self._models) > self.max_loaded:
                    old, _ = self._models.popitem(last=False)
                    log.info("unloading %s voice", old)
            self._models.move_to_end(key)
            return m

    def speak(self, text: str, lang: str, seed: int = 0) -> tuple[np.ndarray, int]:
        """Float32 mono waveform in [-1, 1] and its sample rate."""
        if lang not in self.languages:
            raise UnknownLanguage(lang)
        info = languages.get(lang)
        native = self._model(lang, self.source(lang))
        rate = native.rate
        english = self._model("en", os.environ.get("GHANA_VOICE_ENGLISH_MODEL") or languages.ENGLISH_MODEL) if self.english else None

        parts: list[np.ndarray] = []
        for sentence in sentences(clean(text)):
            pieces = []
            for kind, chunk in segments(sentence):
                if kind == "en":
                    if english is None:
                        continue
                    audio = english.say(chunk, None, seed)
                    audio = _resample(audio, english.rate, rate)
                else:
                    audio = native.say(chunk, info.lookalikes, seed)
                if audio.size:
                    pieces.append(audio)
            if pieces:
                parts.append(_join(pieces, rate, PART_PAUSE_S))
        if not parts:
            return np.zeros(0, dtype=np.float32), rate
        return _join(parts, rate, SENTENCE_PAUSE_S), rate

    def speak_wav(self, text: str, lang: str, seed: int = 0) -> bytes:
        audio, rate = self.speak(text, lang, seed)
        return to_wav(audio, rate)


def _join(pieces: list[np.ndarray], rate: int, pause_s: float) -> np.ndarray:
    gap = np.zeros(int(rate * pause_s), dtype=np.float32)
    out: list[np.ndarray] = []
    for i, p in enumerate(pieces):
        if i:
            out.append(gap)
        out.append(p.astype(np.float32))
    return np.concatenate(out)


def _resample(audio: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or not audio.size:
        return audio
    n = int(round(len(audio) * dst / src))
    return np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)


def to_wav(audio: np.ndarray, rate: int) -> bytes:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak
    pcm = (np.clip(audio, -1, 1) * 32767 * 0.95).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()
