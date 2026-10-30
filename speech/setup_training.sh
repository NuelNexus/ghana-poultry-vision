#!/usr/bin/env bash
# One-time setup for training Ghana Voice (Colab, Kaggle or any Linux machine with an NVIDIA GPU).
#   bash setup_training.sh
set -euo pipefail
cd "$(dirname "$0")"
pip install -q -r requirements-train.txt
if [ ! -d finetune-hf-vits ]; then
  git clone --depth 1 https://github.com/ylacombe/finetune-hf-vits.git
fi
# The fast (Cython) alignment search; the pure-Python one is far too slow to train with.
(cd finetune-hf-vits/monotonic_align && mkdir -p monotonic_align && python setup.py build_ext --inplace >/dev/null)
accelerate config default >/dev/null 2>&1 || true
echo "Ready. Next: python prepare_data.py --lang ee"
