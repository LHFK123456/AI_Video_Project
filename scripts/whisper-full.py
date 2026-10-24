# -*- coding: utf-8 -*-
"""整段识别（small），输出连续文本与词级时间，用于判定全局结构。"""
import sys
import json
import numpy as np
import librosa
import whisper

SRC = sys.argv[1]
MODEL = sys.argv[2]

audio, _ = librosa.load(SRC, sr=16000, mono=True)
print(f"音频 {len(audio)/16000:.2f}s  模型 {MODEL}")
model = whisper.load_model(MODEL)

r = model.transcribe(
    audio, word_timestamps=True, verbose=False, language="en",
    condition_on_previous_text=False, temperature=0.0,
    no_speech_threshold=0.6, logprob_threshold=-1.0,
)

print("\n=== 分段 ===")
for s in r["segments"]:
    print(f"[{s['start']:6.2f}-{s['end']:6.2f}] {s['text'].strip()}")

words = []
for s in r["segments"]:
    for w in s.get("words", []):
        t = w["word"].strip()
        if t:
            words.append({"w": t, "s": round(w["start"], 2), "e": round(w["end"], 2),
                          "p": round(w.get("probability", 0), 2)})

# 去连续重复（幻觉）
clean = []
for w in words:
    if len(clean) >= 3 and all(x["w"].lower() == w["w"].lower() for x in clean[-3:]):
        continue
    clean.append(w)

print(f"\n=== 词级（去重复后 {len(clean)}）===")
for w in clean:
    print(f"{w['s']:7.2f} {w['e']:7.2f} ({w['p']:.2f}) {w['w']}")

with open("scripts/.whisper-small-full.json", "w", encoding="utf-8") as f:
    json.dump({"text": r["text"], "words": clean,
               "segments": [{"s": s["start"], "e": s["end"], "t": s["text"].strip()} for s in r["segments"]]},
              f, ensure_ascii=False, indent=1)