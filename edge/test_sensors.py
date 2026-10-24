"""Check each sensor and the fan on the Pi, one at a time, before running the agent.

    python test_sensors.py              # run every test
    python test_sensors.py dht          # just one: i2c, dht, gas, light, relay (or fan)
    python test_sensors.py live         # print all readings every 2 s (Ctrl+C to stop)

Pins and calibration come from agent.env, same as the agent. Each test prints
PASS / WARN / FAIL plus what to check on the wiring when something's wrong.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

from agent import Config, _load_env_file  # noqa: E402

ADS_ADDR = 0x48  # ADS1115 with ADDR tied to GND
GREEN, YELLOW, RED, DIM, END = "\033[32m", "\033[33m", "\033[31m", "\033[2m", "\033[0m"


def verdict(level: str, msg: str):
    colour = {"PASS": GREEN, "WARN": YELLOW, "FAIL": RED}[level]
    print(f"  {colour}{level}{END}  {msg}")
    return level


def hint(*lines: str):
    for line in lines:
        print(f"        {DIM}- {line}{END}")


def heading(title: str, wiring: str):
    print(f"\n== {title}  {DIM}({wiring}){END}")


def _ads(cfg):
    from poultrygrid.sensors import open_ads1115

    return open_ads1115()


def _has_ads(cfg) -> bool:
    if cfg.sensor_mode == "digital":
        return False
    try:
        _ads(cfg)[0].voltage  # noqa: B018
        return True
    except Exception:
        return False


def _watch_do(pin: int, seconds: float, label: str):
    """Watch a module's DO pin (LM393: low = over threshold). Returns the states seen."""
    from gpiozero import DigitalInputDevice

    do = DigitalInputDevice(pin, pull_up=True)
    seen = set()
    end = time.monotonic() + seconds
    try:
        while time.monotonic() < end:
            v = int(do.value)
            seen.add(v)
            print(f"\r  {label} DO (GPIO{pin}): {'HIGH' if v else 'LOW '}      ", end="", flush=True)
            time.sleep(0.2)
    finally:
        do.close()
    print()
    return seen


def test_i2c(cfg) -> str:
    heading("I2C bus / ADS1115 (optional)", "VDD->3.3V, GND->GND, SCL->GPIO3 (pin 5), SDA->GPIO2 (pin 3), ADDR->GND")
    if cfg.sensor_mode == "digital":
        return verdict("PASS", "PG_SENSOR_MODE=digital: no ADS1115 expected, MQ-135 and LDR use their DO pins")
    if not Path("/dev/i2c-1").exists():
        verdict("FAIL", "I2C is turned off")
        hint("sudo raspi-config nonint do_i2c 0 && sudo reboot")
        return "FAIL"
    import board
    import busio

    i2c = busio.I2C(board.SCL, board.SDA)
    while not i2c.try_lock():
        pass
    try:
        found = i2c.scan()
    finally:
        i2c.unlock()
        i2c.deinit()
    print(f"  devices found: {', '.join(hex(a) for a in found) or 'none'}")
    if ADS_ADDR in found:
        return verdict("PASS", f"ADS1115 answering at {hex(ADS_ADDR)}")
    if any(0x48 <= a <= 0x4B for a in found):
        verdict("FAIL", "an ADS1115 is there but not at 0x48")
        hint("tie the ADDR pin to GND (0x49=VDD, 0x4A=SDA, 0x4B=SCL)")
        return "FAIL"
    if cfg.sensor_mode == "ads1115":
        verdict("FAIL", "no ADS1115 on the bus, and PG_SENSOR_MODE=ads1115 requires one")
        hint("check SDA/SCL aren't swapped and the board has 3.3 V and GND")
        return "FAIL"
    verdict("WARN", "no ADS1115: the MQ-135 and LDR will be read from their DO pins (on/off only)")
    hint("that works, but an ADS1115 gives the model real gas and light levels",
         f"DO wiring: MQ-135 DO -> GPIO{cfg.gas_do_pin}, LDR DO -> GPIO{cfg.ldr_do_pin}")
    return "WARN"


def test_dht(cfg) -> str:
    heading("DHT22 temperature / humidity", f"+ ->3.3V, out->GPIO{cfg.dht_pin}, - ->GND, 10k pull-up out->3.3V")
    import board
    import adafruit_dht

    dht = adafruit_dht.DHT22(getattr(board, f"D{cfg.dht_pin}"), use_pulseio=False)
    good = []
    try:
        for i in range(5):
            try:
                t, h = dht.temperature, dht.humidity
                if t is not None and h is not None:
                    good.append((t, h))
                    print(f"  read {i + 1}: {t:.1f} °C  {h:.1f} %RH")
                else:
                    print(f"  read {i + 1}: no data")
            except RuntimeError as e:  # checksum / timing errors are normal now and then
                print(f"  read {i + 1}: {e}")
            time.sleep(2.2)  # the DHT22 can't be read faster than every 2 s
    finally:
        dht.exit()
    if not good:
        verdict("FAIL", "no valid reading in 5 tries")
        hint(f"data wire on GPIO{cfg.dht_pin} (physical pin 7 for GPIO4)?",
             "a bare 4-pin DHT22 needs a 10k resistor from data to 3.3 V (3-pin modules have one)",
             "power from 3.3 V, not 5 V, unless your module says otherwise")
        return "FAIL"
    t, h = good[-1]
    if not (-10 <= t <= 60 and 0 <= h <= 100):
        verdict("WARN", f"values look wrong ({t} °C, {h} %)")
        hint("is it a DHT11? This code expects a DHT22 / AM2302")
        return "WARN"
    if len(good) < 3:
        verdict("WARN", f"only {len(good)}/5 reads worked; the agent retries, but check the wiring is solid")
        return "WARN"
    return verdict("PASS", f"{len(good)}/5 good reads, latest {t:.1f} °C / {h:.1f} %RH")


