"""Text rules for Ghana Voice. No models needed: python -m unittest discover speech/tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ghana_voice import languages  # noqa: E402
from ghana_voice.text import clean, fit_to_vocab, number_words, segments, sentences  # noqa: E402
from prepare_data import audio_ext, usable_text  # noqa: E402

AKA = set(" '-23_abdefghiklmnoprstuwyáɔɛʼ")  # facebook/mms-tts-aka
MAW = set(" '-abdefghiklmnoprstuvwyz|ŋɛԑↄ")  # facebook/mms-tts-maw


class Numbers(unittest.TestCase):
    def test_words(self):
        self.assertEqual(number_words("28"), "twenty eight")
        self.assertEqual(number_words("28.2"), "twenty eight point two")
        self.assertEqual(number_words("28,5"), "twenty eight point five")
        self.assertEqual(number_words("1,500"), "one thousand five hundred")
        self.assertEqual(number_words("105"), "one hundred and five")
        self.assertEqual(number_words("2005"), "two thousand and five")
        self.assertEqual(number_words("0"), "zero")
        self.assertEqual(number_words("0244123456789"), "zero two four four one two three four five six seven eight nine")

    def test_segments_in_english(self):
        self.assertEqual(
            segments("Ɛhɔ yɛ 28.2°C ne 65% nnɛ."),
            [("native", "Ɛhɔ yɛ"), ("en", "twenty eight point two degrees"), ("native", "ne"),
             ("en", "sixty five percent"), ("native", "nnɛ.")],
        )
        self.assertEqual(segments("GH₵ 20 pɛ"), [("en", "twenty cedis"), ("native", "pɛ")])
        self.assertEqual(segments("Nkokɔ 5 goats"), [("native", "Nkokɔ"), ("en", "five"), ("native", "goats")])
        self.assertEqual(segments("..."), [])


class Cleaning(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(clean("- **Bue** mframa no\n- see https://x.y/z now"), "Bue mframa no\nsee now")

    def test_sentences(self):
        self.assertEqual(sentences("Akwaaba! Wo ho te sɛn?\nMe ho yɛ"), ["Akwaaba!", "Wo ho te sɛn?", "Me ho yɛ"])

    def test_fit_twi(self):
        # Upper case, tone marks the model lacks, and punctuation the model never saw.
        self.assertEqual(fit_to_vocab("Ɔkɔ̀ fiè, ɛnnɛ!", AKA), "ɔkɔ fie ɛnnɛ")

    def test_fit_dagbani_on_mampruli(self):
        lang = languages.get("dag")
        # ɔ is missing from the Mampruli model, so it becomes the look-alike ↄ; ɛ is known and stays.
        self.assertEqual(fit_to_vocab("Ŋɔ ɛ", MAW, lang.lookalikes), "ŋↄ ɛ")
        # ʒ is unknown until make_base.py adds it: dropped rather than mis-spoken.
        self.assertEqual(fit_to_vocab("ʒi", MAW, lang.lookalikes), "i")
        self.assertEqual(fit_to_vocab("ʒi", MAW | {"ʒ"}, lang.lookalikes), "ʒi")


class DataPrep(unittest.TestCase):
    def test_usable_text(self):
        self.assertIsNone(usable_text("1 KRONIKA 10."))
        self.assertIsNone(usable_text(" ... "))
        self.assertEqual(usable_text("Saul  wu eɖokui. "), "Saul wu eɖokui.")

    def test_audio_ext(self):
        self.assertEqual(audio_ext(b"RIFF...."), ".wav")
        self.assertEqual(audio_ext(b"fLaC...."), ".flac")
        self.assertEqual(audio_ext(b"ID3....."), ".mp3")


class Languages(unittest.TestCase):
    def test_app_languages_present(self):
        # Every Ghanaian language the app offers (src/lib/ai-languages.ts) has an entry.
        for code in ("tw", "ga", "ee", "dag", "ha"):
            self.assertIn(code, languages.LANGS)

    def test_open_data_or_own(self):
        for l in languages.LANGS.values():
            self.assertIn(l.status, {"ready", "approx", "train"})
            if l.status != "train":
                self.assertTrue(l.dataset_config, l.code)


if __name__ == "__main__":
    unittest.main()
