"""检查渲染帧里的文字是否存在、位置是否合理。

用法: python scripts/check-frame.py out/probe/t-0300.png
输出: 白像素/彩色像素比例、文字包围盒、平均亮度
"""
import sys
import numpy as np
from PIL import Image

for p in sys.argv[1:]:
    im = Image.open(p).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape
    lum = a.mean(axis=2)

    # 亮像素：字幕为白/霓虹，背景接近纯黑
    bright = lum > 70
    frac = bright.mean()

    # 彩色像素（霓虹）：通道间差异大
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    chroma = (mx - mn) > 40
    cfrac = chroma.mean()

    ys, xs = np.where(bright)
    if len(ys):
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
        # 转成相对坐标
        rb = (
            round(xs.min() / w, 3),
            round(ys.min() / h, 3),
            round(xs.max() / w, 3),
            round(ys.max() / h, 3),
        )
    else:
        bbox = None
        rb = None

    print(f"{p.split(chr(92))[-1].split('/')[-1]:16s} {w}x{h} "
          f"lit={frac*100:6.2f}%  chroma={cfrac*100:6.2f}%  "
          f"lum={lum.mean():6.2f}  bbox={rb}")