def _watch(chan, seconds: float, label: str, fmt):
    vals = []
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        v = chan.voltage
        vals.append(v)
        print(f"\r  {label}: {v:.3f} V  {fmt(v)}      ", end="", flush=True)
        time.sleep(0.25)
    print()
    return vals


def test_gas(cfg) -> str:
    if not _has_ads(cfg):
        heading("MQ-135 gas sensor (DO mode)", f"VCC->5V, GND->GND, DO->GPIO{cfg.gas_do_pin}")
        print("  breathe on the sensor or hold a marker / alcohol wipe near it in the next 10 s")
        seen = _watch_do(cfg.gas_do_pin, 10, "MQ-135")
        if seen == {0}:
            verdict("WARN", "DO stayed LOW (triggered) the whole time")
            hint("let the heater warm up for a few minutes, then turn the module's screw until the DO LED just goes off in clean air")
            return "WARN"
        if seen == {1}:
            verdict("WARN", "DO never triggered")
            hint("turn the screw the other way a little so gas trips it",
                 f"check DO (not AO) goes to GPIO{cfg.gas_do_pin}")
            return "WARN"
        return verdict("PASS", "DO switches when gas rises")
    heading("MQ-135 gas sensor", "VCC->5V, GND->GND, AO->ADS1115 A0 (through a divider, see below)")
    try:
        gas, _ = _ads(cfg)
    except Exception as e:
        verdict("FAIL", f"can't reach the ADS1115 ({e})")
        return "FAIL"
    base = cfg.mq135_baseline_v

    def idx(v):
        return f"gas index {max(0.0, (v - base) / base * 100):.1f}" if base > 0 else ""

    print("  breathe on the sensor or hold a marker / alcohol wipe near it to see it rise")
    vals = _watch(gas, 10, "A0", idx)
    lo, hi, last = min(vals), max(vals), vals[-1]
    if hi < 0.02:
        verdict("FAIL", "reads 0 V: nothing connected to A0")
        hint("AO (analog out), not DO, goes to A0", "the module needs 5 V on VCC for its heater")
        return "FAIL"
    if hi > 3.4:
        verdict("WARN", f"A0 is at {hi:.2f} V, above the ADS1115's 3.3 V supply")
        hint("put a divider on AO: 10k from AO to A0, 20k from A0 to GND (5 V -> 3.3 V)",
             "then rerun calibrate so the baseline matches")
        return "WARN"
    if abs(last - base) / max(base, 0.01) > 0.5:
        verdict("WARN", f"{last:.2f} V is far from PG_MQ135_BASELINE_V={base}")
        hint("let it warm up (a few minutes; 24 h on first ever use), then in clean air run:",
             "python agent.py calibrate --env agent.env")
        return "WARN"
    moved = "and responds" if hi - lo > 0.05 else "(didn't change; try breathing on it)"
    return verdict("PASS", f"{last:.2f} V {moved}")


def test_light(cfg) -> str:
    if not _has_ads(cfg):
        heading("LDR light sensor (DO mode)", f"VCC->3.3V, GND->GND, DO->GPIO{cfg.ldr_do_pin}")
        print("  cover the sensor with your hand, then uncover it, in the next 10 s")
        seen = _watch_do(cfg.ldr_do_pin, 10, "LDR")
        if len(seen) < 2:
            verdict("WARN", "DO didn't change. Did you cover it?")
            hint("turn the module's screw so its DO LED flips between covered and uncovered",
                 f"check DO goes to GPIO{cfg.ldr_do_pin}")
            return "WARN"
        return verdict("PASS", "responds to light")
    heading("LDR light sensor", "VCC->3.3V, GND->GND, AO->ADS1115 A1")
    try:
        _, ldr = _ads(cfg)
    except Exception as e:
        verdict("FAIL", f"can't reach the ADS1115 ({e})")
        return "FAIL"

    def light(v):
        frac = v / 3.3
        return f"light {(1 - frac if cfg.ldr_invert else frac) * 50:.1f}"

    print("  cover the sensor with your hand, then uncover it, in the next 10 s")
    vals = _watch(ldr, 10, "A1", light)
    lo, hi = min(vals), max(vals)
    if hi < 0.02:
        verdict("FAIL", "reads 0 V: nothing connected to A1")
        hint("AO, not DO, goes to A1")
        return "FAIL"
    if hi - lo < 0.1:
        verdict("WARN", f"barely changed ({lo:.2f}-{hi:.2f} V). Did you cover it?")
        hint("if it really is covered, check the wire to A1")
        return "WARN"
    # Covered should read darker. If not, PG_LDR_INVERT is the wrong way round.
    print(f"  range {lo:.2f}-{hi:.2f} V; with PG_LDR_INVERT={int(cfg.ldr_invert)} covering it should LOWER 'light'."
          " If it went up, flip PG_LDR_INVERT in agent.env.")
    return verdict("PASS", "responds to light")


