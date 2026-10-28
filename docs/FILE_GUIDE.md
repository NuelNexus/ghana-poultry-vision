# Project file guide

What each important folder and file does, and which other files it works with. Line counts are
approximate (October 2026). Files under `src/components/ui/` are stock shadcn/ui components and
aren't listed individually.

## Top level

| Path | What it is |
|---|---|
| `README.md` | Setup: database, running the app, connecting the Pi, how the edge AI works, languages. |
| `docs/` | This documentation (changelog, implementation, testing, file guide, Khaya setup, decisions). |
| `package.json` | Scripts: `dev`, `build`, `db:migrate`, `twi` (local Twi voice + word helper), `lint`, `format`. |
| `.env` (not in git) | Secrets and settings: `DATABASE_URL`, `OPENAI_API_KEY`, optional `KHAYA_API_KEY`, `TWI_TTS_URL`, `TWI_NLP_URL`, model overrides. |
| `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `components.json` | Build, TypeScript, lint and shadcn config (Lovable / TanStack Start template). |
| `.venv-twi/` (not in git) | Local Python environment for the Twi voice and DistilABENA word helper (`npm run twi`). |
| `promo/`, `*.glb`, `*.mp4`, `*.gif` at root | Source media (3D models, the life-cycle video, promo ad). Copies the site uses live in `public/`. |

## `db/` — database (Neon Postgres)

| File | Adds |
|---|---|
| `migrations/001_init.sql` | Users, sessions, roles, farms, houses, devices, sensor readings, alerts, hatchery, cameras. |
| `migrations/002_ai_chat_history.sql` | `ai_conversations`, `ai_messages` (Ama's chat history per user, with language and English translation). |
| `migrations/003_twi_tts.sql` | `tts_jobs` and device columns for the Pi Twi voice relay. |
| `migrations/004_site_language.sql` | `users.language`, `ui_translations` (cached site translations), default Twi voice `twi-1`. |
| `migrations/007_flock_type.sql` | `poultry_houses.flock_type` (broiler / layer) for the vaccination schedule. |

Applied with `npm run db:migrate` (`scripts/db-migrate.mjs`, over Neon's HTTP driver).

## `edge/` — Raspberry Pi side

| File | Responsibility |
|---|---|
| `agent.py` | Main Pi loop every ~30 s: reads sensors, runs the numpy model, drives the fan, posts to `/api/public/devices/ingest`, keeps an SQLite outbox when offline. |
| `poultrygrid/sensors.py` | DHT22, MQ-135 and LDR (ADS1115 or DO pins), fan relay. |
| `poultrygrid/legacy_v3.py` | How the v3 model was fed, kept only so `train.py` can benchmark v4 against it. |
| `poultrygrid/features.py`, `model_np.py` | Sensor health checks, 26 features (incl. 5-min trends, age-aware comfort band, per-sensor trust) and numpy-only inference. |
| `poultrygrid/simulator.py`, `train.py` | Coop simulator (the farm's sensors and their faults) and training script with the v3/v4 benchmark (`models/poultrygrid_v4.npz`). |
| `test_sensors.py` | Hardware check script for the sensors. |
| `twi_tts.py` | Twi voice (GhanaNLP stable-twi-tts, female `twi-1`). Modes: `worker` (polls the app for jobs), `serve` (HTTP `/synthesize`), `say`, `bench`. Number/English handling, lenient phoneme table, sentence cache. |
| `twi_nlp.py` | DistilABENA v2 word helper: `POST /suggest` for next-word / fill-the-blank Twi suggestions. |
| `deploy/*.service`, `install_pi.sh`, `install_tts.sh` | systemd units and installers for the agent and the Twi voice. |
| `README.md` | Pi wiring, setup and the Twi voice section. |

## `scripts/`

| File | Responsibility |
|---|---|
| `db-migrate.mjs` | Applies `db/migrations/*.sql` in order, once each. |
| `twi-lab.mjs` | `npm run twi`: starts `twi_tts.py serve` on :5002 and `twi_nlp.py serve` on :5003 from `.venv-twi`. |

## `src/routes/` — pages and HTTP endpoints

| File | Page / endpoint |
|---|---|
| `__root.tsx` | HTML shell; wraps every page in `AuthProvider` → `LanguageProvider` and mounts `AccessDock` and toasts. |
| `index.tsx` | Landing page (scroll-scrubbed hatch frame sequence from `public/hatch/`). |
| `login.tsx` | Sign in / sign up. Sign-up starts with the language picker; sign-in shows language chips; `HatchLoop` animation at the bottom; background `public/auth-bg.svg`. |
| `app.tsx` | Console shell (sidebar, top bar, theme) for everything under `/app`. |
| `app.index.tsx` | Overview dashboard. |
| `app.houses.tsx`, `app.health.tsx`, `app.cameras.tsx`, `app.alerts.tsx`, `app.automation.tsx`, `app.hatchery.tsx`, `app.devices.tsx`, `app.reports.tsx` | The console pages. |
| `app.ai.tsx` | Ama: text chat (history, dictation, Listen, Twi word chips) and live voice call (OpenAI Realtime with Twi routing). |
| `app.profile.tsx` | Account, **Language and voice**, security, appearance, accessibility, preferences, farm info. |
| `api/public/devices/ingest.ts` | Pi readings in; alerts raised/resolved; flock age and fan override back. |
| `api/public/devices/tts.ts` | Pi Twi-voice worker: long-poll for jobs, upload audio. |

## `src/lib/` — shared logic

**Language and voice (newest work)**

| File | Responsibility |
|---|---|
| `site-lang.ts` | The 7 site languages (`SITE_LANGS`), `helloIn`, `speechLangFor` (which voice reads a text). Shared by browser and server. |
| `ai-languages.ts` | Speech-language codes, Khaya codes, transcription hints, `isPromptEcho`, `detectLang` (Twi / Ga / Ewe / other). |
| `dom-translator.ts` | Browser: translates the page in place (text, placeholders, labels), with number placeholders, local cache, `translate="no"` opt-out. |
| `translate.server.ts` | Server: translates batches (Khaya or GPT-5.5), caches in `ui_translations`, de-duplicates concurrent requests. |
| `voice.server.ts` | `speakIn(text, lang)`: Twi voice → Khaya → OpenAI, with a sentence cache. |
| `speech-client.ts` | Browser: `SpeechPlayer` plays text sentence by sentence with prefetch and slow-voice fallback. |
| `twi-tts.server.ts` | Reaches the Twi voice: direct `TWI_TTS_URL`, or the database relay to the Pi. Default voice `twi-1`. |
| `twi-nlp.server.ts` | Calls the DistilABENA word helper (`TWI_NLP_URL`). |
| `khaya.server.ts` | GhanaNLP Khaya client: transcribe, translate, speak. |
| `openai.server.ts` | OpenAI client: chat (GPT-4o-mini / GPT-5 family), transcription, speech, realtime session secrets. Model env vars documented at the top. |
| `ai-audio.ts` | Browser mic recording (`Recorder`, with auto-stop on silence), WAV conversion. |

**Flock care**

| File | Responsibility |
|---|---|
| `vaccine-schedule.ts` | Farmsquare broiler and layer schedules, `flockDay` (Day 1 = arrival), `flockCare` (today's step, vaccine due, next vaccine, one-line summary), `VACCINE_TIPS` for Ama. |
| `flock-care-query.ts` | The `flock-care` React Query used by the card and Ama's starter questions. |

**Data, auth, theme**

| File | Responsibility |
|---|---|
| `api/assistant.functions.ts` | Ama's server functions: chat, transcription, speech, Twi turns, voice sessions, chat history. Holds her system prompt (`systemPrompt`) and the hardware description. |
| `api/i18n.functions.ts` | `translateUi`, `speakText`, `helloAudio`, `dictate`, `explainPage`, `voiceCommand`, with hourly limits for signed-out visitors. |
| `api/auth.functions.ts` | Sign in/up (with language), profile, password, sessions, `setMyLanguage`. |
| `api/farm.functions.ts` | Farms, houses, devices, readings, alerts, hatchery, cameras. |
| `api/middleware.ts` | `requireUser`, `requireManager`. |
| `auth.server.ts`, `auth.tsx` | Password hashing, session cookies, `getSessionUser` (includes `language`); React auth context. |
| `db.server.ts` | Neon `query` / `queryOne`. |
| `theme.ts` | Console themes, text size, motion, accessibility settings (per user, in the browser). |

## `src/components/`

| File | Responsibility |
|---|---|
| `LanguageProvider.tsx` | Site language state (account → device → English), runs the page translator, voice-help preferences. `useLanguage()`. |
| `AccessDock.tsx` | Speak / Explain / Tap-to-hear buttons, mic on text boxes, spoken alerts. Compact on phones. Hidden on `/app/ai`. |
| `LanguagePicker.tsx` | Language tiles/chips; tapping switches the site and plays a greeting in that language. |
| `HatchLoop.tsx` | Sign-in/sign-up animation: egg rolls → cracks → chick → hen, left to right, bunny style. |
| `Sidebar.tsx` | Navigation, phone top bar and drawer, live indicator, alerts button. |
| `ThemeProvider.tsx` | Applies the console theme under `/app`. |
| `ExplorerAvatar.tsx`, `FarmScene.tsx` | Ama's 3D avatar and the 3D farm scene. |
| `ai-status.tsx` | AI health status badges and helpers. |
| `FlockCareCard.tsx` | "Flock care today": each house's vaccine schedule step, next vaccine, **Hear it**, and broilers/layers buttons for houses without a type. |
| `ui-kit.tsx` | Shared console UI (cards, buttons, fields, formatters). |

## `public/`

| Path | What it is |
|---|---|
| `auth-bg.svg` | Sign-in/sign-up background, drawn locally (replaced a remote image that now returns 403). |
| `hatch/` | Landing page frame sequence (egg to chicken). |
| `ai/` | Ama's 3D model, animations, coop and grass models, still/animated blob. |
