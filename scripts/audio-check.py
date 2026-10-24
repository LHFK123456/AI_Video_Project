# -*- coding: utf-8 -*-
"""音质体检：频谱上限、有效位深、噪声底、动态范围、削波。"""
import sys
import numpy as np
import librosa

SRC = sys.argv[1]
y, sr = librosa.load(SRC, sr=None, mono=True)
print(f"文件 {SRC}")
print(f"采样率 {sr} Hz   时长 {len(y)/sr:.3f}s   样本 {len(y)}")

# 峰值 / RMS / 削波
peak = float(np.max(np.abs(y)))
rms = float(np.sqrt(np.mean(y ** 2)))
clip = int(np.sum(np.abs(y) > 0.999))
print(f"\n[电平]")
print(f"  峰值      {peak:.4f}  ({20*np.log10(max(peak,1e-9)):.2f} dBFS)")
print(f"  RMS       {rms:.4f}  ({20*np.log10(max(rms,1e-9)):.2f} dBFS)")
print(f"  峰均比    {20*np.log10(max(peak,1e-9)/max(rms,1e-9)):.2f} dB")
print(f"  削波样本  {clip}  ({clip/len(y)*100:.5f}%)")

# 频谱上限：找高频截止
n_fft = 8192
S = np.abs(librosa.stft(y, n_fft=n_fft))
freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
spec_mean = S.mean(axis=1)

# 高频段的相对能量包络
total = spec_mean.sum()
print(f"\n[频谱能量分布]")
for lo, hi in [(0, 100), (100, 500), (500, 2000), (2000, 5000),
               (5000, 8000), (8000, 11000), (11000, 15000), (15000, 20000)]:
    m = (freqs >= lo) & (freqs < hi)
    e = spec_mean[m].sum() / total * 100
    print(f"  {lo:5d}-{hi:5d} Hz : {e:6.2f}%")

# 高频截止点：能量掉到最大值的 -60dB 以上最远频率
thr = spec_mean.max() * 1e-3
above = np.where(spec_mean > thr)[0]
if len(above):
    print(f"\n  能量 >-60dB 的最高频率: {freqs[above[-1]]:.0f} Hz")

# 噪声底：取最安静 5% 帧的中位频谱
frame_e = S.sum(axis=0)
quiet_idx = np.argsort(frame_e)[: max(1, int(len(frame_e) * 0.05))]
noise_spec = S[:, quiet_idx].mean(axis=1)
signal_spec = S.mean(axis=1)
snr_band = []
for lo, hi in [(100, 1000), (1000, 4000), (4000, 8000), (8000, 16000)]:
    m = (freqs >= lo) & (freqs < hi)
    s = signal_spec[m].mean()
    nz = noise_spec[m].mean()
    db = 20 * np.log10(max(s, 1e-12) / max(nz, 1e-12))
    snr_band.append((lo, hi, db))
print(f"\n[安静段相对噪声底 SNR]")
for lo, hi, db in snr_band:
    print(f"  {lo:5d}-{hi:5d} Hz : {db:6.1f} dB")

# 有效位深估计：量化台阶
d = np.abs(np.diff(y))
d = d[d > 1e-7]
if len(d):
    step = np.median(d[d < np.percentile(d, 30)]) if len(d) > 100 else 0
    print(f"\n[量化]")
    print(f"  最小可分辨台阶估计 {step:.2e}")
    print(f"  理论有效位深 ≈ {-np.log2(max(step,1e-12)):.1f} bit")

# 立体声
y2, _ = librosa.load(SRC, sr=None, mono=False)
if y2.ndim == 2:
    print(f"\n[声道] {y2.shape[0]} 声道")
    if y2.shape[0] == 2:
        corr = float(np.corrcoef(y2[0], y2[1])[0, 1])
        print(f"  L/R 相关 {corr:.6f}")
        if abs(corr - 1.0) < 1e-6:
            print("  → 完全单声道（左右相同）")

# 是否电话频宽 / 低码率痕迹
print(f"\n[判定参考]")
if len(above) and freqs[above[-1]] < 15000:
    print(f"  ⚠ 高频截止于 {freqs[above[-1]]:.0f} Hz —— 有损压缩痕迹")
else:
    print("  高频延展正常")