def test_pwm_fan(cfg) -> str:
    heading("PWM fan",
            f"fan PWM wire (blue)->GPIO{cfg.fan_pwm_pin}, fan GND->Pi GND, fan +12 V from its own supply")
    from poultrygrid.sensors import FanPWM

    fan = FanPWM(cfg.fan_pwm_pin, cfg.fan_pwm_hz, cfg.fan_pwm_duty, cfg.fan_pwm_invert)
    try:
        for on in (True, False, True, False):
            fan.set(on)
            print(f"  fan {'ON ' if on else 'OFF'}  ({fan.on_duty:.0%} vs 0 % duty; listen for it speeding up / slowing down)")
            time.sleep(5)
    finally:
        fan.close()
    hint("never changes speed: check the PWM wire is on the right GPIO and the fan's GND is joined to the Pi's GND",
         "fast when it should be slow: flip PG_FAN_PWM_INVERT in agent.env",
         "still turns at 0 %: normal for many 4-pin fans; it only needs a relay if it must stop completely")
    return verdict("PASS", "duty switched up and down twice; confirm the fan followed it")


def test_relay(cfg) -> str:
    if cfg.fan_mode == "pwm":
        return test_pwm_fan(cfg)
    low = "LOW" if cfg.relay_active_low else "HIGH"
    heading("Fan relay",
            f"relay IN->GPIO{cfg.fan_relay_pin}, VCC->5V, GND->GND; fan supply through COM and NO "
            f"(module switches on when IN is {low})")
    from gpiozero import OutputDevice

    relay = OutputDevice(cfg.fan_relay_pin, active_high=not cfg.relay_active_low, initial_value=False)
    try:
        for on in (True, False, True, False):
            relay.value = on
            print(f"  relay {'ON ' if on else 'OFF'}  (listen for the click; the fan should {'run' if on else 'stop'})")
            time.sleep(3)
    finally:
        relay.off()
        relay.close()
    print("  There's no speed sensor on a relay fan, so this test can't see the fan itself.")
    hint("no click at all: check VCC/GND to the relay board and IN on the right GPIO",
         "clicks but the fan never runs: check the fan's supply is wired through COM and NO (not NC)",
         "fan runs when it should be off: flip PG_RELAY_ACTIVE_LOW in agent.env")
    return verdict("PASS", "relay switched on and off twice; confirm the fan followed it")


def live(cfg):
    from poultrygrid.sensors import PiHardware

    hw = PiHardware(cfg)
    print(f"MQ-135 / LDR mode: {hw.mode}")
    print("time      temp    RH     gas   light   fan   (Ctrl+C to stop)")
    try:
        while True:
            r = hw.read()
            f = lambda v, n=1: "  -  " if v is None else f"{v:.{n}f}"  # noqa: E731
            print(f"{time.strftime('%H:%M:%S')}  {f(r.temperature)}°C  {f(r.humidity, 0)}%  "
                  f"{f(r.gas_index)}  {f(r.light)}  {'on' if r.fan_on else 'off'}", flush=True)
            time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        hw.close()


TESTS = {"i2c": test_i2c, "dht": test_dht, "gas": test_gas, "light": test_light, "relay": test_relay, "fan": test_relay}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tests", nargs="*", choices=[*TESTS, "live"], help="default: all")
    ap.add_argument("--env", type=Path, default=Path(os.environ.get("PG_ENV_FILE", HERE / "agent.env")))
    args = ap.parse_args()
    _load_env_file(args.env)
    cfg = Config.from_env()

    try:
        import board  # noqa: F401
    except ImportError:
        sys.exit("Sensor libraries missing. Run:  pip install -r requirements-pi.txt")

    if args.tests == ["live"]:
        return live(cfg)
    names = args.tests or [t for t in TESTS if t != "fan"]
    results = {}
    for name in names:
        try:
            results[name] = TESTS[name](cfg)
        except KeyboardInterrupt:
            print("\nstopped")
            break
        except Exception as e:  # one broken sensor shouldn't stop the others being checked
            results[name] = verdict("FAIL", f"{type(e).__name__}: {e}")

    print("\n== Summary")
    for name, res in results.items():
        verdict(res, name)
    if results and all(r != "FAIL" for r in results.values()):
        print("\nNext: python agent.py --env agent.env --dry-run   (real sensors + model, nothing sent)")
    sys.exit(1 if "FAIL" in results.values() else 0)


if __name__ == "__main__":
    main()
