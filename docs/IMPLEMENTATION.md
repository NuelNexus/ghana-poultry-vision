# How the main features work

How the parts of PoultryGrid fit together, focused on the AI assistant, languages and voice.
For setup see the main `README.md`. For which file does what, see `FILE_GUIDE.md`.

## 1. Architecture

```
Raspberry Pi (edge/agent.py) ── readings + AI status ──▶ /api/public/devices/ingest ──▶ Neon Postgres
     │                                                                                     ▲
     └─ twi_tts.py worker ◀── long-poll /api/public/devices/tts (Twi voice jobs) ──────────┤
                                                                                           │
Browser (React, TanStack Start) ── server functions (createServerFn) ──▶ src/lib/api/*.functions.ts
     │   LanguageProvider + DomTranslator ── translateUi ──▶ translate.server.ts ──▶ ui_translations
     │   AccessDock / SpeechPlayer ── speakText / speakReply ──▶ voice.server.ts ──▶ Twi voice / Khaya / OpenAI
     └── Ama voice call ── WebRTC ──▶ OpenAI Realtime (secret minted by createVoiceSession)
```

- **Stack:** TanStack Start (React 19, Vite), server functions with zod validation, Neon Postgres
  through `query`/`queryOne`, email/password sessions in an httpOnly cookie, roles
  admin/manager/worker.
- **Deploying:** the repo is a Lovable project. Pushing to GitHub doesn't update the live site;
  click **Publish** in Lovable. Environment variables live in Lovable's settings.

## 2. Ama, the AI assistant

### Text chat (`src/routes/app.ai.tsx` → `askAssistant`)
1. The browser sends the last 20 messages and the site language (`uiLang`).
2. `detectLang` (`src/lib/ai-languages.ts`) classifies the newest message as `tw`, `ga`, `ee`
   or `auto`.
3. `answer()` builds the system prompt (`systemPrompt`): Ama's role, the farm hardware (so she
   never invents sensors), language rules, the **reading rule** (below), and the live farm data
   as JSON (one entry per Pi, plus open alerts).
4. **Model choice (`modelFor`):** Twi, Ga, Ewe, or a site language of Twi/Ga/Ewe/Dagbani/Hausa →
   `OPENAI_LOCAL_MODEL` (GPT-5.5, reasoning off). Otherwise `OPENAI_CHAT_MODEL` (GPT-4o-mini).
5. **With a Khaya key**, for languages Khaya translates, Ama thinks in English: the farmer's
   words are translated to English, GPT answers in plain English, and Khaya translates the
   answer back. The English versions are saved and shown under the message.
6. The turn is saved in `ai_conversations` / `ai_messages` (the History panel).

**Reading rule:** the farm data goes with every request (so questions like "should I worry?"
work), but the prompt says to talk about readings only when asked about them, about how the
farm is doing, or for an open critical alert. See `DECISIONS.md` D16 for the test.

### Vaccine reminders (`src/lib/vaccine-schedule.ts`)
- Each house has a flock type (broiler / layer) and a "Chicks placed on" date. `flockCare` turns
  them into the schedule day (placement day = Day 1, UTC, which is Ghana time), today's tasks, a
  vaccine due now and the next vaccine.
- `describeFarm` adds this as `flock_care` to Ama's farm data, and her system prompt tells her to
  mention a vaccine due today in her first reply and how to give it (`VACCINE_TIPS`).
- `getFlockCare` (used by `FlockCareCard` on the Overview and the AI rail) also raises one
  `vaccine` alert per vaccine (severity warning, so spoken alerts read it) and resolves it after
  that vaccine's day or week. Ama's own reads don't touch alerts.

### Listening to replies
**Listen** (or "read replies aloud" in settings) plays the reply through `SpeechPlayer` and
`speakReply`, one sentence at a time (section 5).

### Dictation and Twi word chips
- The mic in the composer records (`Recorder`), and `transcribeSpeech` turns the recording into
  text. The site language is used as a spelling hint; for Twi with a Khaya key, Khaya
  re-transcribes the audio.
- When the typed text looks like Twi and `TWI_NLP_URL` is set, DistilABENA suggests the next word
  or fills a `___` blank.

### Voice call (OpenAI Realtime over WebRTC)
- `createVoiceSession` mints a short-lived secret carrying the same system prompt (with the site
  language) and a transcription hint for that language.
