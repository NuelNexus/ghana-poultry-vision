"""Export a fine-tuned checkpoint as a stable-twi-tts voice directory.

    python export_voice.py --checkpoint runs/nelvin/.../last.ckpt --out voices/nelvin

Writes model.onnx, config.json and tokens.txt (copied from the stock model: same phoneme map)
and a voices.json listing a single voice "nelvin" (speaker id 0). The other stock voices
are left out because fine-tuning on one speaker drifts the shared layers they rely on.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STOCK = Path(r"C:/Users/imman/AppData/Local/stable-twi-tts/model-v0.1.0")

ap = argparse.ArgumentParser()
ap.add_argument("--checkpoint", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()

out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
env = {"PYTHONPATH": str(ROOT / "piper1-gpl" / "src"), "PYTHONIOENCODING": "utf-8"}
import os
subprocess.run([sys.executable, "-m", "piper.train.export_onnx", "--checkpoint", args.checkpoint,
                "--output-file", str(out / "model.onnx")], check=True, env={**os.environ, **env})

for f in ("config.json", "tokens.txt"):
    shutil.copy(STOCK / f, out / f)
cfg = json.loads((out / "config.json").read_text(encoding="utf-8"))
cfg["speaker_id_map"] = {"NELVIN": 0}
cfg["default_speaker_id"] = 0
(out / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")

voices = {
    "voices": [{"name": "nelvin", "speaker_id": 0, "language": "twi", "hours": 0.11,
                "clips": 78, "source_speaker": "NELVIN"}],
    "default": {"twi_only": "nelvin", "codeswitch": "nelvin"},
    "note": f"Fine-tuned from stable-twi-tts on 78 NELVIN clips; checkpoint {Path(args.checkpoint).name}",
}
(out / "voices.json").write_text(json.dumps(voices, indent=1), encoding="utf-8")
print("voice directory:", out)
