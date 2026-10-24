# -*- coding: utf-8 -*-
"""
带自定义 prompt 的定点探测。
用法: python scripts/probe.py <wav> <model> <prompt> <a> <b> [<prompt2> <a2> <b2> ...]
"""
import sys
import numpy as np
import librosa
import whisper

SRC, MODEL = sys.argv[1], sys.argv[2]
rest = sys.argv[3:]

audio, _ = librosa.load(SRC, sr=16000, mono=True)
DUR = len(audio) / 16000
model = whisper.load_model(MODEL)
print(f"音频 {DUR:.2f}s  模型 {MODEL}\n")

for i in range(0, len(rest), 3):
    prompt, a, b = rest[i], float(rest[i + 1]), float(rest[i + 2])
    a2, b2 = max(0.0, a - 0.2), min(DUR, b + 0.2)
    seg = audio[int(a2 * 16000): int(b2 * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language="en",
        initial_prompt=prompt, condition_on_previous_text=False,
        temperature=0.0, no_speech_threshold=0.95,
        logprob_threshold=-2.5, compression_ratio_threshold=4.0,
        beam_size=5,
    )
    print(f"──── 窗口 {a:.2f}→{b:.2f}s  prompt=「{prompt[:40]}」")
    print(f"     听到: 「{r['text'].strip()[:100]}」")
    seen = set()
    for s in r["segments"]:
        for w in s.get("words", []):
            t = w["word"].strip()
            if not t or w.get("probability", 0) < 0.03:
                continue
            key = (t.lower(), round(w["start"] + a2, 1))
            if key in seen:
                continue
            seen.add(key)
            print(f"       {w['start']+a2:7.2f} {w['end']+a2:7.2f} ({w.get('probability',0):.2f}) {t}")
    print()