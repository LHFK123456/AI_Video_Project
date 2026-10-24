# -*- coding: utf-8 -*-
"""
用 librosa 做谐波分离 + pYIN 基频跟踪，提取"在唱"活动曲线。
唱音有稳定基频 -> voiced；鼓点/纯打击无音高 -> unvoiced。
"""
import sys
import json
import numpy as np
import librosa

SRC = sys.argv[1] if len(sys.argv) > 1 else "public/test.mp3"

print(f"加载 {SRC}")
y, sr = librosa.load(SRC, sr=22050, mono=True)
dur = len(y) / sr
print(f"时长 {dur:.3f}s  sr={sr}")

# 谐波/打击分离
y_h, y_p = librosa.effects.hpss(y, margin=3.0)
print("HPSS 完成")

# pYIN 基频跟踪
hop = 128  # 5.8ms 分辨率
f0, voiced_flag, voiced_prob = librosa.pyin(
    y_h, fmin=80, fmax=900, sr=sr, frame_length=2048, hop_length=hop,
    fill_na=0.0,
)
fps = sr / hop
print(f"pYIN 完成  帧数 {len(f0)}  voiced 占比 {voiced_flag.mean()*100:.1f}%")

# 谐波能量（人声与主旋律）
rms_h = librosa.feature.rms(y=y_h, frame_length=2048, hop_length=hop)[0]
rms_p = librosa.feature.rms(y=y_p, frame_length=2048, hop_length=hop)[0]

# 中频带能量（人声基频区）
S_h = np.abs(librosa.stft(y_h, n_fft=2048, hop_length=hop))
freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
band = (freqs >= 250) & (freqs <= 1500)
band_e = S_h[band, :].mean(axis=0)

# 对齐长度
n = min(len(f0), len(rms_h), len(band_e))
f0 = f0[:n]; voiced_flag = voiced_flag[:n]; voiced_prob = voiced_prob[:n]
rms_h = rms_h[:n]; rms_p = rms_p[:n]; band_e = band_e[:n]

def norm_ref(a, q=97):
    ref = np.percentile(a, q)
    return np.clip(a / (ref if ref > 1e-9 else 1), 0, 1)

v_prob = norm_ref(voiced_prob, 98)
b_e = norm_ref(band_e, 97)
h_e = norm_ref(rms_h, 97)

# "在唱"强度：voiced 概率 × 中频能量，压制打击
vocal = v_prob * (0.45 + 0.55 * b_e) * (1.0 - 0.25 * norm_ref(rms_p, 97))
vocal = norm_ref(vocal, 96)

# 平滑
from scipy.ndimage import uniform_filter1d
try:
    v_s = uniform_filter1d(vocal, size=max(1, int(0.05 * fps)))
    v_slow = uniform_filter1d(vocal, size=max(1, int(0.18 * fps)))
except Exception:
    v_s = vocal
    v_slow = vocal

print("\n=== 每 0.5s 的 voicing 与能量 ===")
print("时间   voiced%  中频   人声  图示")
for i in range(0, n, int(0.5 * fps)):
    t = i / fps
    j = min(n, i + int(0.5 * fps))
    vp = voiced_flag[i:j].mean() * 100
    print(f"{t:5.1f}  {vp:6.0f}%  {b_e[i:j].mean():.2f}  {v_s[i]:.2f}  {'█' * int(v_s[i] * 40)}")

out = {
    "fps": fps,
    "dur": dur,
    "vocal": [round(float(v), 4) for v in v_s],
    "vocal_slow": [round(float(v), 4) for v in v_slow],
    "voiced": [int(v) for v in voiced_flag],
    "f0": [round(float(v), 1) for v in f0],
}
with open("scripts/.vocal-pyin.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh)
print(f"\n已存 scripts/.vocal-pyin.json  fps={fps:.2f} frames={n}")