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
