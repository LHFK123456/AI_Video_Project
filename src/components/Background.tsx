import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { beatFrames, downbeatHit, hash, pulse, smoothEnergy } from "../lib/beats";
import type { Beat } from "../types";

type Props = {
  accent1: string;
  accent2: string;
  background: string;
  beats: Beat[];
  energy: number[];
  intensity: number;
  showGrid: boolean;
};

/** 把 hex 转 rgba 字符串 */
function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const Background: React.FC<Props> = ({
  accent1,
  accent2,
  background,
  beats,
  energy,
  intensity,
  showGrid,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const frames = React.useMemo(
    () => beatFrames(beats, fps),
    [beats, fps],
  );

  const hit = downbeatHit(frames, frame, fps * 0.55);
  const kickPulse = pulse(frames, frame, fps * 0.28);
  const en = smoothEnergy(energy, frame, 2);
  const t = frame / fps;

  // 缓慢漂移的主光斑
  const driftX = Math.sin(t * 0.31) * 8;
  const driftY = Math.cos(t * 0.24) * 6;
  const glowScale = 1 + hit * 0.24 + en * 0.12;

  // 三条流动的色带，位置由音频能量与时间共同决定
  const bands = Array.from({ length: 3 }, (_, i) => {
    const ph = t * (0.18 + i * 0.07) + i * 1.8;
    const y = 50 + Math.sin(ph) * 26 + i * 6;
    const rot = -18 + Math.sin(ph * 0.7) * 9 + i * 7;
    const op = 0.1 + 0.16 * (0.5 + 0.5 * Math.sin(ph * 1.3)) + en * 0.1;
    return { y, rot, op: op * intensity * 0.9, c: i % 2 === 0 ? accent1 : accent2 };
  });

  // 网格随强拍向外推
  const gridScale = 1 + hit * 0.05;
  const gridOp = 0.055 + kickPulse * 0.075;

  // 音浪涟漪：每拍一圈
  const ripples = Array.from({ length: 5 }, (_, i) => {
    const idx = Math.floor(frame / Math.max(1, fps * 0.25)) - i;
    const bf = frames[idx];
    if (!bf) return null;
    const age = frame - bf.f;
    if (age < 0 || age > fps * 0.9) return null;
    const p = age / (fps * 0.9);
    return {
      p,
      s: bf.s,
      size: 12 + p * 78,
      op: (1 - p) * 0.16 * bf.s,
    };
  }).filter(Boolean) as { p: number; s: number; size: number; op: number }[];

  const noise = Array.from({ length: 26 }, (_, i) => ({
    x: hash(i * 3.7) * 100,
    y: hash(i * 7.3 + 1) * 100,
    r: 0.6 + hash(i * 2.1) * 2.2,
    op: 0.06 + hash(i * 5.5) * 0.16,
    sp: 0.3 + hash(i * 9.1) * 0.9,
    ph: hash(i * 4.4) * 6.28,
  }));

  return (
    <AbsoluteFill style={{ backgroundColor: background, overflow: "hidden" }}>
      {/* 主光晕：居中偏上，围绕标题而非压住歌词 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "42%",
          width: width * 1.35,
          height: height * 1.35,
          transform: `translate(-50%, -50%) translate(${driftX}px, ${driftY}px) scale(${glowScale})`,
          background: `radial-gradient(circle at 50% 50%, ${hexToRgba(accent1, 0.26 + hit * 0.13)} 0%, ${hexToRgba(accent2, 0.11)} 32%, transparent 62%)`,
          filter: "blur(52px)",
        }}
      />

      {/* 副光晕：挪到右上，避开底部歌词区 */}
      <div
        style={{
          position: "absolute",
          right: "-20%",
          top: "-10%",
          width: width * 0.8,
          height: height * 0.8,
          transform: `scale(${1 + kickPulse * 0.12})`,
          background: `radial-gradient(circle, ${hexToRgba(accent2, 0.18)} 0%, transparent 60%)`,
          filter: "blur(64px)",
        }}
      />

      {/* 斜向色带：整体上移，不压歌词 */}
      {bands.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: "-25%",
            top: `${b.y * 0.78}%`,
            width: "150%",
            height: `${5 + i * 2}%`,
            transform: `rotate(${b.rot}deg)`,
            background: `linear-gradient(90deg, transparent, ${hexToRgba(b.c, b.op * 0.75)}, transparent)`,
            filter: "blur(30px)",
            mixBlendMode: "screen",
          }}
        />
      ))}

      {/* 网格 */}
      {showGrid && (
        <AbsoluteFill
          style={{
            transform: `scale(${gridScale})`,
            backgroundImage: `linear-gradient(${hexToRgba("#ffffff", gridOp)} 1px, transparent 1px), linear-gradient(90deg, ${hexToRgba("#ffffff", gridOp)} 1px, transparent 1px)`,
            backgroundSize: `${96}px ${96}px`,
            maskImage:
              "radial-gradient(ellipse 62% 62% at 50% 50%, black 30%, transparent 78%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 62% 62% at 50% 50%, black 30%, transparent 78%)",
          }}
        />
      )}

      {/* 音浪涟漪 */}
      {ripples.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: `${r.size}vmin`,
            height: `${r.size}vmin`,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            border: `2px solid ${hexToRgba(accent1, r.op)}`,
            boxShadow: `0 0 ${20 + r.p * 40}px ${hexToRgba(accent2, r.op * 0.7)}`,
          }}
        />
      ))}

      {/* 浮动微粒 */}
      {noise.map((p, i) => {
        const y = (p.y + t * p.sp * 3) % 110;
        const op = p.op * (0.5 + 0.5 * Math.sin(t * 2.2 + p.ph)) * (0.6 + en * 0.8);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${p.x}%`,
              top: `${y}%`,
              width: p.r,
              height: p.r,
              borderRadius: "50%",
              backgroundColor: hexToRgba(i % 3 === 0 ? accent1 : "#ffffff", op),
            }}
          />
        );
      })}

      {/* 暗角 */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 45%, transparent 34%, ${hexToRgba("#000000", 0.42)} 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};