import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSessionUser } from "../auth.server";
import { chatCompletion, fromBase64, localModel } from "../openai.server";
import { isKnownSiteText, translateTexts } from "../translate.server";
import { speakIn } from "../voice.server";
import { SITE_LANG_IDS, helloIn, siteLang, speechLangFor, type SiteLang } from "../site-lang";
import { farmSummary, hear } from "./assistant.functions";

// Site-wide language and voice features: page translation, read-aloud, "explain
// this page" and spoken commands. Most of these also work before signing in
// (landing, sign-in and sign-up pages), so a farmer who can't read English can
// still create an account. Visitors who aren't signed in get a shared hourly
// allowance, so nobody can run up the OpenAI bill from outside.

const langSchema = z.enum(SITE_LANG_IDS);

// Hourly allowance for visitors who aren't signed in, per server instance.
const allowance = new Map<string, { reset: number; left: number }>();
function takeAnon(kind: string, perHour: number, n = 1) {
  const now = Date.now();
  let a = allowance.get(kind);
  if (!a || a.reset < now) {
    a = { reset: now + 3_600_000, left: perHour };
    allowance.set(kind, a);
  }
  if (a.left < n) throw new Error("Too many requests. Please sign in or try again later.");
  a.left -= n;
}

// Replies Ama just wrote for visitors (explanations, command answers), so they
// can be read aloud before signing in. Kept for a few minutes.
const recentReplies: { text: string; at: number }[] = [];
function remember(text: string) {
  recentReplies.push({ text, at: Date.now() });
  while (
    recentReplies.length > 200 ||
    (recentReplies[0] && Date.now() - recentReplies[0].at > 600_000)
  )
    recentReplies.shift();
  return text;
}
const isRecentReply = (t: string) => recentReplies.some((r) => r.text.includes(t.trim()));

const fast = (lang: SiteLang) => (lang === "en" || lang === "fr" ? undefined : localModel());

/** English site strings -> the farmer's language. Unknown/failed ones come back as null. */
export const translateUi = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      lang: langSchema,
      texts: z.array(z.string().max(600)).max(80),
    }),
  )
  .handler(async ({ data }) => {
    if (!(await getSessionUser())) takeAnon("translate", 3000, data.texts.length);
    const map = await translateTexts(data.lang, data.texts);
    return { t: data.texts.map((s) => map.get(s.trim()) ?? null) };
  });

/**
 * Read one sentence aloud in the farmer's language. Signed-in users can have any
 * text read; visitors only text that is on the site (it was translated here).
 */
export const speakText = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      text: z.string().min(1).max(1200),
      lang: langSchema,
      slowTwi: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    if (!(await getSessionUser())) {
      // Visitors: site text and Ama's fresh replies, plus short snippets (a heading
      // built from several pieces), all inside the shared hourly allowance.
      const ok =
        data.text.length <= 200 || isRecentReply(data.text) || (await isKnownSiteText(data.text));
      if (!ok) throw new Error("Sign in to have this read aloud");
      takeAnon("speak", 400);
    }
    return speakIn(data.text, speechLangFor(data.text, data.lang), { slowTwi: data.slowTwi });
  });

/**
 * The greeting for one language in the picker ("Welcome. Tap here to use
 * PoultryGrid in Twi."), written and spoken in that language, so people who
 * can't read can choose by ear.
 */
export const helloAudio = createServerFn({ method: "POST" })
  .inputValidator(z.object({ lang: langSchema }))
  .handler(async ({ data }) => {
    if (!(await getSessionUser())) takeAnon("hello", 600);
    const l = siteLang(data.lang);
    const en = helloIn(l);
    const text = data.lang === "en" ? en : ((await translateTexts(data.lang, [en])).get(en) ?? en);
    const voice = await speakIn(text, data.lang === "en" ? "auto" : l.speech);
    return { text, ...voice };
  });

/** Speech -> text in the farmer's language, for the mic on any text box. */
export const dictate = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      audio: z.string().min(1).max(3_000_000), // base64, about a minute of speech
      mimeType: z.string().max(100),
      lang: langSchema,
    }),
  )
  .handler(async ({ data }) => {
    if (!(await getSessionUser())) takeAnon("dictate", 300);
    return { text: await hear(fromBase64(data.audio), data.mimeType, data.lang) };
  });

