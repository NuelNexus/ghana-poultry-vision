# Ghana Voice

Our own text-to-speech for Ghanaian languages: Twi, Fante, Ewe, Hausa, Dagbani, Ga, and 14 more
Ghanaian languages. It runs on a Raspberry Pi or any PC (no GPU needed to speak), and the app
uses it before paid services (Khaya, OpenAI).

Each voice is a VITS model (36 M parameters, 16 kHz). It starts from one of Meta's
[MMS-TTS](https://huggingface.co/facebook/mms-tts) voices and is fine-tuned on GhanaNLP's open
[`ghana-speech`](https://huggingface.co/datasets/ghananlpcommunity/ghana-speech) recordings
(about 1,400 hours of read speech in 40+ Ghanaian languages).

## Languages

| Code | Language | Out of the box | After training | Open data |
|---|---|---|---|---|
| `tw` | Twi (Asante) | MMS Akan voice | Asante Twi voice | 200 h |
| `ak` | Twi (Akuapem) | MMS Akan voice | Akuapem voice | 63 h |
| `fat` | Fante | off (Akan voice would be accented) | Fante voice | yes |
| `ee` | Ewe | MMS Ewe voice | clearer Ewe voice | yes |
| `ha` | Hausa | MMS Hausa voice | clearer Hausa voice | yes |
| `dag` | Dagbani | off (Mampruli voice would be accented) | Dagbani voice | yes |
| `ga` | Ga | off | Ga voice | **none: record your own** |
| `gjn` `xsm` `kus` `nzi` `dga` `maw` `xon` `sil` `vag` `bim` `lef` `mzw` `akp` `kbp` | Gonja, Kasem, Kusaal, Nzema, Dagaare, Mampruli, Konkomba, Sisaala, Vagla, Bimoba, Lelemi, Deg, Siwu, Kabiye | MMS voice | trainable the same way | yes |

`python serve.py list` prints this table with what this machine will actually serve.

Numbers are spoken in English ("twenty eight point two degrees"), the way Ghanaians say them
inside Twi or Ewe, by the MMS English voice. The language voices never learned digits.

## Speak (any machine)

```bash
cd speech
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python serve.py say "Akwaaba! Ɛhɔ yɛ 28°C nnɛ." --lang tw --out hello.wav
python serve.py serve --host 0.0.0.0 --port 5003      # the app's voice server
```

The first use of a language downloads its voice (about 145 MB) from Hugging Face. Speed on a
Raspberry Pi hasn't been measured yet; the app sends one sentence at a time and falls back to
the next voice after 12 s.

Settings (environment variables):

| Variable | What it does |
|---|---|
| `GHANA_VOICE_MODELS` | Folder with trained voices, one sub-folder per code (`models/ee/`, ...). These replace the MMS voice for that language and switch on `fat`, `dag` and `ga`. |
| `GHANA_VOICE_LANGS` | Comma list of languages to serve, e.g. `tw,ee,dag`. Default: ready ones plus trained ones. |
| `GHANA_VOICE_TOKEN` | Bearer token the server requires. Set it whenever other machines can reach the port. |
| `GHANA_VOICE_ENGLISH` | `0` to skip numbers instead of reading them in English. |
| `GHANA_VOICE_THREADS` | CPU threads (default up to 4). |

### Connect it to PoultryGrid

In the app's `.env`:

```
GHANA_VOICE_URL=http://<pi-or-pc>:5003
GHANA_VOICE_TOKEN=<the same secret>
```

Voice order (`src/lib/voice.server.ts`): Twi tries stable-twi-tts, then Ghana Voice, then Khaya,
then OpenAI. Ga, Ewe, Dagbani and Hausa try Ghana Voice first, then Khaya, then OpenAI. The app
asks the server which languages it has (`GET /health`, once a minute), so a language the server
doesn't speak goes straight to the next voice.

## Train a voice (free GPU)

Open [`train_colab.ipynb`](train_colab.ipynb) in Google Colab with a T4 GPU and run the cells,
or on any Linux machine with an NVIDIA GPU:

```bash
cd speech
bash setup_training.sh                  # installs the training stack and finetune-hf-vits
python prepare_data.py --lang ee --hours 6
python make_base.py --lang ee
python train.py --lang ee               # ~8,000 steps, about 3-4 h on a T4
GHANA_VOICE_MODELS=models python serve.py say "Woezɔ!" --lang ee
```

What each step does:

1. **`prepare_data.py`** streams the language's recordings from `ghana-speech` (only what you
   ask for), keeps 1-15 s clips, skips transcripts with digits (chapter headings) and writes
   `data/<code>/` (clips + `metadata.csv`).
2. **`make_base.py`** turns the MMS voice into a trainable checkpoint (adds the discriminator,
   via [finetune-hf-vits](https://github.com/ylacombe/finetune-hf-vits)) and adds letters the
   language uses but the base voice never saw. Dagbani on the Mampruli voice gets ɣ, ʒ, c and
   j; each starts from the closest sound (ɣ from g, ʒ from z). Mampruli wrote ɔ as the
   look-alike ↄ, so Dagbani text is mapped onto it. Existing letters keep their ids.
3. **`train.py`** writes the training config, fine-tunes, and exports the finished voice to
   `models/<code>/`. Progress, losses and audio samples go to TensorBoard (`runs/`).

### Ga: record your own

There is no open Ga speech dataset yet. One clear speaker reading 1-2 hours (about 1,000
sentences, 2-12 s each) in a quiet room is enough for a usable voice. Put the clips in a folder
with a `metadata.csv`:

```
file_name,text
ga_0001.wav,Ojekoo!
ga_0002.wav,Te oyɔɔ tɛŋŋ?
```

Write numbers as words. Then `python prepare_data.py --lang ga --from-folder my_ga_recordings/`
and continue with `make_base.py` and `train.py` as above. The same works for a custom farm voice
in any language. Ask speakers for written consent to use their voice.

## Tests

```bash
python -m unittest discover -s speech/tests      # text rules, no models needed
```

## Licences

- Code in this folder: MIT, like the rest of PoultryGrid.
- MMS-TTS voices and the `ghana-speech` recordings: **CC BY-NC 4.0, non-commercial use only**.
  A trained voice inherits that. For commercial use, train on recordings you own (as for Ga
  above) starting from a commercially licensed base, or license the data.

## Files

| File | What it does |
|---|---|
| `ghana_voice/languages.py` | The language table: base voice, dataset, look-alike and new letters. |
| `ghana_voice/text.py` | Text clean-up, numbers to English words, fitting text to a voice's letters. |
| `ghana_voice/synth.py` | Loads voices (trained or MMS, up to 4 in memory) and speaks sentence by sentence. |
| `serve.py` | `list`, `say` and the HTTP server (`GET /health`, `POST /synthesize`). |
| `prepare_data.py`, `make_base.py`, `train.py` | The three training steps. |
| `setup_training.sh`, `requirements-train.txt` | Training setup. `requirements.txt` is for speaking only. |
| `train_colab.ipynb` | The whole training flow as a Colab notebook. |
| `tests/test_text.py` | Unit tests for the text rules and data filters. |
