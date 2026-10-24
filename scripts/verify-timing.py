"""从预览视频逐帧检测字幕，验证「唱到哪句出哪句」。

判据：文字有锐利边缘，背景光晕/粒子是平滑渐变。
     用 Sobel 梯度幅值在文字带内计数，而非亮度占比——
     亮度法会被爆发期的霓虹光晕和白闪严重干扰。

用法: python scripts/verify-timing.py out/preview.mp4
"""
import json
import subprocess
import sys
import numpy as np

VIDEO = sys.argv[1] if len(sys.argv) > 1 else "out/preview.mp4"
W, H = 360, 640
FPS = 60

cmd = [
    "D:/ffmpeg/bin/ffmpeg.exe", "-v", "error", "-i", VIDEO,
    "-vf", f"scale={W}:{H},format=gray",
    "-f", "rawvideo", "-",
]
proc = subprocess.run(cmd, capture_output=True)
buf = proc.stdout
n = len(buf) // (W * H)
print(f"解码 {n} 帧  ({n/FPS:.2f}s)  {W}x{H}")
arr = np.frombuffer(buf[: n * W * H], dtype=np.uint8).reshape(n, H, W).astype(np.float32)


def edge_energy(frames):
    """Sobel 梯度幅值 > 28 的像素数（锐利边缘）。"""
    out = np.zeros(frames.shape[0], dtype=np.float32)
    for i in range(frames.shape[0]):
        f = frames[i]
        gx = np.abs(f[1:-1, 2:] - f[1:-1, :-2])
        gy = np.abs(f[2:, 1:-1] - f[:-2, 1:-1])
        g = np.maximum(gx, gy)
        # 只数"边缘两头反差大"的像素：必须同时有暗背景
        out[i] = (g > 28).sum()
    return out


# 正文带：0.36~0.62（主行） + 0.62~0.70（译文）
main = arr[:, int(H * 0.36) : int(H * 0.62), :]
sub = arr[:, int(H * 0.62) : int(H * 0.70), :]

e_main = edge_energy(main)
e_sub = edge_energy(sub)
e_all = e_main + e_sub

# 背景参考：同尺寸的顶部空区（无文字），用于扣除特效干扰
ref = arr[:, int(H * 0.04) : int(H * 0.30), :]
e_ref = edge_energy(ref)

# 净文字信号
net = e_all - e_ref * 0.45
thr = max(30.0, np.percentile(net, 55) * 0.35)
has_text = net > thr

lyrics = json.load(open("src/data/lyrics.json", encoding="utf-8"))

print(f"阈值 {thr:.0f}  (峰值 {net.max():.0f}, 中位 {np.median(net):.0f})\n")
print(f"{'#':>3} {'起唱':>7} {'收声':>7} | {'实测开始':>8} {'实测结束':>8} | {'误差':>8}  {'状态'}")
print("-" * 84)

ok, bad, miss = 0, [], []
for l in lyrics:
    a = int(round(l["start"] * FPS))
    b = int(round(l["end"] * FPS))

    # 起唱：在 [a-10, a+16] 找第一次出现
    onset = None
    for f in range(max(0, a - 10), min(n - 1, a + 16) + 1):
        if has_text[f]:
            onset = f
            break

    # 收声：在 [b-12, b+22] 找最后一次
    vanish = None
    for f in range(min(n - 1, b + 22), max(0, b - 12) - 1, -1):
        if has_text[f]:
            vanish = f
            break

    if onset is None:
        miss.append(l["id"])
        status = "未检出"
        err = None
    else:
        err = (onset - a) / FPS
        if abs(err) <= 0.05:
            status = "准时"
            ok += 1
        elif err > 0:
            status = f"迟 {err*1000:.0f}ms"
            bad.append((l["id"], err))
        else:
            status = f"早 {-err*1000:.0f}ms"
            bad.append((l["id"], err))

    es = f"{onset/FPS:8.3f}" if onset is not None else "       -"
    vs = f"{vanish/FPS:8.3f}" if vanish is not None else "       -"
    ee = f"{err*1000:+8.0f}ms" if err is not None else "        -"
    print(f"{l['id']:>3} {l['start']:7.2f} {l['end']:7.2f} | {es} {vs} | {ee}  {status}  {l['en'][:24]}")

print(f"\n准时 {ok}/{len(lyrics)} 句   未检出 {len(miss)}")
if bad:
    print("偏离:", ", ".join(f"#{i}({d*1000:+.0f}ms)" for i, d in bad))

print("\n空白段检查（应无字幕）:")
gaps = []
prev_end = 0.0
for l in lyrics:
    if l["start"] - prev_end > 1.0:
        gaps.append((prev_end, l["start"]))
    prev_end = max(prev_end, l["end"])
gaps.append((prev_end, n / FPS))

for s, e in gaps:
    f0, f1 = int(s * FPS) + 10, int(e * FPS) - 10
    if f1 <= f0:
        continue
    seg = has_text[f0:f1]
    ratio = seg.mean()
    mark = "OK" if ratio < 0.10 else "!! 有字"
    print(f"  {s:6.2f}-{e:6.2f}s  有字帧 {ratio*100:5.1f}%  {mark}")