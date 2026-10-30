"""Step 1: collect training recordings for one language.

From GhanaNLP's open read-speech set (streamed, only what you ask for is downloaded):
    python prepare_data.py --lang ee --hours 6

From your own recordings (Ga, or your own farm voice): a folder with WAV/FLAC/MP3 files and a
metadata.csv with two columns, file_name,text (one clear speaker, 1-15 s per clip, 1+ hour total):
    python prepare_data.py --lang ga --from-folder my_ga_recordings/

Writes data/<lang>/ as a Hugging Face "audiofolder": the clips plus metadata.csv
(file_name, text). make_base.py then fits the text to the model's alphabet.
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from ghana_voice import languages  # noqa: E402

HERE = Path(__file__).parent

_MAGIC = {b"RIFF": ".wav", b"fLaC": ".flac", b"OggS": ".ogg", b"ID3": ".mp3", b"\xff\xfb": ".mp3", b"\xff\xf3": ".mp3"}


def audio_ext(data: bytes) -> str:
    for magic, ext in _MAGIC.items():
        if data.startswith(magic):
            return ext
    return ".wav"


def usable_text(text: str) -> str | None:
    """Clean a transcript, or None when it shouldn't be trained on.

    Digits are skipped: the Bible readings start chapters with "1 KRONIKA 10." and the
    voice should never learn to guess how a number sounds (numbers are read in English).
    """
    text = unicodedata.normalize("NFC", text or "").strip()
    text = re.sub(r"\s+", " ", text)
    if not text or re.search(r"\d", text) or len(text) < 3:
        return None
    if not re.search(r"\w", text):
        return None
    return text


def from_hub(lang: languages.Lang, out: Path, hours: float, min_s: float, max_s: float,
             skip: int, source_filter: str | None) -> int:
    from datasets import Audio, load_dataset

    if not lang.dataset_config:
        raise SystemExit(f"There is no open dataset for {lang.name}. Record your own and use --from-folder.")
    ds = load_dataset(languages.DATASET, lang.dataset_config, split="train", streaming=True)
    ds = ds.cast_column("audio", Audio(decode=False))  # keep the original bytes: no decoder needed
    want = hours * 3600
    got = 0.0
    rows = []
    pattern = re.compile(source_filter) if source_filter else None
    for i, row in enumerate(ds):
        if i < skip:
            continue
        dur = float(row.get("duration") or 0)
        if not (min_s <= dur <= max_s):
            continue
        if pattern and not pattern.search(str(row.get("source_file") or "")):
            continue
        text = usable_text(row.get("text", ""))
        audio = row["audio"]
        data = audio.get("bytes") or (Path(audio["path"]).read_bytes() if audio.get("path") else None)
        if not text or not data:
            continue
        name = f"clips/{len(rows):06d}{audio_ext(data)}"
        (out / name).write_bytes(data)
        rows.append((name, text))
        got += dur
        if len(rows) % 500 == 0:
            print(f"  {len(rows)} clips, {got / 3600:.2f} h")
        if got >= want:
            break
    write_metadata(out, rows)
    print(f"{lang.name}: {len(rows)} clips, {got / 3600:.2f} h -> {out}")
    return len(rows)


def from_folder(src: Path, out: Path) -> int:
    meta = src / "metadata.csv"
    if not meta.exists():
        raise SystemExit(f"{meta} is missing. It needs two columns: file_name,text")
    rows = []
    with meta.open(newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            text = usable_text(r.get("text", ""))
            path = src / (r.get("file_name") or "")
            if not text:
                print(f"  skipped (empty or has digits, write numbers as words): {r.get('file_name')}")
                continue
            if not path.is_file():
                print(f"  skipped (file not found): {path}")
                continue
            name = f"clips/{len(rows):06d}{path.suffix.lower()}"
            shutil.copyfile(path, out / name)
            rows.append((name, text))
    write_metadata(out, rows)
    print(f"{len(rows)} clips -> {out}")
    return len(rows)


def write_metadata(out: Path, rows: list[tuple[str, str]]):
    with (out / "metadata.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file_name", "text"])
        w.writerows(rows)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lang", required=True, choices=list(languages.LANGS))
    p.add_argument("--out", type=Path, help="default: data/<lang>")
    p.add_argument("--hours", type=float, default=6.0, help="hours of speech to collect (default 6)")
    p.add_argument("--min-seconds", type=float, default=1.0)
    p.add_argument("--max-seconds", type=float, default=15.0)
    p.add_argument("--skip", type=int, default=0, help="skip this many rows first (to pick another reader)")
    p.add_argument("--source-filter", help="regex on source_file, to keep one book or one reader")
    p.add_argument("--from-folder", type=Path, help="your own recordings instead of the open dataset")
    a = p.parse_args(argv)

    lang = languages.get(a.lang)
    out = a.out or HERE / "data" / a.lang
    if out.exists():
        shutil.rmtree(out)
    (out / "clips").mkdir(parents=True)
    n = (
        from_folder(a.from_folder, out)
        if a.from_folder
        else from_hub(lang, out, a.hours, a.min_seconds, a.max_seconds, a.skip, a.source_filter)
    )
    if n < 100:
        print("Warning: under 100 clips. Expect a weak voice; aim for 1,000+ clips (1-2 hours or more).")


if __name__ == "__main__":
    main()
