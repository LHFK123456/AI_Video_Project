# -*- coding: utf-8 -*-
"""
定点转写：对给定时间窗做高分辨率识别（前后各补 0.3s 上下文）。
用法: python scripts/transcribe-window.py <wav> <model> <from> <to> [from2 to2 ...]
"""
import sys
import numpy as np
import librosa
import whisper

SRC = sys.argv[1]
MODEL = sys.argv[2]
pairs = sys.argv[3:]

P = ("Some build it up so they can break it down. Some stay the same and never miss a thing. "
     "Too much and not enough. Live and learn or learn to live. Live it up or die trying. "
     "Start and end. Half full of fantasies. Half empty broken dreams. Read between the lines. "
     "Flawless is all it seems. Far from dream. why do we live like we are a dying breed? "
     "Most of us just keep starving for attention. We are what we see. "
     "If all of us believe in living perfect. Happiness will come unexpected. "
     "Don't let someone else take it for granted. "
     "Won't know what you've got until it's all gone and away. Life is not so bad you gotta live it up.")

audio, _ = librosa.load(SRC, sr=16000, mono=True)
DUR = len(audio) / 16000
print(f"音频 {DUR:.2f}s  模型 {MODEL}")
model = whisper.load_model(MODEL)

for i in range(0, len(pairs), 2):
    a = max(0.0, float(pairs[i]) - 0.35)
    b = min(DUR, float(pairs[i + 1]) + 0.35)
    seg = audio[int(a * 16000): int(b * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language="en",
        initial_prompt=P, condition_on_previous_text=False,
        temperature=0.0, no_speech_threshold=0.7, logprob_threshold=-1.5,
    )
    print(f"\n===== 窗口 {a+0.35:.2f} → {b-0.35:.2f}s =====")
    print("文本:", r["text"].strip())
    for s in r["segments"]:
        for w in s.get("words", []):
            print(f"  {w['start']+a:7.2f} {w['end']+a:7.2f} ({w.get('probability',0):.2f}) {w['word'].strip()}")