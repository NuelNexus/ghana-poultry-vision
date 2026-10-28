# Changelog

Newest first. Each entry gives the problem, the change, the files involved and how it was
checked. Commit hashes come from `git log`. Entries marked *(from git history)* are summarised
from commit messages and file lists; they weren't re-tested for this document.

---

## Unreleased — coop unit, marketplace, first-login tour, video guides

### Unit 2, the coop, run from the site
- **Request:** rework the ESP32 coop sketch (two zones with a DHT sensor, fan relay and lamp relay
  each, a water turbidity sensor and an LCD) so the coop can be controlled from the site.
- **Change:** `firmware/coop_unit/coop_unit.ino` joins Wi-Fi and reports every 10 s to
  `/api/public/devices/ingest`. The response carries the coop's settings: per zone Auto/Manual,
  fan and lamp on/off, the four thermostat temperatures, and the water thresholds. Each change on
  the site is a new version; the coop saves it in flash, applies it at once and reports the
  version back, so the page shows when it has landed. Pins, relay logic and the thermostat with
  its hysteresis are as before. New safety: the lamp is cut off if a zone runs 6 °C over its
  fan temperature (or over 40 °C) or its sensor fails, even in Manual; bad settings are refused;
  with no Wi-Fi the coop keeps its last settings. The LCD gains a connection screen.
  `emulator.py` runs the same logic in Python against the site.
