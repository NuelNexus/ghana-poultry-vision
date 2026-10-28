# PoultryGrid edge AI (Raspberry Pi)

A rebuilt version of the coop-condition model from
[engieworks15-dotcom/AI_For_Poultry](https://github.com/engieworks15-dotcom/AI_For_Poultry).
It runs on a Raspberry Pi, switches the ventilation fan through a relay, and reports every
reading and prediction to the PoultryGrid app, where it shows up live on the
Dashboard, AI Health, Houses and Alerts pages.

```
DHT22 / MQ-135 / LDR ──> Pi agent ──> model (numpy) ──> fan relay (on / off)
                                        │
                                        └──> POST /api/public/devices/ingest ──> Neon ──> app
```

## What the app shows for each reading

| Field | Meaning |
|-|-|
| **Status** | Healthy / Warning / Critical, smoothed so it doesn't flicker |
| **Confidence** | Calibrated probability for that status |
| **Causes** | Heat stress, too cold for flock age, ammonia/gas build-up, humidity too high, air too dry, poor ventilation, each with advice |
| **Growth phase** | Brooding / Starter / Grower / Finisher, from the flock's age |
| **Target temp** | What the house should be for that age (33 °C on day 0 down to 20 °C) |
| **Fan** | On / Off, switched by the agent through the relay (or forced from the Devices or Automation page) |

Status changes create alerts automatically, and the alerts close again once conditions recover.

## What changed from the original model

| | Original | v4 (current) |
|-|-|-|
| Training data | 12k rows drawn independently; labels computed from the *same* values the model sees | 6,000 simulated coop episodes (462k samples) over time with weather, flock age, brooder heat, airflow, wet litter, heatwaves, heater and fan failures. The sensors are this farm's parts read the way the agent reads them: MQ-135 and LDR through an ADS1115, the DO pins or not wired; relay or 4-pin PWM fan. Two thirds of episodes include sensor faults (below). Labels come from the true state; the model sees noisy, sometimes broken readings |
| Inputs | 5 instantaneous readings | 26 features: the 4 sensors + fan state, share of the last 5 and 10 readings the fan was on, 5-minute means, trends (slopes), temperature variance, flock age and age-specific comfort band, gas per unit airflow, how far each sensor can be trusted, whether gas comes from the on/off DO pin, and how many minutes old the last fresh DHT22 reading is |
| Broken sensors | Not handled: a dead sensor read as 0 °C, garbage went straight in | Every reading is checked first (missing, out of range, frozen). Faulty values are dropped, a dead DHT22 is replaced with its last good reading and that reading's age, and the agent reports each sensor's health to the app |
| Flock age | Ignored (fixed 26 °C target) | Age-aware: a 3-day-old chick at 26 °C is in danger; a 5-week bird at 26 °C is fine |
| Outputs | Status only | Status + which of 6 causes + calibrated confidence |
| Fan logic | Critical → high, always | Heat, gas and damp switch the fan on; cold chicks keep it off. The relay holds each state for at least 60 s |
| Evaluation | Random row split | Split by episode (no leakage), plus macro-F1 and critical recall |
| On the Pi | PyTorch + scikit-learn + pickle | Numpy only; the model is a 108 KB `.npz` file (26 → 128 → 128 → 64) |
| Stability | Raw prediction each reading | EMA + hysteresis: escalate after 2 readings (1 if very sure it's critical), de-escalate after 4 |
| Network loss | n/a | Readings buffered in SQLite and sent in order when back online |

### Results: v4 against v3, sensor by sensor (`models/metrics.json`)

300 unseen simulated episodes per situation. v3 is fed the way the v3 agent fed it
(dropouts forward-filled, garbage passed through, unwired sensors replaced with
clean air). *Accuracy* is the share of readings with the right status; *false
critical* is how often a house that isn't critical gets called critical.

| Situation | v3 accuracy | v4 accuracy | v3 false critical | v4 false critical |
|-|-|-|-|-|
| All sensors fine (ADS1115, relay) | 91.3 % | 91.1 % | 2.6 % | 3.0 % |
| 4-pin PWM fan | 92.3 % | 92.0 % | 2.8 % | 3.2 % |
| DHT22 flaky (40 % of reads fail) | 90.7 % | 90.4 % | 2.1 % | 2.5 % |
| Gas/light on the DO pins | 79.6 % | 79.8 % | 1.2 % | 6.5 % |
| Gas/light not wired | 73.2 % | 74.1 % | 2.0 % | 3.1 % |
| **DHT22 unplugged** | 49.8 % | **77.2 %** | 71.9 % | **13.6 %** |
| DHT22 frozen | 76.2 % | 76.1 % | 12.2 % | 12.8 % |
| **DHT22 sending garbage** | 49.2 % | **83.7 %** | 74.1 % | **6.2 %** |
| MQ-135 unplugged | 75.8 % | 78.6 % | 1.5 % | 4.6 % |
| **MQ-135 floating input** | 51.1 % | **71.3 %** | 69.2 % | **14.9 %** |
| LDR unplugged | 91.8 % | 91.2 % | 1.8 % | 2.7 % |

With healthy sensors v4 is as good as v3 (about 91 %); nothing more can be squeezed
out of the same readings. The gain is when hardware fails: a pulled DHT22 wire, a
corrupted read or a floating gas input used to make v3 call a critical alarm about
70 % of the time, wrongly; v4 recognises the fault, works from what it still
trusts, and the app shows which sensor needs attention. With the DO pins, v4 catches
more real emergencies (critical recall 96 % against 88 %) at the cost of more false
alarms. When the DHT22 is dead, nothing can measure heat, so v4 leans cautious and
keeps the fan on. On a mix like the field (two thirds of episodes with some fault)
v4 scores 84.1 % accuracy and 94.6 % critical recall.

> These numbers come from simulated data. Real-world accuracy depends on how
> closely the simulator matches your house. Once the Pi has logged a few weeks of
> readings, you can export them from Neon and fine-tune the model on them.

## Hardware

| Part | Connection |
|-|-|
| DHT22 | Data to GPIO 4 (10k pull-up to 3.3 V if it's a bare sensor) |
| MQ-135 | AO to ADS1115 A0 through a 10k/20k divider (analog, preferred), or DO to GPIO 17 |
| LDR module | AO to ADS1115 A1 (analog), or DO to GPIO 27 |
| Fan relay | IN to GPIO 18, VCC to 5 V, GND to GND. The fan's own supply goes through COM and NO |
| or 4-pin PWM fan | PWM wire (usually blue) to GPIO 18, fan GND to a Pi GND *and* the 12 V supply's GND, fan +12 V from that supply. No relay or MOSFET. Set `PG_FAN_MODE=pwm` |

The Pi has no analog inputs. With an ADS1115 on I²C the agent gets real gas and
light levels. Without one it reads the modules' DO pins, which only say "over
the threshold set with the module's screw" or not, so the gas index becomes 4
(clear) or 16 (triggered) and the light is dark or bright. `PG_SENSOR_MODE=auto`
(the default) uses the ADS1115 if it answers and falls back to DO otherwise.
Nothing wired to the DO pins reads as "gas detected", so until the MQ-135 and
LDR are connected set `PG_SENSOR_MODE=none`: gas and light are sent as missing
and the model is given clean air and normal day/night light in their place.

Most relay boards switch on when IN is pulled low (`PG_RELAY_ACTIVE_LOW=1`, the
default). The agent waits at least `PG_RELAY_MIN_SWITCH_S` (60 s) between
switches so the contacts don't chatter; a manager's override from the app skips
that wait. A relay can't tell whether the blades are turning, so there is no fan
fault detection: if the fan is on and the house keeps heating up, check it.

A 4-pin PWM fan needs no extra parts: its PWM input is a logic-level signal the
Pi's 3.3 V GPIO drives directly (the ADS1115 can't help here; it only reads
analog inputs). The fan still needs its own 12 V supply; never take 12 V near
the Pi's pins, and join the grounds. With `PG_FAN_MODE=pwm` the agent runs the
fan at `PG_FAN_PWM_DUTY` (default 100 %) for "on" and 0 % for "off", at 10 kHz
(the most the Pi's software PWM does; fans are specified for 25 kHz but run
fine at 10). Many 4-pin fans keep turning slowly at 0 %; if yours must stop
completely, use the relay instead. A 3-pin or 2-pin fan has no PWM input and
needs the relay.

Works on a Pi 3, 4, 5 or Zero 2 W with Raspberry Pi OS Bookworm.

## Test the sensors

After wiring, check each part on its own before running the agent:

```bash
cd edge
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r requirements-pi.txt
.venv/bin/python test_sensors.py          # i2c, dht, gas, light, relay, with PASS/WARN/FAIL and wiring hints
.venv/bin/python test_sensors.py fan      # just the fan (relay click or PWM speed change)
.venv/bin/python test_sensors.py live     # all readings every 2 s
```

The MQ-135 module runs on 5 V, so put a divider (10k + 20k) between its AO and the
ADS1115's A0 to keep the input under 3.3 V.

## Install on the Pi

1. In the app, open **Devices → Register device**, choose *Raspberry Pi (edge AI)* and the house.
   Copy the `agent.env` it shows. In **Houses**, set *Chicks placed on* so the Pi knows the flock age.
2. On the Pi:
   ```bash
   git clone https://github.com/NuelNexus/ghana-poultry-vision.git
   sudo ghana-poultry-vision/edge/deploy/install_pi.sh
   ```
   It installs dependencies, asks for the app URL, device ID and key, and starts the
   `poultrygrid-agent` systemd service.
3. With an ADS1115, calibrate the gas sensor in clean air (after a 24 h burn-in on first use).
   In DO mode, turn the MQ-135 module's screw until its DO LED just goes off in clean air instead:
   ```bash
   sudo -u poultrygrid /opt/poultrygrid/venv/bin/python /opt/poultrygrid/edge/agent.py calibrate --env /etc/poultrygrid/agent.env
   ```
   Put the printed `PG_MQ135_BASELINE_V` in `/etc/poultrygrid/agent.env`, then run
   `sudo systemctl restart poultrygrid-agent`.
4. Watch it: `journalctl -u poultrygrid-agent -f`

```
22:10:45 CRITICAL 91% | T=35.9°C RH=72% gas=3.6 light=30 | fan=on | Heat stress, Humidity too high
```

## Twi voice for Ama (optional)

The same Pi can give Ama, the app's AI assistant, a native Twi voice with GhanaNLP's
[stable-twi-tts](https://github.com/GhanaNLP/stable-twi-tts) (a Piper/VITS model on ONNX, no PyTorch).

```
app: Ama writes a Twi reply ──> tts_jobs (Neon) <── Pi polls /api/public/devices/tts (device key)
                                      ▲                        │ speaks it (stable-twi-tts)
browser plays it  <── app  <──────────┴──── uploads the WAV ───┘
```

The Pi asks the app for work, so nothing needs to be opened on the farm router. It checks every
20 s, and every second while someone has the AI tab open in Twi. If the Pi is off, Ama falls back
to Khaya (with a key) or OpenAI's voice.

```bash
sudo ghana-poultry-vision/edge/deploy/install_tts.sh   # after install_pi.sh
journalctl -u poultrygrid-tts -f
```

- **Needs 64-bit Raspberry Pi OS** (onnxruntime has no 32-bit ARM build). Pi 4 or 5 recommended;
  the model is 80 MB on disk and peaked at about 175 MB of RAM in testing. `twi_tts.py bench` prints the speed.
- Numbers and quoted English ("heat stress") are read in English, the way Ghanaians code-switch;
  the Twi voice alone skips digits. That uses espeak-ng 1.51 (GPL-3.0), bundled by the `[eng]` extra.
- **The voice model is CC BY-NC 4.0: non-commercial use only.** The code is MIT.
- Settings in `/etc/poultrygrid/agent.env`: `PG_TTS_VOICE` (default `twi-6`, the male voice), `PG_TTS_THREADS`.

On the same network, or behind a tunnel, the app can call the Pi directly instead:
`python twi_tts.py serve --host 0.0.0.0 --port 5002` with `PG_TTS_TOKEN` set on the Pi, and
`TWI_TTS_URL=http://<pi>:5002` plus the same `TWI_TTS_TOKEN` in the app's environment.

## Try it without hardware

```bash
cd edge
pip install numpy
python agent.py --simulate --dry-run            # prints readings + predictions
python agent.py --simulate --env my-agent.env   # posts a simulated coop to your app
```

The simulated coop is closed-loop: the fan level the agent picks changes the
temperature, humidity and gas, and heatwaves, fan failures, wet litter and
heater failures happen at random, so every status shows up in the app.

## Retrain

```bash
cd edge
pip install -r requirements-train.txt
python train.py            # ~4 min on a laptop CPU; writes models/poultrygrid_v4.npz + metrics.json
```

The labelling rules, comfort bands and fan policy live in `poultrygrid/features.py`.
The coop physics is in `poultrygrid/simulator.py`. Change either and retrain.

## Files

| Path | What it is |
|-|-|
| `test_sensors.py` | Checks each sensor and the fan, with wiring hints |
| `agent.py` | The Pi service: sensors → features → model → smoothing → fan → app (with offline outbox) |
| `train.py` | Simulate, train, calibrate, evaluate against the original network, export |
| `poultrygrid/features.py` | Shared domain logic: growth phases, comfort bands, labels, features, fan policy |
| `poultrygrid/simulator.py` | Time-series coop simulator used for training |
| `poultrygrid/model_np.py` | Numpy inference for the exported model |
| `poultrygrid/sensors.py` | DHT22, ADS1115 or DO-pin gas/light, fan relay drivers, plus the simulated coop |
| `twi_tts.py` | Ama's Twi voice: takes replies from the app and speaks them (stable-twi-tts) |
| `models/` | Trained model and its metrics |
| `deploy/` | Installer and systemd unit |
