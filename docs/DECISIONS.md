# Design decisions

Why things were built the way they were: the options considered, what was chosen, and what
evidence decided it. Newest first. Each entry says what was measured; where something couldn't
be verified, it says so.

---

## D20. Video guides: HyperFrames, captions baked in, two languages (Oct 2026)

**Request:** tutorials for the site and both units, in Twi and English, made with HyperFrames.

**Choices:**
- **Real screenshots, not mock-ups.** The app was run locally with the coop emulator and the Pi
  simulator reporting, and each screen was captured at 1920×1080 with the bounding boxes of the
  elements the guides point at (`videos/shots/rects.json`), so every highlight lands on the real
  button. The units have no photos, so they're drawn; the coop's LCD screens are copied
  character for character from the firmware.
- **One content file, generated projects.** `videos/guides.mjs` holds every line in both
  languages; `videos/build.mjs` writes a HyperFrames project per guide and language and renders
  it. Changing a caption means editing one line and re-rendering one video.
- **Captions baked in, two files per guide.** HyperFrames renders a fixed MP4; there's no
  subtitle track to switch. Twi accounts get the Twi videos, other languages English for now.
- **Silent.** The skill adds music to explainers, but the only offline sound was a 5.5 s
  cinematic whoosh and there was no HeyGen sign-in for music or voice. A voiceover in Twi needs
  a Twi voice (stable-twi-tts is in the repo) and can be added later.
- **GSAP vendored from npm** (`videos/vendor/`): the render sandbox blocked jsDelivr, and a
  local copy also keeps renders reproducible.

**Not verified:** the Twi captions were written for these videos without a native speaker's
review.

## D19. First-login tour translated by the site translator (Oct 2026)

**Need:** an introduction for new accounts that shows every tab, in their language.

**Options:** hand-written copy per language (7 languages, would drift), or **English copy that
the page translator renders** like everything else (D12). **Chosen:** the second; the tour is
ordinary DOM text, so the translator and Tap-to-hear handle it with no extra work. It highlights
real sidebar links (`data-tour="<path>"`) rather than screenshots, so it can't go stale.
Existing accounts are marked as onboarded in migration 007 so only new sign-ups see it.

## D18. The coop takes its settings by polling, with versions (Oct 2026)

**Need:** switch the coop's fans and lamps and change its temperatures from the site.

**Options:**
1. Push (MQTT or WebSockets to the ESP32). Needs a broker or a long-lived connection; the app
   runs on serverless hosting where neither is available.
2. A separate command queue the ESP32 polls. Commands can be lost or replayed out of order.
3. **Desired state with a version, returned on every check-in. Chosen.** The site stores the
   whole settings object; each change bumps the version. The coop applies a version once, saves
   it in flash, and reports the version it runs, which is how the page knows it landed.

**Why:** the coop already checks in every 10 s, so the latency is at most 10 s with no extra
requests; a missed response just means the next one carries the same state; an offline coop
keeps running its last settings. Validation lives in both places (`src/lib/controls.ts`, the
firmware) so a bad value can't reach the relays. Safety limits (overheat cut-out, sensor
failure) live only in the firmware so the site can't turn them off.

## D17. One marketplace for every account; seller text left untranslated (Oct 2026)

**Context:** since migration 006 every account is its own farm and sees only its own data.

**Choice:** the marketplace is the exception: listings are visible to every signed-in account,
because the point is farmers trading with each other. The owner still asked that nothing be
seeded, so an empty marketplace says so. Photos are stored in Neon (`bytea`, ≤ 800 KB, shrunk to
1280 px in the browser) because the app has no file storage; at ~50–150 KB a photo that's fine for
now. Titles, descriptions and messages carry `translate="no"`: machine-translating free text
would garble product names and prices, and every listing would add rows to `ui_translations`
forever.

## D16. Ama only mentions readings when they're relevant (Oct 2026)

**Problem:** Ama kept bringing up temperature and farm status, even when the farmer just said
hello or asked about feed or vaccines, in any language.

**Cause:** the system prompt (`systemPrompt` in `src/lib/api/assistant.functions.ts`) sends the
live readings with every message and said "Base answers on the live farm data below". The
hardware notes also told her to say when data is out of date, which she did unprompted. GPT-5.5
(used for Ghanaian languages) followed this most eagerly.

