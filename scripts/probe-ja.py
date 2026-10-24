# -*- coding: utf-8 -*-
"""日语段落定点识别（language=ja）。"""
import sys
import numpy as np
import librosa
import whisper

SRC, MODEL = sys.argv[1], sys.argv[2]
audio, _ = librosa.load(SRC, sr=16000, mono=True)
DUR = len(audio) / 16000
model = whisper.load_model(MODEL)
print(f"音频 {DUR:.2f}s\n")

WINDOWS = [
    ("過剰と不足の間を 探し続けてるばかり", 8.1, 11.7),
    ("スタートとエンドに こだわりはできやしない", 16.1, 21.9),
]

for prompt, a, b in WINDOWS:
    a2, b2 = max(0, a - 0.2), min(DUR, b + 0.2)
    seg = audio[int(a2 * 16000): int(b2 * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language="ja",
        initial_prompt=prompt, condition_on_previous_text=False,
        temperature=0.0, no_speech_threshold=0.9, logprob_threshold=-2.5,
        beam_size=5,
    )
    print(f"──── {a:.1f}→{b:.1f}s")
    print(f"     文本: {r['text'].strip()}")
    seen = set()
    for s in r["segments"]:
        for w in s.get("words", []):
            t = w["word"].strip()
            if not t or w.get("probability", 0) < 0.03:
                continue
            k = (t, round(w["start"] + a2, 1))
            if k in seen:
                continue
            seen.add(k)
            print(f"       {w['start']+a2:7.2f} {w['end']+a2:7.2f} ({w.get('probability',0):.2f}) {t}")
    print()