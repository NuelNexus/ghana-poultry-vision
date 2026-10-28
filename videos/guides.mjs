// What the six guide videos say and show, in English and Twi.
// `node videos/build.mjs` turns each guide into a HyperFrames project per
// language and renders it to public/guides/<slug>-<lang>.mp4.
//
// Scenes:
//   title   { title, sub }                      brand card
//   shot    { img, beats: [{ focus, zoom?, text }] }
//            a real screenshot from videos/shots; focus is a key in
//            shots/rects.json, several keys (their union), or {x,y,w,h}; the camera moves to it and
//            outlines it while the caption shows
//   brooder / coop { beats: [{ part, text }] }  drawn unit diagrams
//   lcd     { beats: [{ screen, text }] }       the coop's 16x2 LCD (screens
//            copied from firmware/coop_unit/coop_unit.ino)
//   phone   { img, beats: [{ text }] }          a phone screenshot in a frame
//   end     { text }                            closing line
//
// Twi: Asante Twi, written for these videos. Have a native speaker check it
// before relying on it.

export const GUIDES = [
  {
    slug: "welcome",
    kicker: { en: "Guide 1", tw: "Akwankyerɛ 1" },
    scenes: [
      {
        type: "title",
        title: { en: "Welcome to PoultryGrid", tw: "Akwaaba ba PoultryGrid" },
        sub: { en: "Your farm, on your phone", tw: "Wo afuo, wɔ wo fon so" },
      },
      {
        type: "shot",
        img: "overview",
        beats: [
          {
            focus: "sidebar",
            zoom: 1.6,
            text: { en: "Everything is in the menu on the left.", tw: "Biribiara wɔ menu a ɛwɔ benkum so no mu." },
          },
          {
            focus: "main",
            zoom: 1.25,
            text: {
              en: "Overview shows how your houses are doing right now.",
              tw: "Overview kyerɛ sɛdeɛ wo nkokɔ adan te seesei ara.",
            },
          },
          {
            focus: "houses",
            text: { en: "Houses: each house, its birds and readings.", tw: "Houses: dan biara, ne nkokɔ ne ne nsɛm." },
          },
          {
            focus: "health",
            text: {
              en: "Flock health: the AI says Healthy, Warning or Critical.",
              tw: "Flock health: AI no ka sɛ ɛyɛ Healthy, Warning anaa Critical.",
            },
          },
          {
            focus: "alerts",
            text: { en: "Alerts: problems that need you.", tw: "Alerts: ɔhaw a ɛhia wo." },
          },
          {
            focus: "automation",
            text: {
              en: "Automation: run the fans and heat lamps.",
              tw: "Automation: hwɛ fan ne kanea no so.",
            },
          },
          {
            focus: "devices",
            text: { en: "Devices: connect your two units.", tw: "Devices: ka wo nnwinnade mmienu no bom." },
          },
          {
            focus: "market",
            text: {
              en: "Marketplace: sell and buy with other farmers.",
              tw: "Marketplace: tɔn na tɔ firi akuafoɔ foforɔ hɔ.",
            },
          },
          {
            focus: "ai",
            text: { en: "AI assistant: ask Ama anything.", tw: "AI assistant: bisa Ama biribiara." },
          },
          {
            focus: "dock",
            zoom: 1.8,
            text: {
              en: "On every page: Speak, Explain, or tap to hear.",
              tw: "Krataafa biara so: kasa, ma wɔnkyerɛkyerɛ, anaa mia na tie.",
            },
          },
        ],
      },
      {
        type: "shot",
        img: "tour-automation",
        beats: [
          {
            focus: "card",
            zoom: 1.35,
            text: {
              en: "New here? A short tour shows you around.",
              tw: "Woyɛ foforɔ? Akwankyerɛ tiawa bi bɛkyerɛ wo mu.",
            },
          },
        ],
      },
      {
        type: "end",
        text: {
          en: "Watch the other guides to learn each part.",
          tw: "Hwɛ akwankyerɛ a aka no na sua fã biara.",
        },
      },
    ],
  },

  {
    slug: "brooder",
    kicker: { en: "Guide 2", tw: "Akwankyerɛ 2" },
    scenes: [
      {
        type: "title",
        title: { en: "Unit 1: the incubator & brooder", tw: "Adwinnade 1: Incubator ne Brooder" },
        sub: { en: "Keeps the chicks at the right warmth", tw: "Ɛma nkokɔma no nya ɔhyew a ɛfata" },
      },
      {
        type: "brooder",
        beats: [
          { part: "pi", text: { en: "A Raspberry Pi sits in the brooder.", tw: "Raspberry Pi bi wɔ brooder no mu." } },
          {
            part: "dht",
            text: { en: "It measures temperature and humidity,", tw: "Ɛsusu ɔhyew ne nsuo a ɛwɔ mframa mu," },
          },
          {
            part: "gas",
            text: { en: "ammonia gas from the litter,", tw: "ammonia gas a ɛfiri nkokɔ bin mu," },
          },
          { part: "ldr", text: { en: "and light.", tw: "ne hann." } },
          {
            part: "ai",
            text: {
              en: "Every 30 seconds its AI checks the chicks are comfortable for their age.",
              tw: "Sekan aduasa biara, AI no hwɛ sɛ nkokɔma no te yie ma wɔn nna dodoɔ.",
            },
          },
          {
            part: "fan",
            text: { en: "It switches the fan on or off by itself.", tw: "Ɛno ankasa sɔ fan no anaa ɛdum no." },
          },
          {
            part: "site",
            text: { en: "And it sends everything to the site.", tw: "Na ɛde biribiara kɔ site no so." },
          },
        ],
      },
      {
        type: "shot",
        img: "health",
        beats: [
          {
            focus: "status",
            text: {
              en: "Flock health shows Healthy, Warning or Critical, and why.",
              tw: "Flock health kyerɛ Healthy, Warning anaa Critical, ne deɛ ɛmaa no.",
            },
          },
          {
            focus: "chart",
            text: {
              en: "See the temperature against the target for the chicks’ age.",
              tw: "Hwɛ ɔhyew no ne deɛ ɛsɛ ma nkokɔma no nna dodoɔ.",
            },
          },
        ],
      },
      {
        type: "shot",
        img: "houses",
        beats: [
          {
            focus: "add",
            zoom: 1.8,
            text: {
              en: "Set the day the chicks arrived, so the AI knows their age.",
              tw: "Kyerɛw da a nkokɔma no baeɛ, na AI no ahunu wɔn nna dodoɔ.",
            },
          },
        ],
      },
      {
        type: "shot",
        img: "devices",
        beats: [
          {
            focus: "add",
            zoom: 1.7,
            text: {
              en: "Connect it under Devices: register the Pi and copy its settings.",
              tw: "Ka ho wɔ Devices mu: kyerɛw Pi no din na fa ne nhyehyɛeɛ.",
            },
          },
        ],
      },
      {
        type: "end",
        text: {
          en: "The brooder keeps working, even without internet.",
          tw: "Brooder no kɔ so yɛ adwuma, sɛ intanɛt nni hɔ mpo a.",
        },
      },
    ],
  },

  {
    slug: "coop",
    kicker: { en: "Guide 3", tw: "Akwankyerɛ 3" },
    scenes: [
      {
        type: "title",
        title: { en: "Unit 2: the coop", tw: "Adwinnade 2: Nkokɔ dan no" },
        sub: {
          en: "Two zones, fans, heat lamps and clean water",
          tw: "Fã mmienu, fan, kanea a ɛma ɔhyew, ne nsuo pa",
        },
      },
      {
        type: "coop",
        beats: [
          { part: "esp", text: { en: "An ESP32 controller runs the coop.", tw: "ESP32 kɔntrola bi na ɛhwɛ nkokɔ dan no so." } },
          { part: "layers", text: { en: "One zone is for layers,", tw: "Fã baako wɔ hɔ ma nkokɔ a wɔto nkosua," } },
          { part: "broilers", text: { en: "the other for broilers.", tw: "na fã baako nso ma broilers." } },
          {
            part: "kit",
            text: {
              en: "Each zone has a temperature sensor, a fan and a heat lamp.",
              tw: "Fã biara wɔ ɔhyew sensa, fan ne kanea a ɛma ɔhyew.",
            },
          },
          {
            part: "auto",
            text: {
              en: "Too hot: the fan runs. Too cold: the lamp comes on.",
              tw: "Sɛ ɛyɛ hyew dodo a, fan no bɔ. Sɛ ɛyɛ nwini dodo a, kanea no sɔ.",
            },
          },
          { part: "auto", text: { en: "Never both at once.", tw: "Ɛnyɛ mmienu nyinaa bere koro." } },
          {
            part: "water",
            text: { en: "A water sensor checks the drinker.", tw: "Nsuo sensa bi hwɛ nsuo a nkokɔ no nom no." },
          },
          {
            part: "wifi",
            text: {
              en: "It reports to the site every 10 seconds.",
              tw: "Ɛde ne nsɛm kɔ site no so sekan du biara.",
            },
          },
        ],
      },
      {
        type: "lcd",
        beats: [
          { screen: 0, text: { en: "The coop’s screen shows,", tw: "Nkokɔ dan no screen kyerɛ," } },
          { screen: 1, text: { en: "each zone’s temperature, fan and lamp,", tw: "fã biara ɔhyew, ne fan ne ne kanea," } },
          { screen: 2, text: { en: "AUT means Auto, MAN means Manual,", tw: "AUT kyerɛ Auto, MAN kyerɛ Manual," } },
          { screen: 3, text: { en: "the drinking water,", tw: "nsuo a wɔnom no," } },
          {
            screen: 4,
            text: { en: "and whether the site is connected.", tw: "ne sɛ site no ka ho anaa." },
          },
        ],
      },
      {
        type: "shot",
        img: "devices-add",
        beats: [
          {
            focus: "modal",
            zoom: 1.35,
            text: {
              en: "Register it under Devices, then put its settings on the ESP32.",
              tw: "Kyerɛw ne din wɔ Devices mu, na fa ne nhyehyɛeɛ hyɛ ESP32 no mu.",
            },
          },
        ],
      },
      {
        type: "end",
        text: {
          en: "With no internet, it runs on its last settings.",
          tw: "Sɛ intanɛt nni hɔ a, ɛde ne nhyehyɛeɛ a ɛtwa toɔ yɛ adwuma.",
        },
      },
    ],
  },

  {
    slug: "controls",
    kicker: { en: "Guide 4", tw: "Akwankyerɛ 4" },
    scenes: [
      {
        type: "title",
        title: { en: "Running the coop from your phone", tw: "Fa wo fon hwɛ nkokɔ dan no so" },
        sub: { en: "Fans, heat lamps and temperatures", tw: "Fan, kanea ne ɔhyew" },
      },
      {
        type: "shot",
        img: "automation",
        beats: [
          { focus: "coop", zoom: 1.7, text: { en: "Open Automation.", tw: "Bue Automation." } },
          {
            focus: "layers",
            text: {
              en: "Each zone shows its temperature, fan and lamp.",
              tw: "Fã biara kyerɛ ne ɔhyew, ne fan ne ne kanea.",
            },
          },
          {
            focus: "layersMode",
            zoom: 2,
            text: {
              en: "Auto: the coop decides. Manual: you decide.",
              tw: "Auto: nkokɔ dan no ankasa si gyinaeɛ. Manual: wo na wosi gyinaeɛ.",
            },
          },
          {
            focus: "layersFan",
            zoom: 2,
            text: {
              en: "In Manual, switch the fan or lamp on or off.",
              tw: "Wɔ Manual mu, sɔ anaa dum fan anaa kanea no.",
            },
          },
          {
            focus: "broilersInputs",
            text: {
              en: "In Auto, set the temperatures for the fan and lamp.",
              tw: "Wɔ Auto mu, hyɛ ɔhyew a ɛsɛ ma fan ne kanea.",
            },
          },
          {
            focus: "sync",
            zoom: 1.8,
            text: {
              en: "The coop confirms each change in about 10 seconds.",
              tw: "Nkokɔ dan no gye nsakraeɛ biara tom wɔ sekan du bɛyɛ mu.",
            },
          },
        ],
      },
      {
        type: "phone",
        img: "phone-automation",
        beats: [{ text: { en: "It works the same on your phone.", tw: "Ɛyɛ adwuma saa ara wɔ wo fon so." } }],
      },
      {
        type: "shot",
        img: "automation-2",
        beats: [
          {
            focus: "water",
            text: { en: "Set when the water counts as dirty.", tw: "Kyerɛ bere a nsuo no ho nte." },
          },
          {
            focus: "log",
            text: {
              en: "Every change is listed, with who made it.",
              tw: "Wɔkyerɛw nsakraeɛ biara, ne onipa a ɔyɛeɛ.",
            },
          },
          {
            focus: "piMode",
            zoom: 2,
            text: {
              en: "The brooder fan is here too: AI auto, or force it on or off.",
              tw: "Brooder fan no nso wɔ ha: AI auto, anaa hyɛ no ma ɛnsɔ anaa ɛndum.",
            },
          },
        ],
      },
      {
        type: "end",
        text: {
          en: "Safety stays on: a lamp switches off if its zone overheats.",
          tw: "Banbɔ wɔ hɔ daa: sɛ fã bi yɛ hyew dodo a, ne kanea dum.",
        },
      },
    ],
  },

  {
    slug: "alerts",
    kicker: { en: "Guide 5", tw: "Akwankyerɛ 5" },
    scenes: [
      {
        type: "title",
        title: { en: "Flock health and alerts", tw: "Nkokɔ apɔmuden ne kɔkɔbɔ" },
        sub: { en: "What the colours mean, and what to do", tw: "Deɛ kɔla no kyerɛ, ne deɛ ɛsɛ sɛ woyɛ" },
      },
      {
        type: "shot",
        img: "health",
        beats: [
          {
            focus: "statusTitle",
            zoom: 1.5,
            text: {
              en: "Flock health shows what the AI thinks right now.",
              tw: "Flock health kyerɛ deɛ AI no susu seesei ara.",
            },
          },
          {
            focus: "status",
            text: {
              en: "Healthy: all good. Warning: watch it. Critical: act now.",
              tw: "Healthy: biribiara ye. Warning: hwɛ so yie. Critical: yɛ biribi seesei ara.",
            },
          },
          {
            focus: { x: 500, y: 215, w: 900, h: 36 },
            zoom: 1.6,
            text: {
              en: "It tells you the likely cause and what to do.",
              tw: "Ɛka deɛ ebia ɛde ɔhaw no ba, ne deɛ ɛsɛ sɛ woyɛ.",
            },
          },
          {
            focus: "strip",
            zoom: 1.6,
            text: {
              en: "The coloured strip shows how the day went.",
              tw: "Kɔla ahodoɔ no kyerɛ sɛdeɛ da no kɔeɛ.",
            },
          },
        ],
      },
      {
        type: "shot",
        img: "alerts",
        beats: [
          {
            focus: "list",
            zoom: 1.3,
            text: {
              en: "Problems become alerts: heat, gas, dirty water, a lamp cut-out.",
              tw: "Ɔhaw bɛyɛ kɔkɔbɔ: ɔhyew, gas, nsuo a ɛho nte, kanea a ɛdum.",
            },
          },
          {
            focus: "tabs",
            zoom: 1.8,
            text: {
              en: "Most close by themselves once things recover.",
              tw: "Wɔn mu dodoɔ no ara to wɔn ho mu bere a nneɛma asan ayɛ yie.",
            },
          },
        ],
      },
      {
        type: "shot",
        img: "overview",
        beats: [
          {
            focus: "dock",
            zoom: 1.9,
            text: { en: "Not sure? Tap Speak and ask, in your language.", tw: "Wonnim? Mia Speak na bisa, wɔ wo kasa mu." },
          },
        ],
      },
      { type: "end", text: { en: "Check your alerts every day.", tw: "Hwɛ wo kɔkɔbɔ da biara." } },
    ],
  },

  {
    slug: "market",
    kicker: { en: "Guide 6", tw: "Akwankyerɛ 6" },
    scenes: [
      {
        type: "title",
        title: { en: "Selling and buying", tw: "Tɔn na tɔ" },
        sub: { en: "The PoultryGrid marketplace", tw: "PoultryGrid dwa no" },
      },
      {
        type: "shot",
        img: "market",
        beats: [
          {
            focus: "sell",
            zoom: 1.8,
            text: { en: "Open Marketplace and tap Sell something.", tw: "Bue Marketplace na mia Sell something." },
          },
        ],
      },
      {
        type: "shot",
        img: "market-sell",
        beats: [
          { focus: "title", zoom: 1.6, text: { en: "Say what you’re selling,", tw: "Ka deɛ woretɔn," } },
          {
            focus: "price",
            zoom: 1.6,
            text: { en: "the price and how many you have,", tw: "ne boɔ, ne dodoɔ a wowɔ," },
          },
          { focus: "phone", zoom: 1.6, text: { en: "and a phone number for buyers.", tw: "ne fon nɔma ma atɔfoɔ." } },
          { focus: "photos", zoom: 1.8, text: { en: "Add up to four photos.", tw: "Fa mfonin nnan to so." } },
        ],
      },
      {
        type: "shot",
        img: "market",
        beats: [
          {
            focus: "grid",
            zoom: 1.4,
            text: {
              en: "Your listing shows for every farmer on PoultryGrid.",
              tw: "Wo nneɛma no bɛda adi ama okuafoɔ biara a ɔwɔ PoultryGrid so.",
            },
          },
        ],
      },
      {
        type: "shot",
        img: "market-listing",
        beats: [
          {
            focus: ["call", "whatsapp"],
            zoom: 1.8,
            text: { en: "Buyers can call you or WhatsApp you,", tw: "Atɔfoɔ bɛtumi afrɛ wo anaa wɔde WhatsApp akasa," },
          },
          {
            focus: "form",
            zoom: 1.4,
            text: { en: "or send you a message here.", tw: "anaa wɔde nkra abrɛ wo wɔ ha." },
          },
        ],
      },
      {
        type: "shot",
        img: "market-messages",
        beats: [
          {
            focus: "received",
            zoom: 1.4,
            text: { en: "Their messages arrive under Messages.", tw: "Wɔn nkra ba Messages mu." },
          },
        ],
      },
      {
        type: "end",
        text: {
          en: "Sold out? Mark it sold, so buyers know.",
          tw: "Woatɔn awie? Kyerɛ sɛ woatɔn, na atɔfoɔ ahunu.",
        },
      },
    ],
  },
];
