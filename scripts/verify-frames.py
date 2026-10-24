"""严格验收：像素级确认「唱到哪句出哪句」。

检查项：
  1. 每一句的起唱帧（frame = round(start*60)）画面必须已有文字
  2. 真实空白段（上一句完全消失后 到 下一句起唱前）必须完全干净
  3. drop 帧仍是文字存在的（第14句白转霓虹）

说明：相邻两句之间歌手几乎没有停顿（如第1句 6.22s 收声、第2句 6.24s 起唱），
      此时上一句的字仍在淡出属正常，因此"起唱前必须干净"不适用于相邻句，
      只对真实空白段做检查。

用法: python scripts/verify-frames.py out/preview4.mp4
"""
import json
import subprocess
import sys
import numpy as np

VIDEO = sys.argv[1] if len(sys.argv) > 1 else "out/preview4.mp4"
W, H = 540, 960
FPS = 60
TAIL_BUILD = round(0.26 * FPS)
TAIL_DROP = round(0.2 * FPS)
PIVOT_ID = 14

lyrics = json.load(open("src/data/lyrics.json", encoding="utf-8"))
lines = sorted([l for l in lyrics if l["start"] is not None], key=lambda x: x["start"])

# 复算每句的消失帧（与 lyricTiming.ts 一致）
slots = []
for i, l in enumerate(lines):
    a = round(l["start"] * FPS)
    b = round(l["end"] * FPS)
    tail = TAIL_DROP if l["id"] > PIVOT_ID else TAIL_BUILD
    nxt = round(lines[i + 1]["start"] * FPS) if i + 1 < len(lines) else 10**9
    fade_end = min(b + tail, nxt)
    slots.append((l, a, b, fade_end))

checks = []
for l, a, b, fe in slots:
    checks.append((a, "text", f"句{l['id']} 起唱帧 {l['start']:.2f}s"))
# 真实空白段：上一句消失 → 下一句起唱，跨度 > 0.8s
for i in range(len(slots) - 1):
    l, a, b, fe = slots[i]
    nxt_a = slots[i + 1][1]
    if (nxt_a - fe) / FPS > 0.8:
        mid = (fe + nxt_a) // 2
        checks.append((mid, "clean", f"空白段 句{l['id']}后 {fe/FPS:.2f}-{nxt_a/FPS:.2f}s"))
checks.append((2433, "text", "drop 帧 40.55s"))

checks.sort()
frames = sorted({f for f, _, _ in checks if 0 <= f < 3490})
expr = "+".join(f"eq(n\\,{f})" for f in frames)
cmd = [
    "D:/ffmpeg/bin/ffmpeg.exe", "-v", "error", "-i", VIDEO,
    "-vf", f"select={expr},scale={W}:{H},format=rgb24",
    "-fps_mode", "passthrough", "-f", "rawvideo", "-",
]
buf = subprocess.run(cmd, capture_output=True).stdout
fsz = W * H * 3
cnt = len(buf) // fsz
print(f"取到 {cnt}/{len(frames)} 帧\n")

data = np.frombuffer(buf[: cnt * fsz], dtype=np.uint8).reshape(cnt, H, W, 3).astype(np.float32)
got = {f: data[i] for i, f in enumerate(frames[:cnt])}


def measure(fr):
    """返回 (亮像素数, 彩度百分比, 峰值亮度)。阈值自适应，兼容细体白字。"""
    lum = fr.mean(axis=2)
    band = lum[int(H * 0.34) : int(H * 0.72), :]
    base = float(np.percentile(band, 50))
    top = float(band.max())
    thr = base + max(16.0, (top - base) * 0.30)
    lit = int((band > thr).sum())
    mx, mn = fr.max(axis=2), fr.min(axis=2)
    chroma = float(((mx - mn) > 36).mean() * 100)
    return lit, chroma, top


print(f"{'帧':>5} {'时间':>7}  {'期望':>6}  {'亮像素':>7} {'彩度':>6} {'峰值':>5}  判定  说明")
print("-" * 84)

fails = []
for f, want, label in checks:
    if f not in got:
        continue
    lit, chroma, top = measure(got[f])
    has = lit > 90 or chroma > 2.0
    ok = (want == "text" and has) or (want == "clean" and not has)
    if not ok:
        fails.append((f, label, want, lit, chroma))
    print(
        f"{f:>5} {f/FPS:7.2f}  {want:>6}  {lit:7d} {chroma:5.1f}% {top:5.0f}  "
        f"{'OK' if ok else 'FAIL':>4}  {label}"
    )

print(f"\n{'全部通过' if not fails else f'{len(fails)} 项不符'}")
for f, label, want, lit, ch in fails:
    print(f"  FAIL 第{f}帧 ({f/FPS:.2f}s) 期望{want} 实得 lit={lit} chroma={ch:.1f}% — {label}")