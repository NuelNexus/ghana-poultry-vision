# PoultryGrid AI

Smart poultry farm management for Ghana: live house monitoring, a Raspberry Pi
edge-AI unit that classifies coop conditions and runs the ventilation fan,
hatchery, alerts, energy and biogas tracking.

- **Web app**: TanStack Start (React) with a [Neon](https://neon.tech) Postgres database
- **Edge AI**: [`edge/`](edge/README.md), the Raspberry Pi agent and model (rebuilt from AI_For_Poultry)

## Set up the database (Neon)

1. Create a project at [console.neon.tech](https://console.neon.tech) and copy the
   **connection string** (Dashboard → Connect; use the pooled one).
2. Create the tables:
   ```bash
   cp .env.example .env          # paste the connection string into DATABASE_URL
   npm install
   npm run db:migrate
   ```
   Migrations live in `db/migrations/` and each one runs once.
3. Set the same `DATABASE_URL` as an environment variable or secret wherever the app is
   deployed (Lovable / Cloudflare / Vercel project settings). It is only read on the server.

## Run the app

```bash
npm run dev
```

Open the app and create an account. **The first account becomes the farm admin.**
Later sign-ups join as workers (read-only, can resolve alerts). To promote someone:

```sql
insert into user_roles (user_id, role)
select id, 'manager' from users where email = 'person@example.com';
```

## Connect the Raspberry Pi

1. **Houses → Add house**, and set *Chicks placed on* (this gives the AI the flock age).
2. **Devices → Register device**, choose *Raspberry Pi (edge AI)* and the house, and copy the `agent.env` it shows.
3. On the Pi, run `sudo edge/deploy/install_pi.sh` (full guide: [edge/README.md](edge/README.md)).

The Pi posts a reading and its prediction every 30 s. The app shows:

- **Dashboard**: live coop condition (status, confidence, growth phase, fan level, causes and advice)
- **AI Health**: per-house status history, temperature against the age target, time in each state, status changes
- **Houses**: status badge and causes per house
- **Alerts**: warning and critical alerts are raised automatically and close when conditions recover
- **Devices**: online state, house assignment, and a fan override (AI auto / force low / medium / high)

Pages refresh every 10–15 s. Without a Pi, `python edge/agent.py --simulate` streams a simulated coop.

## How the Raspberry Pi edge AI works

The Pi runs the AI on the device, in the poultry house. It reads the sensors, decides
how the house is doing, sets the fan, and then reports to the app. The fan keeps
running correctly even if the internet goes down.

```
DHT22 / MQ-135 / LDR / fan tach ──> Pi agent ──> model (numpy) ──> fan PWM
                                        │
                                        └──> POST /api/public/devices/ingest ──> Neon ──> app
```

### Hardware

| Part | Measures | Connection |
|-|-|-|
| DHT22 | Temperature, humidity | GPIO 4 |
| MQ-135 | Ammonia / gas, as a % rise over a clean-air baseline | ADS1115 ADC on I²C, channel 0 |
| LDR | Light | ADS1115 channel 1 |
| Fan PWM | Fan speed control | GPIO 18, through a MOSFET on its own 12 V supply |
| Fan tach | Actual fan RPM | GPIO 23, pulled up to 3.3 V |

Any Pi 3, 4, 5 or Zero 2 W running Raspberry Pi OS Bookworm will do.

### One loop, every 30 seconds (`edge/agent.py`)

1. **Read the sensors.** The DHT22 is retried up to 4 times because it often fails a read.
   Any reading that still fails is filled in with the last good value.
2. **Keep a 5-minute window.** The agent keeps the last 10 readings, so the model can see
   trends as well as the current values.
3. **Work out the flock age.** It comes from the house's *Chicks placed on* date in the
   app, which is sent back with every response. If the Pi is offline, it falls back to
   `PG_BATCH_START_DATE` or `PG_BIRD_AGE_DAYS`. Age matters: 26 °C is dangerous for
   3-day-old chicks but fine for 5-week-old birds.
4. **Build 21 features** (`poultrygrid/features.py`): the latest and 5-reading average of
   each sensor, the commanded fan duty, the age-based target temperature (33 °C at day 0
   down to 20 °C at day 42), how far the house is above or below the comfort band (humid
   heat counts as hotter), trends in temperature, humidity and gas, temperature
   variability, the gap between actual and expected fan RPM, and gas per unit of airflow.
5. **Run the model** (`poultrygrid/model_np.py`). This is a small neural network
   (21 → 64 → 64 → 32) with two outputs:
   - **Status**: Healthy, Warning or Critical, with a calibrated confidence
   - **Causes**: which of 7 problems are present (heat stress, too cold for the flock's age,
     ammonia build-up, humidity too high, air too dry, poor ventilation, fan not spinning),
     each with a piece of advice

   On the Pi it runs on numpy alone, with no PyTorch, from a 32 KB `.npz` file.
6. **Smooth the status** so it doesn't flicker. Probabilities are averaged over time.
   A worse status has to hold for 2 readings in a row before it is shown, and a better one
   for 4. If the model is more than 90 % sure the house is critical, that status is shown
   straight away.
7. **Set the fan.** Heat, gas, humidity or ventilation problems give *high* when critical
   and *medium* when warning. Cold or dry air gives *low*, so chicks get minimum
   ventilation instead of a blast of air. Healthy gives *low*. A fan override set on
   the Devices page always takes priority. Set `PG_FAN_AUTO=0` to monitor without
   touching the fan.
8. **Report to the app.** The reading and the AI result are written to a local SQLite
   outbox first, then sent in batches of up to 50. If the network is down, they wait
   there (up to about a week's worth) and are sent in order once it comes back, so the
   history has no gaps.

### What the app does with it (`src/routes/api/public/devices/ingest.ts`)

- It checks the device's `x-device-id` and `x-api-key` headers, using a timing-safe comparison.
- It stores each reading with its AI fields in `sensor_readings`.
- When the status changes, it creates an alert. When the status returns to healthy, it
  closes that device's open AI alerts.
- It marks the device online and replies with `bird_age_days` and `fan_override`, which
  the Pi uses on its next loop.

### How the model was trained (`edge/train.py`)

The original AI_For_Poultry model was trained on random rows whose labels were just
thresholds on the same values the model saw. That made 97 % accuracy easy on its own
data, but it didn't hold up on realistic data. v2 is trained on a coop simulator
(`poultrygrid/simulator.py`) instead. The simulator runs 3,000 coop episodes
(about 230k samples) over time and includes:

- day/night weather and flock age
- brooder heat, bird heat and fan airflow
- litter wetness
- heatwaves, rain and harmattan dry spells
- heater and fan failures

Labels come from the *true* simulated state, while the model only sees noisy sensor
readings, as it would on real hardware.

The data is split by episode so test episodes are never seen in training. The network
is trained with extra weight on Critical, its confidence is calibrated with temperature
scaling, and it is exported to numpy. Training then checks the numpy export gives the
same predictions as the PyTorch model.

| Held-out test episodes | v2 | Original network, same data |
|-|-|-|
| Accuracy | **93.8 %** | 80.1 % |
| Critical recall | **97.1 %** | 83.7 % |

On the test set, v2 never mistook Healthy for Critical, or Critical for Healthy.
These numbers come from simulated data. Once the Pi has logged real readings, export
them from Neon and fine-tune the model on them.

### Running it

- **Install:** `sudo edge/deploy/install_pi.sh`. This installs the dependencies, creates a
  `poultrygrid` system user, asks for the app URL, device ID and key, writes
  `/etc/poultrygrid/agent.env`, and starts the `poultrygrid-agent` systemd service, which
  restarts automatically if it stops.
- **Calibrate the gas sensor** in clean air: `agent.py calibrate`. Leave the sensor
  warming up for 24 h first.
- **Logs:** `journalctl -u poultrygrid-agent -f`
- **No hardware:** `python edge/agent.py --simulate --dry-run`. This runs a simulated coop
  where the fan level the agent picks changes the conditions, and faults happen at random.
- **Retrain:** `pip install -r edge/requirements-train.txt && python edge/train.py`
  (about a minute on a laptop CPU)

Full hardware and setup details: [edge/README.md](edge/README.md).

## What moved from Supabase to Neon

| Before (Supabase) | Now (Neon) |
|-|-|
| `supabase.from(...)` queries in the browser | Server functions in `src/lib/api/farm.functions.ts`. The browser never touches the database |
| Supabase Auth | Email/password with PBKDF2 hashes and httpOnly session cookies (`src/lib/auth.server.ts`), plus CSRF protection on server functions |
| Row-level security policies | Role checks in `src/lib/api/middleware.ts` (any user reads; admin/manager write) |
| Realtime channels | Polling with React Query |
| `supabase/migrations` | `db/migrations` + `npm run db:migrate` |

Local development without Neon: point `DATABASE_URL` at any Postgres and set `DATABASE_DRIVER=pg`.

## Device API

`POST /api/public/devices/ingest` with headers `x-device-id` and `x-api-key`.
The body is a single reading or `{"readings": [...]}` (up to 200). Fields include
`temperature`, `humidity`, `gas_index`, `light`, `fan_rpm`, `fan_duty`, `bird_age_days`,
`recorded_at`, and the optional edge-AI result under `ai`
(`status`, `confidence`, `probabilities`, `causes`, `fan_level`, `growth_phase`, `target_temp`, `model_version`).
The response returns `config.bird_age_days` (from the house's batch date) and `config.fan_override`.
ESP32 nodes can post plain sensor readings to the same endpoint.
