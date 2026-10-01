"""Sensor and fan drivers for the Raspberry Pi, plus a simulated coop.

Wiring (same as the original AI_For_Poultry build):
    DHT22            -> GPIO 4
    MQ-135 + LDR     -> ADS1115 on I2C, channels 0 and 1
    Fan PWM          -> GPIO 18 through a MOSFET / fan driver on its own 12 V supply
    Fan tach         -> GPIO 23, pulled up to 3.3 V
"""

from __future__ import annotations

import math
import random
import threading
import time
from dataclasses import dataclass

from .features import MAX_RPM, comfort_band


@dataclass
class Reading:
    humidity: float | None
    gas_index: float | None
    temperature: float | None
    light: float | None
    fan_rpm: float | None
    fan_duty: float

    def row(self):
        return [self.humidity, self.gas_index, self.temperature, self.light, self.fan_rpm, self.fan_duty]


class PiHardware:
    def __init__(self, cfg):
        import board  # noqa: F401  (adafruit-blinka)
        import adafruit_dht
        import adafruit_ads1x15.ads1115 as ADS
        from adafruit_ads1x15.analog_in import AnalogIn
        import busio
        from gpiozero import DigitalInputDevice, PWMOutputDevice

        self.cfg = cfg
        self._dht = adafruit_dht.DHT22(getattr(board, f"D{cfg.dht_pin}"), use_pulseio=False)
        i2c = busio.I2C(board.SCL, board.SDA)
        ads = ADS.ADS1115(i2c)
        self._gas = AnalogIn(ads, ADS.P0)
        self._ldr = AnalogIn(ads, ADS.P1)
        self._fan = PWMOutputDevice(cfg.fan_pwm_pin, frequency=cfg.fan_pwm_hz, initial_value=0.0)
        self._tach = DigitalInputDevice(cfg.fan_tach_pin, pull_up=True)
        self._pulses = 0
        self._lock = threading.Lock()
        self._tach.when_deactivated = self._on_pulse
        self._t0 = time.monotonic()
        self.duty = 0.0

    def _on_pulse(self):
        with self._lock:
            self._pulses += 1

    def set_fan(self, duty: float):
        self.duty = max(0.0, min(1.0, duty))
        self._fan.value = self.duty

    def _rpm(self) -> float:
        with self._lock:
            pulses, self._pulses = self._pulses, 0
        now = time.monotonic()
        dt, self._t0 = now - self._t0, now
        return pulses / 2.0 / dt * 60.0 if dt > 0 else 0.0  # 2 pulses per revolution

    def _dht_read(self):
        for _ in range(4):  # DHT22 often fails a read; retry before giving up
            try:
                t, h = self._dht.temperature, self._dht.humidity
                if t is not None and h is not None:
                    return t, h
            except RuntimeError:
                pass
            time.sleep(2.1)
        return None, None

    def read(self) -> Reading:
        t, h = self._dht_read()
        v_gas = self._gas.voltage
        base = self.cfg.mq135_baseline_v
        gas_index = max(0.0, (v_gas - base) / base * 100.0) if base > 0 else None
        v_ldr = self._ldr.voltage
        frac = v_ldr / 3.3
        light = (1.0 - frac if self.cfg.ldr_invert else frac) * 50.0
        return Reading(h, round(gas_index, 2) if gas_index is not None else None, t, round(light, 2),
                       round(self._rpm(), 0), self.duty)

    def gas_voltage(self) -> float:
        return self._gas.voltage

    def close(self):
        self._fan.value = 0.0
        self._dht.exit()


class SimulatedCoop:
    """Closed-loop coop for running the agent without hardware.

    The fan duty the agent picks feeds back into temperature, humidity and
    gas, and faults (heatwave, fan failure, wet litter, heater failure) are
    injected at random so every status shows up in the app.
    """

    def __init__(self, age_days: float, seed: int | None = None, seconds_per_read: float = 120.0):
        self.rng = random.Random(seed)
        self.age = age_days
        self.seconds_per_read = seconds_per_read  # simulated time that passes per reading
        self.T, self.RH, self.G = 27.0, 65.0, 5.0
        self.duty = 0.3
        self.clock = 13 * 3600.0
        self.event, self.event_left = None, 0.0
        self._rpm = 0.0

    def set_fan(self, duty: float):
        self.duty = max(0.0, min(1.0, duty))

    def _step(self, dt: float):
        self.clock += dt
        if self.event_left <= 0 and self.rng.random() < dt / 3600.0:
            self.event = self.rng.choice(["heatwave", "fan_fail", "wet_litter", "heater_fail", "rain"])
            self.event_left = self.rng.uniform(900, 3600)
        elif self.event_left > 0:
            self.event_left -= dt
            if self.event_left <= 0:
                self.event = None
        hour = (self.clock / 3600.0) % 24
        amb_t = 27.0 + 4.0 * math.cos((hour - 15) / 24 * 2 * math.pi) + (7 if self.event == "heatwave" else 0)
        amb_rh = 70.0 - 8.0 * math.cos((hour - 15) / 24 * 2 * math.pi) + (25 if self.event == "rain" else 0)
        rpm = 0.0 if self.event == "fan_fail" or self.duty < 0.12 else self.duty * MAX_RPM
        air = rpm / 1250.0
        low, high = comfort_band(self.age)
        q_birds = 1.5 + 4.0 * min(self.age, 42) / 42.0
        heater = self.age < 21 and self.event != "heater_fail"
        q_heat = max(0.0, min(14.0, ((low + high) / 2 - amb_t) * (1 + 0.8 * air) - q_birds)) if heater else 0.0
        t_eq = amb_t + (q_birds + q_heat) / (1 + 0.8 * air)
        k = min(1.0, dt / 900.0)
        self.T += k * (t_eq - self.T)
        wet = 3.0 if self.event == "wet_litter" else 1.0
        rh_eq = max(10.0, min(99.0, amb_rh + 6.0 * wet / (1 + air) - 2.5 * (self.T - amb_t)))
        self.RH += min(1.0, dt / 600.0) * (rh_eq - self.RH)
        for _ in range(int(dt // 30) or 1):
            self.G = max(0.0, self.G + 0.25 * wet * (0.6 + min(self.age, 56) / 40.0) - self.G * (0.01 + 0.04 * air))
        self._rpm = rpm

    def read(self) -> Reading:
        self._step(self.seconds_per_read)
        g = self.rng.gauss
        return Reading(
            round(max(0, min(100, self.RH + g(0, 1.8))), 1),
            round(max(0, self.G * (1 + g(0, 0.08)) + g(0, 0.7)), 2),
            round(self.T + g(0, 0.35), 1),
            round(max(0, (30 if 6 <= (self.clock / 3600) % 24 <= 18 else 4) + g(0, 1.5)), 1),
            round(max(0, self._rpm + g(0, 45)), 0),
            self.duty,
        )

    def close(self):
        pass
