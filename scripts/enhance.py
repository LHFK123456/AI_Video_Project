# -*- coding: utf-8 -*-
"""
音质增强：谱减降噪 + 人声频段 EQ + 高频谐波修复 + 软限幅。
针对手机自录的高噪声底（实测 SNR 仅 6.3dB）做修复。

用法:
  python scripts/enhance.py <输入wav> <输出wav> [--denoise 0.8] [--quiet]
"""
import sys
import argparse
import numpy as np
import soundfile as sf
import librosa
from scipy.ndimage import uniform_filter1d, minimum_filter1d, maximum_filter1d

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("dst")
ap.add_argument("--denoise", type=float, default=0.75, help="降噪强度 0~1")
ap.add_argument("--target-peak", type=float, default=0.89, help="目标峰值 (0.89≈-1dBFS)")
ap.add_argument("--no-report", action="store_true")
a = ap.parse_args()

y, sr = sf.read(a.src, always_2d=False)
if y.ndim == 2:
    y = y.mean(axis=1)
y = y.astype(np.float64)
print(f"读取 {a.src}  {sr}Hz  {len(y)/sr:.2f}s  峰值 {np.max(np.abs(y)):.3f}")

N_FFT = 2048
HOP = 512

# ---------- 1. 高通：去掉手机录音的低频隆隆 ----------
y = librosa.effects.preemphasis(y, coef=-0.0)  # 占位，保留原始相位
# 用 STFT 域做高通更可控
S = librosa.stft(y, n_fft=N_FFT, hop_length=HOP, window="hann")
mag, phase = np.abs(S), np.angle(S)
freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)

# ---------- 2. 谱减降噪 ----------
# 噪声谱估计：取能量最低的 8% 帧，逐频点取中位数
frame_e = np.sum(mag ** 2, axis=0)
n_quiet = max(8, int(len(frame_e) * 0.08))
quiet_idx = np.argsort(frame_e)[:n_quiet]
noise = np.median(mag[:, quiet_idx], axis=1, keepdims=True)
# 频域再平滑一下，避免音乐性噪声（musical noise）
noise = uniform_filter1d(noise[:, 0], size=5, mode="nearest")[:, None]

# 过减因子随频率变化：低频噪声重、高频噪声轻
alpha = np.where(freqs < 300, 2.2, np.where(freqs < 3000, 1.6, 1.1))[:, None] * a.denoise
# 谱底（spectral floor）避免完全归零导致空洞
floor = 0.06

mag_dn = np.maximum(mag - alpha * noise, floor * noise)
# 保留一点原始能量，避免过度处理
mag_dn = np.maximum(mag_dn, mag * 0.35)
print(f"谱减：噪声底 {20*np.log10(np.maximum(noise.mean(),1e-12)):.1f} dBFS  强度 {a.denoise}")

# ---------- 3. EQ：人声清晰度 ----------
eq = np.ones_like(freqs)
# 80Hz 以下砍掉（隆隆/手持噪声）
eq[freqs < 80] = 0.15
eq[(freqs >= 80) & (freqs < 120)] = np.linspace(0.15, 1.0, np.sum((freqs >= 80) & (freqs < 120)))
# 200-400Hz 轻微收敛（手机录音常浑浊）
m = (freqs >= 200) & (freqs < 400)
eq[m] = 0.86
# 2.5k-5k 提亮（人声临场感/咬字清晰度）
m = (freqs >= 2500) & (freqs < 5000)
eq[m] = 1.0 + 0.30 * np.exp(-((freqs[m] - 3600) ** 2) / (2 * 1200 ** 2))
# 6k-9k 轻微收敛（去手机麦克风的尖锐感）
m = (freqs >= 6000) & (freqs < 9000)
eq[m] = 0.94

mag_eq = mag_dn * eq[:, None]

# ---------- 4. 高频修复：AAC 128k 砍掉了空气感，用谐波激励补 ----------
# 取 3-6kHz 的包络去调制 9-14kHz 的噪声，制造"空气感"
hi_src = np.sum(mag_eq[(freqs >= 3000) & (freqs < 6000)], axis=0)
hi_env = uniform_filter1d(hi_src, size=9, mode="nearest")
hi_env = hi_env / (np.max(hi_env) + 1e-9)
rng = np.random.default_rng(20261024)
for lo, hi, amt in [(9000, 14000, 0.055)]:
    m = (freqs >= lo) & (freqs < hi)
    n_band = int(np.sum(m))
    # 确定性噪声（同一输入必得同一输出）
    nz = np.abs(rng.standard_normal((n_band, mag_eq.shape[1])))
    nz = uniform_filter1d(nz, size=3, axis=0, mode="nearest")
    mag_eq[m] += nz * hi_env[None, :] * amt * np.mean(mag_eq[m]) * 3

# ---------- 5. 逆变换 ----------
S2 = mag_eq * np.exp(1j * phase)
y2 = librosa.istft(S2, hop_length=HOP, window="hann", length=len(y))

# ---------- 6. 轻度压缩 + 软限幅 ----------
# 压缩：把 RMS 拉起来，让整体更"响"但不压扁
rms = np.sqrt(uniform_filter1d(y2 ** 2, size=int(sr * 0.05), mode="nearest"))
thr = np.percentile(rms, 70)
ratio = 2.0
gain = np.where(rms > thr, (thr / np.maximum(rms, 1e-9)) ** (1 - 1 / ratio), 1.0)
gain = uniform_filter1d(gain, size=int(sr * 0.01), mode="nearest")
y2 = y2 * gain

# 软限幅（tanh 曲线，避免硬削波）
peak = np.max(np.abs(y2))
if peak > 0:
    y2 = y2 / peak * 1.02
y2 = np.tanh(y2 * 1.15) / np.tanh(1.15)

# 归一化到目标峰值
peak = np.max(np.abs(y2))
y2 = y2 / (peak + 1e-9) * a.target_peak

# ---------- 7. 报告 ----------
if not a.no_report:
    def stats(sig, name):
        p = np.max(np.abs(sig))
        r = np.sqrt(np.mean(sig ** 2))
        print(f"  {name}: 峰值 {20*np.log10(max(p,1e-9)):.2f} dBFS  RMS {20*np.log10(max(r,1e-9)):.2f} dBFS  "
              f"峰均比 {20*np.log10(max(p,1e-9)/max(r,1e-9)):.2f} dB")
    print("\n[处理前后]")
    stats(y, "原始")
    stats(y2, "增强")

sf.write(a.dst, y2, sr, subtype="PCM_24")
print(f"\n✔ 已写出 {a.dst}  (24bit / {sr}Hz / {len(y2)/sr:.2f}s)")