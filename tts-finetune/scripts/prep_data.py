"""Turn the NELVIN recordings into a Piper fine-tuning set.

    python prep_data.py --src "D:/ghana-poultry-vision/Twi AI" --out D:/twi-tts-finetune/data

- audio: 44.1 kHz stereo -> 22.05 kHz mono 16-bit, edge silence trimmed (kept 0.15 s)
- text:  Twi -> phoneme ids with stable-twi-tts's own g2p + to_ids, so training targets
         match exactly what the app feeds the model at synthesis time.
Writes data/wav/*.wav and data/metadata.csv (file|speaker|text|ids).
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from stable_twi_tts.g2p import phonemize, to_ids

SR = 22050


def lenient(u: str, id_map: dict) -> str | None:
    """Same fix as edge/twi_tts.py _lenient_symbols, so training sees what the app sends:
    drop the tie bar (t͡ɕʰ -> tɕʰ), else the longest known prefix, else skip."""
    if u in id_map:
        return u
    v = u.replace("͡", "")
    if v in id_map:
        return v
    return next((v[:k] for k in range(len(v) - 1, 0, -1) if v[:k] in id_map), None)


def trim(x: np.ndarray, sr: int, thresh_db: float = -26.0, edge: float = 0.12,
         max_pause: float = 0.3, keep_pause: float = 0.2, min_voiced: float = 0.08) -> np.ndarray:
    """Cut edge silence and shorten long pauses.

    The recordings have clicks and 1-2 s gaps (W001: ~1.6 s of silence before the word).
    Left in, the model learns to pause for seconds between words. Voiced = 20 ms frames
    within 26 dB of the loudest frame; voiced runs shorter than 80 ms are clicks, not speech.
    """
    frame = int(0.02 * sr)
    n = len(x) // frame
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms / rms.max())
    v = db > thresh_db
    # drop clicks: voiced runs shorter than min_voiced
    i, k = 0, max(1, int(min_voiced / 0.02))
    while i < n:
        if v[i]:
            j = i
            while j < n and v[j]:
                j += 1
            if j - i < k:
                v[i:j] = False
            i = j
        else:
            i += 1
    idx = np.where(v)[0]
    if len(idx) == 0:
        return x
    first, last = idx[0], idx[-1]
    lead = int(edge / 0.02)  # real audio around the edges, so soft onsets (s, h) survive
    first, last = max(0, first - lead), min(n - 1, last + lead)
    v[first:idx[0]] = True
    v[idx[-1]:last + 1] = True
    pieces = [np.zeros(int(0.05 * sr), dtype=x.dtype)]
    i = first
    max_f, keep_f = int(max_pause / 0.02), int(keep_pause / 0.02)
    while i <= last:
        j = i
        while j <= last and v[j] == v[i]:
            j += 1
        seg = x[i * frame:j * frame]
        if not v[i] and (j - i) > max_f:  # long pause: keep its middle keep_pause seconds, faded
            mid = len(seg) // 2
            h = keep_f * frame // 2
            seg = seg[mid - h:mid + h] * 0.3
        pieces.append(seg)
        i = j
    pieces.append(np.zeros(int(0.05 * sr), dtype=x.dtype))
    return np.concatenate(pieces)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--config", required=True, help="stable-twi-tts finetune/config.json")
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    (out / "wav").mkdir(parents=True, exist_ok=True)
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    id_map = cfg["phoneme_id_map"]
    symbols = set(id_map)

    rows = list(csv.DictReader(open(src / "Voice.csv", encoding="utf-8-sig")))
    lines, total = [], 0.0
    for r in rows:
        x, sr = sf.read(src / r["file_name"], dtype="float32", always_2d=True)
        x = x.mean(axis=1)
        if sr != SR:
            from math import gcd
            g = gcd(SR, sr)
            x = resample_poly(x, SR // g, sr // g).astype(np.float32)
        x = trim(x, SR)
        peak = np.max(np.abs(x))
        if peak > 0:
            x = x * (0.89 / peak)  # about -1 dBFS
        sf.write(out / "wav" / r["file_name"], x, SR, subtype="PCM_16")
        total += len(x) / SR

        text = r["text"].strip()
        units = [lenient(u, id_map) for u in phonemize(text, "twi", symbols)]
        ids = to_ids([u for u in units if u], id_map, "twi")
        lines.append(f"{r['file_name']}|{r['speaker_id']}|{text}|{' '.join(map(str, ids))}")

    (out / "metadata.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(lines)} clips, {total/60:.2f} min of audio")
    print("example:", lines[0][:200])


if __name__ == "__main__":
    main()
