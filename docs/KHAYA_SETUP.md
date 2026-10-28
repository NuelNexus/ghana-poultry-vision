# Getting a GhanaNLP Khaya API key

Khaya is GhanaNLP's set of AI services trained on Ghanaian languages: translation, speech
recognition and voices for Twi, Ga, Ewe, Dagbani, Fante and more. PoultryGrid works without it,
but with a key the Ghanaian languages get Ghanaian-trained engines instead of OpenAI's.

## What the key switches on

Everything below turns on automatically once `KHAYA_API_KEY` is set. No code changes needed.

| Feature | Without a key | With a key |
|---|---|---|
| Site translation (Twi, Ga, Ewe, Dagbani) | GPT-5.5 | Khaya, falling back to GPT-5.5 for anything Khaya can't do |
| Ama's replies in Twi, Ga, Ewe | GPT-5.5 writes the language directly | GPT thinks in English; Khaya translates the farmer's words in and her answer out |
| Speech-to-text for Twi | OpenAI `gpt-4o-transcribe` | OpenAI first, then Khaya re-transcribes when the speech is Twi |
| Voices for Ga, Ewe, Hausa, Dagbani | OpenAI voice | Khaya's female voice |
| Voice for Twi | stable-twi-tts (`twi-6`), then OpenAI | stable-twi-tts, then Khaya, then OpenAI |

Code: `src/lib/khaya.server.ts`, used by `src/lib/translate.server.ts`,
`src/lib/voice.server.ts` and `src/lib/api/assistant.functions.ts`.

## Steps

The Khaya developer portal is a standard **Azure API Management** portal. The steps below follow
that portal. The exact product names on the Products page could not be checked, because that
list loads only after you sign in.

1. **Open the portal:** go to <https://translation.ghananlp.org/>.
2. **Sign up:** click **Sign up** (top right). Enter your email, a password, your first and last
   name, and solve the picture check. Click **Sign up**.
3. **Confirm your email:** open the email from the portal and click the link. Your account is
   not active until you do this.
4. **Sign in:** go back to the portal and click **Sign in**.
5. **Subscribe to a product:** click **Products** in the top menu. Open the product that covers
   translation, speech and TTS; if there's a free or starter tier, pick that. Type any name for
   the subscription (for example `poultrygrid`) and click **Subscribe**. Some products need
   approval first; you'll get an email when it's approved.
6. **Copy your key:** click your name or **Profile** (top right). Under **Subscriptions**, find
   the one you just made and click **Show** next to **Primary key**. Copy it.
7. **Add it to PoultryGrid on this PC:** open `.env` in the project folder and add this line:

   ```
   KHAYA_API_KEY=paste-your-primary-key-here
   ```

   Restart the site (`npm run dev`). `.env` is in `.gitignore`, so the key never goes to GitHub.
8. **Add it to the live site:** in Lovable, open the project's settings, find environment
   variables / secrets, and add `KHAYA_API_KEY` with the same value. Then click **Publish**.

Optional: Khaya has more than one voice. Set `KHAYA_TTS_VOICE` to `female` (the default),
`male_low` or `male_high`.

## Checking it works

- **Twi in chat:** open the AI tab and type a Twi question. With a key, the reply shows a small
  "English: …" line under it; that's Khaya's translation.
- **Ga voice:** in Profile > Language and voice, pick **Gã** and press **Explain** on any
  page. The voice should sound different from the OpenAI voice.
- **If nothing changes:** check the server log for lines starting with `Khaya … failed (401)`
  (wrong key) or `(403)` (subscription not approved yet).

## If you get stuck

The portal's Products page says to email **subscriptions@khaya.ai** with any problem
subscribing.

## Keeping the key safe

- Never paste the key into a chat, a screenshot or the source code. Keep it only in `.env` and in
  Lovable's secrets.
- If it leaks, go to Profile > Subscriptions in the portal and click **Regenerate** next to the
  primary key, then update `.env` and Lovable.
