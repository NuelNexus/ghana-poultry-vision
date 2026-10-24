"""Shared domain logic for training and the Pi runtime.

Everything that has to agree between `train.py` and `agent.py` lives here:
growth-phase targets, the feature vector, the labelling rules and the fan
policy. Only numpy is required, so this imports fine on a Pi Zero.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np

WINDOW = 10            # readings kept for temporal features (10 x 30 s = 5 min)
FAN_AIRFLOW = 2.0      # relative air changes when the relay fan is on (off = 0)

STATUS_LABELS = ["healthy", "warning", "critical"]
STATUS_TITLES = ["Healthy", "Warning", "Critical"]

CAUSES = [
    "heat_stress",
    "cold_stress",
    "ammonia",
    "high_humidity",
    "low_humidity",
    "poor_ventilation",
]
CAUSE_TITLES = {
    "heat_stress": "Heat stress",
    "cold_stress": "Too cold for flock age",
    "ammonia": "Ammonia / gas build-up",
    "high_humidity": "Humidity too high",
    "low_humidity": "Air too dry",
    "poor_ventilation": "Poor ventilation",
}
CAUSE_ADVICE = {
    "heat_stress": "Increase ventilation, check drinkers, reduce stocking density in the hottest hours.",
    "cold_stress": "Check brooder heater and close curtains; keep the fan at minimum ventilation.",
    "ammonia": "Ventilate and replace or top up wet litter; check drinker leaks.",
    "high_humidity": "Ventilate, fix leaking drinkers and turn wet litter.",
    "low_humidity": "Air is very dry; avoid over-ventilating and check water supply.",
    "poor_ventilation": "Airflow is too low for the gas load. Switch the fan on and open the curtains. If the fan is already on, check it is actually turning.",
}

# The fan is switched by a relay, so it is either off or on.
FAN_STATES = ["off", "on"]

# (age_days, target °C) for broilers, interpolated linearly.
_TARGET_TEMP = [(0, 33.0), (7, 30.0), (14, 27.0), (21, 24.0), (28, 22.0), (35, 21.0), (42, 20.0), (70, 20.0)]

FEATURE_NAMES = [
    "temp_last", "temp_mean5", "hum_last", "hum_mean5", "gas_last", "gas_mean5",
    "fan_on_last", "fan_on_frac5", "fan_on_frac10", "light_last",
    "age_days", "target_temp", "heat_excess", "cold_deficit", "is_chick",
    "temp_slope", "hum_slope", "gas_slope", "temp_std", "gas_per_airflow",
    # How far each sensor can be trusted over the window (0 = dead / missing / stuck).
    "temp_ok", "hum_ok", "gas_ok", "light_ok", "gas_coarse",
    # Minutes since the DHT22 last gave a fresh, sane reading (capped at 60).
    "dht_age_min",
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
    airflow: float       # real air movement; 0 if the relay is off or the fan has failed
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
    if s.airflow < 0.4 and s.gas_index >= 10.0:
        sev[5] = 1

    return int(sev.max()), sev


def fan_policy(status: int, causes: Iterable[str]) -> str:
    """Switch the relay fan "on" or "off". Cold chicks are never blasted."""
    causes = set(causes)
    if causes & {"heat_stress", "ammonia", "high_humidity", "poor_ventilation"}:
        return "on"
    if causes & {"cold_stress", "low_humidity"}:
        return "off"
    return "off" if status == 0 else "on"


def _slope(y: np.ndarray) -> float:
    n = len(y)
    if n < 2:
        return 0.0
    x = np.arange(n, dtype=np.float64)
    x -= x.mean()
    return float((x * (y - y.mean())).sum() / (x * x).sum())


# Sensor columns in a reading row, oldest row first: the order Reading.row() uses.
SENSORS = ["humidity", "gas_index", "temperature", "light"]
HUM, GAS, TEMP, LIGHT, FAN = range(5)

# Anything outside these is a wiring fault or a corrupted read, not the house.
PLAUSIBLE = {HUM: (1.0, 100.0), GAS: (0.0, 80.0), TEMP: (-5.0, 55.0), LIGHT: (0.0, 50.0)}
# Values the MQ-135's DO pin maps to when there is no ADS1115 (sensors.GAS_DO_*).
GAS_DO_LEVELS = (4.0, 16.0)


def _as_array(window) -> np.ndarray:
    return np.array([[np.nan if v is None else v for v in r] for r in window], dtype=np.float64)


def sensor_health(window) -> dict[str, str]:
    """Per sensor: "ok", "missing", "implausible" or "stuck", over the recent window.

    Stuck only applies to the DHT22: it always jitters by a tenth or two, so ten
    identical readings mean a frozen or disconnected sensor (the agent reuses the
    last good read for at most 4 readings). Gas and light can legitimately sit
    still (clean air, night, or a DO pin), so they are only judged by presence
    and range.
    """
    w = _as_array(window)[-WINDOW:]
    out = {}
    for j, name in enumerate(SENSORS):
        col = w[:, j]
        lo, hi = PLAUSIBLE[j]
        present = ~np.isnan(col)
        sane = present & (col >= lo) & (col <= hi)
        recent = slice(-4, None)
        if not present[recent].any():
            out[name] = "missing"
        elif not sane[recent].any():
            out[name] = "implausible"
        elif j in (HUM, TEMP) and sane.sum() >= WINDOW and np.ptp(col[sane]) == 0:
            out[name] = "stuck"
        else:
            out[name] = "ok"
    return out


def clean_window(window) -> tuple[np.ndarray, dict[str, str]]:
    """Readings with faulty values blanked (NaN) and the health of each sensor."""
    w = _as_array(window)[-WINDOW:]
    health = sensor_health(w)
    for j, name in enumerate(SENSORS):
        lo, hi = PLAUSIBLE[j]
        col = w[:, j]
        col[(col < lo) | (col > hi)] = np.nan
        if health[name] in ("missing", "implausible", "stuck"):
            col[:] = np.nan
    return w, health


class SensorMemory:
    """Remembers the DHT22 beyond the 5-minute window: its last sane reading and
    how long ago it last changed. A frozen or unplugged sensor then still gives
    the model its last known temperature, with an age that tells it how far to
    trust it. Update it with every reading, in order.
    """

    def __init__(self, seconds_per_reading: float = 30.0):
        self.dt = seconds_per_reading
        self.temp: float | None = None
        self.hum: float | None = None
        self.steps_since_fresh = 10_000

    def update(self, row) -> None:
        t, h = row[TEMP], row[HUM]
        t = None if t is None or t != t or not PLAUSIBLE[TEMP][0] <= t <= PLAUSIBLE[TEMP][1] else float(t)
        h = None if h is None or h != h or not PLAUSIBLE[HUM][0] <= h <= PLAUSIBLE[HUM][1] else float(h)
        fresh = t is not None and (self.temp is None or t != self.temp or (h is not None and h != self.hum))
        if t is not None:
            self.temp = t
        if h is not None:
            self.hum = h
        self.steps_since_fresh = 0 if fresh else self.steps_since_fresh + 1

    @property
    def age_min(self) -> float:
        return min(self.steps_since_fresh * self.dt / 60.0, 60.0)


def _fill(col: np.ndarray, default: float) -> np.ndarray:
    """Forward-fill gaps, back-fill the start, and use `default` if nothing is left."""
    out = col.copy()
    last = np.nan
    for i in range(len(out)):
        if np.isnan(out[i]):
            out[i] = last
        else:
            last = out[i]
    valid = out[~np.isnan(out)]
    out[np.isnan(out)] = valid[0] if len(valid) else default
    return out


def extract_features(window, age_days: float, memory: SensorMemory | None = None) -> np.ndarray:
    """Build the model's input from the most recent readings.

    `window` rows are humidity, gas_index, temperature, light, fan_on (0/1),
    oldest first, straight from the sensors: None / NaN for a failed read is
    fine, and so are garbage values. Faulty readings are blanked, gaps filled
    from neighbours, and a dead sensor replaced with its last known value (from
    `memory`, already updated with the newest row) or a neutral one, while its
    *_ok and dht_age_min inputs tell the model how far to trust it.
    """
    w, _ = clean_window(window)
    n = len(w)
    target = target_temperature(age_days)
    ok = [float((~np.isnan(w[:, j])).sum()) / n for j in range(4)]
    gas_seen = w[:, GAS][~np.isnan(w[:, GAS])]
    gas_coarse = 1.0 if len(gas_seen) and np.isin(gas_seen, GAS_DO_LEVELS).all() else 0.0
    known_t = memory.temp if memory and memory.temp is not None else target
    known_h = memory.hum if memory and memory.hum is not None else 65.0
    hum = _fill(w[:, HUM], known_h)
    gas = _fill(w[:, GAS], GAS_DO_LEVELS[0])
    temp = _fill(w[:, TEMP], known_t)
    light = _fill(w[:, LIGHT], 25.0)
    fan = np.nan_to_num(w[:, FAN], nan=0.0)
    last5 = slice(-5, None)
    t_mean, h_mean, g_mean, f_mean = temp[last5].mean(), hum[last5].mean(), gas[last5].mean(), fan[last5].mean()
    airflow = max(f_mean * FAN_AIRFLOW, 0.2)
    return np.array([
        temp[-1], t_mean, hum[-1], h_mean, gas[-1], g_mean,
        fan[-1], f_mean, fan.mean(), light[-1],
        age_days, target, heat_excess(t_mean, h_mean, age_days), cold_deficit(t_mean, age_days),
        1.0 if age_days < 10 else 0.0,
        _slope(temp), _slope(hum), _slope(gas), float(temp.std()),
        g_mean / airflow,
        ok[TEMP], ok[HUM], ok[GAS], ok[LIGHT], gas_coarse,
        memory.age_min if memory else 0.0,
    ], dtype=np.float32)
