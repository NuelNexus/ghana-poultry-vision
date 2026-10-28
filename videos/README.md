# Guide videos

Six short guides, each in English and Twi, made with
[HyperFrames](https://github.com/heygen-com/hyperframes) (HTML compositions rendered to MP4).
They play on the **Guides** page and in the first-login tour.

| Guide | Shows |
|-|-|
| `welcome` | Every tab, the voice help, the first-login tour |
| `brooder` | Unit 1: the incubator & brooder (Raspberry Pi): sensors, AI, fan, setup |
| `coop` | Unit 2: the coop (ESP32): zones, fans, heat lamps, water sensor, the LCD screens |
| `controls` | Running the coop from Automation, on a computer and a phone |
| `alerts` | Flock health colours, causes, alerts |
| `market` | Selling and buying on the marketplace |

## Files

| Path | What it is |
|-|-|
| `guides.mjs` | What each video says and shows, in English and Twi. Edit this. |
| `build.mjs` | Turns each guide into a HyperFrames project per language and renders it |
| `shots/` | Real screenshots of the app (1920×1080) and `rects.json`, the boxes the camera moves to |
| `vendor/gsap-3.14.2.min.js` | GSAP from npm, copied into each project so renders never fetch from a CDN |
| `build/` | Generated projects (gitignored) |
| `../public/guides/` | Rendered `<slug>-<lang>.mp4` and poster `.jpg` files the site serves |

## Rebuild

```bash
npx --yes hyperframes@0.8.210 browser ensure   # once: the Chrome used for rendering
node videos/build.mjs                          # all 12 videos (about 30 minutes)
node videos/build.mjs coop tw                  # one guide, one language
node videos/build.mjs --no-render              # projects only; open one with
npx --yes hyperframes@0.8.210 preview videos/build/coop-en
```

Each project passes `hyperframes check`. The videos are 1920×1080, 30 fps, about 1–2 MB each.

## Retaking screenshots

The screenshots come from the app with a simulated coop and Pi reporting (the emulator in
`firmware/coop_unit/emulator.py` and `python edge/agent.py --simulate`). If the UI changes,
retake them at a 1920×1080 viewport and update `rects.json` with the bounding boxes of the
elements the guides point at (the keys used in `guides.mjs`).

## Language and sound

- Captions are baked into the video, so there are two files per guide. People using the site
  in Twi get the Twi videos; every other language gets English for now.
- The screenshots show the English interface; people who use the site in Twi see it translated.
- The Twi captions were written for these videos and **should be checked by a native speaker**.
  Fix a line in `guides.mjs` and re-render that guide.
- The videos are silent. There was no music source when they were made: a voiceover or music
  bed needs a HeyGen sign-in (`npx hyperframes media-use resolve --doctor`) or your own track.
