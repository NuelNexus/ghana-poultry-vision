# Testing

How the recent work was tested, the results, and what is still open. Browser tests used
headless Chrome (Puppeteer) against the local site (`npm run dev`, port 8080), signed in as the
test account, at phone size (390×844) and desktop size (1280×900).

The test scripts were one-off scripts kept outside the repo (in the session's scratch folder),
so they are described here rather than shipped. The project has no automated test suite yet.

## Results

### T1. Ama mentions readings only when relevant
**Method:** 9 messages, each in a fresh chat on `/app/ai`. A reply counts as a mention if it
contains a °C/°F reading or a temperature word: temperature, ɔhyew, hyew, température, chaleur,
zafi, dzoxɔxɔ, heat.

| # | Language | Message | Before | After |
|---|---|---|---|---|
| 1 | English | Hello | none | none |
| 2 | English | How do I vaccinate my chicks against Newcastle disease? | none | none |
| 3 | English | How many eggs should a layer hen lay in a week? | none | none |
| 4 | Twi | Akwaaba, wo ho te sɛn? | **farm status, data age** | none |
| 5 | Twi | Ɛdeɛn aduane na ɛyɛ ma nkokɔ mma? | none | none |
| 6 | French | Bonjour, comment ça va ? | none | none |
| 7 | Hausa | Ina kwana, yaya aiki? | none | none |
| 8 | Ga | Ojekoo, te oyɔɔ tɛŋŋ? | **farm status, data age** | none |
| C | English | Is House A too hot right now? *(control)* | gives 28.2 °C | gives 28.2 °C |

**Result:** 2/8 → 0/8 unprompted mentions; the control still answers with the reading.
**Caveat:** model replies vary from run to run, and this was one run of 9 prompts. Retest if the
models change.

### T2. Language detection (`detectLang`)
19 sample sentences, including:
- Twi with and without ɛ/ɔ
- Twi greetings
- a garbled Twi transcript
- English, French and Hausa
- Ewe (by letters and by words)
- Ga ("Mi wuoi lɛ…", "Ojekoo, te oyɔɔ tɛŋŋ?")
- "ok"

**Result:** 19/19 correct.

### T3. Sign-in animation
**Method:** paused every animation on `/login` and captured the figure at 1.5, 3.9, 4.6, 5.6, 7
and 8 s.

**Result:** the egg rolls with its shadow and dust puffs → the shell cracks with the cap flying
off → the chick hops on → the hen hops on (white, red comb), moving left to right.

**Found while testing:**
- The browser on this PC reports "reduce motion" (Windows "Animation effects" off), which kept
  the first version still on the left. It now always moves: with reduce-motion on, it went
  from x = 37 px to 1,541 px over 10 s, left to right.
- The chick was too pale against the yellow background, so its colour was strengthened.

### T4. Sign-in background
- **Before:** the old image URL returns HTTP 403.
- **After:** `.auth-bg` uses `url("/auth-bg.svg")`; the page loads with **no failed requests**.
  Screenshot checked at 1280×800.

### T5. Translated text fits the layout
**Method:** for each language, visited 11 console pages at phone and desktop size after
translations settled. Flagged any text element wider than its box (excluding scroll areas), any
element past the screen edge, and any sideways page scroll. Screen-reader-only labels (hidden on
purpose) and two desktop Profile items that are also cut off in English were left out.

| Run | Languages | Problems found |
|---|---|---|
| Before the fix | Twi, Ga (English as baseline) | 4 (all phone, all Twi): 2 report labels and a flock stage cut off with "…", a device figure out of its box |
| After the wrap rule | Twi, Ga, Ewe, Dagbani, Hausa, French | 1: an Ewe option off-screen in a Profile segmented control |
| After the segmented-control rule | Ewe, Twi (Profile) | **0** |

Sign-in / sign-up / sign-up form on a phone in Twi, Ga, Dagbani and French: all fit.

### T6. Coop unit controls (local Postgres, coop emulator, Pi simulator)
- Registered `COOP-1` (unit 2) and `PI-BROODER-1` (unit 1) on one account; the coop came online
  and confirmed settings v1 on its first check-in.
- From Automation: Layers → Manual (v2), Layers fan on (v3), Broilers "fan on above" 24 → 26 °C
  (v4). Each showed "Sending settings vN…" then "Running settings vN · applied just now · by Ama
  Mensah"; the emulator's log showed the fan on and the new setpoint. Change log: "Layers: manual,
  fan off, lamp off", "Layers: fan on", "Broilers: fan on above 24 → 26 °C".
- "Fan off at" 30 °C (above "fan on above") was refused before sending, with the rule shown.
- The emulator's water drifting below 2.5 V raised "drinking water is dirty"; recovery closed it.
- A second account sees no coop on its Automation page.
- **Not tested:** the sketch on a real ESP32 (it was not compiled; no Arduino toolchain here).

### T7. Marketplace (two accounts in the browser)
- Empty marketplace shows "No listings yet". Seller posts a listing with a 2400×1800 photo:
  stored as a 1280-px JPEG of 52 KB. The buyer (another account) finds it, the WhatsApp link is
  `wa.me/233241234567`, a message with quantity and phone reaches the seller (tab shows
  "Messages (1 new)"). Mark as sold → gone from Browse. Photo URL without a session → 401.

### T8. First-login tour
- New account → tour opens; all 12 steps step through, 11 highlighted (the first is a centred
  welcome); after "Start farming" and a reload it doesn't return. A second account skipped it.

### T9. Video guides
- `hyperframes check` passes on each generated project (lint, runtime, layout); remaining
  notes: no audio (by choice, D20) and two connector notes across scenes (false positives).
- Frames reviewed from rendered files, including Twi captions (ɛ, ɔ, ã render in Inter).

### Earlier results (same session, before these fixes)

| Test | Result |
|---|---|
| Sign-up in Twi: title translated, greeting plays | "Paw wo kasa"; greeting in 4.5 s first time, 1.4 s cached |
| Overview fully in Twi (first visit, empty cache) | 4.0 s; alert text and dates translated |
| Explain on Overview (Twi) | Twi summary in 5.3 s; voice at 6.3 s |
| Listen on a Twi reply | first sound in 2.0 s |
| Voice call, Twi speech | reply shown and spoken ~7 s after the farmer stopped |
| Speak button, Twi speech (signed out) | auto-stopped at 8.4 s, answered in Twi, spoken |
| Tap to hear, signed out (landing) | plays (after two fixes) |
| Twi voice server health | `{"voice": "twi-1"}` |
| Twi model comparison (10 UI strings) | GPT-5.5 10/10 correct; GPT-4o-mini, GPT-4o, GPT-4.1, opus-mt-en-tw made errors |
| Twi voice pitch (12 voices, two methods) | twi-6 ≈120–127 Hz (male); twi-1 ≈182–189 Hz (female) |
| Typecheck (`tsc --noEmit`) | clean |
| Lint on changed files | 0 errors; 2 warnings of a kind the project already has (react-refresh) |

## Known issues and limits
- **The coop firmware hasn't been compiled or run on an ESP32.** Compile it once in the Arduino
  IDE (`firmware/coop_unit/README.md`) before installing it.
- **Twi captions in the video guides haven't been reviewed by a native speaker**, and the videos
  are silent.
- **Ga and Dagbani translations are unverified.** Some Ga strings came back as Twi (for example
  "Kasa" for Speak). Fix: a Khaya key (`KHAYA_SETUP.md`), or correct rows in `ui_translations`.
- **The Twi voice needs `npm run twi` on the PC or the Pi service.** Without it, Twi is spoken by
  OpenAI's voice.
- **Visitor limits are per server instance and kept in memory.** With many instances the real
  limit is higher.
- **`document.title` (the browser tab) isn't translated.**
- **Text split by inline formatting is translated in pieces**, e.g. "…calibrate the MQ-135 in
  clean air with" around a code span, which can read awkwardly.
- **First visit to a new screen or string** shows English for a few seconds until it's
  translated; after that it's cached for everyone.
- **The live site only changes after Publish in Lovable**, and needs the same environment
  variables there.
- **Repo-wide lint** reports about 2,200 formatting problems in older files (mostly
  `ui-kit.tsx`). The files changed here are clean.

## How to re-run the checks by hand
1. **Temperature:** in the AI tab, start a new chat and say hello in Twi; Ama shouldn't mention
   readings. Ask "Is House A too hot?"; she should.
2. **Animation and background:** sign out and open `/login`. A yellow background with shapes;
   an egg rolling along the bottom from left to right that hatches.
3. **Fit:** Profile → Language and voice → pick a language; then open each page at phone size
   (browser dev tools, 390 px wide) and look for cut-off words or sideways scrolling.
4. **Khaya:** follow `KHAYA_SETUP.md` → "Checking it works".