**Options:**
1. Don't send the farm data unless the question looks farm-related. This needs a classifier and
   would miss indirect questions ("should I worry today?").
2. Keep sending the data, but say clearly when to use it. **Chosen.**

**Change:** a "WHEN TO MENTION READINGS" rule: only bring up readings when asked about them,
about how the farm/a house is doing, or for an open critical alert. Greetings, small talk and
general questions get a plain answer. The "data is out of date" note now applies only when she
is already talking about a reading.

**Evidence:** 8 unrelated messages (English, Twi, French, Hausa, Ga) plus 1 heat question, each
in a fresh chat. Before: 2/8 unrelated replies brought up farm status (the Twi and Ga greetings).
After: 0/8. The heat question still gets the 28.2 °C reading.

## D15. Ga and Ewe are recognised by name (Oct 2026)

**Problem:** a Ga greeting ("Ojekoo, te oyɔɔ tɛŋŋ?") was treated as Twi because it contains ɔ.
Once that was fixed, the small English model still answered it in Twi.

**Change:** `detectLang` returns `"ga"` / `"ee"` when those words or letters are clear, and those
languages go to the bigger model with "reply in Ga/Ewe". Everything that checks for Twi still
compares against `"tw"`, so Twi routing is unchanged.

**Evidence:** detection tests 19/19, including new Ga and Ewe cases.

## D14. Sign-in animation: egg to chick to hen, in the bunny's style (Oct 2026)

**Request:** replace the hopping bunny with a rolling egg that becomes a chick, then a chicken,
in a loop. Then: match the bunny's style and move left to right.

**Choices:**
- **SVG + CSS keyframes**, not GIF/video/Lottie: no download, crisp at any size, easy to edit,
  and it follows the page's motion settings.
- **Same visual language as the bunny:** flat white shapes, no outlines, a dark dot eye, the
  bunny's brown ground shadow (`#b78e81`), its hop curve (lean back, up, lean forward, land) and
  its white dust puffs. Same path: from 20vw off the left edge, across to the right, then loop.
- **One 12 s crossing** (the bunny took 6 s): the egg rolls (0–30%), wobbles and cracks
  (30–38%), the chick hops on (38–64%) and grows into a hen that hops off (62–100%).
- **Reduced motion:** a first version played in one spot when the device asked for reduced
  motion. Windows does that whenever "Animation effects" is off, which is the case on the
  owner's PC, so it looked stuck on the left. The bunny ignored that setting and always moved,
  and the owner asked for the same behaviour, so the animation now always travels left to
  right. It's small, slow and sits at the very bottom, away from the form. To bring the
  still version back, add a `@media (prefers-reduced-motion: reduce)` block in `HatchLoop.tsx`.

## D13. Sign-in background drawn locally (Oct 2026)

**Problem:** the background stopped loading. It was a JPEG on a third-party host
(`s3-us-west-2.amazonaws.com/s.cdpn.io/…`) that now returns **403 Forbidden**.

**Options:** find another remote image (could break again), copy the archived JPEG (unclear
licence, 188 KB), or **redraw it as an SVG in `public/`**.

**Chosen:** redraw. An archived copy showed a pale yellow page with outlined shapes (pink dots,
orange arch, blue circle, mint ring, dot grid, two slashes); `public/auth-bg.svg` redraws these.
It's a few KB, served by the site itself, and the CSS also sets the yellow colour so something
shows instantly.

## D12. Whole-site translation in the browser, cached on the server (Oct 2026)

**Need:** every page in Twi, Ga, Ewe, Dagbani, Hausa and French, including user-facing data such
as alert messages, without rewriting ~12,000 lines of JSX into translation keys.

**Options:**
1. Classic i18n (string keys in every component). Correct, but a huge rewrite, and every future
   change would need translation keys.
