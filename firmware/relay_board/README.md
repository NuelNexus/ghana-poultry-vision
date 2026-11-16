# Incubator relay board

An ESP32 with four relays, switched from the site (Automation, tap a part of the incubator) or
from its own page on the farm Wi-Fi.

| Relay | GPIO | Site name |
|---|---|---|
| Incubator controller (heater, turner) | 22 | `incubator` |
| Fan | 23 | `fan` |
| Light | 21 | `light` |
| Strip light | 19 | `strip` |

| Sensor | GPIO | |
|---|---|---|
| DHT22 inside the incubator (temperature, humidity) | 14 | data pin; VCC 3.3 V, GND; 10k pull-up to 3.3 V on a bare sensor |

The DHT22 is read every 2.5 s and sent with each check-in. The site shows it on Automation
(on the drawing and the climate card) against the incubator preset: chicken, guinea fowl, duck,
turkey or quail eggs, lockdown, or a custom range. It only reports; the incubator controller
keeps its own thermostat.

All relays are ON at power-up; the site's last setting follows on the first check-in.
`RELAY_ON` / `RELAY_OFF` at the top of the sketch flip this for "active low" relay modules.

## Set up

1. On the site: Devices, Add device, **Incubator relay board**. Copy the three lines it shows.
2. Copy `secrets.example.h` to `secrets.h` and fill in your Wi-Fi and those three lines.
   `secrets.h` is ignored by git, so your password and key stay on your computer.
3. Arduino IDE: install **ArduinoJson** (v7) and **DHT sensor library** by Adafruit (it asks
   to add **Adafruit Unified Sensor** too, say yes), pick **ESP32 Dev Module**, upload, open the serial
   monitor at 115200 baud. It prints its IP address, then `Site: online`.

## How it talks to the site

`POST /api/public/devices/relays` with headers `x-device-id` and `x-api-key`:

```json
{ "state": { "incubator": true, "fan": false, "light": true, "strip": true },
  "version": 12, "local": false, "firmware": "relay-board 1.1", "rssi": -61,
  "reading": { "temp": 37.6, "humidity": 54.2, "ok": true } }
```

Reply: `{ "desired": { ... }, "version": 13, "next_ms": 1500 }`. The board switches to `desired`
when `version` changes, and checks in again after `next_ms`: 1.5 s while someone has Automation
open, else 15 s. A switch on its own page is sent with `"local": true` right away, and the site
adopts it.

`reading.ok` is false (and the values null) when the DHT22 hasn't given a good read for 15 s.

Its own page and the old addresses (`/fan/on`, `/light/off`, `/status`, ...) still work on the
farm Wi-Fi.
