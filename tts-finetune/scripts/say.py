"""Speak test sentences with a voice directory: python say.py voices/nelvin outdir [voice]"""
import sys
from pathlib import Path

from stable_twi_tts import StableTwiTTS
from stable_twi_tts import tts as tts_mod

sys.path.insert(0, str(Path(__file__).parent))
from prep_data import lenient  # same tie-bar fix as the app

_orig = tts_mod.to_ids
tts_mod.to_ids = lambda units, m, lang: _orig([x for x in (lenient(u, m) for u in units) if x], m, lang)

# Unseen sentences (not in the training set), farm-assistant style.
SENTENCES = [
    "Akwaaba! Me din de Ama. Mɛboa wo ama wo nkokɔ ayɛ yie.",
    "Ɛnnɛ nkokɔfie no mu hyeɛ no yɛ kakra, enti bue mpoma no ma mframa nkɔ mu.",
    "Hwɛ sɛ nsuo a ɛwɔ nkokɔ no nsuo nkuruwa mu no ho teɛ.",
    "Sɛ wohunu sɛ akokɔ bi nni aduane a, yi no fi wɔn mu na frɛ dɔkota.",
    "Nkosua dodoɔ a wonyaeɛ ɛnnɛ no yɛ aduasa.",
]

vdir, out = Path(sys.argv[1]), Path(sys.argv[2])
voice = sys.argv[3] if len(sys.argv) > 3 else None
t = StableTwiTTS(vdir)
for i, s in enumerate(SENTENCES, 1):
    r = t.synthesize(s, voice=voice, language="twi")
    r.save(out / f"{i:02d}.wav")
    print(f"{i:02d}.wav {r.duration:.1f}s  {s}")
