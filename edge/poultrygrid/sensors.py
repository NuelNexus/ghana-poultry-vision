"""Sensor and fan drivers for the Raspberry Pi, plus a simulated coop.

Wiring:
    DHT22            -> GPIO 4
    MQ-135 + LDR     -> ADS1115 on I2C, channels 0 and 1 (analog, preferred)
                        or straight to GPIO 17 / GPIO 27 using the modules' DO pins
    Fan relay        -> GPIO 18 (relay module IN); the fan runs on its own supply
                        through the relay's COM / NO contacts
    or 4-pin PWM fan -> PWM wire (blue) to GPIO 18, fan GND to a Pi GND, fan
                        12 V from its own supply (PG_FAN_MODE=pwm, no relay)

The Pi has no analog inputs. With an ADS1115 the MQ-135 and LDR give real
levels. Without one, their comparator outputs (DO) only say "over the
threshold you set with the module's screw" or not, so the readings are coarse.
PG_SENSOR_MODE=auto (default) uses the ADS1115 if it answers, else DO.
PG_SENSOR_MODE=none is for before the MQ-135 and LDR are wired: gas and light
are sent as missing, and the model sees clean air and normal daylight instead.
"""

from __future__ import annotations

import logging
import math
import random
import time
from dataclasses import dataclass

from .features import FAN_AIRFLOW, comfort_band

log = logging.getLogger("poultrygrid")

# What a DO pin's state stands for when there's no ADS1115. Picked so a
# triggered MQ-135 reads as a gas warning, not an instant critical.
GAS_DO_TRIGGERED, GAS_DO_CLEAR = 16.0, 4.0
LIGHT_DO_BRIGHT, LIGHT_DO_DARK = 30.0, 3.0


def stand_in_gas_light() -> tuple[float, float]:
    """What the model sees when the gas and light sensors aren't connected: clean
    air, and day or night light like the simulated coop it was trained on."""
    return GAS_DO_CLEAR, LIGHT_DO_BRIGHT if 6 <= time.localtime().tm_hour < 18 else LIGHT_DO_DARK


@dataclass
class Reading:
    humidity: float | None
    gas_index: float | None
    temperature: float | None
    light: float | None
    fan_on: bool

    def row(self):
        return [self.humidity, self.gas_index, self.temperature, self.light, 1.0 if self.fan_on else 0.0]


class FanRelay:
    """Relay-switched fan with a minimum hold time so the contacts don't chatter."""

    def __init__(self, pin: int, active_low: bool, min_switch_s: float):
        from gpiozero import OutputDevice

        self._relay = OutputDevice(pin, active_high=not active_low, initial_value=False)
        self.min_switch_s = min_switch_s
        self.on = False
        self._changed = -math.inf

    def set(self, on: bool, force: bool = False):
        if on == self.on:
            return
        if not force and time.monotonic() - self._changed < self.min_switch_s:
            return  # switched too recently; try again next reading
        self._relay.value = on
        self.on, self._changed = on, time.monotonic()

    def close(self):
        self._relay.off()
        self._relay.close()


class FanPWM:
    """4-pin PWM fan with its PWM wire straight to a GPIO pin; on/off like the relay.

    The model was trained on an on/off fan, so "on" is one fixed duty and "off"
    is 0 %. Many 4-pin fans keep turning slowly at 0 %; that only adds airflow.
    """

    def __init__(self, pin: int, hz: int, on_duty: float, invert: bool):
        from gpiozero import PWMOutputDevice

        # lgpio's software PWM rejects anything above 10 kHz
        self._pwm = PWMOutputDevice(pin, active_high=not invert, frequency=min(hz, 10000), initial_value=0.0)
        self.on_duty = max(0.0, min(1.0, on_duty))
        self.on = False

    def set(self, on: bool, force: bool = False):
        self._pwm.value = self.on_duty if on else 0.0
        self.on = on

    def close(self):
        self._pwm.off()
        self._pwm.close()


def open_fan(cfg):
    if cfg.fan_mode == "pwm":
        return FanPWM(cfg.fan_pwm_pin, cfg.fan_pwm_hz, cfg.fan_pwm_duty, cfg.fan_pwm_invert)
    return FanRelay(cfg.fan_relay_pin, cfg.relay_active_low, cfg.relay_min_switch_s)


def open_ads1115():
    import board
    import busio
    import adafruit_ads1x15.ads1115 as ADS
    from adafruit_ads1x15.analog_in import AnalogIn

    ads = ADS.ADS1115(busio.I2C(board.SCL, board.SDA))
    return AnalogIn(ads, ADS.P0), AnalogIn(ads, ADS.P1)