- **When a Twi voice is available** (`twiRouting`), the realtime model doesn't reply on its own
  (`create_response: false`). After each turn is transcribed:
  - **Twi** → `twiReply` (GPT-5.5 / Khaya), then spoken sentence by sentence in the female Twi
    voice. The text is also handed to the realtime model so the call keeps its context.
  - **anything else** → `response.create`: the realtime model answers as usual.
- Talking over Ama stops her (barge-in), for both the realtime voice and the Twi voice.

## 3. Language detection (`detectLang`)

A cheap word check that runs on every message and voice turn:
1. Ewe letters (ɖ ʋ ƒ ɣ) or tone marks → `ee`.
2. Count strong Twi words, weak Twi words (that are also English, like "me", "no"), Ga words
   and Ewe words. Two or more Ga/Ewe words that outnumber the Twi words → `ga` / `ee`.
3. ɛ or ɔ anywhere → `tw` (English never uses them, and Ga/Ewe were ruled out above).
4. One strong Twi word in a 1–2 word message → `tw` ("Akwaaba", "Medaase").
5. Two or more strong Twi words making up ≥30% of the words → `tw`.
6. Otherwise `auto`.

Callers that route to the Twi stack check `=== "tw"`, so `ga`/`ee` only change the model and
prompt language.

## 4. Site language and translation

### Choosing a language
- `SITE_LANGS` (`src/lib/site-lang.ts`): English, Twi, Ga, Ewe, Dagbani, Hausa, French.
- **Sign-up:** the first step is `LanguagePicker`. Tapping a tile switches the site immediately
  and plays a greeting in that language (`helloAudio`). The choice is sent with `signUp` and
  saved in `users.language`.
- **Sign-in:** a compact row of language chips above the form.
- **Profile → Language and voice:** the same picker; saved with `setMyLanguage`.
- `LanguageProvider` decides the language: the account's language if signed in, else this
  device's last choice (`localStorage` `pg-lang`), else English. It sets `<html lang>`.

### Translating the page (`src/lib/dom-translator.ts`)
1. On start, and for every DOM change (MutationObserver), it collects text nodes and the
   `placeholder`, `aria-label`, `title` and `alt` attributes, plus labels on `input[type=submit]`.
2. **Skipped:** `translate="no"`, `.notranslate`, `[data-no-translate]`, code, `textarea`, SVG,
   canvas, editable areas, and strings without words (numbers, times, units) or ids (`pi-01`).
3. Numbers become `⟦0⟧`, `⟦1⟧` …; the template is looked up in the local dictionary
   (`localStorage` `pg-tr:v1:<lang>`, up to 5,000 entries).
4. Misses are batched (60 ms debounce, 48 per request, requests in parallel) to `translateUi`.
5. Results are filled back in with the numbers restored. The original English is remembered,
   so switching back to English restores it.
6. A small "…" pill shows while translations are pending.

### Server side (`src/lib/translate.server.ts`)
- Looks up `ui_translations (lang, source)` first.
- Missing strings: Khaya (Twi/Ga/Ewe/Dagbani with a key), then GPT-5.5 in parallel batches of
  12, with a JSON schema. The prompt includes app meanings ("birds" = the farmer's chickens,
  "house" = a poultry house).
- A translation is accepted only if it keeps the same `⟦n⟧` placeholders.
- Identical requests arriving at the same time share one model call.

### Fitting translated text into the UI
Twi, Ga, Hausa and French words are often longer than English. See `CHANGELOG.md` → "Translated
text fits the layout" for the CSS rules and the scan that checks every page.

## 5. Voice output

### Engine order (`src/lib/voice.server.ts`, `speakIn`)
| Language | 1st | 2nd | 3rd |
|---|---|---|---|
| Twi | stable-twi-tts `twi-1` (Pi relay or `TWI_TTS_URL`) | Khaya (key) | OpenAI `gpt-4o-mini-tts` "nova" |
| Ga, Ewe, Dagbani, Hausa | Khaya (key) | OpenAI | — |
| English, French, other | OpenAI | — | — |

The last 150 spoken sentences are cached in memory on the server; the Twi voice server caches
its last 128.

### Playback (`src/lib/speech-client.ts`, `SpeechPlayer`)
- `splitForSpeech` makes sentence-sized chunks (short first chunk for a fast start, 220
  characters at most).
- Chunk 1 and 2 are requested at once; each time a chunk starts playing, the one two ahead is
  requested.
- If the Twi voice misses for one chunk (12 s limit), `slowTwi` sends the remaining chunks
  straight to the next voice.
- Only one player talks at a time across the page. `unlock()` is called inside taps so phones
  allow sound.

