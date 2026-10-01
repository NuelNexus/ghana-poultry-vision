#!/usr/bin/env bash
# Install the PoultryGrid agent on Raspberry Pi OS (Bookworm, Pi 3/4/5/Zero 2 W).
#   git clone https://github.com/NuelNexus/ghana-poultry-vision.git
#   sudo ghana-poultry-vision/edge/deploy/install_pi.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/poultrygrid

echo "==> System packages"
apt-get update -qq
apt-get install -y -qq python3-venv python3-dev libgpiod2 i2c-tools swig liblgpio-dev >/dev/null || \
  apt-get install -y -qq python3-venv python3-dev libgpiod2 i2c-tools >/dev/null
raspi-config nonint do_i2c 0 2>/dev/null || true

echo "==> User and folders"
id poultrygrid &>/dev/null || useradd --system --home "$APP" --shell /usr/sbin/nologin poultrygrid
for g in gpio i2c; do getent group $g >/dev/null && usermod -aG $g poultrygrid; done
mkdir -p "$APP" /etc/poultrygrid /var/lib/poultrygrid
rm -rf "$APP/edge" && cp -r "$SRC" "$APP/edge"
chown -R poultrygrid:poultrygrid /var/lib/poultrygrid

echo "==> Python environment"
python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/edge/requirements-pi.txt"

if [[ ! -f /etc/poultrygrid/agent.env ]]; then
  echo "==> Connect to the app (Devices -> Register device shows these values)"
  read -rp "App URL (e.g. https://your-app.example.com): " url
  read -rp "Device ID: " dev
  read -rp "Device API key: " key
  sed -e "s|^PG_API_URL=.*|PG_API_URL=$url|" -e "s|^PG_DEVICE_ID=.*|PG_DEVICE_ID=$dev|" \
      -e "s|^PG_DEVICE_API_KEY=.*|PG_DEVICE_API_KEY=$key|" "$APP/edge/agent.env.example" > /etc/poultrygrid/agent.env
  chmod 640 /etc/poultrygrid/agent.env
  chgrp poultrygrid /etc/poultrygrid/agent.env
fi

echo "==> Service"
cp "$APP/edge/deploy/poultrygrid-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now poultrygrid-agent
sleep 3
systemctl --no-pager status poultrygrid-agent | head -5
echo
echo "Done. Live log: journalctl -u poultrygrid-agent -f"
echo "Calibrate the MQ-135 in clean air: sudo -u poultrygrid $APP/venv/bin/python $APP/edge/agent.py calibrate --env /etc/poultrygrid/agent.env"
