"""Shared domain logic for training and the Pi runtime.

Everything that has to agree between `train.py` and `agent.py` lives here:
growth-phase targets, the feature vector, the labelling rules and the fan
policy. Only numpy is required, so this imports fine on a Pi Zero.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np

WINDOW = 10            # readings kept for temporal features (10 x 30 s = 5 min)
MAX_RPM = 2500.0       # 12 V three-wire fan at full duty

STATUS_LABELS = ["healthy", "warning", "critical"]
STATUS_TITLES = ["Healthy", "Warning", "Critical"]

CAUSES = [
    "heat_stress",
    "cold_stress",
    "ammonia",
    "high_humidity",
    "low_humidity",
    "poor_ventilation",
    "fan_fault",
]
CAUSE_TITLES = {
    "heat_stress": "Heat stress",
    "cold_stress": "Too cold for flock age",
    "ammonia": "Ammonia / gas build-up",
    "high_humidity": "Humidity too high",
    "low_humidity": "Air too dry",
    "poor_ventilation": "Poor ventilation",
    "fan_fault": "Fan not spinning",
}
CAUSE_ADVICE = {
    "heat_stress": "Increase ventilation, check drinkers, reduce stocking density in the hottest hours.",
    "cold_stress": "Check brooder heater and close curtains; keep the fan at minimum ventilation.",
    "ammonia": "Ventilate and replace or top up wet litter; check drinker leaks.",
    "high_humidity": "Ventilate, fix leaking drinkers and turn wet litter.",
    "low_humidity": "Air is very dry; avoid over-ventilating and check water supply.",
    "poor_ventilation": "Airflow is too low for the gas load; raise fan speed.",
    "fan_fault": "Fan is commanded on but not spinning: check power, wiring and blades.",
}

FAN_LEVELS = ["low", "medium", "high"]
FAN_DUTY = {"low": 0.25, "medium": 0.6, "high": 1.0}

# (age_days, target °C) for broilers, interpolated linearly.
_TARGET_TEMP = [(0, 33.0), (7, 30.0), (14, 27.0), (21, 24.0), (28, 22.0), (35, 21.0), (42, 20.0), (70, 20.0)]

FEATURE_NAMES = [
    "temp_last", "temp_mean5", "hum_last", "hum_mean5", "gas_last", "gas_mean5",
    "rpm_last", "rpm_mean5", "duty_last", "light_last",
    "age_days", "target_temp", "heat_excess", "cold_deficit", "is_chick",
    "temp_slope", "hum_slope", "gas_slope", "temp_std", "rpm_gap", "gas_per_airflow",
]
N_FEATURES = len(FEATURE_NAMES)


def target_temperature(age_days: float) -> float:
    a = max(0.0, float(age_days))
    for (a0, t0), (a1, t1) in zip(_TARGET_TEMP, _TARGET_TEMP[1:]):
        if a <= a1:
            return t0 + (t1 - t0) * (a - a0) / (a1 - a0)
    return _TARGET_TEMP[-1][1]


def growth_phase(age_days: float) -> str:
    if age_days < 8:
        return "brooding"
    if age_days < 22:
        return "starter"
    if age_days < 36:
        return "grower"
    return "finisher"


def comfort_band(age_days: float) -> tuple[float, float]:
    """Comfortable house temperature range for the flock's age.

    Chicks need a tight band around the brooding target. Older birds in
    Ghana's open-sided houses are comfortable up to about 26 °C even though
    the closed-house guide target keeps falling.
    """
    t = target_temperature(age_days)
    high = t + 1.5 if age_days < 14 else max(t + 1.5, 26.0)
    return t - 1.5, high


def heat_excess(temp: float, humidity: float, age_days: float) -> float:
    """Degrees above the comfort band, with humid heat counted as hotter."""
    eff = temp + 0.08 * max(0.0, humidity - 65.0)
    return eff - comfort_band(age_days)[1]


def cold_deficit(temp: float, age_days: float) -> float:
    return comfort_band(age_days)[0] - temp


@dataclass
class TrueState:
    temperature: float
    humidity: float
    gas_index: float
    fan_rpm: float
    fan_duty: float
    age_days: float


def label_state(s: TrueState) -> tuple[int, np.ndarray]:
    """Ground-truth rules: returns (status, per-cause severity 0/1/2)."""
    warn_t, crit_t = (1.0, 3.0) if s.age_days < 10 else (1.5, 4.0)
    hot = heat_excess(s.temperature, s.humidity, s.age_days)
    cold = cold_deficit(s.temperature, s.age_days)
    sev = np.zeros(len(CAUSES), dtype=np.int64)

    if hot > crit_t:
        sev[0] = 2
    elif hot > warn_t:
        sev[0] = 1
    if cold > crit_t:
        sev[1] = 2
    elif cold > warn_t:
        sev[1] = 1
    if s.gas_index >= 22.0:
        sev[2] = 2
    elif s.gas_index >= 14.0:
        sev[2] = 1
    if s.humidity > 85.0:
        sev[3] = 2
    elif s.humidity > 75.0:
        sev[3] = 1
    if s.humidity < 30.0:
        sev[4] = 2
    elif s.humidity < 40.0:
        sev[4] = 1
    if s.fan_rpm < 500.0 and s.gas_index >= 10.0:
        sev[5] = 1
    if s.fan_duty >= 0.35 and s.fan_rpm < 250.0:
        sev[6] = 2 if (sev[0] or sev[2]) else 1

    return int(sev.max()), sev


def fan_policy(status: int, causes: Iterable[str]) -> str:
    """Pick a fan level. Cold chicks get minimum ventilation, not a gale."""
    causes = set(causes)
    venting = causes & {"heat_stress", "ammonia", "high_humidity", "poor_ventilation", "fan_fault"}
    if venting:
        return "high" if status == 2 else "medium"
    if causes & {"cold_stress", "low_humidity"}:
        return "low"
    return "low" if status == 0 else "medium"


def _slope(y: np.ndarray) -> float:
    n = len(y)
    if n < 2:
        return 0.0
    x = np.arange(n, dtype=np.float64)
    x -= x.mean()
    return float((x * (y - y.mean())).sum() / (x * x).sum())


def extract_features(window: np.ndarray, age_days: float) -> np.ndarray:
    """Build the feature vector from the most recent readings.

    `window` has shape (n, 6) with columns
    humidity, gas_index, temperature, light, fan_rpm, fan_duty
    (the original AI_For_Poultry order, plus the commanded fan duty),
    oldest first. Missing values must already be forward-filled.
    """
    w = np.asarray(window, dtype=np.float64)[-WINDOW:]
    hum, gas, temp, light, rpm, duty = (w[:, i] for i in range(6))
    last5 = slice(-5, None)
    t_mean, h_mean, g_mean, r_mean = temp[last5].mean(), hum[last5].mean(), gas[last5].mean(), rpm[last5].mean()
    target = target_temperature(age_days)
    airflow = max(r_mean / 1250.0, 0.2)
    return np.array([
        temp[-1], t_mean, hum[-1], h_mean, gas[-1], g_mean,
        rpm[-1], r_mean, duty[-1], light[-1],
        age_days, target, heat_excess(t_mean, h_mean, age_days), cold_deficit(t_mean, age_days),
        1.0 if age_days < 10 else 0.0,
        _slope(temp), _slope(hum), _slope(gas), float(temp.std()),
        r_mean - duty[-1] * MAX_RPM, g_mean / airflow,
    ], dtype=np.float32)


def forward_fill(rows: Sequence[Sequence[float]]) -> np.ndarray:
    """Replace NaN/None sensor dropouts with the previous valid value."""
    arr = np.array([[np.nan if v is None else v for v in r] for r in rows], dtype=np.float64)
    for j in range(arr.shape[1]):
        col = arr[:, j]
        last = math.nan
        for i in range(len(col)):
            if np.isnan(col[i]):
                col[i] = last
            else:
                last = col[i]
        if np.isnan(col).any():
            valid = col[~np.isnan(col)]
            col[np.isnan(col)] = valid[0] if len(valid) else 0.0
    return arr
