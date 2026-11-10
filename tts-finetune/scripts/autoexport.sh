#!/bin/bash
# Watch the clean run: export each 50-epoch snapshot as a voice + samples, and the final
# checkpoint as voices/nelvin when training ends. Log: autoexport.log
cd /d/twi-tts-finetune
RUN=runs/nelvin-clean
CK=$RUN/lightning_logs/version_0/checkpoints
export PYTHONIOENCODING=utf-8
done_list=" "
export_one() {  # $1 checkpoint, $2 voice dir name
  .venv/Scripts/python scripts/export_voice.py --checkpoint "$1" --out "voices/$2" > /dev/null 2>&1 \
    && .venv/Scripts/python scripts/say.py "voices/$2" "samples/$2" > /dev/null 2>&1 \
    && echo "$(date '+%H:%M') exported $2" || echo "$(date '+%H:%M') FAILED $2"
}
while true; do
  for f in "$CK"/snap-epoch=*.ckpt; do
    [ -f "$f" ] || continue
    n=$(basename "$f" .ckpt | sed 's/.*=//')
    case "$done_list" in *" $n "*) continue ;; esac
    sleep 20  # let the save finish
    export_one "$f" "nelvin-clean-epoch$n"
    done_list="$done_list$n "
  done
  if grep -q -E "Trainer.fit. stopped|Traceback" train-clean.log 2>/dev/null; then
    if grep -q Traceback train-clean.log; then echo "$(date '+%H:%M') training crashed, see train-clean.log"; fi
    [ -f "$CK/last.ckpt" ] && export_one "$CK/last.ckpt" nelvin
    echo "$(date '+%H:%M') finished"
    exit 0
  fi
  sleep 60
done
