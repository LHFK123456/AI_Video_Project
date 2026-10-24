#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
a2v.py — 音频转视频（封面图/渐变背景 + 音频波形 + 标题 + 字幕烧入）

零第三方依赖：只用 Python 标准库 + 一个 ffmpeg.exe。
背景渐变由本脚本自己渲染成 PNG，所以不挑 ffmpeg 版本（新旧都能跑）。

用法：
  python a2v.py                              # 处理 input/ 下所有音频
  python a2v.py input/song.mp3               # 单个文件
  python a2v.py song.mp3 -i cover.jpg --title "歌名 - 歌手"
  python a2v.py song.mp3 --size vertical --wave --wave-color 0x5B8CFF
  python a2v.py song.mp3 --subtitle song.srt
  python a2v.py song.mp3 --fit blur          # 封面模糊铺底 + 原图居中
  python a2v.py --doctor                     # 环境自检
  python a2v.py song.mp3 --dry-run           # 只打印命令，不编码
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import zlib

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache")
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus",
             ".wma", ".aiff", ".aif", ".ape", ".amr"}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

SIZE_PRESETS = {
    "1080p": (1920, 1080), "hd": (1920, 1080), "landscape": (1920, 1080),
    "720p": (1280, 720), "4k": (3840, 2160),
    "vertical": (1080, 1920), "shorts": (1080, 1920), "douyin": (1080, 1920),
    "square": (1080, 1080),
}

