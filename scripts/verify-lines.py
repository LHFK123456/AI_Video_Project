# -*- coding: utf-8 -*-
"""
逐句定点识别：把整首歌按已知 22 句的粗略位置切成小窗，
每个窗口只喂该句歌词作 prompt，让模型只在该窗内找这一句。
这样能避免幻觉，并得到每句准确的起止时间。

用法: python scripts/verify-lines.py assets/enhanced.wav .models/whisper/base.pt
"""
import sys
import json
import numpy as np
import librosa
import whisper

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/enhanced.wav"
MODEL = sys.argv[2] if len(sys.argv) > 2 else ".models/whisper/base.pt"

# (序号, 英文歌词, 中文, 粗定位窗口 (a,b))
LINES = [
    (1, "Some build it up so they can break it down", "有的人筑起高楼 为了再全部倾覆", 3.0, 6.4),
    (2, "Some stay the same and never miss a thing", "有的人从未改变 也不会错过什么", 6.2, 8.3),
    (3, "Too much and not enough", "在过剩与不足之间", 8.2, 10.0),
    (4, "keep searching", "不断地寻求着平衡", 9.9, 11.5),
    (5, "Live and learn or learn to live", "活到老学到老 或是学习如何活着", 11.4, 14.8),
    (6, "Live it up or die trying", "坚持活下去 或是死在奋斗的时候", 14.7, 16.7),
    (7, "Start and end", "事物的开始与结束", 16.5, 18.6),
    (8, "can't be picky", "无法局限我的视野", 18.5, 21.8),
    (9, "Half full of fantasies", "一半鼓鼓囊囊 全是幻想", 23.3, 26.6),
    (10, "Half empty broken dreams", "一半空空荡荡 破碎的梦", 26.5, 31.5),
    (11, "Read between the lines", "领悟言外之意", 31.3, 33.8),
    (12, "Flawless is all it seems", "看起来全都是完美无缺的", 33.6, 36.0),
    (13, "Far from dream", "梦想遥不可及", 35.9, 38.6),
    (14, "why do we live like", "我们为何要这样生活", 39.3, 40.7),
    (15, "We are a dying breed", "难道我们是濒临灭绝的物种", 40.6, 42.5),
    (16, "Most of us just keep starving for attention", "我们之中的大多数都渴望得到关注", 42.4, 45.4),
    (17, "We are what we see", "我们就是自己眼中这样", 45.3, 47.4),
    (18, "If all of us believe in living perfect", "如果每一个人都相信自己完美地活着", 47.3, 49.8),
    (19, "Happiness will come unexpected", "幸福会毫无预兆地来到", 49.7, 52.3),
    (20, "Don't let someone else take it for granted", "不要让别人把这视作理所当然", 52.2, 54.5),
    (21, "Won't know what you've got until it's all gone and away", "在全都失去之前 你不会知道自己拥有什么", 54.4, 57.9),
    (22, "Life is not so bad you gotta live it up", "生活没有那么糟糕 你得要坚持下去", 55.5, 58.17),
]

audio, _ = librosa.load(SRC, sr=16000, mono=True)
DUR = len(audio) / 16000
print(f"音频 {DUR:.2f}s")
model = whisper.load_model(MODEL)
print("模型已加载\n")

results = []
for idx, en, zh, a, b in LINES:
    a2 = max(0.0, a - 0.25)
    b2 = min(DUR, b + 0.25)
    seg = audio[int(a2 * 16000): int(b2 * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language="en",
        initial_prompt=en + ".",
        condition_on_previous_text=False,
        temperature=0.0, no_speech_threshold=0.85,
        logprob_threshold=-2.0, compression_ratio_threshold=3.0,
    )
    ws = []
    for s in r["segments"]:
        for w in s.get("words", []):
            t = w["word"].strip()
            if t and w.get("probability", 0) > 0.05:
                ws.append({"w": t, "s": round(w["start"] + a2, 2),
                           "e": round(w["end"] + a2, 2), "p": round(w.get("probability", 0), 2)})
    txt = r["text"].strip()
    results.append({
        "i": idx, "en": en, "zh": zh, "win": [a, b],
        "heard": txt, "words": ws,
    })
    span = f"{ws[0]['s']:.2f}-{ws[-1]['e']:.2f}" if ws else "—"
    print(f"{idx:2}. [{a:5.1f}-{b:5.1f}] {span:>14}  「{txt[:58]}」")

with open("scripts/.line-verify.json", "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=1)
print("\n已存 scripts/.line-verify.json")