# NELVIN voice: fine-tuning stable-twi-tts

How `edge/voices/nelvin` was made: GhanaNLP's [stable-twi-tts](https://huggingface.co/ghananlpcommunity/stable-twi-tts)
(Piper VITS) fine-tuned on 78 recordings of NELVIN (`../Twi AI`, about 4 minutes once cleaned), on a CPU-only PC.

The model is CC BY-NC 4.0 (non-commercial), inherited from stable-twi-tts.

## What's here

| | |
|---|---|
| `scripts/prep_data.py` | Recordings -> 22.05 kHz mono, clicks and long pauses cut, Twi -> phoneme ids (`metadata.csv`) |
| `scripts/make_start_ckpt.py` | Seeds NELVIN's speaker slot (0) from the stock male voice twi-6 |
| `scripts/train.sh` | Piper training run (300 epochs, batch 8, lr 1e-4, CPU) |
| `scripts/autoexport.sh` | Exports a snapshot every 50 epochs while training, and the final voice |
| `scripts/export_voice.py`, `say.py` | Checkpoint -> ONNX voice folder; synthesize test sentences |
| `app/` + `Start Twi Voice.bat` | Local page to type Twi and hear it, and compare training snapshots side by side |
| `piper-patch/` | Changes to [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (commit in `BASE_COMMIT.txt`) so it trains on Windows without a C compiler |

## Redo it

1. Clone piper1-gpl at the commit in `piper-patch/BASE_COMMIT.txt`, `git apply piper-patch/piper1-gpl.patch`,
   and copy `monotonic_align_core.py` to `src/piper/train/vits/monotonic_align/core.py` (numba instead of Cython).
2. Download `finetune/` from the stable-twi-tts repo into `upstream/finetune/`.
3. `python scripts/prep_data.py --src "../Twi AI" --out data-clean --config upstream/finetune/config.json`
4. `python scripts/make_start_ckpt.py`, then `DATA=data-clean START=start.ckpt bash scripts/train.sh 300 runs/nelvin-clean`
5. `python scripts/export_voice.py --checkpoint runs/.../last.ckpt --out voices/nelvin`, then copy it to `edge/voices/nelvin`.

The scripts were written for a working folder at `D:/twi-tts-finetune`; change the `cd` lines in the `.sh` files to match yours.
Checkpoints (17 GB) are not in the repo.

## Lessons

- Silence and clicks in the recordings taught the model to pause for seconds. Cutting them (`trim()` in
  `prep_data.py`, -26 dB threshold) brought 5 test sentences from 31 s to about 20 s.
- More general Twi data (BibleTTS, WAXAL) improves pronunciation, not likeness: the stock model already saw 164 h
  of Twi. More NELVIN recordings is what makes it sound more like him.
