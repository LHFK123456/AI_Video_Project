# -*- coding: utf-8 -*-
"""终校 2：第9句起点、第14/15句交界、第16句起点、第19句起点。"""
import sys
import numpy as np
import librosa
import whisper

SRC, MODEL = sys.argv[1], sys.argv[2]
audio, _ = librosa.load(SRC, sr=16000, mono=True)
model = whisper.load_model(MODEL)

CASES = [
    ("L9 Half full", "Half full of fantasies", 23.10, 25.30),
    ("L14-L15", "why do we live like we are a dying breed", 38.95, 42.85),
    ("L16 起点", "Most of us just keep starving for attention", 41.90, 43.60),
    ("L19 起点", "Happiness will come unexpected", 49.30, 50.90),
]

for label, prompt, a, b in CASES:
    seg = audio[int(a * 16000): int(b * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language="en",
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