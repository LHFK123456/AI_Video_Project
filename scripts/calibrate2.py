# -*- coding: utf-8 -*-
"""最后两处歧义区间的精细校准：10-14s（日语/英语交界）与 51-56s（副歌尾）。"""
import sys
import numpy as np
import librosa
import whisper

SRC, MODEL = sys.argv[1], sys.argv[2]
audio, _ = librosa.load(SRC, sr=16000, mono=True)
DUR = len(audio) / 16000
model = whisper.load_model(MODEL)

CASES = [
    ("A 10-14s 交界", "探し続けてるばかり Live and learn or learn to live", "ja", 9.8, 15.2),
    ("B 9.8-13.0 英文", "keep searching. Live and learn or learn to live.", "en", 9.8, 13.2),
    ("C 51-56s 副歌尾", "Don't let someone else take it for granted. Won't know what you've got until it's all gone and away.", "en", 51.2, 56.2),
]

for label, prompt, lang, a, b in CASES:
    a2, b2 = max(0, a), min(DUR, b)
    seg = audio[int(a2 * 16000): int(b2 * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language=lang,
        initial_prompt=prompt, condition_on_previous_text=False,
        temperature=0.0, no_speech_threshold=0.95, logprob_threshold=-2.5,
        compression_ratio_threshold=4.0, beam_size=5,
    )
    print(f"\n════ {label}  {a:.2f}→{b:.2f}")
    print(f"     「{r['text'].strip()}」")
    seen = set()
    for s in r["segments"]:
        for w in s.get("words", []):
            t = w["word"].strip()
            if not t or w.get("probability", 0) < 0.02:
                continue
            k = (t, round(w["start"] + a2, 1))
            if k in seen:
                continue
            seen.add(k)
            print(f"      {w['start']+a2:7.2f} {w['end']+a2:7.2f} ({w.get('probability',0):.2f}) {t}")