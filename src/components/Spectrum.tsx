import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { beatFrames, clamp, hash, pulse } from "../lib/beats";
import type { Beat } from "../types";

type Props = {
  spectrum: number[][];
  beats: Beat[];
  accent1: string;
  accent2: string;
  intensity: number;
  /** 镜像条数（中间向两侧） */
  mirrored: boolean;
  /** 有歌词时压缩频谱高度，给歌词让位 */
  hasLyrics?: boolean;
};

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 底部频谱柱。左低右高，镜像时从中心向两侧展开。
 * 每根柱子高度由该频段真实能量驱动，并叠加踩点脉冲。
 */
export const Spectrum: React.FC<Props> = ({
  spectrum,
  beats,
  accent1,
  accent2,
  intensity,
  mirrored,
  hasLyrics = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const frames = React.useMemo(
    () => beatFrames(beats, fps),
    [beats, fps],
  );

  const row = spectrum[Math.min(frame, spectrum.length - 1)] ?? [];
  const bands = row.length || 48;
  const kick = pulse(frames, frame, fps * 0.2);
  const kickSlow = pulse(frames, frame, fps * 0.45);

  // 平滑：取当前帧与前后帧平均，减少单帧抖动
  const smooth = React.useMemo(() => {
    const out: number[] = [];
    for (let b = 0; b < bands; b++) {
      let s = 0;
      let w = 0;
      for (let d = -1; d <= 1; d++) {
        const f = frame + d;
        if (f < 0 || f >= spectrum.length) continue;
        const weight = 2 - Math.abs(d);
        s += (spectrum[f]?.[b] ?? 0) * weight;
        w += weight;
      }
      out.push(w ? s / w : 0);
    }
    return out;
  }, [spectrum, frame, bands]);

  const barCount = mirrored ? Math.min(bands, 40) * 2 : Math.min(bands, 64);
  const half = barCount / 2;
  const barW = Math.min(14, (width * 0.62) / barCount);
  const gap = barW * 0.46;
  // 有歌词时压扁频谱并下移，避免与歌词抢位置
  const compact = !!hasLyrics;
  const maxH = height * (compact ? 0.115 : 0.2);
  const baseY = height * (compact ? 0.935 : 0.855);

  const bars = Array.from({ length: barCount }, (_, i) => {
    // 镜像时中心为低频，向两侧频率递增；非镜像时左低右高
    const fromCenter = Math.abs(i - half + 0.5);
    const norm = mirrored
      ? Math.min(1, fromCenter / Math.max(1, half - 0.5))
      : i / Math.max(1, barCount - 1);
    const idx = Math.max(0, Math.min(bands - 1, Math.floor(norm * bands)));

    const v = smooth[idx] ?? 0;
    // 低频更高一些，符合视觉习惯
    const boost = mirrored ? 1 - norm * 0.66 : 0.6 + (1 - norm) * 0.4;
    const h =
      (0.06 + Math.pow(v, 0.82) * 0.94 * boost) * maxH * (0.72 + intensity * 0.34);

    const x = mirrored
      ? width / 2 + (i < half ? -(half - i - 0.5) : i - half + 0.5) * (barW + gap)
      : (width - barCount * (barW + gap)) / 2 + i * (barW + gap);

    // 颜色：低频用 accent1，高频过渡到 accent2
    const mix = norm;
    const jitter = 0.85 + hash(i * 2.3 + Math.floor(frame / 4)) * 0.3;
    const alpha = (0.5 + v * 0.5) * jitter;

    return { x, h, w: barW, alpha, mix, v, idx };
  });

  return (
    <>
      {/* 频谱倒影光 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: height * 0.34,
          background: `linear-gradient(to top, ${hexToRgba(accent1, 0.14 + kick * 0.1)}, transparent)`,
          pointerEvents: "none",
        }}
      />

      {bars.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x,
            top: baseY - b.h,
            width: b.w,
            height: b.h,
            borderRadius: b.w * 0.4,
            background: `linear-gradient(to bottom, ${hexToRgba("#ffffff", b.alpha * 0.95)}, ${hexToRgba(b.mix > 0.5 ? accent2 : accent1, b.alpha)})`,
            boxShadow: `0 0 ${6 + b.v * 20}px ${hexToRgba(b.mix > 0.5 ? accent2 : accent1, b.alpha * 0.75)}`,
            opacity: clamp(0.35 + b.v * 0.75),
          }}
        />
      ))}

      {/* 基线 */}
      <div
        style={{
          position: "absolute",
          left: width * 0.12,
          right: width * 0.12,
          top: baseY,
          height: Math.max(1, 1.5 + kickSlow * 2),
          background: `linear-gradient(90deg, transparent, ${hexToRgba(accent1, 0.5 + kick * 0.4)}, ${hexToRgba(accent2, 0.4)}, transparent)`,
          boxShadow: `0 0 ${8 + kickSlow * 22}px ${hexToRgba(accent1, 0.45)}`,
        }}
      />
    </>
  );
};