/** "What is on this screen?": a short spoken explanation of the page in the farmer's language. */
export const explainPage = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      lang: langSchema,
      title: z.string().max(200),
      text: z.string().max(9000),
    }),
  )
  .handler(async ({ data }) => {
    if (!(await getSessionUser())) takeAnon("explain", 120);
    const l = siteLang(data.lang);
    const text = await chatCompletion(
      [
        {
          role: "system",
          content: `You are Ama, the helper inside PoultryGrid, a poultry farm app in Ghana. A farmer who may
not read well asked what is on their screen. Using only the screen text below, explain in ${l.name}
(${l.native}), in 3 to 5 short spoken sentences: what this page is for, the most important
numbers or warnings on it, and what they can do here. Plain words, no lists, no markdown, no emoji.
Never invent numbers.`,
        },
        { role: "user", content: `Page: ${data.title}\n\nScreen text:\n${data.text}` },
      ],
      { model: fast(data.lang), maxTokens: 500 },
    );
    return { text: remember(text.trim()) };
  });

// Spoken commands -------------------------------------------------------------

const APP_PAGES = {
  "/app": "Overview: all houses at a glance, today's status",
  "/app/houses": "Houses: each poultry house, its birds and latest readings",
  "/app/health": "Flock health: the AI's health status and likely causes",
  "/app/cameras": "Cameras: live view from the farm camera",
  "/app/alerts": "Alerts: warnings about heat, gas, fans, offline devices",
  "/app/automation": "Automation: coop zones (fans, heat lamps, water) and the brooder fan",
  "/app/hatchery": "Hatchery: egg batches and hatch records",
  "/app/devices": "Devices: Raspberry Pi and camera setup",
  "/app/reports": "Reports: charts and history",
  "/app/ai": "AI assistant: chat or talk with Ama",
  "/app/market":
    "Marketplace: buy and sell eggs, birds, chicks, feed and manure with other farmers",
  "/app/guides": "Guides: video guides for the site and both units, and the welcome tour",
  "/app/profile": "Profile and settings: language, text size, account",
} as const;
const PUBLIC_PAGES = {
  "/": "Home page about PoultryGrid",
  "/login": "Sign in",
  "/login?mode=signup": "Create an account",
} as const;

/**
 * The farmer tapped "Speak" and said something in their language. Ama either
 * takes them to a page ("show me the alerts") or answers ("is the house too
 * hot?") from the live farm data, always replying in their language.
 */
export const voiceCommand = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      lang: langSchema,
      said: z.string().min(1).max(1000),
      path: z.string().max(200),
      screen: z.string().max(4000).default(""),
    }),
  )
  .handler(async ({ data }) => {
    const user = await getSessionUser();
    if (!user) takeAnon("command", 200);
    const pages: Record<string, string> = user ? APP_PAGES : PUBLIC_PAGES;
    const l = siteLang(data.lang);
    const farm = user ? await farmSummary(user.id).catch(() => "unavailable") : null;
    const raw = await chatCompletion(
      [
        {
          role: "system",
          content: `You are Ama, the voice helper of PoultryGrid, a poultry farm app in Ghana. The farmer
pressed the Speak button and said something, probably in ${l.name} (${l.native}); the words were
written down by speech recognition and may be rough. They are on page ${data.path}.
Decide:
- If they want to go somewhere or see something, set "go" to one of these pages, else "":
${Object.entries(pages)
  .map(([p, d]) => `  ${p} - ${d}`)
  .join("\n")}
- In "say", reply in ${l.name} in one to three short spoken sentences: what you opened for them,
  or the answer to their question. ${
    farm
      ? "For questions about the farm use only the live data below; never invent readings."
      : "They are not signed in, so you cannot see any farm data; help them sign in or create an account."
  }
  Plain words, no lists, no markdown.
- If you could not understand them, "go" is "" and "say" asks them kindly to say it again.
${farm ? `\nLIVE FARM DATA:\n${farm}` : ""}${data.screen ? `\n\nTEXT ON THEIR SCREEN:\n${data.screen}` : ""}`,
        },
        { role: "user", content: data.said },
      ],
      {
        model: fast(data.lang),
        maxTokens: 400,
        jsonSchema: {
          name: "command",
          schema: {
            type: "object",
            properties: {
              go: { type: "string", enum: ["", ...Object.keys(pages)] },
              say: { type: "string" },
            },
            required: ["go", "say"],
            additionalProperties: false,
          },
        },
      },
    );
    const out = JSON.parse(raw) as { go: string; say: string };
    return { go: out.go || null, say: remember(out.say.trim()) };
  });