FONT_CANDIDATES = [
    r"C:/Windows/Fonts/msyh.ttc",
    r"C:/Windows/Fonts/msyhbd.ttc",
    r"C:/Windows/Fonts/simhei.ttf",
    r"C:/Windows/Fonts/Deng.ttf",
    r"C:/Windows/Fonts/simsun.ttc",
    r"C:/Windows/Fonts/arial.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

DEFAULTS = {
    "size": "1920x1080",
    "fps": 30,
    "crf": 20,
    "preset": "medium",
    "audio_bitrate": "192k",
    "fit": "cover",                       # cover / contain / blur
    "bg": "0x101319",                     # 纯色（gradient 关闭时）
    "gradient": ["0x1D2B4F", "0x090B12"],  # 上 -> 下
    "gradient_on": True,
    "wave": None,                         # None = 智能（无封面图时开）
    "wave_height": 200,
    "wave_color": "0x6E9BFF",
    "wave_mode": "cline",
    "title": "",
    "title_size": 0,                      # 0 = 按分辨率自动
    "title_y": 0.86,
    "title_color": "white",
    "zoom": False,
    "tag": "",
    "font": "",
    "fade": 0.5,
    "hwenc": "auto",      # auto / nvenc / qsv / off
    "loudnorm": False,
}

HW_CANDIDATES = ["h264_nvenc", "h264_qsv", "h264_amf"]
_HW_CACHE: dict[str, str | None] = {}


# ------------------------------------------------------------------ 基础
def log(msg: str = "") -> None:
    print(msg, flush=True)


def load_config() -> dict:
    cfg = dict(DEFAULTS)
    path = os.path.join(HERE, "config.json")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                cfg.update(json.load(f))
        except Exception as e:
            log(f"[warn] config.json 解析失败，用默认值：{e}")
    return cfg


def find_tool(name: str) -> str | None:
    exe = name + (".exe" if sys.platform == "win32" else "")
    here = os.path.dirname(HERE)
    cands = [
        # 1. D 盘标准安装位置（推荐）
        os.path.join("D:\\", "ffmpeg", "bin", exe),
        # 2. 项目同级 tools/ 目录
        os.path.join(here, "tools", "ffmpeg", "bin", exe),
        os.path.join(HERE, "tools", "ffmpeg", "bin", exe),
        # 3. 项目内 bin/
        os.path.join(HERE, "bin", exe),
    ]
    for p in cands:
        if os.path.isfile(p) and _runnable(p):
            return p
    # 4. PATH 里找
    found = shutil.which(name)
    if found and _runnable(found):
        return found
    return None


_RUN_CACHE: dict[str, bool] = {}


def _runnable(path: str) -> bool:
    """某些机器的应用控制策略会拦截个别 exe，先探一次。"""
    if path in _RUN_CACHE:
        return _RUN_CACHE[path]
    ok = True
    try:
        r = subprocess.run([path, "-version"], capture_output=True, timeout=20)
        ok = r.returncode == 0
    except Exception:
        ok = False
    _RUN_CACHE[path] = ok
    return ok


def pick_font(cfg: dict) -> str | None:
    if cfg.get("font") and os.path.isfile(cfg["font"]):
        return cfg["font"]
    for p in FONT_CANDIDATES:
        if os.path.isfile(p):
            return p
    return None


def pick_hwenc(mode: str) -> str | None:
    """返回可用的硬件编码器；没用就返回 None 走 libx264。"""
    if mode in ("off", "none", "cpu", False):
        return None
    if mode in HW_CANDIDATES:
        return mode if _enc_works(mode) else None
    if mode in _HW_CACHE:
        return _HW_CACHE[mode]
    ffmpeg = find_tool("ffmpeg")
    found = None
    if ffmpeg:
        for enc in HW_CANDIDATES:
            if _enc_works(enc):
                found = enc
                break
    _HW_CACHE["auto"] = found
    return found


def _enc_works(enc: str) -> bool:
    key = "enc:" + enc
    if key in _HW_CACHE:
        return bool(_HW_CACHE[key])
    ffmpeg = find_tool("ffmpeg")
    ok = False
    if ffmpeg:
        try:
            r = subprocess.run(
                [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                 "-f", "lavfi", "-i", "color=c=black:s=256x144:d=0.2",
                 "-c:v", enc, "-f", "null", "-"],
                capture_output=True, timeout=45)
            ok = r.returncode == 0 and not r.stderr.strip()
        except Exception:
            ok = False
    _HW_CACHE[key] = enc if ok else None
    return ok


def ffpath(p: str) -> str:
    """转成 ffmpeg 滤镜里安全的路径：正斜杠 + 冒号转义 + 单引号包裹。"""
    p = os.path.abspath(p).replace("\\", "/").replace(":", r"\:")
    return "'" + p + "'"


def parse_size(s: str) -> tuple[int, int]:
    k = str(s).strip().lower()
    if k in SIZE_PRESETS:
        return SIZE_PRESETS[k]
    m = re.fullmatch(r"(\d{2,5})\s*[x×*]\s*(\d{2,5})", k)
    if not m:
        raise SystemExit(f"[错误] 无法识别尺寸：{s}（可用 vertical / square / 1920x1080）")
    w, h = int(m.group(1)), int(m.group(2))
    return w - w % 2, h - h % 2


def norm_color(c: str) -> str:
    c = str(c).strip()
    return "0x" + c[1:] if c.startswith("#") else c


def probe(path: str) -> dict:
    exe = find_tool("ffprobe")
    if not exe:
        raise SystemExit("[错误] 找不到 ffprobe。")
    r = subprocess.run([exe, "-v", "error", "-show_format", "-show_streams",
                        "-of", "json", path],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise SystemExit(f"[错误] 读不了文件 {path}\n{r.stderr.strip()}")
    return json.loads(r.stdout or "{}")


def audio_info(path: str) -> tuple[float, int]:
    info = probe(path)
    dur = 0.0
    try:
        dur = float(info.get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        pass
    ch = 2
    has_audio = False
    for st in info.get("streams", []):
        if st.get("codec_type") == "audio":
            has_audio = True
            ch = int(st.get("channels") or 2)
            if dur <= 0 and st.get("duration"):
                try:
                    dur = float(st["duration"])
                except (TypeError, ValueError):
                    pass
            break
    if not has_audio:
        raise SystemExit(f"[错误] 这个文件里没有音频流：{path}")
    if dur <= 0:
        raise SystemExit(f"[错误] 读不出音频时长：{path}")
    return dur, ch


def hhmmss(sec: float) -> str:
    sec = max(0, int(sec))
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return f"{h:d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


# ------------------------------------------------------------------ 背景图渲染（纯 Python 写 PNG）
def _hex2rgb(c: str) -> tuple[int, int, int]:
    c = c.strip().lstrip("#")
    if c.lower().startswith("0x"):
        c = c[2:]
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    c = c.ljust(6, "0")[:6]
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


def _png_bytes(w: int, h: int, rgb_rows: list[bytes]) -> bytes:
    raw = bytearray()
    for row in rgb_rows:
        raw.append(0)          # filter: none
        raw += row

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)   # 8bit RGB
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))