2. **Translate the rendered page** (like a browser's translate feature, but ours). **Chosen.**

**How it stays correct:**
- Only text nodes and a few attributes are changed; React keeps its nodes. When React updates a
  text, a MutationObserver sees the new English and translates it.
- Numbers become placeholders (`⟦0⟧`), so "3 alerts" and "12 alerts" share one translation.
- `translate="no"` marks what must stay as written (brand, Ama's chat, which is already in the
  farmer's language).
- Each English string is translated **once per language** and stored in `ui_translations`; the
  browser keeps a local copy too. All 6 languages were pre-filled by visiting every page
  (≈510 strings each), so farmers never wait for a first translation.

**Engine:** GPT-5.5 by default. Tested on 10 real UI strings: GPT-4o-mini and GPT-4o made errors
(e.g. "Feed and water" became "doctor and water"; crabs instead of eggs); GPT-5.4-mini and GPT-4.1
were mixed; GPT-5.5 got all 10 right. Also tried the open Helsinki `opus-mt-en-tw` model: Bible-style
output ("Turn on the fan" became a phrase about relying on what is strong), so it was rejected and
deleted. Khaya takes over for the Ghanaian languages when a key exists.

**Not verified:** Ga and Dagbani quality. Some Ga words came out as Twi. A Khaya key should
help.

## D11. Ghanaian-language replies use GPT-5.5 (Oct 2026)

Same Twi test, for Ama's answers: GPT-4o-mini wrote garbled advice ("make the water beautiful");
GPT-5.5 with reasoning off gave correct, specific advice in 3.6 s (vs 2.5 s). English stays on
GPT-4o-mini for cost. Settings: `OPENAI_LOCAL_MODEL`, `OPENAI_CHAT_MODEL`.

## D10. Speech is played sentence by sentence (Oct 2026)

**Problem:** spoken Twi replies waited for the whole reply to be synthesised, and a slow PC hit a
30 s timeout before falling back.

**Change:** `SpeechPlayer` (`src/lib/speech-client.ts`) splits text into sentences, fetches the
first immediately and two ahead while playing. Each sentence gets 12 s; if the Twi voice misses
once, the rest of that reply goes straight to the next voice (`slowTwi`). Server and voice server
both cache recent sentences.

**Evidence:** Listen → first sound in 2.0 s (was the full synthesis time).

## D9. Female Twi voice `twi-1` (Oct 2026)

stable-twi-tts ships 12 shortlisted voices with no gender labels. Each was synthesised with the
same sentence and its pitch measured two ways (autocorrelation and YIN). The old default `twi-6`
was the lowest (≈120–127 Hz, male). `twi-1` was the highest (≈189 Hz median, female range) and is
also the package's top-ranked voice for clarity. An OpenAI audio model was asked to confirm
gender but declined, so the choice rests on pitch.

**Reversed (Oct 2026):** after using it, the female `twi-1` was judged worse to listen to; the
default is the male `twi-6` again (migration 008).

## D8. Voice help on every page (Oct 2026)

For farmers who can't read, or can't read English: **Speak** (spoken navigation and questions),
**Explain** (spoken summary of the screen), **Tap to hear** (tap once to hear a button, twice to
press it, so nothing is pressed by accident), a mic on every text box, optional spoken alerts.
Speaking stops on its own after 1.6 s of silence, so nobody has to find a stop button. On phones
the dock collapses to one Speak button plus "more", because the full bar covered page buttons in
testing.

Signed-out visitors (landing, sign-up) can use these too, with hourly limits per server so the
OpenAI bill can't be run up from outside.

## D7. Auto-detect instead of a language picker for Ama (Oct 2026, `d0ff5fc`)

The user asked to remove Ama's language picker. Detection is a word list plus the letters ɛ/ɔ
(never used in English), with checks to exclude Ga and Ewe. Twi goes to the Twi stack; everything
else goes to GPT, and the live GPT voice call is kept as it was.

## D6. Twi voice runs on the Pi, reached through the database (Oct 2026, `4722b82`)

The Pi sits behind the farm router, so the site can't call it. It long-polls
`/api/public/devices/tts` with its device key instead; the site queues text in `tts_jobs` and
waits for the audio. A direct `TWI_TTS_URL` is also supported (same network, or `npm run twi` on
this PC).

## Earlier (from git history)

- **Neon instead of Supabase** (`9f38741`): server functions with session cookies and role
  middleware, replacing Supabase auth and row-level security.
- **Numpy-only edge model** (`9f38741`): 93.8% accuracy on held-out episodes vs 80.1% for the
  original network; a 32 KB model, so the Pi doesn't need PyTorch.
- **Migrations over HTTP** (`6a41809`): Neon's WebSocket driver failed behind firewalls.
