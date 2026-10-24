# -*- coding: utf-8 -*-
"""
Whisper 分段词级识别：用已知歌词作 prompt 抑制幻觉，逐段切窗识别。
输出每个词的起止时间，供后续与歌词行做 DP 对齐。

用法:
  python scripts/whisper-align.py assets/enhanced.wav [model.pt]
"""
import sys
import json
import numpy as np
import librosa
import whisper

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/enhanced.wav"
MODEL = sys.argv[2] if len(sys.argv) > 2 else ".models/whisper/base.pt"

# 已知歌词（作为识别提示，显著抑制幻觉）
KNOWN = (
    "Some build it up so they can break it down. "
    "Some stay the same and never miss a thing. "
    "Too much and not enough, keep searching. "
    "Live and learn or learn to live. "
    "Live it up or die trying. "
    "Start and end, can't be picky. "
    "Half full of fantasies. "
    "Half empty broken dreams. "
    "Read between the lines. "
    "Flawless is all it seems. "
    "Far from dream. "
    "Why do we live like we are a dying breed? "
    "Most of us just keep starving for attention. "
    "We are what we see. "
    "If all of us believe in living perfect. "
    "Happiness will come unexpected. "
    "Don't let someone else take it for granted. "
    "Won't know what you've got until it's all gone and away. "
    "Life is not so bad, you gotta live it up."
)

print(f"加载音频 {SRC}")
audio, _ = librosa.load(SRC, sr=16000, mono=True)
audio = audio.astype(np.float32)
DUR = len(audio) / 16000
print(f"  时长 {DUR:.2f}s")

print(f"加载模型 {MODEL}")
model = whisper.load_model(MODEL)
print("开始识别…")

# 分段识别：每段 8 秒、重叠 1 秒，避免长上下文幻觉跑飞
SEG = 8.0
OVERLAP = 1.0
step = SEG - OVERLAP

all_words = []
t0 = 0.0
idx = 0
while t0 < DUR - 0.4:
    t1 = min(DUR, t0 + SEG)
    seg_audio = audio[int(t0 * 16000): int(t1 * 16000)]
    if len(seg_audio) < 16000 * 0.5:
        break
    idx += 1
    try:
        r = model.transcribe(
            seg_audio,
            word_timestamps=True,
            verbose=False,
            language="en",
            initial_prompt=KNOWN,
            condition_on_previous_text=False,
            temperature=0.0,
            no_speech_threshold=0.6,
            logprob_threshold=-1.0,
        )
    except Exception as e:
        print(f"  段{idx} 失败: {e}")
        t0 += step
        continue

    ws = []
    for s in r["segments"]:
        for w in s.get("words", []):
            word = w["word"].strip()
            if not word:
                continue
            # 只保留落在非重叠区（或第一段）的词，避免重复
            ws.append({
                "w": word,
                "s": round(w["start"] + t0, 3),
                "e": round(w["end"] + t0, 3),
                "p": round(w.get("probability", 0), 3),
            })
    all_words.extend(ws)
    txt = r["text"].strip()
    print(f"  段{idx} [{t0:.1f}-{t1:.1f}] {len(ws)}词  {txt[:70]}")
    t0 += step

# 去重（按时间重叠 + 相同词）
all_words.sort(key=lambda x: x["s"])
dedup = []
for w in all_words:
    dup = False
    for pr in dedup[-6:]:
        if abs(pr["s"] - w["s"]) < 0.28 and pr["w"].lower() == w["w"].lower():
            dup = True
            break
    if not dup:
        dedup.append(w)

print(f"\n总词数 {len(all_words)} → 去重后 {len(dedup)}")
print("\n=== 逐词时间戳 ===")
for w in dedup:
    print(f"{w['s']:7.2f} → {w['e']:7.2f}  ({w['p']:.2f})  {w['w']}")

with open("scripts/.whisper-aligned.json", "w", encoding="utf-8") as f:
    json.dump({"dur": DUR, "model": MODEL, "words": dedup}, f, ensure_ascii=False, indent=1)
print("\n已存 scripts/.whisper-aligned.json")