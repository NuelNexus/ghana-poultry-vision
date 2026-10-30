# PoultryGrid AI

Smart poultry farm management for Ghana: live house monitoring, two hardware units you run
from your phone, a marketplace for selling produce, hatchery and alerts, in 7 languages.

- **Web app**: TanStack Start (React) with a [Neon](https://neon.tech) Postgres database
- **Unit 1, incubator & brooder**: [`edge/`](edge/README.md), the Raspberry Pi agent and AI model (rebuilt from AI_For_Poultry)
- **Unit 2, coop**: [`firmware/coop_unit/`](firmware/coop_unit/README.md), the ESP32 controller for the layers and broilers zones
- **Video guides**: [`videos/`](videos/README.md), six guides in English and Twi made with HyperFrames

Full documentation (changelog, how things work, decisions, tests, file guide, Khaya key setup)
is in [`docs/`](docs/README.md).

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

### HTTPS for the microphone on other devices

Browsers only allow the microphone on HTTPS (or `localhost`). On the Pi,
`scripts/setup-autostart.sh` also starts `poultrygrid-https`: HTTPS on port 8443 in front of the
app, with a certificate from a private certificate authority made on the Pi
(`scripts/make-cert.sh`, files in `.certs/`, re-issued when the IP changes). Open
`https://<pi-ip>:8443` or `https://<hostname>.local:8443`. The first visit shows a security
warning; to remove it for good, open `https://<pi-ip>:8443/poultrygrid-ca.crt` on the device and
install it (Android: Settings > Security > Encryption & credentials > Install a certificate > CA
certificate; iPhone: install the profile, then Settings > General > About > Certificate Trust
Settings and turn it on). Port 8080 stays plain HTTP for the Pi agent.

Open the app and create an account. **The first account becomes the farm admin.**
Later sign-ups join as workers (read-only, can resolve alerts). To promote someone:

```sql
insert into user_roles (user_id, role)
select id, 'manager' from users where email = 'person@example.com';
```

## Languages and voice help

The whole site works in English, Twi, Ga, Ewe, Dagbani, Hausa and French. Farmers pick a
language when they sign up (each choice plays a spoken greeting, so they can pick by ear) and
can change it in Profile > Language and voice. It is saved on their account.

- **Translation:** every English string on screen is translated on the fly
  (`src/lib/dom-translator.ts`), once per language, and kept in the `ui_translations` table, so
  pages are instant after the first visit. Translations come from GhanaNLP Khaya for Twi, Ga, Ewe
  and Dagbani when `KHAYA_API_KEY` is set, and otherwise from `OPENAI_TRANSLATE_MODEL` (default
  `gpt-5.5`, the only OpenAI model whose Twi was correct in our tests). To keep something from
  being translated, add `translate="no"` to it.
- **Help buttons on every page** (`src/components/AccessDock.tsx`): **Speak** (say where to go or
  ask about the farm, in your language), **Explain** (Ama says what the page shows) and **Tap to
  hear** (tap any text to hear it; tap a button once to hear it and again to press it). Every text
  box gets a microphone, and new alerts can be read out loud.
- **Voices:** Twi uses the male `twi-6` voice from stable-twi-tts (`npm run twi` on this PC, or
  the Pi service). **Ghana Voice** ([`speech/`](speech/README.md)), our own voices for Twi, Ewe,
  Hausa, Dagbani, Ga and 14 more Ghanaian languages, comes next when `GHANA_VOICE_URL` is set; it
  can be retrained on a free Colab GPU. Then Khaya with a key, else OpenAI. Speech is sent one sentence
  at a time, so the first words play after about a second.
- **Ama's answers** in Twi and the other Ghanaian languages use `OPENAI_LOCAL_MODEL` (default
  `gpt-5.5`); English uses `OPENAI_CHAT_MODEL` (default `gpt-4o-mini`).

## Connect the Raspberry Pi

1. **Houses → Add house**, and set *Chicks placed on* (this gives the AI the flock age).
2. **Devices → Register device**, choose *Raspberry Pi (edge AI)* and the house, and copy the `agent.env` it shows.
3. On the Pi, run `sudo edge/deploy/install_pi.sh` (full guide: [edge/README.md](edge/README.md)).
   If the web app also runs on the Pi, `sudo scripts/setup-autostart.sh` instead starts the app
   (port 8080), the agent and Ama's Twi voice on every boot (`--no-tts` skips the voice).

The Pi posts a reading and its prediction every 30 s. The app shows:

- **Dashboard**: live coop condition (status, confidence, growth phase, fan on/off, causes and advice)
- **AI Health**: per-house status history, temperature against the age target, time in each state, status changes
- **Houses**: status badge and causes per house
- **Alerts**: warning and critical alerts are raised automatically and close when conditions recover
- **Devices**: online state, house assignment, and a fan override (AI auto / force on / force off)

Pages refresh every 10–15 s. Without a Pi, `python edge/agent.py --simulate` streams a simulated coop.

## Connect the coop (unit 2)

1. **Devices → Add device → Unit 2 · Coop controller (ESP32)**, pick the house, and copy the
   three `#define` lines it shows.