- **Site:** migration `007` adds `devices.unit` (brooder / coop), coop reading columns,
  `device_controls` and `control_log`. Ingest stores zones and water, averages the zones into the
  reading's temperature and humidity, returns the settings, and raises alerts for dirty water,
  overheat cut-outs and rejected settings. Automation gets a coop section (zones, Auto/Manual,
  fan and lamp switches, setpoints in the user's °C/°F, water thresholds, sync status, change log)
  above the Pi's fan control. Devices can register the coop and show its `config.h` lines.
- **Files:** `firmware/coop_unit/*`, `db/migrations/007_coop_marketplace_onboarding.sql`,
  `src/lib/controls.ts`, `src/lib/api/controls.functions.ts`, `src/components/coop-controls.tsx`,
  `src/routes/api/public/devices/ingest.ts`, `src/routes/app.automation.tsx`,
  `src/routes/app.devices.tsx`, `src/lib/api/farm.functions.ts`.
- **Checked:** local Postgres with the coop emulator and the Pi simulator: settings v1 → v4 sent
  from the page and applied by the coop within one check-in, the change log, an invalid setpoint
  refused, a second account can't see the coop. **The sketch has not been compiled or run on an
  ESP32** (no Arduino toolchain was available); compile it once before installing.

### Ama knows the coop unit
- **Change:** her hardware notes describe unit 2 (two zones, fan and heat lamp relays, Auto /
  Manual, the safety cut-out, the drinker's turbidity sensor) and the marketplace, and her farm
  summary includes each coop's zones and whether the drinking water is clean. "Drinker" and
  "lighting control" were removed from the list of sensors the farm doesn't have.
- **Files:** `src/lib/api/assistant.functions.ts`.
- **Checked:** `tsc`. Not tried against the live model (no OpenAI key here).

### Marketplace
- **Request:** let users sell their poultry produce, with real user data only.
- **Change:** a marketplace shared by every account (`/app/market`): listings with up to 4
  photos (shrunk to 1280 px in the browser, stored in Neon), search, category and region filters,
  call / WhatsApp / message the seller, a Messages tab for both sides, mark sold or pause, edit,
  delete. Nothing is seeded: an empty marketplace says "No listings yet". Seller-written text
  carries `translate="no"`. Ama's voice navigation knows the page.
- **Files:** `src/lib/api/market.functions.ts`, `src/lib/market.ts`,
  `src/routes/app.market.index.tsx`, `src/routes/app.market.$listingId.tsx`,
  `src/components/market/listing-form.tsx`, `src/routes/api/public/market/images/$imageId.ts`,
  `src/components/Sidebar.tsx`, `src/lib/api/i18n.functions.ts`.
- **Checked:** two accounts in the browser: list with a photo (2400 → 1280 px, 270 → 52 KB), the
  buyer finds it, the WhatsApp link uses +233, the message reaches the seller with a "new" count,
  sold listings leave Browse, photos refuse signed-out requests (401).

### First-login tour and Guides
- **Change:** a new account sees a tour once after signing up: each sidebar link and the voice
  help dock highlighted with a line about it (12 steps, centred cards on phones, Esc / arrow
  keys). It's English in the code and translated by the site translator like any page.
  `users.onboarded_at` records that it was seen; existing accounts are marked as seen.
  `/app/guides` lists the video guides and replays the tour.
- **Files:** `src/components/onboarding-tour.tsx`, `src/lib/guides.ts`, `src/routes/app.guides.tsx`,
  `src/routes/app.tsx`, `src/lib/auth.server.ts`, `src/lib/api/auth.functions.ts`.
- **Checked:** sign-up → tour → 12 steps with highlights → not shown again after reload; Skip on a
  second account.

### Video guides in English and Twi
- **Change:** six guides (welcome, the incubator & brooder unit, the coop unit, running the coop,
  flock health and alerts, the marketplace), each in English and Twi, made with HyperFrames from
  real screenshots of the app and drawn diagrams of the two units, with the coop's LCD screens
  copied from the firmware. Captions are baked in. `node videos/build.mjs` rebuilds them.
- **Files:** `videos/*`, `public/guides/*`.
- **Checked:** `hyperframes check` passes on each project; frames reviewed, including Twi letters
  (ɛ, ɔ). Silent (no music source available). Twi captions need a native speaker's review.

---

## Unreleased — relay fan, readout redesign, sign-up tiles

### Model v4: trained on this farm's sensors, including when they break
- **Problem:** v3 was trained on clean readings that were always there. On the Pi a pulled
  DHT22 wire became 0 °C (forward-filled), garbage reads went straight in, and unwired gas/light
  sensors were replaced with made-up clean air, so a sensor fault looked like a critical house.
- **Change:** the simulator now uses the farm's parts read the way the agent reads them (MQ-135
  and LDR via ADS1115, DO pins or not wired; relay or PWM fan) and breaks them: flaky, unplugged,
  frozen and garbage DHT22 reads, unplugged or floating gas input, unplugged LDR. Every reading is
  checked (`sensor_health`, `clean_window`); faulty values are dropped, a dead DHT22 falls back to
  its last good reading and its age (`SensorMemory`), and the model gets trust inputs per sensor
  (26 features, 26 → 128 → 128 → 64). The agent sends each sensor's health; the readout shows a
  "Sensor problem" strip and per-gauge notes. Fake clean-air stand-ins removed.
- **Result** (300 unseen episodes per situation, v3 → v4): healthy sensors 91.3 → 91.1 %;
  DHT22 unplugged 49.8 → 77.2 % (false critical 71.9 → 13.6 %); DHT22 garbage 49.2 → 83.7 %
  (74.1 → 6.2 %); MQ-135 floating 51.1 → 71.3 % (69.2 → 14.9 %). Full table in edge/README.md.
- **Files:** `edge/poultrygrid/{features,simulator,legacy_v3,sensors}.py`, `edge/agent.py`,
  `edge/train.py`, `edge/models/poultrygrid_v4.npz`, `src/components/{coop-readout,ai-status}.tsx`,
  `src/lib/api/types.ts`.
- **Checked:** benchmark above; agent run with a DHT22 that dies mid-run (reports the fault, keeps
  the fan on); `tsc`. Not run on the real Pi; numbers are from simulated data.

### The Pi drives the fan through a relay
- **Problem:** the agent, model and app assumed a PWM fan with a tachometer (low / medium /
  high, rpm). The real build is a DHT22, MQ-135, LDR and a relay-switched fan.
- **Change:** the relay is on or off (GPIO 18, active-low by default, 60 s minimum between
  switches). MQ-135 and LDR use an ADS1115 if one answers, otherwise their DO pins. Model
  v3 (`poultrygrid_v3.npz`) was retrained on a relay-fan simulator: 20 features, 6 causes
  (no fan fault, since nothing measures the blades). Held-out: 91.8 % accuracy, 97.6 %
  critical recall. The app stores `fan_on`, overrides are force on / off, and every page
  shows On / Off instead of rpm. Migration `005_fan_relay.sql` adds `fan_on`, converts old
  readings, overrides and alert text.
- **Files:** `edge/poultrygrid/*`, `edge/agent.py`, `edge/test_sensors.py`, `edge/train.py`,
  `db/migrations/005_fan_relay.sql`, `src/routes/api/public/devices/ingest.ts`,
  `src/lib/api/types.ts`, the overview, flock health, automation, devices, reports and AI pages.
- **Checked:** agent run against the simulated coop (`--simulate`-style loop, 60 readings),
  `tsc`, eslint, pages in the browser. Not run on a real Pi.

### Coop readout and alert rows redesigned
- **Change:** `AiStatusPanel` (Flock health, Overview) is now a readout: a status tile with a
  shape mark, the top cause as the title and its advice, the temperature on a comfort-band
  scale for the flock's age, and gauges for humidity, gas, light and the fan relay. An
  offline Pi gets a hatched "No live data" strip. Alert rows drop the coloured left stripe
  and pill for a time column, a shape mark and the severity as a word.
- **Files:** `src/components/coop-readout.tsx` (new), `src/components/ai-status.tsx`,
  `src/routes/app.index.tsx`, `src/routes/app.alerts.tsx`, `src/styles.css`.

### Sign-up language tiles and voice dock match the card
- **Change:** on the auth pages the language tiles and the voice help dock use the card's
  black outline, offset shadows and Fjalla One. The Continue button no longer touches the tiles.
- **Files:** `src/styles.css`, `src/routes/login.tsx`.

## Earlier — AI behaviour, sign-in page, languages fit, docs

### Ama no longer brings up temperature unprompted
- **Problem:** in every language, Ama worked the farm's readings (temperature, "your data is old")
  into replies to greetings and general questions.
- **Cause:** the system prompt said "Base answers on the live farm data below", and the
  hardware notes told her to report stale data.
- **Change:** a "WHEN TO MENTION READINGS" rule in `systemPrompt`: readings only when asked, when
  the question is about how the farm is doing, or for an open critical alert. The stale-data
  note now applies only when she's already discussing a reading.
- **Files:** `src/lib/api/assistant.functions.ts`. The rule also covers the voice call, which
  uses the same prompt.
- **Tested:** 8 unrelated messages plus 1 heat question, each in a fresh chat
  (`docs/TESTING.md` T1). Unprompted mentions went from 2/8 to 0/8; the heat question still gets
  the 28.2 °C reading.

### Ga and Ewe recognised; answered in the right language
- **Problem:** "Ojekoo, te oyɔɔ tɛŋŋ?" (Ga) was treated as Twi; after that was fixed, the small
  model still answered it in Twi.
- **Change:** `detectLang` now returns `ga` / `ee` (new Ga words: ojekoo, oyɔɔ, tɛŋŋ, tɛɛ, minyɛ).
  Those languages use the bigger model with an instruction to reply in that language. The
  saved chat language and the reading-aloud voice follow the detected language.
- **Files:** `src/lib/ai-languages.ts`, `src/lib/api/assistant.functions.ts`, `src/lib/site-lang.ts`.
- **Tested:** detection cases 19/19 (T2).

### Sign-in / sign-up animation: egg → chick → hen (replaces the bunny)
- **Request:** a rolling egg that becomes a chick, then a chicken, looping; then: in the same
  style as the bunny, moving left to right.
- **Change:** new `HatchLoop` component (SVG + CSS). It uses the bunny's look (flat white
  shapes, dot eye, brown ground shadow, hop, dust puffs) and path (off-screen left to
  off-screen right). A 12 s loop: egg rolls → wobbles and cracks (the top of the shell flies
  off) → chick hops on → grows into a hen → hops off. It always travels, like the bunny did,
  even with "reduce motion" on (see D14). The bunny's 155 lines of CSS were removed.