class PiHardware:
    def __init__(self, cfg):
        import board  # noqa: F401  (adafruit-blinka)
        import adafruit_dht

        self.cfg = cfg
        self._dht = adafruit_dht.DHT22(getattr(board, f"D{cfg.dht_pin}"), use_pulseio=False)
        self._dht_last = None  # (temperature, humidity, monotonic time)
        self._gas = self._ldr = self._gas_do = self._ldr_do = None
        self.mode = "none" if cfg.sensor_mode == "none" else "digital"
        if self.mode == "none":
            log.warning("PG_SENSOR_MODE=none: MQ-135 and LDR not connected; gas and light are reported as missing")
        elif cfg.sensor_mode in ("auto", "ads1115"):
            try:
                self._gas, self._ldr = open_ads1115()
                self._gas.voltage  # noqa: B018  fails here if nothing answers on I2C
                self.mode = "ads1115"
            except Exception as e:  # no ADS1115 on the bus
                if cfg.sensor_mode == "ads1115":
                    raise
                log.warning("No ADS1115 (%s); reading MQ-135 and LDR from their DO pins", e)
        if self.mode == "digital":
            from gpiozero import DigitalInputDevice

            # LM393 modules pull DO low when over their threshold.
            self._gas_do = DigitalInputDevice(cfg.gas_do_pin, pull_up=True)
            self._ldr_do = DigitalInputDevice(cfg.ldr_do_pin, pull_up=True)
        self._fan = open_fan(cfg)

    @property
    def fan_on(self) -> bool:
        return self._fan.on

    def set_fan(self, on: bool, force: bool = False):
        self._fan.set(on, force)

    def _dht_read(self):
        # The bit-banged DHT22 driver only gets about 1 read in 4 through on a Pi,
        # so retry, then reuse the last good reading for a couple of minutes.
        for _ in range(8):
            try:
                t, h = self._dht.temperature, self._dht.humidity
                if t is not None and h is not None:
                    self._dht_last = (t, h, time.monotonic())
                    return t, h
            except RuntimeError:
                pass
            time.sleep(2.1)
        if self._dht_last and time.monotonic() - self._dht_last[2] < 120:
            return self._dht_last[:2]
        return None, None

    def _gas_light(self) -> tuple[float | None, float | None]:
        if self.mode == "none":
            return None, None
        if self.mode == "ads1115":
            base = self.cfg.mq135_baseline_v
            v_gas = self._gas.voltage
            gas = round(max(0.0, (v_gas - base) / base * 100.0), 2) if base > 0 else None
            frac = self._ldr.voltage / 3.3
            return gas, round((1.0 - frac if self.cfg.ldr_invert else frac) * 50.0, 2)
        gas = GAS_DO_TRIGGERED if not self._gas_do.value else GAS_DO_CLEAR
        bright = not self._ldr_do.value
        if not self.cfg.ldr_invert:
            bright = not bright
        return gas, LIGHT_DO_BRIGHT if bright else LIGHT_DO_DARK

    def read(self) -> Reading:
        t, h = self._dht_read()
        gas, light = self._gas_light()
        return Reading(h, gas, t, light, self._fan.on)

    def gas_voltage(self) -> float:
        if self.mode != "ads1115":
            raise RuntimeError("Calibration needs the MQ-135 on an ADS1115 (analog). In DO mode, set the threshold with the module's screw.")
        return self._gas.voltage

    def close(self):
        self._fan.close()
        self._dht.exit()


class SimulatedCoop:
    """Closed-loop coop for running the agent without hardware.

    The relay state the agent picks feeds back into temperature, humidity
    and gas, and faults (heatwave, fan failure, wet litter, heater failure) are
    injected at random so every status shows up in the app.
    """

    def __init__(self, age_days: float, seed: int | None = None, seconds_per_read: float = 120.0):
        self.rng = random.Random(seed)
        self.age = age_days
        self.seconds_per_read = seconds_per_read  # simulated time that passes per reading
        self.T, self.RH, self.G = 27.0, 65.0, 5.0
        self.fan_on = False
        self.clock = 13 * 3600.0
        self.event, self.event_left = None, 0.0

    def set_fan(self, on: bool, force: bool = False):
        self.fan_on = on

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
        air = FAN_AIRFLOW if self.fan_on and self.event != "fan_fail" else 0.0
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

    def read(self) -> Reading:
        self._step(self.seconds_per_read)
        g = self.rng.gauss
        return Reading(
            round(max(0, min(100, self.RH + g(0, 1.8))), 1),
            round(max(0, self.G * (1 + g(0, 0.08)) + g(0, 0.7)), 2),
            round(self.T + g(0, 0.35), 1),
            round(max(0, (30 if 6 <= (self.clock / 3600) % 24 <= 18 else 4) + g(0, 1.5)), 1),
            self.fan_on,
        )

    def close(self):
        pass
