# PoultryGrid edge AI (Raspberry Pi)

A rebuilt version of the coop-condition model from
[engieworks15-dotcom/AI_For_Poultry](https://github.com/engieworks15-dotcom/AI_For_Poultry).
It runs on a Raspberry Pi, drives the ventilation fan, and reports every
reading and prediction to the PoultryGrid app, where it shows up live on the
Dashboard, AI Health, Houses and Alerts pages.

```
DHT22 / MQ-135 / LDR / fan tach ──> Pi agent ──> model (numpy) ──> fan PWM
                                        │
                                        └──> POST /api/public/devices/ingest ──> Neon ──> app
```

## What the app shows for each reading

| Field | Meaning |
|-|-|
| **Status** | Healthy / Warning / Critical, smoothed so it doesn't flicker |
| **Confidence** | Calibrated probability for that status |
| **Causes** | Heat stress, too cold for flock age, ammonia/gas build-up, humidity too high, air too dry, poor ventilation, fan not spinning, each with advice |
| **Growth phase** | Brooding / Starter / Grower / Finisher, from the flock's age |
| **Target temp** | What the house should be for that age (33 °C on day 0 down to 20 °C) |
| **Fan level** | Low / Medium / High, picked by the agent (or forced from the Devices page) |

Status changes create alerts automatically, and the alerts close again once conditions recover.

## What changed from the original model

| | Original | v2 |
|-|-|-|
| Training data | 12k rows drawn independently; labels computed from the *same* values the model sees | 3,000 simulated coop episodes (230k samples) over time with weather, flock age, brooder heat, airflow, wet litter, heatwaves, heater and fan failures. Labels come from the true state; the model sees noisy sensor readings |
| Inputs | 5 instantaneous readings | 21 features: the 5 sensors + commanded fan duty, 5-minute means, trends (slopes), temperature variance, flock age and age-specific comfort band, rpm-vs-command gap, gas per unit airflow |
| Flock age | Ignored (fixed 26 °C target) | Age-aware: a 3-day-old chick at 26 °C is in danger; a 5-week bird at 26 °C is fine |
| Outputs | Status only | Status + which of 7 causes + calibrated confidence |
| Fan logic | Critical → high, always | Cold chicks get minimum ventilation instead of being blasted; a dead fan is detected from the tach |
| Evaluation | Random row split | Split by episode (no leakage), plus macro-F1 and critical recall |
| On the Pi | PyTorch + scikit-learn + pickle | Numpy only; the model is a 32 KB `.npz` file |
| Stability | Raw prediction each reading | EMA + hysteresis: escalate after 2 readings (1 if very sure it's critical), de-escalate after 4 |
| Network loss | n/a | Readings buffered in SQLite and sent in order when back online |

### Results (held-out test episodes, `models/metrics.json`)

Both models were trained on the same realistic data:

| | v2 | Original network |
|-|-|-|
| Accuracy | **93.8 %** | 80.1 % |
| Macro F1 | **93.8 %** | 80.1 % |
| Critical recall | **97.1 %** | 83.7 % |

v2 never confused Healthy with Critical, in either direction, on the test set. The original's
97 % only held on its own data, where the labels were thresholds on the inputs.
Per-cause F1 ranges from 0.88 (ammonia, the noisiest sensor) to 0.999 (fan fault).

> These numbers come from simulated data. Real-world accuracy depends on how
> closely the simulator matches your house. Once the Pi has logged a few weeks of
> readings, you can export them from Neon and fine-tune the model on them.

## Hardware (same wiring as the original)

| Part | Connection |
|-|-|
| DHT22 | GPIO 4 |
| MQ-135 and LDR | ADS1115 ADC on I²C (channels 0 and 1) |
| Fan PWM | GPIO 18, through a MOSFET / fan driver on a separate 12 V supply |
| Fan tach | GPIO 23, pulled up to 3.3 V |

Works on a Pi 3, 4, 5 or Zero 2 W with Raspberry Pi OS Bookworm.

## Test the sensors

After wiring, check each part on its own before running the agent:

```bash
cd edge
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r requirements-pi.txt
.venv/bin/python test_sensors.py          # i2c, dht, gas, light, fan, with PASS/WARN/FAIL and wiring hints
.venv/bin/python test_sensors.py fan      # just one
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
3. Calibrate the gas sensor in clean air (after a 24 h burn-in on first use):
   ```bash
   sudo -u poultrygrid /opt/poultrygrid/venv/bin/python /opt/poultrygrid/edge/agent.py calibrate --env /etc/poultrygrid/agent.env
   ```
   Put the printed `PG_MQ135_BASELINE_V` in `/etc/poultrygrid/agent.env`, then run
   `sudo systemctl restart poultrygrid-agent`.
4. Watch it: `journalctl -u poultrygrid-agent -f`

```
22:10:45 CRITICAL 91% | T=35.9°C RH=72% gas=3.6 rpm=2497 | fan=high | Heat stress, Humidity too high
```

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
python train.py            # ~1 min on a laptop CPU; writes models/poultrygrid_v2.npz + metrics.json
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
| `poultrygrid/sensors.py` | DHT22 / ADS1115 / PWM / tach drivers, plus the simulated coop |
| `models/` | Trained model and its metrics |
| `deploy/` | Installer and systemd unit |