- **Files:** `src/components/HatchLoop.tsx` (new), `src/routes/login.tsx`, `src/styles.css`.
- **Tested:** frames captured at 1.5, 3.9, 4.6, 5.6, 7, 8 s (T3).

### Sign-in background loads again
- **Problem:** the background image didn't load.
- **Cause:** it was hot-linked from `s3-us-west-2.amazonaws.com/s.cdpn.io/…`, which now
  returns 403 Forbidden.
- **Change:** redrew the same design (pale yellow with outlined shapes, checked against an
  archived copy) as `public/auth-bg.svg`, served by the site itself. The CSS also sets the
  yellow colour so it shows instantly.
- **Files:** `public/auth-bg.svg` (new), `src/styles.css` (`.auth-bg`).
- **Tested:** the page loads `/auth-bg.svg` with no failed requests (T4).

### Translated text fits the layout
- **Problem:** Twi, Ga and other translations are often longer than the English they replace.
- **Change:** a scan of 11 pages × 2 screen sizes per language found the places that broke, all on
  phones: text cut off with "…", one figure pushed out of its box, and (in Ewe) a long option
  hidden off-screen in a sideways-scrolling segmented control. When the site language isn't
  English, these now wrap instead: `.truncate`, `.whitespace-nowrap` and `.pg-seg` inside the
  console, and long words may break or hyphenate. English keeps its compact layout.