def make_gradient(w: int, h: int, c0: str, c1: str, glow: bool = True) -> str:
    """对角线渐变 + 中心柔光，输出 PNG 路径（带缓存）。"""
    key = f"bg_{w}x{h}_{c0}_{c1}_{int(glow)}.png".replace("0x", "").replace("#", "")
    out = os.path.join(CACHE, key)
    if os.path.isfile(out) and os.path.getsize(out) > 1000:
        return out
    os.makedirs(CACHE, exist_ok=True)

    r0, g0, b0 = _hex2rgb(c0)
    r1, g1, b1 = _hex2rgb(c1)

    # 1024 级 LUT，避免逐像素浮点
    N = 1024
    lut = []
    for i in range(N):
        t = i / (N - 1)
        lut.append((int(r0 + (r1 - r0) * t),
                    int(g0 + (g1 - g0) * t),
                    int(b0 + (b1 - b0) * t)))

    cx, cy = w / 2.0, h / 2.0
    maxd2 = (cx * cx + cy * cy) or 1.0
    rows: list[bytes] = []
    for y in range(h):
        ty = y / (h - 1) if h > 1 else 0.0
        base = ty * 0.78
        row = bytearray()
        if glow:
            dy = (y - cy)
            dy2 = dy * dy
            for x in range(w):
                t = base + (x / (w - 1) if w > 1 else 0) * 0.22
                r, g, b = lut[int(t * (N - 1))]
                dx = x - cx
                d2 = (dx * dx + dy2) / maxd2
                k = 1.0 - d2
                if k > 0:
                    add = int(26 * k * k)
                    r = min(255, r + add)
                    g = min(255, g + add)
                    b = min(255, b + add + 6)
                row += bytes((r, g, b))
        else:
            for x in range(w):
                t = base + (x / (w - 1) if w > 1 else 0) * 0.22
                row += bytes(lut[int(t * (N - 1))])
        rows.append(bytes(row))

    with open(out, "wb") as f:
        f.write(_png_bytes(w, h, rows))
    return out


# ------------------------------------------------------------------ 卡点模式
def _fit_chain(idx: int, w: int, h: int, fit: str, bg: str, tag: str) -> str:
    """把第 idx 路输入统一成 w×h 的 [tag]。"""
    if fit == "blur":
        return (
            f"[{idx}:v]split=2[a{tag}][b{tag}];"
            f"[a{tag}]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
            f"boxblur=20:2,eq=brightness=-0.12:saturation=1.06[ab{tag}];"
            f"[b{tag}]scale={w}:{h}:force_original_aspect_ratio=decrease[bb{tag}];"
            f"[ab{tag}][bb{tag}]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[{tag}]"
        )
    if fit == "contain":
        return (
            f"[{idx}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={bg},setsar=1,"
            f"format=yuv420p[{tag}]"
        )
    return (
        f"[{idx}:v]scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},setsar=1,format=yuv420p[{tag}]"
    )


