"""PoultryGrid brooder AI on a PC: the brooding-area ESP32 sends raw readings here,
this runs the coop model on them and reports to the app.

    ESP32 (DHT22 + MQ-135) --LAN--> this PC: model v4, smoothing, causes, fan --> app (ingest)

It is the Pi agent (agent.py) with the sensors on an ESP32 instead of the Pi's GPIO:
same model, same smoothing, same fan policy, same offline outbox, same payload, so the
Dashboard, AI Health, Houses, Alerts and Automation pages work exactly as before.

    python brooder_server.py                 # listen on :5004 (npm start runs this for you)
    python brooder_server.py --dry-run       # print the payloads instead of sending them

The ESP32 signs each reading with its device ID and API key (Devices -> Register
device -> Unit 1, the same kind of key the Pi used). This PC forwards with those
credentials, so the app checks the key; any number of ESP32 units can use one PC.

The ESP32 finds this PC by itself: it broadcasts "PG-BROODER?" on UDP port 5004 and
this server answers, so a new IP for the PC from the router doesn't matter.
Windows asks once to allow Python through the firewall: allow it on private networks.

Settings (environment or agent.env next to this file):
    PG_API_URL                 the app, e.g. https://ghana-poultry-vision.vercel.app
    PG_BROODER_PORT            5004 (HTTP and UDP discovery)
    PG_ESP_MQ135_BASELINE_V    only to pin the MQ-135's clean-air voltage by hand; by default
                               it calibrates itself (AutoBaseline below)
    PG_INTERVAL_S              seconds between the ESP32's reports (default 30; the
                               firmware sends at this rate)
    PG_BATCH_START_DATE / PG_BIRD_AGE_DAYS   fallback flock age (the app's wins)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import re
import socket
import sqlite3
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

import agent as pi_agent  # noqa: E402  (same folder)
from poultrygrid.sensors import Reading  # noqa: E402

log = logging.getLogger("poultrygrid.brooder")
DISCOVER = b"PG-BROODER?"
DEVICE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")


class AutoBaseline:
    """The MQ-135's clean-air voltage, learned from its own readings (automatic baseline
    correction, as commercial air-quality sensors do): the cleanest air of the last week
    is taken as clean. Ammonia only ever pushes the voltage *up*, so the low end of the
    readings is the baseline; it follows the sensor as it warms up, ages and drifts.

    Each hour's 10th percentile is kept (robust to a single low glitch); the baseline is
    the lowest of the last 7 days' hours and the current hour. Until the first 3 readings
    (90 s) there is none and the gas level is reported as missing. Saved per unit, so a
    restart of the PC keeps it.
    """

    KEEP_H = 7 * 24
    MIN_V, MAX_V = 0.05, 4.5

    def __init__(self, path: Path):
        self.path = path
        self.hours: list[tuple[int, float]] = []  # (hour number, 10th percentile)
        self.cur_hour = -1
        self.cur: list[float] = []
        try:
            d = json.loads(path.read_text())
            self.hours = [(int(h), float(v)) for h, v in d.get("hours", [])]
            self.cur_hour, self.cur = int(d.get("cur_hour", -1)), [float(v) for v in d.get("cur", [])]
        except (OSError, ValueError, TypeError):
            pass

    @staticmethod
    def _p10(vals: list[float]) -> float:
        v = sorted(vals)
        return v[int(0.1 * (len(v) - 1))]

    def update(self, v: float, now: float | None = None):
        if not self.MIN_V <= v <= self.MAX_V:
            return
        hour = int((now or time.time()) // 3600)
        if hour != self.cur_hour:
            if len(self.cur) >= 10:
                self.hours.append((self.cur_hour, self._p10(self.cur)))
            self.hours = [(h, x) for h, x in self.hours if hour - h <= self.KEEP_H]
            self.cur_hour, self.cur = hour, []
        self.cur.append(v)
        try:
            self.path.write_text(json.dumps({"hours": self.hours, "cur_hour": self.cur_hour,
                                             "cur": self.cur[-200:]}))
        except OSError:
            pass

    @property
    def value(self) -> float | None:
        vals = [x for _, x in self.hours]
        if len(self.cur) >= 3:
            vals.append(self._p10(self.cur))
        return min(vals) if vals else None


class EspSensors:
    """The 'hardware' the Pi agent reads, fed by the ESP32's last report instead of GPIO.

    The fan: the agent decides on/off (with the relay's minimum hold time); the decision
    goes back to the ESP32 in the reply and it switches its relay, if it has one.
    """

    mode = "esp32"
    not_wired = {"light"}  # the brooding-area unit has no LDR

    def __init__(self, baseline: AutoBaseline | float, min_switch_s: float):
        self.baseline = baseline
        self.min_switch_s = min_switch_s
        self.last: dict = {}
        self.want_fan = False
        self._fan_reported: bool | None = None
        self._switched_at = 0.0

    @property
    def fan_on(self) -> bool:
        # What the ESP32 says its relay is doing, else what we asked for.
        return self._fan_reported if self._fan_reported is not None else self.want_fan

    def set_fan(self, on: bool, force: bool = False):
        if on == self.want_fan:
            return
        if not force and time.monotonic() - self._switched_at < self.min_switch_s:
            return  # hold, so the relay doesn't chatter
        self.want_fan, self._switched_at = on, time.monotonic()

    def gas_index(self, v: float | None) -> float | None:
        # Same scale as the Pi on the ADS1115: % above the clean-air voltage.
        if v is None:
            return None
        if isinstance(self.baseline, AutoBaseline):
            self.baseline.update(v)
            base = self.baseline.value
        else:
            base = self.baseline
        if not base or base <= 0:
            return None
        return round(max(0.0, (v - base) / base * 100.0), 2)

    def read(self) -> Reading:
        r = self.last
        if "fan_on" in r and r["fan_on"] is not None:
            self._fan_reported = bool(r["fan_on"])
        return Reading(
            humidity=r.get("humidity"),
            gas_index=self.gas_index(r.get("mq_voltage")),
            temperature=r.get("temperature"),
            light=None,
            fan_on=self.fan_on,
        )

    def close(self):
        pass


class RemoteAgent(pi_agent.Agent):
    """The Pi agent for one ESP32. Readings are scored at once (the ESP32 gets its
    answer straight away); sending to the app happens on a background thread."""

    def __init__(self, cfg: pi_agent.Config, hw: EspSensors, dry_run: bool):
        super().__init__(cfg, hw, dry_run=dry_run)
        # The outbox is written by the sender thread, created here.
        self.outbox.db.close()
        self.outbox.db = sqlite3.connect(cfg.outbox_path, check_same_thread=False)
        self._q: queue.Queue = queue.Queue()
        threading.Thread(target=self._sender, daemon=True, name=f"send-{cfg.device_id}").start()
        self.last_payload: dict | None = None
        self.last_error: str | None = None

    def _send(self, payload: dict):  # called from tick()
        self.last_payload = payload
        self._q.put(payload)

    def _sender(self):
        while True:
            payload = self._q.get()
            try:
                super()._send(payload)
                self.last_error = None
            except Exception as e:  # never let the sender thread die
                self.last_error = str(e)
                log.exception("Sending to the app failed")


def base_config(args) -> pi_agent.Config:
    cfg = pi_agent.Config.from_env()
    cfg.fan_auto = True  # the decision is only sent back; the ESP32 owns the relay
    if args.interval:
        cfg.interval_s = args.interval
    return cfg


class Brooders:
    """One RemoteAgent per ESP32 device ID, created on its first reading."""

    def __init__(self, args):
        self.args = args
        self.cfg = base_config(args)
        fixed = os.environ.get("PG_ESP_MQ135_BASELINE_V")
        self.fixed_baseline = float(fixed) if fixed else None
        self.agents: dict[str, RemoteAgent] = {}
        self.lock = threading.Lock()

    def agent_for(self, device_id: str, api_key: str) -> RemoteAgent:
        with self.lock:
            a = self.agents.get(device_id)
            if a is None or a.cfg.api_key != api_key:
                cfg = pi_agent.Config(**{**self.cfg.__dict__})
                cfg.device_id, cfg.api_key = device_id, api_key
                safe = re.sub(r"[^A-Za-z0-9_-]", "_", device_id)
                cfg.outbox_path = HERE / f"outbox-{safe}.sqlite3"
                base = self.fixed_baseline or AutoBaseline(HERE / f"mq135-baseline-{safe}.json")
                hw = EspSensors(base, cfg.relay_min_switch_s)
                a = RemoteAgent(cfg, hw, self.args.dry_run)
                self.agents[device_id] = a
                log.info("ESP32 %s connected (model %s)", device_id, a.model.version)
            return a

    def handle(self, device_id: str, api_key: str, body: dict) -> dict:
        a = self.agent_for(device_id, api_key)
        a.hw.last = body
        p = a.tick()
        ai = p["ai"]
        return {
            "ok": True,
            "status": ai["status"],
            "confidence": ai["confidence"],
            "causes": [c["label"] for c in ai["causes"]],
            "fan_on": a.hw.want_fan if a.fan_override is None else a.fan_override == "on",
            "target_temp": ai["target_temp"],
            "interval_s": int(a.cfg.interval_s),
            "gas_baseline_v": (round(a.hw.baseline.value, 3)
                               if isinstance(a.hw.baseline, AutoBaseline) and a.hw.baseline.value
                               else a.hw.baseline if isinstance(a.hw.baseline, float) else None),
            "app": "error" if a.last_error else "ok",
        }


def make_handler(brooders: Brooders):
    class Handler(BaseHTTPRequestHandler):
        server_version = "PoultryGridBrooder/1.0"

        def log_message(self, fmt, *a):  # quiet: the agent logs each reading
            log.debug(fmt, *a)

        def _json(self, code: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path.rstrip("/") in ("", "/health"):
                self._json(200, {
                    "ok": True,
                    "units": {
                        k: {"status": (a.last_payload or {}).get("ai", {}).get("status"),
                            "app": "error" if a.last_error else "ok"}
                        for k, a in brooders.agents.items()
                    },
                })
            else:
                self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path.rstrip("/") != "/reading":
                return self._json(404, {"error": "not found"})
            dev = self.headers.get("x-device-id", "")
            key = self.headers.get("x-api-key", "")
            if not DEVICE_RE.match(dev) or not (8 <= len(key) <= 200):
                return self._json(401, {"error": "Missing or malformed device credentials"})
            try:
                n = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(min(n, 10_000)) or b"{}")
                clean = {
                    "temperature": _num(body.get("temperature"), -20, 80),
                    "humidity": _num(body.get("humidity"), 0, 100),
                    "mq_voltage": _num(body.get("mq_voltage"), 0, 6),
                    "fan_on": body.get("fan_on") if isinstance(body.get("fan_on"), bool) else None,
                }
            except (ValueError, TypeError):
                return self._json(400, {"error": "Invalid body"})
            try:
                self._json(200, brooders.handle(dev, key, clean))
            except Exception as e:
                log.exception("Reading failed")
                self._json(500, {"error": str(e)[:200]})

    return Handler


def _num(v, lo, hi):
    if v is None:
        return None
    f = float(v)
    return f if lo <= f <= hi else None


def discovery(port: int, stop: threading.Event):
    """Answer the ESP32's 'where are you?' broadcast with this PC's HTTP port."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("", port))
    s.settimeout(1.0)
    while not stop.is_set():
        try:
            data, addr = s.recvfrom(256)
        except socket.timeout:
            continue
        except OSError:
            break
        if data.strip() == DISCOVER:
            s.sendto(f"PG-BROODER {port}".encode(), addr)
            log.info("Found by ESP32 at %s", addr[0])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env", type=Path, default=Path(os.environ.get("PG_ENV_FILE", HERE / "agent.env")))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PG_BROODER_PORT", "5004")))
    ap.add_argument("--dry-run", action="store_true", help="print payloads instead of sending them")
    ap.add_argument("--interval", type=float, help="seconds between the ESP32's reports")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)
    pi_agent._load_env_file(args.env)

    brooders = Brooders(args)
    stop = threading.Event()
    threading.Thread(target=discovery, args=(args.port, stop), daemon=True).start()
    httpd = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(brooders))
    log.info("Brooder AI listening on :%d (HTTP and UDP discovery) -> %s%s", args.port,
             brooders.cfg.api_url, " [dry run]" if args.dry_run else "")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        httpd.server_close()


if __name__ == "__main__":
    main()