- **Files:** `src/styles.css` (end of file).
- **Tested:** problems went 4 → 1 → 0 across Twi, Ga, Ewe, Dagbani, Hausa and French (T5). The
  sign-in and sign-up pages fit on a phone in Twi, Ga, Dagbani and French.

### Documentation
- New `docs/` folder: this changelog, `IMPLEMENTATION.md`, `TESTING.md`, `FILE_GUIDE.md`,
  `DECISIONS.md`, `KHAYA_SETUP.md`.

---

## e08f1b2 — Whole site in 7 languages, voice help on every page, female Twi voice (2026-10-23)

### Site language
- **Request:** translate all the site's text (OpenAI generally, the Twi AI for Twi), let people
  pick the language in settings and at sign-up, and help people who can't read English.
- **Change:**
  - Languages: English, Twi, Ga, Ewe, Dagbani, Hausa, French.
  - Sign-up starts with a language picker; tapping a language plays a greeting in it.
  - Language chips on the sign-in page.
  - Profile → Language and voice.
  - The choice is saved on the account (`users.language`).
  - Every page is translated in place and cached per language (`ui_translations`). Engine:
    GPT-5.5, or Khaya for Ghanaian languages when a key exists.
  - All six languages were pre-filled (≈510 strings each).
- **Files:** `src/lib/site-lang.ts`, `src/lib/dom-translator.ts`, `src/lib/translate.server.ts`,
  `src/components/LanguageProvider.tsx`, `src/components/LanguagePicker.tsx`,
  `src/lib/api/i18n.functions.ts`, `src/lib/api/auth.functions.ts`, `src/lib/auth.server.ts`,
  `src/routes/login.tsx`, `src/routes/app.profile.tsx`, `src/routes/__root.tsx`,
  `db/migrations/004_site_language.sql`.
- **Tested:** the sign-up page switched to Twi ("Paw wo kasa") and the greeting played (1.4 s
  once cached). The Overview page was fully in Twi 4 s after a first visit, including alert
  messages and dates. The landing page was in Twi on a phone.

### Voice help on every page
- **Change:** Speak, Explain, Tap to hear, a mic on every text box and optional spoken alerts.
  It also works signed out, with hourly limits.
- **Files:** `src/components/AccessDock.tsx`, `src/lib/ai-audio.ts` (auto-stop on silence),
  `src/lib/api/i18n.functions.ts`.
- **Tested:**
  - Speak with recorded Twi speech: stopped on silence at 8.4 s, answered in Twi, spoken.
  - Explain on Overview: Twi summary; voice started at 6.3 s.
  - Tap to hear: works for visitors after two fixes (CSS-capitalised text; headings made of
    several pieces).
  - Phone layout: the dock covered page buttons, so it now collapses to Speak plus "more".

### Twi voice: female, faster, more dependable
- **Change:**
  - Default voice changed from `twi-6` (male, ~120 Hz) to `twi-1` (female, ~189 Hz).
  - Speech is played sentence by sentence with prefetch.
  - 12 s per sentence; after one miss, the rest of the reply uses the next voice.
  - Sentence caches on the server and in the voice server.
  - The voice server refuses a busy port on Windows. An old copy had kept answering with the
    male voice.
- **Files:** `src/lib/voice.server.ts`, `src/lib/speech-client.ts`, `src/lib/twi-tts.server.ts`,
  `edge/twi_tts.py`, `edge/twi_nlp.py`, `src/routes/app.ai.tsx`, `edge/README.md`.
- **Tested:**
  - Listen → first sound in 2.0 s.
  - Twi voice call: reply shown and spoken about 7 s after the farmer stopped talking.
  - The voice server's health check reports `twi-1`.

