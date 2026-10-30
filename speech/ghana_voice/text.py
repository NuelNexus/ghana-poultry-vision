"""Text -> what a Ghana Voice model can say.

The voices only know the letters of their language: digits, symbols and letters
they never saw are dropped silently by the tokenizer. Ama's replies are full of
readings ("28.2°C", "65%"), and Ghanaians say numbers in English inside Twi, Ewe
or Dagbani anyway, so numbers (with their unit) are cut out and spoken by the
English voice. Everything else goes to the language's own voice.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable

MAX_CHARS = 2000

_UNITS = {
    "°c": "degrees", "℃": "degrees", "°": "degrees", "%": "percent",
    "ppm": "p p m", "rpm": "r p m", "kg": "kilos", "g": "grams", "ghs": "cedis", "gh₵": "cedis",
}
# A number, optionally with a unit after it. "GH₵ 20" is handled as a prefix.
_NUM = re.compile(
    r"(?:(gh₵|ghs)\s*)?(\d+(?:[.,]\d+)?)\s*(°\s*c\b|℃|°|%|ppm\b|rpm\b|kg\b|g\b)?",
    re.IGNORECASE,
)
_SENTENCE_END = re.compile(r"(?<=[.!?;:])\s+|\n+")

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def _int_words(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    if n < 1000:
        rest = n % 100
        return _ONES[n // 100] + " hundred" + ("" if rest == 0 else " and " + _int_words(rest))
    for size, word in ((10**9, "billion"), (10**6, "million"), (1000, "thousand")):
        if n >= size:
            rest = n % size
            head = _int_words(n // size) + " " + word
            if rest == 0:
                return head
            return head + (" and " if rest < 100 else " ") + _int_words(rest)
    raise ValueError(n)


def number_words(num: str) -> str:
    """'28.2' -> 'twenty eight point two', '1,500' read as one thousand five hundred."""
    num = num.strip()
    if re.fullmatch(r"\d{1,3}(,\d{3})+", num):
        num = num.replace(",", "")
    num = num.replace(",", ".")
    whole, _, frac = num.partition(".")
    if len(whole) > 12:  # a phone number or an id: digit by digit
        return " ".join(_ONES[int(d)] for d in num if d.isdigit())
    words = _int_words(int(whole))
    if frac:
        words += " point " + " ".join(_ONES[int(d)] for d in frac)
    return words


def clean(text: str) -> str:
    """Markdown and list markers out, one space between words, Unicode in composed form."""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    text = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", text, flags=re.M)  # list markers
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()[:MAX_CHARS]


def segments(text: str) -> list[tuple[str, str]]:
    """Split into ('native', text) and ('en', words) parts, in order."""
    out: list[tuple[str, str]] = []
    pos = 0
    for m in _NUM.finditer(text):
        if m.start() > pos:
            out.append(("native", text[pos : m.start()]))
        currency, num, unit = m.groups()
        words = number_words(num)
        if unit:
            words += " " + _UNITS[re.sub(r"\s", "", unit.lower())]
        if currency:
            words += " cedis"
        out.append(("en", words))
        pos = m.end()
    if pos < len(text):
        out.append(("native", text[pos:]))
    # Drop parts with nothing to say (only spaces or punctuation).
    return [(kind, s.strip()) for kind, s in out if re.search(r"\w", s)]


def sentences(text: str) -> list[str]:
    """Long text is spoken a sentence at a time: VITS gets mumbly on long inputs."""
    return [s.strip() for s in _SENTENCE_END.split(text) if s and s.strip()]


def fit_to_vocab(text: str, vocab: Iterable[str], lookalikes: dict[str, str] | None = None) -> str:
    """Rewrite text with only letters the model knows.

    Lower-case first (MMS vocabularies are lower case). Then for each letter: the
    letter itself, else the language's look-alike (Dagbani ɔ -> ↄ for the Mampruli
    base), else the letter without its accent (à -> a), else dropped. Spaces survive.
    """
    known = set(vocab)
    lookalikes = lookalikes or {}
    out = []
    for ch in unicodedata.normalize("NFC", text.lower()):
        if ch not in known:
            ch = lookalikes.get(ch, ch)
        if ch in known or ch == " ":
            out.append(ch)
            continue
        parts = unicodedata.normalize("NFD", ch)
        kept = "".join(p for p in parts if p in known)
        if kept and not unicodedata.combining(kept[0]):
            out.append(unicodedata.normalize("NFC", kept))
        elif ch in "\n\t":
            out.append(" ")
    return re.sub(r"\s+", " ", "".join(out)).strip()
