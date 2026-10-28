# Coop unit (unit 2): ESP32 firmware

The PoultryGrid kit has two units:

| Unit | Hardware | Code | What it does |
|-|-|-|-|
| 1 · Incubator & brooder | Raspberry Pi | [`edge/`](../../edge/README.md) | AI rates the chicks' conditions, switches the brooder fan |
| **2 · Coop** | **ESP32** | **this folder** | Runs fans and heat lamps in two zones, checks the drinking water, takes orders from the site |

`coop_unit.ino` is the stand-alone coop sketch (two zones with a DHT sensor, a fan relay and a
lamp relay each, a water turbidity sensor and a 16×2 LCD) reworked so it can be run from the
site. Pins, relay logic, the thermostat and its hysteresis are unchanged.

## What you can do from the site

On **Automation → Coop · unit 2**, for each zone (layers, broilers):

- **Auto / Manual.** Auto runs the coop's own thermostat. Manual does exactly what you set.
- **Fan and heat lamp on/off** (Manual).
- **The four temperatures** (Auto): fan on above, fan off at, lamp off at, lamp on below.
- **Water thresholds:** the turbidity voltage below which the water counts as dirty, and
  above which it counts as clean again.

Every change gets a version number. The coop picks it up on its next check-in (every 10 s),
saves it in flash, and reports back the version it is running, so the page shows *Sending…*
until the coop confirms, then *Running settings v5*.

## Safety (not changeable from the site)

- The lamp is forced off if a zone goes 6 °C above its "fan on" temperature, or above 40 °C,
  **in any mode**. The LCD shows `HOT` and the site raises a critical alert.
- If a zone's sensor fails 3 times in a row, its lamp goes off (never heat blind). In Auto the
  fan goes off too, as in the original sketch; in Manual the fan follows your setting.
- Fan and lamp are never on together; if both are asked for, the fan wins.
- Bad settings from the site (temperatures out of order, water thresholds reversed) are
  refused; the coop keeps its current settings and the site raises a warning.
- No Wi-Fi: the coop keeps running on the last settings it saved.

## Wiring (unchanged)

| Part | Connection |
|-|-|
| DHT22, layers zone | GPIO 4 |
| DHT11, broilers zone | GPIO 5 |
| Layers fan / lamp relays | GPIO 25 / 26 |
| Broilers fan / lamp relays | GPIO 27 / 14 |
| Turbidity sensor A pin | GPIO 34 through a 10 kΩ / 20 kΩ divider (the module outputs up to 4.5 V) |
| LCD 16×2 (I²C, 0x27) | SDA 21, SCL 22 |

The relay board is active-high (`RELAY_ACTIVE_HIGH = true`). If the relays work backwards,
set it to `false`.

## Set up

1. On the site: **Devices → Add device → Unit 2 · Coop controller (ESP32)**. Copy the three
   `#define` lines it shows.
2. Copy `config.example.h` to `config.h` (it's gitignored) and paste them in, with your
   Wi-Fi name and password. `PG_API_URL` must be an address the ESP32 can reach, not
   `localhost`.
3. Arduino IDE: install the board package **esp32** (Espressif) and the libraries **DHT sensor
   library** (Adafruit), **LiquidCrystal I2C** and **ArduinoJson** (version 7). Board:
   **ESP32 Dev Module**.
4. Upload `coop_unit.ino` and open the serial monitor at 115200 baud. The LCD cycles through
   the welcome screen, each zone, the water and the connection (`SITE: ONLINE / SETTINGS v4`).

HTTPS is checked against the root certificates in `root_ca.h` (Let's Encrypt, Google Trust
Services and SSL.com, which cover Cloudflare, Vercel and Lovable). For a test server without a
valid certificate, `PG_INSECURE_TLS 1` turns the check off; don't use it on a real site.

## Try it without the ESP32

`emulator.py` speaks to the site exactly like the sketch and runs the same control logic
(thermostat, manual mode, overheat cut-out, settings validation), with simulated temperatures
that react to the fan and lamp:

```bash
python firmware/coop_unit/emulator.py --url http://localhost:3000 --device COOP-1 --key <api key>
```

## What it sends and receives

`POST /api/public/devices/ingest` every 10 s, headers `x-device-id` and `x-api-key`:

```json
{
  "unit": "coop", "firmware": "coop-2.0.0", "config_version": 4, "rssi": -61, "uptime_s": 5230,
  "zones": {
    "layers":   { "temp": 23.4, "humidity": 62, "sensor_ok": true, "fan": true,  "lamp": false, "mode": "manual", "safety_tripped": false },
    "broilers": { "temp": 21.1, "humidity": 66, "sensor_ok": true, "fan": false, "lamp": false, "mode": "auto",   "safety_tripped": false }
  },
  "water": { "voltage": 3.21, "sensor_ok": true, "good": true }
}
```

The response's `config.controls` holds the settings (validated on the site with the same rules
as the firmware, `src/lib/controls.ts`):

```json
{ "version": 5,
  "zones": { "layers": { "mode": "manual", "fan": true, "lamp": false,
                         "high_temp": 24, "fan_off_temp": 23, "lamp_off_temp": 19, "low_temp": 18 },
             "broilers": { "...": "..." } },
  "water": { "bad_v": 2.5, "good_v": 2.7 } }
```

## Not yet checked

The sketch was written against the arduino-esp32 and ArduinoJson 7 APIs but **has not been
compiled or run on an ESP32 yet** (no Arduino toolchain was available where it was written).
The emulator, which mirrors its logic, was run against the site. Compile it once in the
Arduino IDE and fix anything it reports before installing it in the coop.