### `speechLangFor(text, uiLang)`
Picks the voice for a text: the language `detectLang` sees (Twi/Ga/Ewe); otherwise the site
language, unless the text is plainly English.

## 6. Voice help on every page (`src/components/AccessDock.tsx`)

| Feature | How it works |
|---|---|
| **Speak** | Records until 1.6 s of silence (`Recorder.onSilence`), transcribes with `dictate` (site language hint), then `voiceCommand` returns `{go, say}`. It navigates if `go` is set and speaks `say`. Signed-in users get answers from live farm data; visitors get help with public pages. |
| **Explain** | Sends the visible text of `<main>` (up to 8,000 characters) to `explainPage`, which returns 3–5 spoken sentences in the site language. |
| **Tap to hear** | Capture-phase click listener. Text is read aloud. A button is read on the first tap and pressed on a second tap within 6 s. The element is outlined while it's read. |
| **Mic on text boxes** | Appears on focus for text/search/email/tel/url inputs and textareas. It fills the box using the native value setter plus an `input` event, so React sees it. Email dictation converts " at " / " dot ". `data-no-dictate` opts out. |
| **Spoken alerts** | Optional. Watches `listAlerts` every 30 s and reads new warning/critical alerts, translated. |
| **Layout** | Bottom-right. On phones it shows only Speak plus a "more" button. Body padding keeps page content clear of it. Hidden on `/app/ai`, which has its own voice controls. |

**Visitor limits** (`i18n.functions.ts`, per server instance, per hour): translate 3,000
strings, speak 400, dictate 300, explain 120, command 200, greeting 600. Visitors can hear site
text, Ama's replies from the last 10 minutes, and short snippets (≤200 characters).

## 7. Twi tools on the Pi or PC

- `npm run twi` starts both on this PC: the voice on :5002 and the word helper on :5003. `.env`
  points `TWI_TTS_URL` / `TWI_NLP_URL` at them.
- On a Pi: `edge/deploy/install_tts.sh` installs `poultrygrid-tts.service` (worker mode). It
  needs 64-bit Pi OS and about 175 MB of RAM.
- The servers refuse to start if their port is taken, so an old copy can't keep answering
  silently. Windows otherwise lets two copies share a port.
- **Licence:** the stable-twi-tts voice model is CC BY-NC 4.0 (non-commercial); its code is MIT.

## 8. Sign-in and sign-up page visuals

- **Background:** `.auth-bg` in `src/styles.css` uses `#fef5b1` and `public/auth-bg.svg`.
- **Animation:** `HatchLoop` (`src/components/HatchLoop.tsx`), see `DECISIONS.md` D14 for the
  timeline and why it ignores the reduced-motion setting.

## 9. Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Neon Postgres. |
| `OPENAI_API_KEY` | — | Required for Ama, translation and voices. |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | English answers. |
| `OPENAI_LOCAL_MODEL` | `gpt-5.5` | Answers in Twi/Ga/Ewe/Dagbani/Hausa. |
| `OPENAI_TRANSLATE_MODEL` | `gpt-5.5` | Site translation. |
| `OPENAI_STT_MODEL` | `gpt-4o-transcribe` | Speech to text. |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | `gpt-4o-mini-tts` / `nova` | Spoken replies (female). |
| `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` | `gpt-realtime-mini` / `marin` | Voice call. |
| `KHAYA_API_KEY` | unset | Turns on Khaya (see `KHAYA_SETUP.md`). |
| `KHAYA_TTS_VOICE` | `female` | Khaya voice. |
| `TWI_TTS_URL` / `TWI_TTS_TOKEN` | unset | Direct Twi voice server; otherwise the Pi relay. |
| `TWI_TTS_VOICE` | `twi-1` | stable-twi-tts voice. |
| `TWI_NLP_URL` / `TWI_NLP_TOKEN` | unset | DistilABENA word helper. |

## 10. Extending

- **Add a site language:** add it to `SITE_LANGS` (and `SpeechLang`, `STT_PROMPT`, `KHAYA_CODES`
  if it has speech support), then visit the pages once in that language, or run the warm-up
  script, to fill the cache.
- **Keep text untranslated:** add `translate="no"`.
- **Fix a bad translation:** update the row in `ui_translations`
  (`update ui_translations set text = '…' where lang = 'tw' and source = '…'`). Browsers pick it
  up once their local cache is cleared or the string changes.
- **Change when Ama mentions readings:** edit the "WHEN TO MENTION READINGS" block in
  `systemPrompt`.
