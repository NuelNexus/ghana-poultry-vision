#!/usr/bin/env bash
# Start the whole Pi setup on boot: the web app (port 8080), the edge AI agent and
# Ama's Twi voice.
#   sudo scripts/setup-autostart.sh            # everything
#   sudo scripts/setup-autostart.sh --no-tts   # skip the Twi voice (80 MB model)
# Re-run it after changing the edge code to push the new version to /opt/poultrygrid.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$(stat -c %U "$REPO")}"
NPM="$(sudo -u "$USER_NAME" bash -lc 'command -v npm' || true)"
[[ -n "$NPM" ]] || { echo "npm not found for $USER_NAME"; exit 1; }

echo "==> Web app service"
# Stop a dev server started by hand so the service can take port 8080
pkill -u "$USER_NAME" -f "$REPO/node_modules/.bin/vite dev" 2>/dev/null || true
sed -e "s|@USER@|$USER_NAME|" -e "s|@REPO@|$REPO|" -e "s|@NODE_DIR@|$(dirname "$NPM")|g" \
    "$REPO/edge/deploy/poultrygrid-web.service" > /etc/systemd/system/poultrygrid-web.service
systemctl daemon-reload
systemctl enable poultrygrid-web
systemctl restart poultrygrid-web

echo "==> Edge AI agent (installs/updates /opt/poultrygrid, keeps /etc/poultrygrid/agent.env)"
"$REPO/edge/deploy/install_pi.sh"
# Wait for the web app before the agent starts posting (it buffers readings either way)
mkdir -p /etc/systemd/system/poultrygrid-agent.service.d
cat > /etc/systemd/system/poultrygrid-agent.service.d/after-web.conf <<CONF
[Unit]
After=poultrygrid-web.service
Wants=poultrygrid-web.service
CONF
systemctl daemon-reload
systemctl restart poultrygrid-agent

if [[ "${1:-}" != "--no-tts" && "$(uname -m)" == "aarch64" ]]; then
  echo "==> Ama's Twi voice"
  "$REPO/edge/deploy/install_tts.sh"
fi

echo
echo "Everything starts on boot now."
echo "  App:   http://$(hostname -I | awk '{print $1}'):8080"
echo "  Logs:  journalctl -u poultrygrid-web -f    journalctl -u poultrygrid-agent -f    journalctl -u poultrygrid-tts -f"
