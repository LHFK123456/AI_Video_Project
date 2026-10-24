# -*- coding: utf-8 -*-
"""终校：第5句起点、第9/10句边界。"""
import sys
import numpy as np
import librosa
import whisper

SRC, MODEL = sys.argv[1], sys.argv[2]
audio, _ = librosa.load(SRC, sr=16000, mono=True)
model = whisper.load_model(MODEL)

CASES = [
    ("L5 起点", "Live and learn or learn to live", "en", 12.55, 15.35),
    ("L9 区间", "Half full of fantasies", "en", 22.80, 27.60),
    ("L10 区间", "Half empty broken dreams", "en", 27.60, 31.80),
    ("L13 和声", "Far from dream, why do we live like", "en", 37.70, 39.60),
]

for label, prompt, lang, a, b in CASES:
    seg = audio[int(a * 16000): int(b * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language=lang,
        initial_prompt=prompt, condition_on_previous_text=False,
        temperature=0.0, no_speech_threshold=0.95, logprob_threshold=-3.0,
        compression_ratio_threshold=5.0, beam_size=5,
    )
    print(f"\n════ {label}  {a:.2f}→{b:.2f}")
    print(f"     「{r['text'].strip()}」")
    seen = set()
    for s in r["segments"]:
        for w in s.get("words", []):
            t = w["word"].strip()
            if not t or w.get("probability", 0) < 0.02:
                continue
            k = (t, round(w["start"] + a, 1))
            if k in seen:
                continue
            seen.add(k)
            print(f"      {w['start']+a:7.2f} {w['end']+a:7.2f} ({w.get('probability',0):.2f}) {t}")