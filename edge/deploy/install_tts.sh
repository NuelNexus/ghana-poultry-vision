#!/usr/bin/env bash
# Add Ama's Twi voice to a Pi that already runs the PoultryGrid agent (install_pi.sh first).
#   sudo ghana-poultry-vision/edge/deploy/install_tts.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }
[[ "$(uname -m)" == "aarch64" ]] || { echo "Needs 64-bit Raspberry Pi OS (this is $(uname -m))"; exit 1; }
[[ -f /etc/poultrygrid/agent.env ]] || { echo "Run install_pi.sh first (it creates /etc/poultrygrid/agent.env)"; exit 1; }

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/poultrygrid
cp "$SRC/twi_tts.py" "$SRC/requirements-tts.txt" "$APP/edge/"
mkdir -p /var/lib/poultrygrid/tts && chown -R poultrygrid:poultrygrid /var/lib/poultrygrid

echo "==> Python packages (onnxruntime, Twi front-end)"
"$APP/venv/bin/pip" install -q -r "$APP/edge/requirements-tts.txt"

echo "==> Voice model (80 MB, once) and a speed test"
sudo -u poultrygrid PG_TTS_CACHE=/var/lib/poultrygrid/tts "$APP/venv/bin/python" "$APP/edge/twi_tts.py" bench \
  --env /etc/poultrygrid/agent.env

echo "==> Service"
cp "$APP/edge/deploy/poultrygrid-tts.service" /etc/systemd/system/ 2>/dev/null || cp "$SRC/deploy/poultrygrid-tts.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now poultrygrid-tts
sleep 5
systemctl --no-pager status poultrygrid-tts | head -5
echo
echo "Done. Ama now speaks Twi through this Pi. Live log: journalctl -u poultrygrid-tts -f"