### Ama's Ghanaian-language answers use GPT-5.5
- **Evidence:** GPT-4o-mini's Twi was garbled; GPT-5.5 gave correct advice in 3.6 s vs 2.5 s
  (`DECISIONS.md` D11).
- **Files:** `src/lib/openai.server.ts` (GPT-5 parameters, `localModel`, `translateModel`),
  `src/lib/api/assistant.functions.ts`.

## d0ff5fc — Auto-detect the language (2026-10-23)
- Removed the language picker from chat, voice and profile. Twi is detected from what is typed
  or said.
- Voice mode stays a live GPT call; Twi turns are answered by the Twi stack and spoken in the
  GhanaNLP voice.
- Removed the separate turn-by-turn voice mode.
- Fixed a garbled Twi transcript being sent to GPT: any ɛ/ɔ now means Twi.
- Fixed half a sentence being lost when a pause split a turn.

## d09700e — Twi word helper and local Twi lab (2026-10-23)
- DistilABENA v2 suggests the next Twi word, or fills a `___` blank, in the chat composer
  (`edge/twi_nlp.py`, `src/lib/twi-nlp.server.ts`).
  - Hidden-word test: 65% first guess and 91% top-5 correct, ahead of ABENA, RoBAKO and
    GPT-4o-mini.
- `npm run twi` starts the Twi voice and word helper on this PC (`scripts/twi-lab.mjs`).

## 4722b82 — Hatch landing, chat history, voice upgrades, Twi voice on the Pi (2026-10-23)
*(from git history and earlier session notes)*
- Landing page: the chicken life-cycle video as a scroll-scrubbed frame sequence (`public/hatch/`).
- Ama: chats saved per user with a History panel; spoken replies and dictation; mobile mic
  fixes; better Twi/Ga/Ewe/Hausa transcription.
- Khaya integration for speech, translation and voices (`src/lib/khaya.server.ts`), switched on
  by `KHAYA_API_KEY`.
- Twi voice on the Raspberry Pi (`edge/twi_tts.py`): the Pi polls the app for jobs, or serves
  HTTP directly.
  - Comparison with OpenAI's voice, character error rate (lower is better): Pi voice 0.46,
    OpenAI 0.10 by OpenAI's transcriber; 0.37 vs 0.27 by an independent Akan transcriber.
- Migrations 002 (chat history) and 003 (Twi voice jobs).

## 7aa614a — Ama, profile and themes, app redesign, promo ad (2026-10-22)
*(from git history)*
- The AI assistant tab with the 3D Ama avatar (`ExplorerAvatar.tsx`) and farm scene
  (`FarmScene.tsx`); OpenAI chat, speech and realtime voice.
- Profile page with themes (Field, Coastal, Savanna, Kente, High contrast), fonts, text size and
  accessibility settings (`src/lib/theme.ts`, `ThemeProvider.tsx`).
- Console redesign (`ui-kit.tsx`, `Sidebar.tsx`); promo video in `promo/`.

## 0b818f2, 6e234aa, 6a41809 — Pi tooling and docs (2026-10-02/03)
*(from git history)*
- Sensor test script (`edge/test_sensors.py`); README section on the edge AI.
- The bottom nav was removed (the sidebar stays as an icon rail on phones).
- Migrations run over Neon's HTTP driver (WebSockets failed behind firewalls).

## 9f38741 — Raspberry Pi edge AI; Supabase → Neon (2026-10-01)
*(from git history)*
- Coop-condition model retrained on a time-series simulator: 21 features, Healthy/Warning/Critical
  plus 7 causes, 93.8% accuracy / 97.1% critical recall (vs 80.1% / 83.7% before), numpy-only
  32 KB model.
- Pi agent: DHT22, ADS1115 (MQ-135, LDR), fan PWM + tach, offline outbox, systemd installer.
- App moved from Supabase to Neon with server functions, session cookies, role middleware and SQL
  migrations. The ingest endpoint raises and resolves AI alerts.

## June 2026 — initial app (Lovable)
*(from git history; commits titled "Changes" by gpt-engineer-app)*
- TanStack Start template, "Built PoultryGrid AI app" (`463a83b`), dark dashboard redesign
  (`a40e069`), WebGL landing page (`e291398`), Google Fonts (`046b325`). Detailed changes in
  this period can't be confirmed from the commit messages alone.