def build_slideshow_filter(cfg: dict, dur: float, w: int, h: int, fps: int,
                           images: list[str], per_img: float,
                           subtitle: str | None, title_file: str | None,
                           font: str | None) -> tuple[str, list[str]]:
    """多图卡点：每张图显示 per_img 秒，段间 xfade 转场。"""
    parts: list[str] = []
    inputs: list[str] = []
    for p in images:
        inputs += ["-loop", "1", "-framerate", str(fps), "-t", f"{per_img + 1:.3f}", "-i", p]

    n = len(images)
    for i in range(n):
        parts.append(_fit_chain(i + 1, w, h, cfg["fit"], cfg["bg"], f"im{i}"))

    xd = float(cfg.get("xfade", 0.5) or 0)
    xd = min(xd, per_img * 0.4)

    if n == 1:
        parts.append(f"[im0]trim=duration={dur:.3f},setpts=PTS-STARTPTS[seq]")
    elif xd <= 0.01:
        parts.append("".join(f"[im{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[seq]")
    else:
        cur = "im0"
        offset = per_img - xd
        for i in range(1, n):
            out = f"xf{i}"
            parts.append(f"[{cur}][im{i}]xfade=transition={cfg.get('xfade_style','fade')}"
                         f":duration={xd:.3f}:offset={offset:.3f}[{out}]")
            cur = out
            offset += per_img - xd
        parts.append(f"[{cur}]copy[seq]")

    cur = "seq"
    if cfg.get("zoom"):
        parts.append(
            f"[{cur}]zoompan=z='min(zoom+0.00035,1.09)':d=1:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={fps}[seqz]"
        )
        cur = "seqz"

    if subtitle:
        parts.append(
            f"[{cur}]subtitles={ffpath(subtitle)}:force_style="
            f"'FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,"
            f"OutlineColour=&H66000000,BorderStyle=1,Outline=2,Shadow=1,"
            f"Alignment=2,MarginV=56[bgs]"
        )
        cur = "bgs"

    if title_file:
        dt = (
            f"drawtext=textfile={ffpath(title_file)}"
            f":fontcolor={cfg['title_color']}"
            f":fontsize={int(cfg['_title_size'])}"
            f":x=(w-text_w)/2:y=h*{cfg['title_y']}"
            f":box=1:boxcolor=black@0.30:boxborderw=24"
        )
        if font:
            dt = f"drawtext=fontfile={ffpath(font)}:" + dt[len("drawtext="):]
        parts.append(f"[{cur}]{dt}[bgt]")
        cur = "bgt"

    parts.append(f"[{cur}]format=yuv420p,fps={fps},trim=duration={dur:.3f}[vpre]")
    fade = float(cfg.get("fade", 0) or 0)
    if fade > 0 and dur > fade * 2.4:
        parts.append(f"[vpre]fade=t=in:st=0:d={fade:.2f},"
                     f"fade=t=out:st={dur - fade:.2f}:d={fade:.2f}[vout]")
    else:
        parts.append("[vpre]null[vout]")
    return ";".join(parts), inputs


# ------------------------------------------------------------------ 滤镜链
def build_filter(cfg: dict, dur: float, w: int, h: int, fps: int,
                 cover: str | None, bgimg: str | None,
                 wave: bool, subtitle: str | None,
                 title_file: str | None, font: str | None) -> tuple[str, list[str]]:
    """返回 (filtergraph, 额外输入参数)。输入索引：0=音频，1=图片/背景（若有）"""
    parts: list[str] = []
    inputs: list[str] = []

    img_idx = None
    if cover:
        inputs += ["-loop", "1", "-framerate", str(fps), "-i", cover]
        img_idx = 1
    elif bgimg:
        inputs += ["-loop", "1", "-framerate", str(fps), "-i", bgimg]
        img_idx = 1

    if img_idx is not None and cover:
        fit = cfg["fit"]
        if fit == "blur":
            parts.append(
                f"[{img_idx}:v]scale={w}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h},boxblur=20:2,eq=brightness=-0.12:saturation=1.06[bg0]"
            )
            parts.append(f"[{img_idx}:v]scale={w}:{h}:force_original_aspect_ratio=decrease[fg]")
            parts.append("[bg0][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[bg]")
        elif fit == "contain":
            parts.append(
                f"[{img_idx}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={cfg['bg']},setsar=1[bg]"
            )
        else:  # cover
            parts.append(
                f"[{img_idx}:v]scale={w}:{h}:force_original_aspect_ratio=increase,"
                f"crop={w}:{h},setsar=1[bg]"
            )
    elif img_idx is not None:
        parts.append(f"[{img_idx}:v]scale={w}:{h},setsar=1[bg]")
    else:
        parts.append(f"color=c={cfg['bg']}:s={w}x{h}:r={fps},setsar=1[bg]")

    cur = "bg"

    if cfg.get("zoom") and img_idx is not None:
        parts.append(
            f"[{cur}]zoompan=z='min(zoom+0.00030,1.08)':d=1:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={fps}[bgz]"
        )
        cur = "bgz"

    if wave:
        wh = max(40, min(int(cfg["wave_height"]), int(h * 0.42)))
        parts.append(
            f"[0:a]aformat=channel_layouts=stereo,showwaves=s={w}x{wh}:"
            f"mode={cfg['wave_mode']}:rate={fps}:colors={cfg['wave_color']},"
            f"format=yuva420p,colorchannelmixer=aa=0.88[wv]"
        )
        parts.append(f"[{cur}][wv]overlay=0:H-{wh}[bgw]")
        cur = "bgw"

    if subtitle:
        parts.append(
            f"[{cur}]subtitles={ffpath(subtitle)}:force_style="
            f"'FontName=Microsoft YaHei,FontSize=20,PrimaryColour=&H00FFFFFF,"
            f"OutlineColour=&H66000000,BorderStyle=1,Outline=2,Shadow=1,"
            f"Alignment=2,MarginV=56'[bgs]"
        )
        cur = "bgs"

    if title_file:
        dt = (
            f"drawtext=textfile={ffpath(title_file)}"
            f":fontcolor={cfg['title_color']}"
            f":fontsize={int(cfg['_title_size'])}"
            f":x=(w-text_w)/2:y=h*{cfg['title_y']}"
            f":box=1:boxcolor=black@0.30:boxborderw=24"
        )
        if font:
            dt = f"drawtext=fontfile={ffpath(font)}:" + dt[len("drawtext="):]
        parts.append(f"[{cur}]{dt}[bgt]")
        cur = "bgt"

    parts.append(f"[{cur}]format=yuv420p,fps={fps}[vpre]")

    # 首尾各 0.5s 淡入淡出，避免开头黑闪
    fade = float(cfg.get("fade", 0) or 0)
    if fade > 0 and dur > fade * 2.4:
        parts.append(
            f"[vpre]fade=t=in:st=0:d={fade:.2f},"
            f"fade=t=out:st={dur - fade:.2f}:d={fade:.2f}[vout]"
        )
    else:
        parts.append("[vpre]null[vout]")

    return ";".join(parts), inputs


# ------------------------------------------------------------------ 编码
PROG_RE = re.compile(r"out_time_us=(\d+)")


def run_ffmpeg(cmd: list[str], dur: float, label: str = "编码") -> None:
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding="utf-8", errors="replace", bufsize=1)
    W = 26
    t0 = time.time()
    for line in p.stdout:  # type: ignore[union-attr]
        m = PROG_RE.search(line or "")
        if m and dur > 0:
            d = int(m.group(1)) / 1e6
            pct = min(1.0, d / dur)
            bar = "█" * int(W * pct) + "·" * (W - int(W * pct))
            sys.stdout.write(f"\r  {label} [{bar}] {pct*100:5.1f}%  "
                             f"{hhmmss(d)}/{hhmmss(dur)}  {time.time()-t0:5.1f}s ")
            sys.stdout.flush()
    err = p.stderr.read() if p.stderr else ""   # type: ignore[union-attr]
    p.wait()
    sys.stdout.write("\r" + " " * 96 + "\r")
    sys.stdout.flush()
    if p.returncode != 0:
        raise SystemExit(f"[错误] ffmpeg 失败：\n{err.strip()[-2500:]}")


