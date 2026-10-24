"""对指定帧做像素级体检：确认字幕该出现时出现、不该出现时干净。

只解码需要的帧（按 select 过滤），避免整片 rgb24 占用数 GB 内存。

用法: python scripts/spot-check.py out/preview3.mp4
"""
import subprocess
import sys
import numpy as np

VIDEO = sys.argv[1] if len(sys.argv) > 1 else "out/preview3.mp4"
W, H = 540, 960

NEED = [
    (100, "clean", "1.67s 开场黑屏"),
    (214, "clean", "3.57s 第1句起唱前一帧"),
    (218, "text", "3.63s 第1句刚起唱"),
    (230, "text", "3.83s 第1句"),
    (1280, "text", "21.33s 第8句演唱中"),
    (1320, "clean", "22.00s 空白段"),
    (1450, "clean", "24.17s 空白段末尾"),
    (1478, "text", "24.63s 第9句起唱后"),
    (2280, "clean", "38.00s 空白段（第13句前）"),
    (2295, "text", "38.25s 第13句"),
    (2400, "text", "40.00s 第14句（白色）"),
    (2433, "text", "40.55s drop 帧"),
    (2445, "text", "40.75s 第15句"),
    (3400, "text", "56.67s 第21句"),
    (3480, "clean", "58.00s 结尾淡出"),
]

frames = sorted({f for f, _, _ in NEED})
expr = "+".join(f"eq(n\\,{f})" for f in frames)
cmd = [
    "D:/ffmpeg/bin/ffmpeg.exe", "-v", "error", "-i", VIDEO,
    "-vf", f"select='{expr}',scale={W}:{H},format=rgb24",
    "-fps_mode", "passthrough", "-f", "rawvideo", "-",
]
buf = subprocess.run(cmd, capture_output=True).stdout
fsz = W * H * 3
cnt = len(buf) // fsz
print(f"取到 {cnt} 帧（请求 {len(frames)} 帧）\n")

if cnt == 0:
    sys.exit("未取到任何帧，检查 select 语法")

data = np.frombuffer(buf[: cnt * fsz], dtype=np.uint8).reshape(cnt, H, W, 3).astype(np.float32)
got = {f: data[i] for i, f in enumerate(frames[:cnt])}

print(f"{'帧':>5} {'时间':>7}   {'期望':>6}  {'亮像素':>8} {'彩度':>7} {'亮度':>7}  判定  说明")
print("-" * 94)

fail = []
for f, want, note in NEED:
    if f not in got:
        print(f"{f:>5} 未取到")
        continue
    fr = got[f]
    lum = fr.mean(axis=2)
    band = lum[int(H * 0.34) : int(H * 0.72), :]
    # 阈值随画面自适应：细体白字在暗场只有 40~120，不能用固定 62
    base = float(np.percentile(band, 50))
    thr = base + max(18, (float(band.max()) - base) * 0.35)
    lit = int((band > thr).sum())
    mx, mn = fr.max(axis=2), fr.min(axis=2)
    chroma = float(((mx - mn) > 38).mean() * 100)
    avg = float(lum.mean())

    # 判据：自适应阈值下仍有足够多的亮像素，或画面出现明显霓虹
    has = lit > 90 or chroma > 2.0
    ok = (want == "text" and has) or (want == "clean" and not has)
    if not ok:
        fail.append(f)
    print(
        f"{f:>5} {f/60:7.2f}   {want:>6}  {lit:8d} {chroma:6.1f}% {avg:7.2f}  "
        f"{'OK' if ok else 'FAIL':>4}  {note}"
    )

print(f"\n{'全部通过' if not fail else f'{len(fail)} 项不符: {fail}'}")