"""Coop unit emulator: talks to the site exactly like coop_unit.ino does.

Use it to try the Controls page before the ESP32 is wired up, or to test a
deployment. The control logic (thermostat with hysteresis, manual mode,
overheat cut-out, settings validation) mirrors the firmware line for line.

    python emulator.py --url http://localhost:3000 --device COOP-1 --key <api key>

Only the standard library is needed.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import time
import urllib.error
import urllib.request

OVERHEAT_MARGIN = 6.0
LAMP_ABSOLUTE_MAX = 40.0
ZONES = ["layers", "broilers"]


def default_settings():
    zone = {"mode": "auto", "fan": False, "lamp": False,
            "high_temp": 24.0, "fan_off_temp": 23.0, "lamp_off_temp": 19.0, "low_temp": 18.0}
    return {"version": 0, "zones": {z: dict(zone) for z in ZONES}, "water": {"bad_v": 2.5, "good_v": 2.7}}


class Coop:
    def __init__(self, seed=None):
        self.rng = random.Random(seed)
        self.settings = default_settings()
        self.config_error = ""
        self.t0 = time.time()
        self.zone = {z: {"temp": 21.0 + i, "humidity": 62.0, "fan": False, "lamp": False,
                         "sensor_ok": True, "safety_tripped": False} for i, z in enumerate(ZONES)}
        self.water_v = 3.4
        self.water_good = True

    # --- physics: a slow day/night swing, pulled by the fan and lamp ---
    def step(self, dt: float):
        hour = (time.time() - self.t0) / 60.0  # one simulated "day" every 24 minutes
        ambient = 21.0 + 5.0 * math.sin(hour / 24.0 * 2 * math.pi)
        for z in ZONES:
            st = self.zone[z]
            target = ambient + (6.0 if st["lamp"] else 0.0) - (3.0 if st["fan"] else 0.0)
            st["temp"] += (target - st["temp"]) * min(1.0, dt / 120.0) + self.rng.gauss(0, 0.05)
            st["humidity"] = max(30.0, min(95.0, st["humidity"] + self.rng.gauss(0, 0.3)))
        # water slowly gets dirtier; a "change" resets it (simulated every ~15 min)
        self.water_v -= 0.0015 * dt
        if self.water_v < 1.8:
            self.water_v = 3.6

    # --- same as controlZone() in the firmware ---
    def control(self):
        for z in ZONES:
            st, s = self.zone[z], self.settings["zones"][z]
            st["safety_tripped"] = False
            t = st["temp"]
            if s["mode"] == "manual":
                st["fan"], st["lamp"] = s["fan"], s["lamp"]
            else:
                if t > s["high_temp"]:
                    st["fan"], st["lamp"] = True, False
                elif t < s["low_temp"]:
                    st["fan"], st["lamp"] = False, True
                if st["fan"] and t <= s["fan_off_temp"]:
                    st["fan"] = False
                if st["lamp"] and t >= s["lamp_off_temp"]:
                    st["lamp"] = False
            if st["lamp"] and (t > s["high_temp"] + OVERHEAT_MARGIN or t > LAMP_ABSOLUTE_MAX):
                st["lamp"], st["safety_tripped"] = False, True
            if st["fan"]:
                st["lamp"] = False
        w = self.settings["water"]
        if self.water_good and self.water_v < w["bad_v"]:
            self.water_good = False
        elif not self.water_good and self.water_v > w["good_v"]:
            self.water_good = True

    # --- same as applyControls() in the firmware ---
    def apply(self, c: dict):
        version = c.get("version", -1)
        if version < 0 or version == self.settings["version"]:
            return
        nxt = json.loads(json.dumps(self.settings))
        nxt["version"] = version
        for z in ZONES:
            zc = (c.get("zones") or {}).get(z)
            if not zc:
                continue
            s = nxt["zones"][z]
            for k in s:
                if k in zc:
                    s[k] = zc[k]
            ordered = s["low_temp"] < s["lamp_off_temp"] <= s["fan_off_temp"] < s["high_temp"]
            if not ordered or s["low_temp"] < 0 or s["high_temp"] > 45:
                self.config_error = f"{z}: setpoints must be low < lamp-off <= fan-off < high, 0-45 C"
                return
        w = c.get("water")
        if w:
            nxt["water"].update({k: w[k] for k in ("bad_v", "good_v") if k in w})
            if not (0.2 < nxt["water"]["bad_v"] < nxt["water"]["good_v"] < 5.0):
                self.config_error = "water: thresholds must be 0.2 < bad < good < 5.0 V"
                return
        self.settings = nxt
        self.config_error = ""
        print(f"New settings from site: version {version}")
        self.control()

    def report(self) -> dict:
        doc = {"unit": "coop", "firmware": "coop-2.0.0-emulator", "config_version": self.settings["version"],
               "rssi": -58, "uptime_s": int(time.time() - self.t0), "zones": {},
               "water": {"voltage": round(self.water_v, 2), "sensor_ok": True, "good": self.water_good}}
        if self.config_error:
            doc["config_error"] = self.config_error
        for z in ZONES:
            st = self.zone[z]
            doc["zones"][z] = {"temp": round(st["temp"], 1), "humidity": round(st["humidity"]),
                               "sensor_ok": True, "fan": st["fan"], "lamp": st["lamp"],
                               "mode": self.settings["zones"][z]["mode"], "safety_tripped": st["safety_tripped"]}
        return doc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--device", required=True)
    ap.add_argument("--key", required=True)
    ap.add_argument("--interval", type=float, default=10.0)
    ap.add_argument("--count", type=int, default=0, help="stop after N reports (0 = run forever)")
    args = ap.parse_args()

    coop = Coop()
    sent = 0
    last = time.time()
    while True:
        now = time.time()
        coop.step(max(1.0, (now - last) * 30))  # 30x speed so changes are visible
        last = now
        coop.control()
        req = urllib.request.Request(
            args.url.rstrip("/") + "/api/public/devices/ingest", method="POST",
            data=json.dumps(coop.report()).encode(),
            headers={"content-type": "application/json", "x-device-id": args.device, "x-api-key": args.key})
        try:
            with urllib.request.urlopen(req, timeout=8) as res:
                cfg = (json.loads(res.read()).get("config") or {}).get("controls")
                if cfg:
                    coop.apply(cfg)
        except (urllib.error.URLError, OSError) as e:
            print("Site report failed:", e)
        z = coop.zone
        print(" | ".join(f"{n}: {z[n]['temp']:.1f}C fan={'ON' if z[n]['fan'] else 'off'} "
                         f"lamp={'ON' if z[n]['lamp'] else 'off'} {coop.settings['zones'][n]['mode']}" for n in ZONES)
              + f" | water {coop.water_v:.2f}V {'GOOD' if coop.water_good else 'BAD'} | v{coop.settings['version']}")
        sent += 1
        if args.count and sent >= args.count:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