def make_one(audio: str, a, cfg: dict, out_dir: str) -> str | None:
    ffmpeg = find_tool("ffmpeg")
    if not ffmpeg:
        raise SystemExit("[错误] 找不到可运行的 ffmpeg（可能被执行策略拦截）。"
                         "运行 --doctor 看详情。")

    w, h = parse_size(a.size or cfg["size"])
    fps = int(a.fps or cfg["fps"])
    dur, ch = audio_info(audio)

    cfg = dict(cfg)
    if a.title is not None:
        cfg["title"] = a.title
    if a.fit:
        cfg["fit"] = a.fit
    if a.bg:
        cfg["bg"] = norm_color(a.bg)
        cfg["gradient_on"] = False
    if a.wave_color:
        cfg["wave_color"] = norm_color(a.wave_color)
    if a.wave_height:
        cfg["wave_height"] = a.wave_height
    if a.no_zoom:
        cfg["zoom"] = False
    if a.fade is not None:
        cfg["fade"] = a.fade

    cover = a.image
    if cover and not os.path.isfile(cover):
        raise SystemExit(f"[错误] 封面图不存在：{cover}")

    # 多图卡点
    images: list[str] = []
    if a.images:
        for p in a.images.split(","):
            p = p.strip()
            if not p:
                continue
            if os.path.isdir(p):
                for fn in sorted(os.listdir(p)):
                    if os.path.splitext(fn)[1].lower() in IMG_EXT:
                        images.append(os.path.join(p, fn))
            elif os.path.isfile(p):
                images.append(p)
            else:
                log(f"[warn] 图片不存在，跳过：{p}")
        if images and not cover:
            cover = images[0]

    smart_wave = (not cover)
    wave = a.wave or (cfg["wave"] if cfg["wave"] is not None else smart_wave)
    if a.no_wave or len(images) > 1:
        wave = False

    bgimg = None
    if not cover:
        if cfg["gradient_on"]:
            bgimg = make_gradient(w, h, cfg["gradient"][0], cfg["gradient"][1])
        else:
            bgimg = make_gradient(w, h, cfg["bg"], cfg["bg"], glow=False)

    # 标题
    title_file = None
    if cfg["title"]:
        os.makedirs(CACHE, exist_ok=True)
        title_file = os.path.join(CACHE, "title.txt")
        with open(title_file, "w", encoding="utf-8") as f:
            f.write(cfg["title"])
        ts = int(cfg["title_size"]) or max(28, int(h * 0.055))
        if len(cfg["title"]) > 22:
            ts = max(24, int(ts * 22 / len(cfg["title"])))
        cfg["_title_size"] = ts
    if a.size and parse_size(a.size)[0] < parse_size(a.size)[1]:
        cfg["title_y"] = 0.80

    sub = a.subtitle
    if sub is None:
        guess = os.path.splitext(audio)[0] + ".srt"
        sub = guess if os.path.isfile(guess) else None
    if sub and not os.path.isfile(sub):
        raise SystemExit(f"[错误] 字幕不存在：{sub}")

    font = pick_font(cfg) if title_file else None

    # 卡点模式：给了多张图就走多图序列
    if images and len(images) > 1:
        per = float(a.per or cfg.get("per_img", 0))
        if per <= 0:
            per = dur / len(images)
        graph, extra_inputs = build_slideshow_filter(
            cfg, dur, w, h, fps, images, per, sub, title_file, font)
    else:
        graph, extra_inputs = build_filter(cfg, dur, w, h, fps, cover, bgimg,
                                           wave, sub, title_file, font)

    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(audio))[0]
    suffix = a.tag if a.tag is not None else cfg["tag"]
    out = a.output or os.path.join(out_dir, f"{stem}{suffix}.mp4")
    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)

    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-nostats",
           "-i", audio] + extra_inputs
    cmd += ["-filter_complex", graph, "-map", "[vout]", "-map", "0:a:0"]

    hw = pick_hwenc(str(a.hwenc or cfg.get("hwenc", "auto")))
    if hw:
        cmd += ["-c:v", hw]
        if hw == "h264_nvenc":
            q = str(a.crf or cfg["crf"])
            cmd += ["-preset", "p5", "-rc", "vbr", "-cq", q, "-b:v", "0",
                    "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1"]
        elif hw == "h264_qsv":
            cmd += ["-preset", "medium", "-global_quality", str(a.crf or cfg["crf"]),
                    "-pix_fmt", "nv12"]
        else:
            cmd += ["-quality", "quality", "-rc", "cqp", "-qp_i", "20", "-qp_p", "22",
                    "-pix_fmt", "yuv420p"]
    else:
        cmd += ["-c:v", "libx264", "-preset", str(a.preset or cfg["preset"]),
                "-crf", str(a.crf or cfg["crf"]), "-pix_fmt", "yuv420p",
                "-profile:v", "high", "-level", "4.1"]

    cmd += ["-ac", "2", "-ar", "44100"]
    if cfg.get("loudnorm") or a.loudnorm:
        cmd += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
    cmd += ["-c:a", "aac", "-b:a", str(a.audio_bitrate or cfg["audio_bitrate"])]
    cmd += ["-t", f"{dur:.3f}", "-movflags", "+faststart", "-progress", "pipe:1", out]

    log(f"\n▶ {os.path.basename(audio)}")
    log(f"  时长 {hhmmss(dur)}   {w}x{h}@{fps}   声道 {ch}")
    log(f"  背景 {'封面图 ' + os.path.basename(cover) if cover else '程序生成渐变'}"
        f"   {'波形开' if wave else '波形关'}"
        f"   {'有标题' if title_file else '无标题'}"
        f"   {'有字幕' if sub else '无字幕'}"
        f"   编码 {'GPU/' + hw if hw else 'CPU/x264'}")

    if a.dry_run:
        log("  [dry-run] " + " ".join(f'"{c}"' if " " in c else c for c in cmd))
        return None

    run_ffmpeg(cmd, dur)
    if not os.path.isfile(out) or os.path.getsize(out) == 0:
        raise SystemExit("[错误] 输出文件没生成。")
    log(f"  ✔ {out}  ({os.path.getsize(out)/1048576:.1f} MB)")
    return out


