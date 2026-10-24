"""Time-series simulator of a Ghanaian broiler coop compartment.

The original AI_For_Poultry dataset drew every row independently and
labelled it from the same values the model saw, so the network only had to
re-learn five thresholds. Here a coop is simulated over time (30 s steps)
with weather, flock age, brooder heat, fan airflow, litter wetness and
faults. Labels come from the *true* state while the model only sees noisy
sensor readings, so it has to learn to denoise and use trends, the way it
must on real hardware.

The sensors are the farm's actual parts, read the way the Pi agent reads
them, and they break the way real ones do:

  DHT22    reads fail (the agent retries, then reuses the last good read for
           2 min), the sensor gets unplugged, freezes, or sends garbage
  MQ-135   through an ADS1115, or its on/off DO pin, or not wired at all;
  and LDR  unplugged (reads 0 / a stuck level) or a floating, random input
  fan      a relay (off = no air) or a 4-pin PWM fan (off may still turn
           slowly), and the fan itself can die

`SCENARIOS` force one situation each, for the benchmark in train.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .features import (
    CAUSES, FAN_AIRFLOW, GAS_DO_LEVELS, WINDOW, SensorMemory, TrueState, comfort_band,
    extract_features, fan_policy, label_state, target_temperature,
)
from .legacy_v3 import extract_features_v3

DT = 30.0  # seconds per step


def _ambient(rng, steps, start_hour):
    mean_t = rng.uniform(21.0, 31.0)
    amp_t = rng.uniform(2.0, 6.0)
    mean_rh = rng.uniform(50.0, 88.0)
    hours = (start_hour + np.arange(steps) * DT / 3600.0) % 24
    phase = np.cos((hours - 15.0) / 24.0 * 2 * np.pi)  # hottest ~15:00
    temp = mean_t + amp_t * phase
    rh = np.clip(mean_rh - 2.2 * amp_t * phase, 25, 98)
    return temp, rh, hours


@dataclass
class Hardware:
    gas_light: str = "ads1115"          # "ads1115" | "digital" | "none"
    fan: str = "relay"                  # "relay" | "pwm"
    pwm_creep: bool = False             # PWM fan keeps turning slowly at 0 %
    dht_fail: float = 0.02              # chance a reading fails even after the agent's retries
    faults: list = field(default_factory=list)  # (kind, start_step, end_step)

    def fault(self, kind: str, i: int) -> bool:
        return any(k == kind and a <= i < b for k, a, b in self.faults)


SENSOR_FAULTS = ["dht_unplugged", "dht_frozen", "dht_garbage", "gas_unplugged", "gas_floating", "ldr_unplugged"]


def random_hardware(rng: np.random.Generator, steps: int) -> Hardware:
    """The training mix: a third of episodes are clean, the rest get the farm's
    real wiring options and, often, one or two sensor faults."""
    hw = Hardware(
        gas_light=str(rng.choice(["ads1115", "digital", "none"], p=[0.5, 0.3, 0.2])),
        fan=str(rng.choice(["relay", "pwm"], p=[0.6, 0.4])),
        pwm_creep=bool(rng.random() < 0.5),
        dht_fail=float(rng.choice([0.02, rng.uniform(0.05, 0.3), rng.uniform(0.3, 0.6)], p=[0.5, 0.35, 0.15])),
    )
    if rng.random() < 0.35:
        return hw
    for kind in SENSOR_FAULTS:
        if rng.random() < 0.15:
            a = int(rng.integers(0, steps - 20))
            hw.faults.append((kind, a, a + int(rng.integers(20, steps))))
    return hw


def _from_step(rng, steps, kind):
    a = int(rng.integers(0, steps // 2))
    return [(kind, a, steps)]


# One forced situation each, for the benchmark.
SCENARIOS = {
    "clean (ADS1115, relay)": lambda r, n: Hardware(),
    "gas/light on DO pins": lambda r, n: Hardware(gas_light="digital"),
    "gas/light not wired": lambda r, n: Hardware(gas_light="none"),
    "4-pin PWM fan": lambda r, n: Hardware(fan="pwm", pwm_creep=bool(r.random() < 0.5)),
    "DHT22 flaky (40% reads fail)": lambda r, n: Hardware(dht_fail=0.4),
    "DHT22 unplugged": lambda r, n: Hardware(faults=_from_step(r, n, "dht_unplugged")),
    "DHT22 frozen": lambda r, n: Hardware(faults=_from_step(r, n, "dht_frozen")),
    "DHT22 garbage values": lambda r, n: Hardware(faults=_from_step(r, n, "dht_garbage")),
    "MQ-135 unplugged": lambda r, n: Hardware(faults=_from_step(r, n, "gas_unplugged")),
    "MQ-135 floating input": lambda r, n: Hardware(faults=_from_step(r, n, "gas_floating")),
    "LDR unplugged": lambda r, n: Hardware(faults=_from_step(r, n, "ldr_unplugged")),
}


class _Sensors:
    """Turns the true coop state into what the agent would put in a reading row."""

    def __init__(self, rng: np.random.Generator, hw: Hardware, brooder: bool):
        self.rng, self.hw, self.brooder = rng, hw, brooder
        self.gas_drift = rng.normal(0, 1.0)
        self.gas_thr = rng.uniform(10, 20)      # where the MQ-135 module's screw is set
        self.light_thr = rng.uniform(8, 20)
        self.last_dht = None                    # (t, h, step)
        self.frozen = None
        self.gas_stuck = None
        self.ldr_stuck = None

    def read(self, i: int, T: float, RH: float, G: float, hour: float, fan_on: bool) -> list[float]:
        rng, hw, nan = self.rng, self.hw, np.nan

        # DHT22
        t, h = T + rng.normal(0, 0.35), float(np.clip(RH + rng.normal(0, 1.8), 0, 100))
        if hw.fault("dht_frozen", i):
            if self.frozen is None:
                self.frozen = self.last_dht[:2] if self.last_dht else (round(t, 1), round(h, 1))
            t, h = self.frozen
        elif hw.fault("dht_unplugged", i) or rng.random() < hw.dht_fail:
            # The agent reuses the last good read for up to 2 minutes, then reports nothing.
            if self.last_dht and (i - self.last_dht[2]) * DT <= 120:
                t, h = self.last_dht[:2]
            else:
                t, h = nan, nan
        else:
            if rng.random() < 0.01:  # an occasional bad read that still passes the checksum
                t += rng.choice([-1, 1]) * rng.uniform(3, 8)
            t, h = round(t, 1), round(h, 1)
            self.last_dht = (t, h, i)
        if hw.fault("dht_garbage", i) and rng.random() < 0.4:
            t, h = float(rng.choice([-40.0, 0.0, 85.0, 127.0])), float(rng.choice([0.0, 99.9, 3276.7]))

        # MQ-135 and LDR
        light_true = (25 + 10 * np.sin((hour - 6) / 12 * np.pi)) if 6 <= hour <= 18 else (12.0 if self.brooder else 3.0)
        g = max(0.0, G * (1 + rng.normal(0, 0.08)) + self.gas_drift + rng.normal(0, 0.7))
        lt = max(0.0, light_true + rng.normal(0, 1.5))
        if hw.gas_light == "none":
            g, lt = nan, nan
        elif hw.gas_light == "digital":
            g = GAS_DO_LEVELS[1] if g >= self.gas_thr else GAS_DO_LEVELS[0]
            lt = 30.0 if lt >= self.light_thr else 3.0
            if hw.fault("gas_unplugged", i):
                self.gas_stuck = self.gas_stuck or float(rng.choice(GAS_DO_LEVELS))
                g = self.gas_stuck
            elif hw.fault("gas_floating", i):
                g = float(rng.choice(GAS_DO_LEVELS))
            if hw.fault("ldr_unplugged", i):
                self.ldr_stuck = self.ldr_stuck or float(rng.choice([3.0, 30.0]))
                lt = self.ldr_stuck
        else:
            g = min(g, 60.0)
            if hw.fault("gas_unplugged", i):
                g = 0.0                        # AO open: the ADS1115 reads ~0 V, below the baseline
            elif hw.fault("gas_floating", i):
                g = float(rng.uniform(0, 60))
            if hw.fault("ldr_unplugged", i):
                self.ldr_stuck = self.ldr_stuck if self.ldr_stuck is not None else float(rng.choice([0.0, 50.0]))
                lt = self.ldr_stuck
        return [h, round(g, 2) if g == g else g, t, round(lt, 1) if lt == lt else lt, 1.0 if fan_on else 0.0]


def simulate_episode(rng: np.random.Generator, steps: int = 240, scenario: str | None = None):
    """Return (sensor_rows[steps, 5] with NaN for no reading, true_states, age_days, hours, hardware)."""
    age = float(rng.choice([rng.uniform(0, 10), rng.uniform(0, 56)]))
    density = rng.uniform(0.6, 1.4)
    wetness = rng.uniform(0.5, 1.3)
    start_hour = rng.uniform(0, 24)
    amb_t, amb_rh, hours = _ambient(rng, steps, start_hour)
    target = target_temperature(age)
    brooder = age < 21

    # Events: (kind, start, end)
    events = []
    for kind, p in [("heatwave", 0.18), ("heater_fail", 0.25 if brooder else 0.0), ("fan_fail", 0.15),
                    ("wet_litter", 0.2), ("rain", 0.15), ("dry_harmattan", 0.1)]:
        if rng.random() < p:
            s = int(rng.integers(0, steps - 20))
            events.append((kind, s, s + int(rng.integers(30, steps))))

    def active(kind, i):
        return any(k == kind and s <= i < e for k, s, e in events)

    hw = SCENARIOS[scenario](rng, steps) if scenario else random_hardware(rng, steps)
    sensors = _Sensors(rng, hw, brooder)

    controller = rng.choice(["policy", "fixed", "thermostat"], p=[0.5, 0.25, 0.25])
    fixed_on = bool(rng.random() < 0.5)
    fan_health = rng.uniform(0.8, 1.1)  # fan size relative to the house

    T = amb_t[0] + rng.uniform(-1, 4)
    RH = amb_rh[0] + rng.uniform(-5, 5)
    G = rng.uniform(1, 10)
    fan_on = False
    rows, states = [], []

    for i in range(steps):
        at, arh = amb_t[i], amb_rh[i]
        if active("heatwave", i):
            at += rng.uniform(4, 8) if i % 20 == 0 else 6.0
        if active("rain", i):
            at -= 3.0
            arh = 97.0
        if active("dry_harmattan", i):
            arh = min(arh, 22.0)
        wet = wetness * (3.0 if active("wet_litter", i) else 1.0)

        # Relay controller (the agent, a thermostat, or a farmer who leaves it alone)
        if controller == "policy":
            st, sev = label_state(TrueState(T, RH, G, FAN_AIRFLOW, age))
            causes = [c for c, v in zip(CAUSES, sev) if v]
            fan_on = fan_policy(st, causes) == "on" if i % 6 == 0 else fan_on
        elif controller == "thermostat":
            high = comfort_band(age)[1]
            fan_on = T > high + 0.5 or (fan_on and T > high - 0.5)  # 1 °C hysteresis
        else:
            fan_on = fixed_on

        # A failed fan (blown fuse, stuck blades) moves no air even when switched on.
        # A 4-pin PWM fan at 0 % often keeps turning slowly.
        if active("fan_fail", i):
            airflow = 0.0
        elif fan_on:
            airflow = FAN_AIRFLOW * fan_health
        else:
            airflow = 0.25 * FAN_AIRFLOW if hw.fan == "pwm" and hw.pwm_creep else 0.0

        q_birds = 1.5 + 4.0 * density * min(age, 42) / 42.0
        heater_ok = brooder and not active("heater_fail", i)
        q_heater = float(np.clip((target - at) * (1 + 0.8 * airflow) - q_birds, 0, 14)) if heater_ok else 0.0
        t_eq = at + (q_birds + q_heater) / (1 + 0.8 * airflow)
        T += (DT / 900.0) * (t_eq - T)

        rh_eq = arh + 6.0 * wet * density / (1 + airflow) - 2.5 * (T - at)
        RH += (DT / 600.0) * (np.clip(rh_eq, 10, 99) - RH)

        prod = 0.25 * density * wet * (0.6 + min(age, 56) / 40.0)
        G += prod - G * (0.01 + 0.04 * airflow)
        G = max(G, 0.0)

        states.append(TrueState(T, RH, G, airflow, age))

        rows.append(sensors.read(i, T, RH, G, hours[i], fan_on))

    return np.array(rows, dtype=np.float64), states, age, hours, hw


def build_dataset(n_episodes: int, seed: int, steps: int = 240, stride: int = 3,
                  scenario: str | None = None, legacy: bool = False) -> dict:
    """Windows of readings -> features and labels.

    Returns X, y_status, y_causes (binary per cause) and episode ids, plus X_v3
    (the old model's inputs, built the way the v3 agent did) when `legacy`.
    """
    rng = np.random.default_rng(seed)
    X, X3, ys, yc, eps = [], [], [], [], []
    for ep in range(n_episodes):
        rows, states, age, hours, hw = simulate_episode(rng, steps, scenario)
        memory = SensorMemory(DT)
        for i in range(steps):
            memory.update(rows[i])  # the agent updates it with every reading
            if i < WINDOW - 1 or (i - WINDOW + 1) % stride:
                continue
            window = rows[i - WINDOW + 1:i + 1]
            status, sev = label_state(states[i])
            X.append(extract_features(window, age, memory))
            if legacy:
                X3.append(extract_features_v3(window, age, hours[i], hw.gas_light != "none"))
            ys.append(status)
            yc.append((sev > 0).astype(np.float32))
            eps.append(ep)
    out = {"X": np.stack(X), "y": np.array(ys, dtype=np.int64), "yc": np.stack(yc), "eps": np.array(eps)}
    if legacy:
        out["X_v3"] = np.stack(X3)
    return out
