"""How the v3 model saw readings, kept only so train.py can benchmark v4 against it.

v3 was trained on clean readings that were always there. On the Pi, dropouts
were forward-filled (a sensor that never answered became 0), garbage values went
straight in, and unwired gas/light sensors were replaced with clean air and
day/night light. This reproduces that so the comparison is fair.
"""

from __future__ import annotations

import math

import numpy as np

from .features import FAN_AIRFLOW, WINDOW, _slope, cold_deficit, heat_excess, target_temperature


def forward_fill_v3(rows) -> np.ndarray:
    arr = np.array(rows, dtype=np.float64)
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


def extract_features_v3(window, age_days: float, hours=None, gas_light_wired: bool = True) -> np.ndarray:
    w = forward_fill_v3(np.asarray(window, dtype=np.float64)[-WINDOW:])
    if not gas_light_wired:  # the v3 agent's stand-ins for PG_SENSOR_MODE=none
        w[:, 1] = 4.0
        w[:, 3] = 30.0 if hours is None or 6 <= hours < 18 else 3.0
    hum, gas, temp, light, fan = (w[:, i] for i in range(5))
    last5 = slice(-5, None)
    t_mean, h_mean, g_mean, f_mean = temp[last5].mean(), hum[last5].mean(), gas[last5].mean(), fan[last5].mean()
    airflow = max(f_mean * FAN_AIRFLOW, 0.2)
    return np.array([
        temp[-1], t_mean, hum[-1], h_mean, gas[-1], g_mean,
        fan[-1], f_mean, fan.mean(), light[-1],
        age_days, target_temperature(age_days), heat_excess(t_mean, h_mean, age_days),
        cold_deficit(t_mean, age_days), 1.0 if age_days < 10 else 0.0,
        _slope(temp), _slope(hum), _slope(gas), float(temp.std()),
        g_mean / airflow,
    ], dtype=np.float32)