# ------------------------------------------------------------------ 自检
def doctor() -> int:
    log("环境自检")
    log("-" * 52)
    ok = True
    for name in ("ffmpeg", "ffprobe"):
        p = find_tool(name)
        if p:
            try:
                line = subprocess.run([p, "-version"], capture_output=True, text=True,
                                      encoding="utf-8", errors="replace",
                                      timeout=20).stdout.splitlines()[0]
            except Exception:
                line = "(读取版本失败)"
            log(f"  {name:8s} ✔ {p}")
            log(f"  {'':8s}   {line[:70]}")
        else:
            ok = False
            log(f"  {name:8s} ✘ 未找到或无法执行")
    f = pick_font(load_config())
    log(f"  {'font':8s} {'✔ ' + f if f else '✘ 无（标题可能显示异常）'}")
    for d in ("input", "output", "assets"):
        p = os.path.join(HERE, d)
        os.makedirs(p, exist_ok=True)
        log(f"  {d+'/':8s} ✔ {p}")
    log("-" * 52)
    log("状态正常，可以开工。" if ok else "缺少 ffmpeg，先跑 setup.py 安装。")
    return 0 if ok else 1


# ------------------------------------------------------------------ 入口
def main() -> int:
    cfg = load_config()
    ap = argparse.ArgumentParser(
        formatter_class=argparse.RawTextHelpFormatter,
        description="音频转视频：封面/渐变背景 + 波形 + 标题 + 字幕")
    ap.add_argument("inputs", nargs="*", help="音频文件或目录，留空=处理 input/")
    ap.add_argument("-i", "--image", help="封面图")
    ap.add_argument("--images", help="多图卡点：逗号分隔的图片路径，或一个图片目录")
    ap.add_argument("--per", type=float, help="卡点时每张图显示秒数，默认均分时长")
    ap.add_argument("-o", "--output", help="输出路径（单文件时有效）")
    ap.add_argument("--size", help="vertical / square / 1920x1080 / 4k")
    ap.add_argument("--fps", type=int)
    ap.add_argument("--crf", type=int, help="画质，越小越清晰（默认20）")
    ap.add_argument("--preset", help="x264预设 ultrafast..veryslow")
    ap.add_argument("--audio-bitrate", dest="audio_bitrate")
    ap.add_argument("--fit", choices=["cover", "contain", "blur"])
    ap.add_argument("--bg", help="背景色 0x101014，指定后不用渐变")
    ap.add_argument("--wave", action="store_true", help="强制显示波形")
    ap.add_argument("--no-wave", dest="no_wave", action="store_true")
    ap.add_argument("--wave-color", dest="wave_color")
    ap.add_argument("--wave-height", dest="wave_height", type=int)
    ap.add_argument("--title")
    ap.add_argument("--title-size", dest="title_size", type=int)
    ap.add_argument("--subtitle")
    ap.add_argument("--no-zoom", dest="no_zoom", action="store_true")
    ap.add_argument("--fade", type=float, help="首尾淡入淡出秒数，0=关闭，默认0.5")
    ap.add_argument("--out-dir", dest="out_dir", help="输出目录，默认 output/")
    ap.add_argument("--tag", help="输出文件名后缀")
    ap.add_argument("--hwenc", choices=["auto", "nvenc", "qsv", "amf", "off"],
                    help="硬件编码，默认 auto（有独显自动用）")
    ap.add_argument("--loudnorm", action="store_true", help="响度标准化到 -16 LUFS")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true")
    ap.add_argument("--doctor", action="store_true")
    a = ap.parse_args()

    if a.doctor:
        return doctor()

    out_dir = a.out_dir or os.path.join(HERE, "output")
    srcs = a.inputs or [os.path.join(HERE, "input")]
    targets: list[str] = []
    for s in srcs:
        if os.path.isdir(s):
            for fn in sorted(os.listdir(s)):
                if os.path.splitext(fn)[1].lower() in AUDIO_EXT:
                    targets.append(os.path.join(s, fn))
        elif os.path.isfile(s):
            targets.append(s)
        else:
            log(f"[warn] 路径不存在：{s}")

    if not targets:
        log(f"[提示] 没找到音频。放进 {os.path.join(HERE, 'input')} 后再运行，")
        log("       或者：python a2v.py 你的音频.mp3")
        return 1

    log(f"共 {len(targets)} 个音频 → {out_dir}")
    t0 = time.time()
    done, failed = [], []
    for i, f in enumerate(targets, 1):
        log(f"\n[{i}/{len(targets)}]")
        try:
            o = make_one(f, a, cfg, out_dir)
            if o:
                done.append(o)
        except SystemExit as e:
            log(str(e))
            failed.append(os.path.basename(f))

    log(f"\n完成 {len(done)} 个，失败 {len(failed)} 个，用时 {time.time()-t0:.1f}s")
    for d in done:
        log("  ✔ " + d)
    for f in failed:
        log("  ✘ " + f)
    return 0 if not failed else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("\n已中断。")
        sys.exit(130)