"""Step 3: fine-tune the voice on a GPU, then export it for serve.py.

    python train.py --lang ee                      # ~8,000 steps; about 3-4 h on a free Colab T4
    python train.py --lang ee --steps 2000         # a quick first listen
    python train.py --lang ee --hub-id you/ghana-voice-ee   # also upload to Hugging Face

Reads data/<lang>/ (prepare_data.py) and bases/<lang>/ (make_base.py), trains in runs/<lang>/
and copies the finished voice (generator only, ~145 MB) to models/<lang>/, where serve.py
picks it up (set GHANA_VOICE_MODELS to that models/ folder).
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from ghana_voice import languages  # noqa: E402
from ghana_voice.text import fit_to_vocab  # noqa: E402

HERE = Path(__file__).parent


def build_config(lang: languages.Lang, data: Path, base: Path, run: Path, n_clips: int, a) -> dict:
    vocab = json.loads((base / "vocab.json").read_text(encoding="utf-8"))
    steps_per_epoch = max(1, math.ceil(n_clips / a.batch))
    epochs = a.epochs or max(1, math.ceil(a.steps / steps_per_epoch))
    return {
        "project_name": f"ghana_voice_{lang.code}",
        "push_to_hub": bool(a.hub_id),
        **({"hub_model_id": a.hub_id} if a.hub_id else {}),
        "report_to": ["tensorboard"],
        "overwrite_output_dir": True,
        "output_dir": str(run.resolve()),
        # A local "audiofolder": clips + metadata.csv (file_name, text).
        "dataset_name": str(data.resolve()),
        "audio_column_name": "audio",
        "text_column_name": "text",
        "train_split_name": "train",
        "eval_split_name": "train",
        "full_generation_sample_text": fit_to_vocab(lang.sample, vocab, lang.lookalikes),
        "max_duration_in_seconds": 20,
        "min_duration_in_seconds": 1.0,
        "max_tokens_length": 500,
        "model_name_or_path": str(base.resolve()),
        "preprocessing_num_workers": 4,
        "do_train": True,
        "num_train_epochs": epochs,
        "gradient_accumulation_steps": 1,
        "gradient_checkpointing": False,
        "per_device_train_batch_size": a.batch,
        "learning_rate": a.lr,
        "adam_beta1": 0.8,
        "adam_beta2": 0.99,
        "warmup_ratio": 0.01,
        "group_by_length": False,
        "do_eval": True,
        "eval_steps": a.eval_steps,
        "per_device_eval_batch_size": a.batch,
        "max_eval_samples": 25,
        "do_step_schedule_per_epoch": True,
        "weight_disc": 3,
        "weight_fmaps": 1,
        "weight_gen": 1,
        "weight_kl": 1.5,
        "weight_duration": 1,
        "weight_mel": 35,
        "fp16": not a.no_fp16,
        "seed": 456,
    }


def export(run: Path, dest: Path):
    """Keep only what speaking needs: the generator, its config and the tokenizer."""
    from transformers import AutoTokenizer, VitsModel

    if dest.exists():
        shutil.rmtree(dest)
    VitsModel.from_pretrained(run).save_pretrained(dest)
    AutoTokenizer.from_pretrained(run).save_pretrained(dest)
    print(f"Voice exported to {dest}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lang", required=True, choices=list(languages.LANGS))
    p.add_argument("--data", type=Path)
    p.add_argument("--base", type=Path)
    p.add_argument("--run", type=Path, help="training folder, default runs/<lang>")
    p.add_argument("--models", type=Path, default=HERE / "models", help="where the finished voice goes")
    p.add_argument("--fhv", type=Path, default=HERE / "finetune-hf-vits")
    p.add_argument("--steps", type=int, default=8000, help="training steps (turned into epochs)")
    p.add_argument("--epochs", type=int, help="overrides --steps")
    p.add_argument("--batch", type=int, default=16, help="lower to 8 if the GPU runs out of memory")
    p.add_argument("--lr", type=float, default=2e-5)
    p.add_argument("--eval-steps", type=int, default=250)
    p.add_argument("--no-fp16", action="store_true", help="for GPUs without half precision")
    p.add_argument("--hub-id", help="push the voice to this Hugging Face repo (needs `huggingface-cli login`)")
    p.add_argument("--config-only", action="store_true", help="write the training config and stop")
    a = p.parse_args(argv)

    lang = languages.get(a.lang)
    data = a.data or HERE / "data" / a.lang
    base = a.base or HERE / "bases" / a.lang
    run = a.run or HERE / "runs" / a.lang
    for need, step in ((data / "metadata.csv", "prepare_data.py"), (base / "vocab.json", "make_base.py")):
        if not need.exists():
            raise SystemExit(f"{need} is missing: run {step} --lang {a.lang} first")
    with (data / "metadata.csv").open(encoding="utf-8") as f:
        n_clips = sum(1 for _ in csv.DictReader(f))
    if "raw_text" not in (data / "metadata.csv").read_text(encoding="utf-8").splitlines()[0]:
        raise SystemExit(f"Run make_base.py --lang {a.lang} first: it fits the text to the model's letters")

    run.mkdir(parents=True, exist_ok=True)
    cfg = build_config(lang, data, base, run, n_clips, a)
    cfg_path = run / "train_config.json"
    cfg_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{lang.name}: {n_clips} clips, {cfg['num_train_epochs']} epochs, batch {a.batch} -> {cfg_path}")
    if a.config_only:
        return

    script = a.fhv / "run_vits_finetuning.py"
    if not script.exists():
        raise SystemExit(f"{script} not found. Run setup_training.sh first (or pass --fhv).")
    subprocess.run(["accelerate", "launch", str(script.resolve()), str(cfg_path.resolve())], check=True, cwd=a.fhv)
    export(run, a.models / lang.code)
    print(f"Listen: GHANA_VOICE_MODELS={a.models} python serve.py say \"{lang.sample}\" --lang {lang.code}")


if __name__ == "__main__":
    main()
