"""Step 2: build the starting checkpoint for fine-tuning one language.

    python make_base.py --lang dag

1. Converts the MMS voice for the language's base (facebook/mms-tts-<base>) into a trainable
   checkpoint, with the discriminator VITS needs for training (finetune-hf-vits does this).
2. Adds letters the language writes but the base voice never saw (Dagbani ɣ and ʒ on the
   Mampruli voice, for example). Each new letter starts from the closest known sound,
   so training only has to adjust it. Existing letters keep their ids, so nothing the
   voice already knows is lost.
3. Rewrites data/<lang>/metadata.csv so the text uses only letters the model has
   (the original stays in raw_text).

Needs finetune-hf-vits (setup_training.sh clones it to speech/finetune-hf-vits).
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from ghana_voice import languages  # noqa: E402
from ghana_voice.text import fit_to_vocab  # noqa: E402

HERE = Path(__file__).parent
EMBED_KEY = "text_encoder.embed_tokens.weight"
MIN_COUNT = 20  # a letter must appear this often in the data to get its own token


def convert(base: str, out: Path, fhv: Path):
    script = fhv / "convert_original_discriminator_checkpoint.py"
    if not script.exists():
        raise SystemExit(f"{script} not found. Run setup_training.sh first (or pass --fhv).")
    subprocess.run(
        [sys.executable, str(script), "--language_code", base, "--pytorch_dump_folder_path", str(out)],
        check=True,
        cwd=fhv,
    )


def read_rows(data: Path) -> list[dict]:
    with (data / "metadata.csv").open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def new_letters(texts: list[str], vocab: dict[str, int], lang: languages.Lang) -> dict[str, str]:
    """Letters to add -> the known letter whose embedding they start from ("" = average)."""
    counts: Counter[str] = Counter()
    for t in texts:
        for ch in unicodedata.normalize("NFC", t.lower()):
            counts[ch if ch in vocab else lang.lookalikes.get(ch, ch)] += 1
    add = {}
    for ch, n in counts.items():
        if ch in vocab or n < MIN_COUNT or not unicodedata.category(ch).startswith("L"):
            continue
        base = unicodedata.normalize("NFD", ch)[0]
        if base != ch and base in vocab:
            continue  # an accented known letter: fit_to_vocab drops the accent instead
        seed = lang.new_letters.get(ch, base if base in vocab else "")
        add[ch] = seed if seed in vocab else ""
    for ch, seed in lang.new_letters.items():  # listed letters are added even when rare
        if ch not in vocab and ch not in add:
            add[ch] = seed if seed in vocab else ""
    return add


def reserved_ids(model_dir: Path) -> set[int]:
    ids: set[int] = set()
    added = model_dir / "added_tokens.json"
    if added.exists():
        ids |= {int(i) for i in json.loads(added.read_text(encoding="utf-8")).values()}
    tc = model_dir / "tokenizer_config.json"
    if tc.exists():
        ids |= {int(i) for i in json.loads(tc.read_text(encoding="utf-8")).get("added_tokens_decoder", {})}
    return ids


def extend_vocab(model_dir: Path, add: dict[str, str]) -> dict[str, int]:
    """Append letters to vocab.json and grow the text embedding to match."""
    import torch

    vocab = json.loads((model_dir / "vocab.json").read_text(encoding="utf-8"))
    if not add:
        return vocab
    cfg_path = model_dir / "config.json"
    cfg = json.loads(cfg_path.read_text())
    st = model_dir / "model.safetensors"
    if st.exists():
        from safetensors.torch import load_file, save_file

        state = load_file(st)
    else:
        bin_path = model_dir / "pytorch_model.bin"
        state = torch.load(bin_path, map_location="cpu")
    key = next((k for k in state if k.endswith(EMBED_KEY)), None)
    if key is None:
        raise SystemExit(f"No {EMBED_KEY} in {model_dir}")
    emb = state[key]
    # Special tokens such as <unk> live outside vocab.json (added_tokens.json, tokenizer_config)
    # but still hold an id. New letters must not reuse it.
    taken = set(vocab.values()) | reserved_ids(model_dir)
    next_id = max(max(taken) + 1, emb.shape[0])
    rows = [emb]
    if next_id > emb.shape[0]:  # filler rows so ids and rows line up
        rows.append(emb.mean(0, keepdim=True).repeat(next_id - emb.shape[0], 1))
    for ch, seed in add.items():
        start = emb[vocab[seed]] if seed else emb.mean(0)
        rows.append(start.clone().unsqueeze(0))
        vocab[ch] = next_id
        print(f"  new letter {ch!r} (id {next_id}) starts from {seed or 'the average letter'!r}")
        next_id += 1
    grown = torch.cat(rows, 0)
    assert grown.shape[0] == next_id, (grown.shape, next_id)
    state[key] = grown.contiguous()
    cfg["vocab_size"] = int(next_id)
    if st.exists():
        save_file(state, st, metadata={"format": "pt"})
    else:
        torch.save(state, bin_path)
    cfg_path.write_text(json.dumps(cfg, indent=2))
    (model_dir / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False, indent=2), encoding="utf-8")
    return vocab


def fit_metadata(data: Path, rows: list[dict], vocab: dict[str, int], lang: languages.Lang):
    kept = dropped = 0
    with (data / "metadata.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file_name", "text", "raw_text"])
        for r in rows:
            raw = r.get("raw_text") or r["text"]
            text = fit_to_vocab(raw, vocab, lang.lookalikes)
            # Lost more than a tenth of the letters: the transcript is in another script or messy.
            if len(text.replace(" ", "")) < 0.9 * len(raw.replace(" ", "")) - 2 or len(text) < 2:
                dropped += 1
                continue
            w.writerow([r["file_name"], text, raw])
            kept += 1
    print(f"  metadata: {kept} clips kept, {dropped} dropped (text the model can't spell)")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lang", required=True, choices=list(languages.LANGS))
    p.add_argument("--data", type=Path, help="default: data/<lang>")
    p.add_argument("--out", type=Path, help="default: bases/<lang>")
    p.add_argument("--fhv", type=Path, default=HERE / "finetune-hf-vits")
    p.add_argument("--skip-convert", action="store_true", help="--out already holds a converted checkpoint")
    a = p.parse_args(argv)

    lang = languages.get(a.lang)
    data = a.data or HERE / "data" / a.lang
    out = a.out or HERE / "bases" / a.lang
    rows = read_rows(data)
    if not a.skip_convert:
        if out.exists():
            shutil.rmtree(out)
        print(f"Converting {lang.base_model} into a trainable checkpoint...")
        convert(lang.base, out.resolve(), a.fhv.resolve())
    vocab = json.loads((out / "vocab.json").read_text(encoding="utf-8"))
    add = new_letters([r.get("raw_text") or r["text"] for r in rows], vocab, lang)
    vocab = extend_vocab(out, add)
    fit_metadata(data, rows, vocab, lang)
    print(f"Base for {lang.name} ready: {out}")


if __name__ == "__main__":
    main()
