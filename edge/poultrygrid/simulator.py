"""Time-series simulator of a Ghanaian broiler coop compartment.

The original AI_For_Poultry dataset drew every row independently and
labelled it from the same values the model saw, so the network only had to
re-learn five thresholds. Here a coop is simulated over time (30 s steps)
with weather, flock age, brooder heat, fan airflow, litter wetness and
faults. Labels come from the *true* state while the model only sees noisy
sensor readings, so it has to learn to denoise and use trends, the way it
must on real hardware.
"""

from __future__ import annotations

import numpy as np

from .features import (
    CAUSES, MAX_RPM, WINDOW, FAN_DUTY, TrueState, comfort_band, extract_features, fan_policy,
    label_state, target_temperature,
)

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


def simulate_episode(rng: np.random.Generator, steps: int = 240):
    """Return (sensor_rows[steps, 6], true_states, age_days)."""
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

    controller = rng.choice(["policy", "fixed", "thermostat"], p=[0.5, 0.25, 0.25])
    fixed_duty = float(rng.choice([0.0, 0.2, 0.4, 0.6, 1.0]))
    fan_health = rng.uniform(0.85, 1.05)

    T = amb_t[0] + rng.uniform(-1, 4)
    RH = amb_rh[0] + rng.uniform(-5, 5)
    G = rng.uniform(1, 10)
    duty = 0.4
    rows, states = [], []
    sensor_gas_drift = rng.normal(0, 1.0)

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

        # Fan controller (what the farmer or an older controller would do)
        if controller == "policy":
            st, sev = label_state(TrueState(T, RH, G, 1250.0, duty, age))
            causes = [c for c, v in zip(CAUSES, sev) if v]
            duty = FAN_DUTY[fan_policy(st, causes)] if i % 6 == 0 else duty
        elif controller == "thermostat":
            duty = float(np.clip((T - comfort_band(age)[1]) / 4.0 + 0.4, 0.0, 1.0))
        else:
            duty = fixed_duty

        if active("fan_fail", i) or duty < 0.12:
            rpm_true = rng.uniform(0, 120) if active("fan_fail", i) else 0.0
        else:
            rpm_true = duty * MAX_RPM * fan_health
        airflow = rpm_true / 1250.0

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

        states.append(TrueState(T, RH, G, rpm_true, duty, age))

        # Sensors: DHT22, MQ-135 via ADS1115, LDR, tach
        light_true = (25 + 10 * np.sin((hours[i] - 6) / 12 * np.pi)) if 6 <= hours[i] <= 18 else (12.0 if brooder else 3.0)
        s_t = T + rng.normal(0, 0.35)
        s_rh = RH + rng.normal(0, 1.8)
        s_g = max(0.0, G * (1 + rng.normal(0, 0.08)) + sensor_gas_drift + rng.normal(0, 0.7))
        s_rpm = max(0.0, rpm_true + rng.normal(0, 45))
        s_light = max(0.0, light_true + rng.normal(0, 1.5))
        if rng.random() < 0.01:  # DHT22 glitch
            s_t += rng.choice([-1, 1]) * rng.uniform(3, 8)
        rows.append([np.clip(s_rh, 0, 100), min(s_g, 60.0), s_t, s_light, s_rpm, duty])

    return np.array(rows, dtype=np.float32), states, age


def build_dataset(n_episodes: int, seed: int, steps: int = 240, stride: int = 3):
    """Returns X, y_status, y_causes (binary), raw5 (baseline features), episode ids."""
    rng = np.random.default_rng(seed)
    X, ys, yc, raw, eps = [], [], [], [], []
    for ep in range(n_episodes):
        rows, states, age = simulate_episode(rng, steps)
        for i in range(WINDOW - 1, steps, stride):
            status, sev = label_state(states[i])
            X.append(extract_features(rows[i - WINDOW + 1:i + 1], age))
            ys.append(status)
            yc.append((sev > 0).astype(np.float32))
            raw.append(rows[i, :5])
            eps.append(ep)
    return (np.stack(X), np.array(ys), np.stack(yc), np.stack(raw).astype(np.float32), np.array(eps))
