"""PoultryGrid Pi agent: read sensors -> run the model -> switch the fan relay -> report to the app.

    python agent.py                       # real hardware, settings from env / agent.env
    python agent.py --simulate            # no hardware: closed-loop simulated coop
    python agent.py --simulate --dry-run  # also don't POST, just print
    python agent.py calibrate             # measure the MQ-135 clean-air baseline

Readings are buffered in a local SQLite outbox when the network is down and
sent in order once it comes back, so the app's history has no gaps.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import logging
import os
import signal
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from poultrygrid import MODEL_VERSION
from poultrygrid.features import (
    CAUSE_ADVICE, STATUS_LABELS, STATUS_TITLES, WINDOW, extract_features, fan_policy,
    forward_fill, growth_phase, target_temperature,
)
from poultrygrid.model_np import CoopModel

HERE = Path(__file__).parent
log = logging.getLogger("poultrygrid")


def _load_env_file(path: Path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


@dataclass
class Config:
    api_url: str
    device_id: str
    api_key: str
    interval_s: float
    bird_age_days: float | None
    batch_start_date: str | None
    model_path: Path
    outbox_path: Path
    mq135_baseline_v: float
    ldr_invert: bool
    sensor_mode: str
    dht_pin: int
    gas_do_pin: int
    ldr_do_pin: int
    fan_mode: str
    fan_relay_pin: int
    relay_active_low: bool
    relay_min_switch_s: float
    fan_pwm_pin: int
    fan_pwm_hz: int
    fan_pwm_duty: float
    fan_pwm_invert: bool
    fan_auto: bool

    @classmethod
    def from_env(cls) -> "Config":
        e = os.environ.get
        return cls(
            api_url=e("PG_API_URL", "http://localhost:3000").rstrip("/"),
            device_id=e("PG_DEVICE_ID", ""),
            api_key=e("PG_DEVICE_API_KEY", ""),
            interval_s=float(e("PG_INTERVAL_S", "30")),
            bird_age_days=float(e("PG_BIRD_AGE_DAYS")) if e("PG_BIRD_AGE_DAYS") else None,
            batch_start_date=e("PG_BATCH_START_DATE") or None,
            model_path=Path(e("PG_MODEL_PATH", str(HERE / "models" / "poultrygrid_v3.npz"))),
            outbox_path=Path(e("PG_OUTBOX_PATH", str(HERE / "outbox.sqlite3"))),
            mq135_baseline_v=float(e("PG_MQ135_BASELINE_V", "0.6")),
            ldr_invert=e("PG_LDR_INVERT", "1") == "1",
            sensor_mode=e("PG_SENSOR_MODE", "auto"),
            dht_pin=int(e("PG_DHT_PIN", "4")),
            gas_do_pin=int(e("PG_GAS_DO_PIN", "17")),
            ldr_do_pin=int(e("PG_LDR_DO_PIN", "27")),
            fan_mode=e("PG_FAN_MODE", "relay"),
            fan_relay_pin=int(e("PG_FAN_RELAY_PIN", "18")),
            relay_active_low=e("PG_RELAY_ACTIVE_LOW", "1") == "1",
            relay_min_switch_s=float(e("PG_RELAY_MIN_SWITCH_S", "60")),
            fan_pwm_pin=int(e("PG_FAN_PWM_PIN", "18")),
            fan_pwm_hz=int(e("PG_FAN_PWM_HZ", "10000")),
            fan_pwm_duty=float(e("PG_FAN_PWM_DUTY", "1.0")),
            fan_pwm_invert=e("PG_FAN_PWM_INVERT", "0") == "1",
            fan_auto=e("PG_FAN_AUTO", "1") == "1",
        )

    def age_days(self, server_age: float | None) -> float:
        if server_age is not None:  # the house's batch date in the app wins
            return server_age
        if self.batch_start_date:
            start = dt.date.fromisoformat(self.batch_start_date)
            return float((dt.date.today() - start).days)
        return self.bird_age_days if self.bird_age_days is not None else 28.0


class StatusSmoother:
    """Stops the status (and the fan) flapping on noisy readings.

    Probabilities are averaged with an EMA. Escalation needs 2 readings in a
    row (or 1 if the model is very sure of critical); de-escalation needs 4.
    """

    def __init__(self, alpha=0.5, up=2, down=4):
        self.alpha, self.up, self.down = alpha, up, down
        self.ema: np.ndarray | None = None
        self.status = 0
        self._streak = 0

    def update(self, probs: np.ndarray) -> int:
        if self.ema is None:  # first reading: nothing to smooth against yet
            self.ema, self.status = probs, int(probs.argmax())
            return self.status
        self.ema = self.alpha * probs + (1 - self.alpha) * self.ema
        cand = int(self.ema.argmax())
        if probs[2] > 0.9:
            cand = 2
        if cand == self.status:
            self._streak = 0
        else:
            self._streak += 1
            need = 1 if (cand == 2 and probs[2] > 0.9) else (self.up if cand > self.status else self.down)
            if self._streak >= need:
                self.status, self._streak = cand, 0
        return self.status


class Outbox:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("create table if not exists outbox (id integer primary key, body text not null)")
        self.db.commit()

    def add(self, payload: dict):
        self.db.execute("insert into outbox (body) values (?)", (json.dumps(payload),))
        # Cap the backlog at ~1 week of 30 s readings.
        self.db.execute("delete from outbox where id <= (select max(id) from outbox) - 20000")
        self.db.commit()

    def peek(self, n: int):
        return self.db.execute("select id, body from outbox order by id limit ?", (n,)).fetchall()

    def remove_upto(self, last_id: int):
        self.db.execute("delete from outbox where id <= ?", (last_id,))
        self.db.commit()

    def __len__(self):
        return self.db.execute("select count(*) from outbox").fetchone()[0]


class AppClient:
    def __init__(self, cfg: Config):
        self.cfg = cfg

    def post(self, readings: list[dict]) -> dict:
        body = json.dumps({"readings": readings}).encode()
        req = urllib.request.Request(
            f"{self.cfg.api_url}/api/public/devices/ingest", data=body, method="POST",
            headers={"content-type": "application/json", "x-device-id": self.cfg.device_id,
                     "x-api-key": self.cfg.api_key, "user-agent": f"poultrygrid-agent/{MODEL_VERSION}"},
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            return json.loads(res.read() or b"{}")


class Agent:
    def __init__(self, cfg: Config, hw, dry_run=False):
        self.cfg, self.hw, self.dry_run = cfg, hw, dry_run
        self.model = CoopModel(cfg.model_path)
        self.window: collections.deque = collections.deque(maxlen=WINDOW)
        self.smoother = StatusSmoother()
        self.outbox = Outbox(cfg.outbox_path)
        self.client = AppClient(cfg)
        self.server_age: float | None = None
        self.fan_override: str | None = None
        self.seq = 0

    def tick(self) -> dict:
        r = self.hw.read()
        self.window.append(r.row())
        rows = list(self.window)
        rows = [rows[0]] * (WINDOW - len(rows)) + rows  # pad until the window fills
        filled = forward_fill(rows)
        age = self.cfg.age_days(self.server_age)
        if hasattr(self.hw, "age"):  # keep the simulated flock in step with the app's batch date
            self.hw.age = age
        feats = extract_features(filled, age)

        raw = self.model.predict(feats)
        probs = np.array([raw["probabilities"][k] for k in STATUS_LABELS])
        status = self.smoother.update(probs)
        causes = raw["causes"] if status > 0 else []
        if status > 0 and not causes:  # held at warning by the smoother: still say why
            causes = self.model.top_causes(feats, 1)
        level = self.fan_override or fan_policy(status, [c["id"] for c in causes])
        if self.cfg.fan_auto:
            # A manager's override from the app skips the relay's hold time.
            self.hw.set_fan(level == "on", force=self.fan_override is not None)
        fan_on = bool(self.hw.fan_on)

        latest = filled[-1]
        self.seq += 1
        payload = {
            "recorded_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "seq": self.seq,
            "humidity": _r(latest[0]), "gas_index": _r(latest[1]), "temperature": _r(latest[2]),
            "light": _r(latest[3]), "fan_on": fan_on,
            "bird_age_days": round(age, 1),
            "ai": {
                "status": STATUS_LABELS[status], "status_code": status,
                "confidence": round(float(self.smoother.ema[status]), 3),
                "probabilities": raw["probabilities"],
                "raw_status": raw["status"],
                "causes": [{**c, "advice": CAUSE_ADVICE[c["id"]]} for c in causes],
                "fan_level": "on" if fan_on else "off",
                "growth_phase": growth_phase(age),
                "target_temp": round(target_temperature(age), 1),
                "model_version": self.model.version,
            },
        }
        log.info("%s %.0f%% | T=%.1f°C RH=%.0f%% gas=%.1f light=%.0f | fan=%s%s | %s",
                 STATUS_TITLES[status].upper(), payload["ai"]["confidence"] * 100, latest[2], latest[0],
                 latest[1], latest[3], "on" if fan_on else "off",
                 "" if (level == "on") == fan_on else f" (wants {level}, relay holding)",
                 ", ".join(c["label"] for c in causes) or "all good")
        self._send(payload)
        return payload

    def _send(self, payload: dict):
        if self.dry_run:
            print(json.dumps(payload))
            return
        self.outbox.add(payload)
        try:
            while True:
                batch = self.outbox.peek(50)
                if not batch:
                    break
                res = self.client.post([json.loads(b) for _, b in batch])
                self.outbox.remove_upto(batch[-1][0])
                cfg = res.get("config") or {}
                if cfg.get("bird_age_days") is not None:
                    self.server_age = float(cfg["bird_age_days"])
                override = cfg.get("fan_override")
                self.fan_override = override if override in ("on", "off") else None
        except urllib.error.HTTPError as e:
            log.warning("App rejected readings (%s): %s", e.code, e.read()[:200])
            if e.code in (400, 401, 403):
                self.outbox.remove_upto(self.outbox.peek(1)[0][0])  # drop the bad one, don't jam the queue
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            log.warning("Offline, %d readings buffered (%s)", len(self.outbox), e)


def _r(v, nd=1):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), nd)


def calibrate(cfg: Config):
    from poultrygrid.sensors import PiHardware
    hw = PiHardware(cfg)
    if hw.mode != "ads1115":
        hw.close()
        sys.exit("No ADS1115 found. In DO mode there's nothing to calibrate: turn the MQ-135 module's screw "
                 "until its DO LED just goes off in clean air.")
    print("Keep the MQ-135 in clean outdoor air. It should have warmed up for 24 h on first use.")
    vals = []
    for i in range(60):
        vals.append(hw.gas_voltage())
        print(f"\r{i + 1}/60  {vals[-1]:.3f} V", end="", flush=True)
        time.sleep(1)
    base = float(np.median(vals))
    print(f"\n\nAdd this to agent.env:\nPG_MQ135_BASELINE_V={base:.3f}")
    hw.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", nargs="?", default="run", choices=["run", "calibrate"])
    ap.add_argument("--env", type=Path, default=Path(os.environ.get("PG_ENV_FILE", HERE / "agent.env")))
    ap.add_argument("--simulate", action="store_true", help="use a simulated coop instead of GPIO")
    ap.add_argument("--dry-run", action="store_true", help="print payloads instead of sending them")
    ap.add_argument("--once", action="store_true", help="take one reading and exit")
    ap.add_argument("--interval", type=float, help="seconds between readings")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", stream=sys.stdout)
    _load_env_file(args.env)
    cfg = Config.from_env()
    if args.interval:
        cfg.interval_s = args.interval

    if args.command == "calibrate":
        return calibrate(cfg)
    if not args.dry_run and not (cfg.device_id and cfg.api_key):
        sys.exit("Set PG_DEVICE_ID and PG_DEVICE_API_KEY (register the Pi under Devices in the app).")

    if args.simulate:
        from poultrygrid.sensors import SimulatedCoop
        hw = SimulatedCoop(cfg.age_days(None))
    else:
        from poultrygrid.sensors import PiHardware
        hw = PiHardware(cfg)

    agent = Agent(cfg, hw, dry_run=args.dry_run)
    log.info("PoultryGrid agent %s -> %s as %s", agent.model.version, cfg.api_url, cfg.device_id or "(dry run)")

    stop = False

    def _stop(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        while not stop:
            started = time.monotonic()
            try:
                agent.tick()
            except Exception:  # keep the fan loop alive no matter what
                log.exception("Tick failed")
            if args.once:
                break
            while not stop and time.monotonic() - started < cfg.interval_s:
                time.sleep(0.2)
    finally:
        hw.close()


if __name__ == "__main__":
    main()
