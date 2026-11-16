# Brooding area unit (ESP32)

The brooding area's sensors on an ESP32 instead of the Raspberry Pi. The AI that used to run
on the Pi (status, causes, fan decision; `edge/agent.py`) now runs on your PC:

```
ESP32: DHT22 + MQ-135 ──(Wi-Fi, every 30 s, device ID + API key)──> PC: edge/brooder_server.py
                                                                       model v4, smoothing, causes, fan
                                                                       └──> site /api/public/devices/ingest
```

The site sees exactly what the Pi used to send, so the Dashboard, AI Health, Houses, Alerts and
Automation pages work as before. The PC needs to be on, running `npm start`.

| Part | ESP32 |
|---|---|
| DHT22 | DATA → GPIO 4 (10k pull-up to 3.3 V on a bare sensor), VCC 3.3 V, GND |
| MQ-135 | AO → 10k → GPIO 34 → 10k → GND (halves its 0–5 V), VCC 5 V, GND |
| Fan relay (optional) | IN → any free output, set `FAN_RELAY_PIN` at the top of the sketch |

There's no light sensor on this unit; the AI is told it's not wired (not broken) and works
without it.

## Set up

1. Site: **Devices → Register device → Unit 1 · Incubator & brooder**. Copy its device ID and
   API key (or reuse the ones the Pi had).
2. Copy `secrets.example.h` to `secrets.h`: your Wi-Fi (the same network as the PC) and the ID
   and key. `secrets.h` is ignored by git.
3. Arduino IDE: install **DHT sensor library** (Adafruit, plus **Adafruit Unified Sensor**) and
   **ArduinoJson** v7. Board **ESP32 Dev Module**. Upload, serial monitor at 115200.
4. On the PC: `npm start`. The first time, Windows asks to let Python through the firewall:
   allow it on **private networks** (the ESP32 can't reach the PC otherwise).

The serial monitor shows each reading, then `Found the PoultryGrid PC at …` and the AI's
answer every 30 s, e.g. `AI: warning (82%) | Heat stress`.

## Finding the PC

The ESP32 broadcasts `PG-BROODER?` on UDP port 5004 and the PC answers, so it doesn't matter
what IP the PC has. After two failed sends it looks again (the PC got a new address, or was
off). To use a fixed address instead, set `PG_PC_HOST` in `secrets.h`.

## Gas calibration

The gas level is how far the MQ-135's voltage is above its clean-air voltage (the same scale
the Pi used). With the sensor warmed up and in clean air, on the PC:

```bash
python edge/brooder_server.py calibrate
```

It prints `PG_ESP_MQ135_BASELINE_V=…` after 10 readings (5 minutes); put that line in
`edge/agent.env`. Until then 0.9 V is assumed.

## The fan

The AI decides on or off (heat, gas and damp switch it on; cold chicks keep it off; at least 60 s
between switches), and a manager can force it on Automation. With `FAN_RELAY_PIN` set, the unit
switches its relay to match and reports the real state back.