2. Put them in the SETTINGS block at the top of `firmware/coop_unit/coop_unit.ino` with your
   Wi-Fi name and password, and upload `coop_unit.ino` from the Arduino IDE
   ([firmware/coop_unit/README.md](firmware/coop_unit/README.md) has the libraries and wiring).
3. Run it from **Automation → Coop · unit 2**: each zone (layers, broilers) can be on Auto (the
   coop's own thermostat, with temperatures you set) or Manual (switch the fan and heat lamp
   yourself). Changes reach the coop within about 10 s and the page shows when it has applied
   them. Dirty drinking water and overheat cut-outs show up in Alerts.

Without the ESP32, `python firmware/coop_unit/emulator.py --url <site> --device <id> --key <key>`
runs the same control logic against the site.

## Marketplace

**Marketplace** (`/app/market`) is shared by every account: farmers list eggs, birds, chicks,
manure, feed or equipment with a price, quantity, region and up to 4 photos; buyers call,
WhatsApp or message the seller from the listing, and both sides see their messages under
Messages. Sellers can edit, pause, mark sold or delete. There's no seeded data.

## Welcome tour and guides

New accounts get a short tour of every tab right after signing up (in their language, like the
rest of the site). **Guides** (`/app/guides`) has six videos in English and Twi, on the site,
both units, the coop controls, alerts and the marketplace, and can replay the tour. The videos
are rebuilt with `node videos/build.mjs` ([videos/README.md](videos/README.md)).

After pulling this version, run `npm run db:migrate` once (migration 007 adds the coop controls,
marketplace and tour tables).

## How the Raspberry Pi edge AI works

The Pi runs the AI on the device, in the poultry house. It reads the sensors, decides
how the house is doing, sets the fan, and then reports to the app. The fan keeps
running correctly even if the internet goes down.

```
DHT22 / MQ-135 / LDR ──> Pi agent ──> model (numpy) ──> fan relay (on / off)
                                        │
                                        └──> POST /api/public/devices/ingest ──> Neon ──> app
```

### Hardware

| Part | Measures | Connection |
|-|-|-|
| DHT22 | Temperature, humidity | GPIO 4 |
| MQ-135 | Ammonia / gas, as a % rise over a clean-air baseline | ADS1115 channel 0, or its DO pin to GPIO 17 |
| LDR | Light | ADS1115 channel 1, or its DO pin to GPIO 27 |
| Relay | Switches the fan on or off (no speed control, no speed sensor) | IN to GPIO 18; the fan's supply through COM / NO |

Without an ADS1115 the agent reads the MQ-135 and LDR modules' DO pins, which are
only on/off, so the gas and light readings are coarse. See [edge/README.md](edge/README.md).

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
4. **Check every sensor, then build 26 features** (`poultrygrid/features.py`). Readings that
   are missing, out of range or frozen are dropped; a dead DHT22 is replaced with its last good
   reading and how old it is, and each sensor's health goes to the app. Then: the latest and 5-reading average of
   each sensor, whether the relay is on and how much of the last 5 and 10 readings it was on, the age-based target temperature (33 °C at day 0
   down to 20 °C at day 42), how far the house is above or below the comfort band (humid
   heat counts as hotter), trends in temperature, humidity and gas, temperature
   variability, gas per unit of airflow, and how far each sensor can be trusted.
5. **Run the model** (`poultrygrid/model_np.py`). This is a small neural network
   (26 → 128 → 128 → 64), trained on this farm's sensors including when they break, with two outputs:
   - **Status**: Healthy, Warning or Critical, with a calibrated confidence
   - **Causes**: which of 6 problems are present (heat stress, too cold for the flock's age,
     ammonia build-up, humidity too high, air too dry, poor ventilation),
     each with a piece of advice

   On the Pi it runs on numpy alone, with no PyTorch, from a 108 KB `.npz` file.
6. **Smooth the status** so it doesn't flicker. Probabilities are averaged over time.
   A worse status has to hold for 2 readings in a row before it is shown, and a better one
   for 4. If the model is more than 90 % sure the house is critical, that status is shown
   straight away.
7. **Switch the fan relay.** Heat, gas, humidity or ventilation problems switch it *on*.
   Cold or dry air keeps it *off*, so chicks aren't blasted. Healthy is *off*. The relay
   holds each state for at least 60 s so it doesn't chatter. A fan override (force on /
   off) set on the Devices or Automation page always takes priority and applies at once.
   Set `PG_FAN_AUTO=0` to monitor without touching the fan.
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
  where the agent switching the fan on or off changes the conditions, and faults happen at random.
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
`temperature`, `humidity`, `gas_index`, `light`, `fan_on` (relay state), `bird_age_days`,
`recorded_at`, and the optional edge-AI result under `ai`
(`status`, `confidence`, `probabilities`, `causes`, `fan_level`, `growth_phase`, `target_temp`, `model_version`).
The response returns `config.bird_age_days` (from the house's batch date) and `config.fan_override` (`"on"`, `"off"` or null).

The coop unit posts `unit: "coop"`, `zones` (per zone: `temp`, `humidity`, `fan`, `lamp`, `mode`,
`sensor_ok`, `safety_tripped`), `water` (`voltage`, `good`, `sensor_ok`) and the `config_version`
it runs; its response also carries `config.controls`, the versioned settings it should apply.
Details in [firmware/coop_unit/README.md](firmware/coop_unit/README.md).
