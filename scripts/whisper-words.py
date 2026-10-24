# -*- coding: utf-8 -*-
"""
Whisper 词级时间戳识别，用于歌词对齐。
输出每个词的起止时间，再与歌词文本做动态规划匹配。
"""
import sys
import json
import os
import numpy as np
import whisper

# Whisper 内部会用 ffmpeg 解码；这里直接用 librosa 读成 16k 数组传进去，绕开外部依赖
import librosa

SRC = sys.argv[1] if len(sys.argv) > 1 else "assets/enhanced.wav"
MODEL = sys.argv[2] if len(sys.argv) > 2 else ".models/whisper/tiny.pt"

print(f"加载音频 {SRC}")
audio, _ = librosa.load(SRC, sr=16000, mono=True)
audio = audio.astype(np.float32)
print(f"  时长 {len(audio)/16000:.2f}s  峰值 {np.max(np.abs(audio)):.3f}")

print(f"加载模型 {MODEL}")
model = whisper.load_model(MODEL)
print("模型已加载，开始识别…")

result = model.transcribe(
    audio,
    word_timestamps=True,
    verbose=False,
    condition_on_previous_text=False,
    temperature=0.0,
    no_speech_threshold=0.5,
    # 歌曲有持续伴奏，关掉 VAD 依赖，靠 no_speech 阈值
)

print(f"\n检测语言: {result.get('language')}")
print(f"识别段数: {len(result['segments'])}")

words = []
for seg in result["segments"]:
    for w in seg.get("words", []):
        words.append({
            "w": w["word"].strip(),
            "s": round(w["start"], 3),
            "e": round(w["end"], 3),
            "p": round(w.get("probability", 0), 3),
        })

print(f"词数: {len(words)}")

print("\n=== 逐词时间戳 ===")
for w in words:
    print(f"{w['s']:7.2f} → {w['e']:7.2f}  ({w['p']:.2f})  {w['w']}")

print("\n=== 段落文本 ===")
for seg in result["segments"]:
    print(f"[{seg['start']:.2f}-{seg['end']:.2f}] {seg['text'].strip()}")

with open("scripts/.whisper-words.json", "w", encoding="utf-8") as f:
    json.dump({
        "language": result.get("language"),
        "text": result["text"],
        "words": words,
        "segments": [
            {"s": round(s["start"], 3), "e": round(s["end"], 3), "t": s["text"].strip()}
            for s in result["segments"]
        ],
    }, f, ensure_ascii=False, indent=1)
print("\n已存 scripts/.whisper-words.json")