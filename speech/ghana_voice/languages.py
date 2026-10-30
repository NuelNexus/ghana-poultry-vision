"""The Ghanaian languages Ghana Voice can speak, and where each voice starts from.

Every voice is a VITS model (about 36 M parameters, 16 kHz). It starts from one of
Meta's MMS-TTS checkpoints and is fine-tuned on read speech from GhanaNLP's open
`ghananlpcommunity/ghana-speech` dataset (or on your own recordings, for Ga).

status:
  ready   MMS already has a voice for this exact language. Works before any training;
          fine-tuning makes it clearer.
  approx  No MMS voice for the language, so the server would borrow a close relative's
          voice (Mampruli for Dagbani, Akan for Fante). Understandable but accented;
          off unless trained, or turned on with GHANA_VOICE_LANGS.
  train   Needs fine-tuning on your own data before it can speak (Ga: no open data).
"""

from __future__ import annotations

from dataclasses import dataclass, field

DATASET = "ghananlpcommunity/ghana-speech"


@dataclass(frozen=True)
class Lang:
    code: str  # code the app and server use (src/lib/ai-languages.ts)
    name: str
    base: str  # MMS ISO 639-3 code of the starting checkpoint (facebook/mms-tts-<base>)
    status: str  # ready | approx | train
    dataset_config: str | None  # config of ghana-speech, None when there's no open data
    sample: str  # sentence spoken after training and in tests
    # Letters the base model writes differently. Applied before tokenising, so text in
    # the usual spelling reaches the model in the spelling it learned.
    lookalikes: dict[str, str] = field(default_factory=dict)
    # Letters the base model never saw, and the known letter whose sound is closest.
    # make_base.py adds them to the vocabulary, starting from that letter's embedding.
    new_letters: dict[str, str] = field(default_factory=dict)

    @property
    def base_model(self) -> str:
        return f"facebook/mms-tts-{self.base}"


LANGS: dict[str, Lang] = {
    l.code: l
    for l in [
        Lang(
            "tw", "Twi (Asante)", "aka", "ready", "Asante_Twi_twi",
            "Akwaaba. Wo ho te sɛn? Nkokɔ no ho yɛ hyew nnɛ.",
        ),
        Lang(
            "ak", "Twi (Akuapem)", "aka", "ready", "Akuapem_Twi_twi",
            "Akwaaba. Wo ho te sɛn?",
        ),
        Lang(
            "fat", "Fante", "aka", "approx", "Fante_fat",
            "Akwaaba. Wo ho tse dɛn?",
        ),
        Lang(
            "ee", "Ewe", "ewe", "ready", "Ewe_ewe",
            "Woezɔ! Èfɔ̃ nyuie a?",
        ),
        Lang(
            "ha", "Hausa", "hau", "ready", "Hausa_hau",
            "Sannu da zuwa. Kaji suna jin zafi yau.",
        ),
        Lang(
            "dag", "Dagbani", "maw", "approx", "Dagbani_dag",
            "Dasiba. Naawuni ni ti a alaafee.",
            # The Mampruli model learned ɔ and ɛ as the look-alike letters ↄ and ԑ.
            lookalikes={"ɔ": "ↄ", "ɛ": "ԑ"},
            new_letters={"ɣ": "g", "ʒ": "z", "c": "k", "j": "y"},
        ),
        Lang(
            "ga", "Ga", "ewe", "train", None,
            "Ojekoo! Te oyɔɔ tɛŋŋ?",
        ),
        # Other Ghanaian languages that MMS already speaks. Inference only out of the box;
        # each also has a ghana-speech config, so they can be fine-tuned the same way.
        Lang("gjn", "Gonja", "gjn", "ready", "Gonja_gjn", "Kabe ɛsheŋ."),
        Lang("xsm", "Kasem", "xsm", "ready", "Kasem_xsm", "Kasena kam."),
        Lang("kus", "Kusaal", "kus", "ready", "Kusaal_kus", "Kusaal."),
        Lang("nzi", "Nzema", "nzi", "ready", "Nzema_nzi", "Nzema."),
        Lang("dga", "Dagaare", "dga", "ready", "Dagaare_dga", "Dagaare."),
        Lang("maw", "Mampruli", "maw", "ready", "Mampruli_maw", "Mampruli."),
        Lang("xon", "Konkomba", "xon", "ready", "Konkomba_xon", "Likpakpaln."),
        Lang("sil", "Sisaala", "sil", "ready", "Sisaala_Tumulung_sil", "Sisaala."),
        Lang("vag", "Vagla", "vag", "ready", "Vagla_vag", "Vagla."),
        Lang("bim", "Bimoba", "bim", "ready", "Bimoba_bim", "Bimoba."),
        Lang("lef", "Lelemi", "lef", "ready", "Lelemi_lef", "Lelemi."),
        Lang("mzw", "Deg", "mzw", "ready", "Deg_mzw", "Deg."),
        Lang("akp", "Siwu", "akp", "ready", "Siwu_akp", "Siwu."),
        Lang("kbp", "Kabiye", "kbp", "ready", "Kabiye_kbp", "Kabɩyɛ."),
    ]
}

ENGLISH_MODEL = "facebook/mms-tts-eng"


def get(code: str) -> Lang:
    try:
        return LANGS[code]
    except KeyError:
        raise SystemExit(f"Unknown language {code!r}. Choose one of: {', '.join(LANGS)}") from None
