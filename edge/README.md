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

| | Original | v3 (relay fan) |
|-|-|-|
| Training data | 12k rows drawn independently; labels computed from the *same* values the model sees | 3,000 simulated coop episodes (230k samples) over time with weather, flock age, brooder heat, airflow, wet litter, heatwaves, heater and fan failures, and an on/off relay fan. Labels come from the true state; the model sees noisy sensor readings |
| Inputs | 5 instantaneous readings | 20 features: the 4 sensors + relay state, share of the last 5 and 10 readings the fan was on, 5-minute means, trends (slopes), temperature variance, flock age and age-specific comfort band, gas per unit airflow |
| Flock age | Ignored (fixed 26 °C target) | Age-aware: a 3-day-old chick at 26 °C is in danger; a 5-week bird at 26 °C is fine |
| Outputs | Status only | Status + which of 6 causes + calibrated confidence |
| Fan logic | Critical → high, always | Heat, gas and damp switch the fan on; cold chicks keep it off. The relay holds each state for at least 60 s |
| Evaluation | Random row split | Split by episode (no leakage), plus macro-F1 and critical recall |
| On the Pi | PyTorch + scikit-learn + pickle | Numpy only; the model is a 32 KB `.npz` file |
| Stability | Raw prediction each reading | EMA + hysteresis: escalate after 2 readings (1 if very sure it's critical), de-escalate after 4 |
| Network loss | n/a | Readings buffered in SQLite and sent in order when back online |

### Results (held-out test episodes, `models/metrics.json`)

Both models were trained on the same realistic data:

| | v3 | Original network |
|-|-|-|
| Accuracy | **91.8 %** | 77.7 % |
| Macro F1 | **91.0 %** | 75.9 % |
| Critical recall | **97.6 %** | 84.7 % |

The original's 97 % only held on its own data, where the labels were thresholds on the inputs.
Per-cause F1 ranges from 0.88 (air too dry) to 0.97 (heat stress). v3 scores a little
below the PWM model it replaced (93.8 %) because an on/off fan with no tach tells it less.

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
- Settings in `/etc/poultrygrid/agent.env`: `PG_TTS_VOICE` (default `twi-1`, a female voice), `PG_TTS_THREADS`.

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
python train.py            # ~1 min on a laptop CPU; writes models/poultrygrid_v3.npz + metrics.json
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
