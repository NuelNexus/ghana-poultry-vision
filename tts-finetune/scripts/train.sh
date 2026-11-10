#!/bin/bash
# Fine-tune stable-twi-tts on NELVIN (CPU). Usage: scripts/train.sh <max_epochs> [run_dir] [extra args...]
set -euo pipefail
cd /d/twi-tts-finetune
EPOCHS=${1:-300}
RUN=${2:-runs/nelvin}
shift 2 || true
mkdir -p "$RUN"
export PYTHONPATH="$PWD/piper1-gpl/src"
export PYTHONIOENCODING=utf-8
exec .venv/Scripts/python -m piper.train fit \
  --data.voice_name nelvin \
  --data.csv_path ${DATA:-data}/metadata.csv \
  --data.audio_dir ${DATA:-data}/wav \
  --data.dataset_type phoneme_ids \
  --data.phonemes_path upstream/finetune/phonemes.json \
  --data.espeak_voice en-us \
  --data.phoneme_type text \
  --data.num_symbols 256 \
  --data.trim_silence false \
  --data.cache_dir "$RUN/cache" \
  --data.config_path "$RUN/config.json" \
  --data.batch_size 8 \
  --data.num_workers 0 \
  --data.validation_split 0.05 \
  --data.num_test_examples 2 \
  --model.num_speakers 1555 \
  --model.gin_channels 512 \
  --model.sample_rate 22050 \
  --model.warmstart_ckpt "${START:-start.ckpt}" \
  --model.mos_metric none \
  --model.learning_rate 1e-4 \
  --model.learning_rate_d 1e-4 \
  --model.lr_final_ratio 0.3 \
  --trainer.default_root_dir "$RUN" \
  --trainer.max_epochs "$EPOCHS" \
  --trainer.check_val_every_n_epoch 10 \
  --trainer.log_every_n_steps 5 \
  --trainer.accelerator cpu \
  --trainer.precision 32-true \
  "$@"
