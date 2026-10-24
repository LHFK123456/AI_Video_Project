# -*- coding: utf-8 -*-
"""
整段识别（不切窗）+ 与已知歌词做 DP 对齐。
已知歌词按用户给的 22 句拆行；DP 把检测到的词映射到歌词词序，
缺失的词在邻居之间插值。输出每行的 start/end。

用法: python scripts/lyric-align-dp.py assets/enhanced.wav .models/whisper/base.pt
"""
import sys
import json
import re
import numpy as np
import librosa
import whisper

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/enhanced.wav"
MODEL = sys.argv[2] if len(sys.argv) > 2 else ".models/whisper/base.pt"

# ---- 22 句歌词（英文主体，用于对齐）----
LINES = [
    ("Some build it up so they can break it down", "有的人筑起高楼 为了再全部倾覆"),
    ("Some stay the same and never miss a thing", "有的人从未改变 也不会错过什么"),
    ("Too much and not enough", "在过剩与不足之间"),
    ("keep searching", "不断地寻求着平衡"),
    ("Live and learn or learn to live", "活到老学到老 或是学习如何活着"),
    ("Live it up or die trying", "坚持活下去 或是死在奋斗的时候"),
    ("Start and end", "事物的开始与结束"),
    ("can't be picky", "无法局限我的视野"),
    ("Half full of fantasies", "一半鼓鼓囊囊 全是幻想"),
    ("Half empty broken dreams", "一半空空荡荡 破碎的梦"),
    ("Read between the lines", "(领悟言外之意)"),
    ("Flawless is all it seems", "看起来全都是完美无缺的"),
    ("Far from dream", "梦想遥不可及"),
    ("why do we live like", "我们为何要这样生活"),
    ("We are a dying breed", "难道我们是濒临灭绝的物种？"),
    ("Most of us just keep starving for attention", "我们之中的大多数都渴望得到关注"),
    ("We are what we see", "我们就是自己眼中这样"),
    ("If all of us believe in living perfect", "如果每一个人都相信自己完美地活着"),
    ("Happiness will come unexpected", "幸福会毫无预兆地来到"),
    ("Don't let someone else take it for granted", "不要让别人把这视作理所当然"),
    ("Won't know what you've got until it's all gone and away", "在全都失去之前 你不会知道自己拥有什么"),
    ("Life is not so bad you gotta live it up", "生活没有那么糟糕 你得要坚持下去"),
]

PROMPT = " ".join(l[0] + "." for l in LINES)

print(f"加载音频 {SRC}")
audio, _ = librosa.load(SRC, sr=16000, mono=True)
audio = audio.astype(np.float32)
DUR = len(audio) / 16000
print(f"  时长 {DUR:.2f}s")

print(f"加载模型 {MODEL}")
model = whisper.load_model(MODEL)
print("整段识别…")
r = model.transcribe(
    audio, word_timestamps=True, verbose=False, language="en",
    initial_prompt=PROMPT, condition_on_previous_text=False,
    temperature=0.0, no_speech_threshold=0.6, logprob_threshold=-1.0,
)

words = []
for s in r["segments"]:
    for w in s.get("words", []):
        t = w["word"].strip()
        if t:
            words.append({"w": t, "s": w["start"], "e": w["end"], "p": w.get("probability", 0)})

print(f"检测到 {len(words)} 词")

with open("scripts/.whisper-whole.json", "w", encoding="utf-8") as f:
    json.dump({"dur": DUR, "text": r["text"], "words": words,
               "segments": [{"s": s["start"], "e": s["end"], "t": s["text"].strip()} for s in r["segments"]]},
              f, ensure_ascii=False, indent=1)

print("\n=== 段落 ===")
for s in r["segments"]:
    print(f"[{s['start']:6.2f}-{s['end']:6.2f}] {s['text'].strip()}")

print("\n=== 逐词 ===")
for w in words:
    print(f"{w['s']:7.2f} {w['e']:7.2f} ({w['p']:.2f}) {w['w']}")