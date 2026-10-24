# -*- coding: utf-8 -*-
"""关键边界校准：多窗口 + 混合语言 prompt，解决时间重叠。"""
import sys
import numpy as np
import librosa
import whisper

SRC, MODEL = sys.argv[1], sys.argv[2]
audio, _ = librosa.load(SRC, sr=16000, mono=True)
DUR = len(audio) / 16000
model = whisper.load_model(MODEL)

CASES = [
    # (label, prompt, lang, a, b)
    ("L3-L4 日语段", "Too much と足りない間を 探し続けてるばかり", "ja", 8.0, 12.6),
    ("L5-L6 边界", "Live and learn or learn to live. Live it up or die trying.", "en", 11.4, 17.0),
    ("L6-L7 边界", "Live it up or die trying. スタートとエンドに", "ja", 14.3, 19.4),
    ("L14-L15 边界", "why do we live like. We are a dying breed?", "en", 39.0, 43.4),
    ("L18-L19 边界", "If all of us believe in living perfect. Happiness will come unexpected.", "en", 46.6, 52.6),
    ("L21-L22 尾部", "Won't know what you've got until it's all gone and away. Life is not so bad you gotta live it up.", "en", 53.9, 58.17),
]

for label, prompt, lang, a, b in CASES:
    a2, b2 = max(0, a - 0.15), min(DUR, b + 0.15)
    seg = audio[int(a2 * 16000): int(b2 * 16000)]
    r = model.transcribe(
        seg, word_timestamps=True, verbose=False, language=lang,
        initial_prompt=prompt, condition_on_previous_text=False,
        temperature=0.0, no_speech_threshold=0.95, logprob_threshold=-2.5,
        compression_ratio_threshold=4.0, beam_size=5,
    )
    print(f"\n════ {label}  {a:.2f}→{b:.2f}s")
    print(f"     「{r['text'].strip()[:110]}」")
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