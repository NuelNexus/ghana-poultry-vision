// First-login tour steps and the video guides catalogue.
// Copy is English; the site translator (src/lib/dom-translator.ts) shows it in
// the account's language like every other page. The videos themselves have
// English and Twi versions with the captions baked in (videos/, public/guides/).

export interface TourStep {
  /** CSS selector of what to highlight (sidebar links carry data-tour="<path>"). None = centred card. */
  target?: string;
  title: string;
  body: string;
}

const nav = (path: string) => `[data-tour="${path}"]`;

export const TOUR: TourStep[] = [
  {
    title: "Welcome to PoultryGrid",
    body: "This one-minute tour shows you every part of the site. You can watch the intro video instead, or skip and come back to it from Guides.",
  },
  {
    target: nav("/app"),
    title: "Overview",
    body: "Your farm at a glance: the live condition of your houses, temperature, open alerts and hatch results.",
  },
  {
    target: nav("/app/houses"),
    title: "Houses",
    body: "Each poultry house with its birds and latest readings. Add the date the chicks arrived so the AI knows how old they are.",
  },
  {
    target: nav("/app/health"),
    title: "Flock health",
    body: "The incubator & brooder unit’s AI rates conditions Healthy, Warning or Critical, and says why.",
  },
  {
    target: nav("/app/alerts"),
    title: "Alerts",
    body: "Problems show up here: heat, gas, dirty drinking water, a lamp cut off for safety. Resolve them once they’re fixed.",
  },
  {
    target: nav("/app/automation"),
    title: "Automation",
    body: "Run the coop from your phone: switch each zone’s fan and heat lamp, or leave it on Auto with your own temperatures. The brooder fan is here too.",
  },
  {
    target: nav("/app/hatchery"),
    title: "Hatchery",
    body: "Track incubator batches: how many eggs, the hatch date and how many hatched.",
  },
  {
    target: nav("/app/devices"),
    title: "Devices",
    body: "Register your two units here, the incubator & brooder (Raspberry Pi) and the coop (ESP32), plus your camera.",
  },
  {
    target: nav("/app/market"),
    title: "Marketplace",
    body: "Sell eggs, birds, chicks and manure, and buy from other farmers. Buyers can call you, WhatsApp you or send a message.",
  },
  {
    target: nav("/app/ai"),
    title: "AI assistant",
    body: "Ask Ama anything about your farm, by typing or talking, in your language.",
  },
  {
    target: ".pg-dock",
    title: "Voice help",
    body: "On every page: Speak to go somewhere or ask a question, Explain to hear what the page shows, and Tap to hear any text read out.",
  },
  {
    target: nav("/app/guides"),
    title: "Guides",
    body: "Short videos in English and Twi on the site and both units. You can replay this tour from there.",
  },
];

export type VideoLang = "en" | "tw";
export const VIDEO_LANG_LABEL: Record<VideoLang, string> = { en: "English", tw: "Twi" };

export interface Guide {
  slug: string;
  title: string;
  description: string;
}

export const GUIDES: Guide[] = [
  {
    slug: "welcome",
    title: "Welcome: a tour of the site",
    description: "Every tab in about a minute. Start here.",
  },
  {
    slug: "brooder",
    title: "Unit 1: the incubator & brooder",
    description:
      "What the Raspberry Pi unit measures, what its AI tells you, and how to set it up.",
  },
  {
    slug: "coop",
    title: "Unit 2: the coop",
    description:
      "The layers and broilers zones, fans, heat lamps, the water sensor and the LCD screen.",
  },
  {
    slug: "controls",
    title: "Running the coop from your phone",
    description: "Auto and Manual, switching fans and lamps, and changing the temperatures.",
  },
  {
    slug: "alerts",
    title: "Flock health and alerts",
    description: "Healthy, Warning and Critical: what they mean and what to do.",
  },
  {
    slug: "market",
    title: "Selling and buying on the marketplace",
    description: "Post a listing with photos, answer buyers and mark it sold.",
  },
];

export const guideVideo = (slug: string, lang: VideoLang) => `/guides/${slug}-${lang}.mp4`;
export const guidePoster = (slug: string, lang: VideoLang) => `/guides/${slug}-${lang}.jpg`;
