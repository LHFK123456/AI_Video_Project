import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import {
  beatFrames,
  beatSpring,
  clamp,
  downbeatHit,
  easeOutBack,
  easeOutExpo,
  hash,
  preBeat,
  pulse,
  seg,
} from "../lib/beats";
import type { Beat } from "../types";

type Props = {
  text: string;
  beats: Beat[];
  accent1: string;
  accent2: string;
  intensity: number;
  /** 字号（像素，已含缩放） */
  fontSize: number;
  /** 入场起始帧 */
  startFrame?: number;
  /** 逐字入场的错开帧数 */
  stagger?: number;
  /** 每字响应节拍的相位偏移（帧） */
  beatOffset?: number;
  align?: "center" | "left";
};

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 逐行拆字。每个字独立受节拍驱动：
 *  - 鼓点触发时 scale 从弹簧峰值回弹
 *  - 字上升、发光、轻微旋转
 *  - 相邻字有相位差，形成波浪
 */
export const BeatTitle: React.FC<Props> = ({
  text,
  beats,
  accent1,
  accent2,
  intensity,
  fontSize,
  startFrame = 0,
  stagger = 1.6,
  beatOffset = 0.9,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const frames = React.useMemo(
    () => beatFrames(beats, fps),
    [beats, fps],
  );

  const lines = text.split("\n");
  let charIndex = 0;

  // 强拍冲击：整块标题一起出现轻微的挤压
  const blockHit = downbeatHit(frames, frame, fps * 0.42);
  const blockKick = pulse(frames, frame, fps * 0.2);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: fontSize * 0.14,
        transform: `scale(${1 + blockHit * 0.022 * intensity})`,
        transformOrigin: "center center",
      }}
    >
      {lines.map((line, li) => (
        <div
          key={li}
          style={{
            display: "flex",
            justifyContent: align === "center" ? "center" : "flex-start",
            whiteSpace: "pre",
          }}
        >
          {Array.from(line).map((ch, ci) => {
            const idx = charIndex++;
            if (ch === " ") {
              return (
                <span
                  key={ci}
                  style={{ display: "inline-block", width: fontSize * 0.28 }}
                />
              );
            }

            // 逐字入场
            const inStart = startFrame + idx * stagger;
            const inP = seg(frame, inStart, fps * 0.5, easeOutBack);
            const opacityIn = interpolate(frame, [inStart, inStart + fps * 0.2], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });

            // 该字响应节拍的时刻（相位差 → 波浪）
            const ph = (idx % 6) * beatOffset;
            const springF = beatSpring(frames, frame - ph, fps, {
              damping: 10.5,
              stiffness: 200,
              mass: 0.5,
            });
            const kick = pulse(frames, frame - ph, fps * 0.24);
            const pre = preBeat(frames, frame - ph, Math.max(2, fps * 0.1));

            // 缩放：入场基底 × 鼓点弹簧
            const beatScale = 1 + springF * 0.3 * intensity;
            const scale = inP * beatScale * (1 - pre * 0.035);

            // 位移：鼓点时向上跳
            const jumpY = -springF * fontSize * 0.13 * intensity;
            const tilt = (hash(idx * 1.3) - 0.5) * 6 * kick * intensity;

            // 发光
            const glow = kick * 0.85 * intensity + springF * 0.3;

            return (
              <span
                key={ci}
                style={{
                  display: "inline-block",
                  fontSize,
                  lineHeight: 1.06,
                  fontWeight: 900,
                  letterSpacing: `${fontSize * 0.015}px`,
                  color: "#ffffff",
                  opacity: opacityIn,
                  transform: `translateY(${jumpY}px) scale(${scale}) rotate(${tilt}deg)`,
                  transformOrigin: "center 62%",
                  textShadow: [
                    `0 0 ${8 + glow * 26}px ${hexToRgba(accent1, 0.55 * clamp(glow, 0, 1))}`,
                    `0 0 ${18 + glow * 52}px ${hexToRgba(accent2, 0.42 * clamp(glow, 0, 1))}`,
                    `0 ${fontSize * 0.03}px ${fontSize * 0.09}px rgba(0,0,0,0.55)`,
                  ].join(", "),
                  WebkitTextStroke: `${Math.max(0.5, fontSize * 0.004)}px ${hexToRgba(accent1, 0.28 + kick * 0.45)}`,
                  willChange: "transform",
                }}
              >
                {ch}
              </span>
            );
          })}
        </div>
      ))}

      {/* 底光条：随强拍拉宽 */}
      <div
        style={{
          width: `${18 + blockKick * 26 * intensity + blockHit * 10}%`,
          height: Math.max(2, fontSize * 0.035),
          marginTop: fontSize * 0.06,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent, ${hexToRgba(accent1, 0.95)}, ${hexToRgba(accent2, 0.75)}, transparent)`,
          boxShadow: `0 0 ${14 + blockKick * 34}px ${hexToRgba(accent1, 0.5 + blockKick * 0.4)}`,
          opacity: 0.55 + blockKick * 0.45,
        }}
      />
    </div>
  );
};

/**
 * 小标签（kicker）：字母间距 + 逐字淡入，带轻微踩点
 */
export const Kicker: React.FC<{
  text: string;
  beats: Beat[];
  accent1: string;
  startFrame?: number;
  fontSize: number;
}> = ({ text, beats, accent1, startFrame = 0, fontSize }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frames = React.useMemo(
    () => beatFrames(beats, fps),
    [beats, fps],
  );
  const p = seg(frame, startFrame, fps * 0.5, easeOutExpo);
  const k = pulse(frames, frame, fps * 0.22);
  const en = 0.55 + k * 0.45;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: fontSize * 0.6,
        opacity: p * en,
        transform: `translateY(${(1 - p) * -10}px)`,
      }}
    >
      <div
        style={{
          width: fontSize * 1.6,
          height: Math.max(1.5, fontSize * 0.12),
          background: accent1,
          boxShadow: `0 0 ${10 + k * 16}px ${hexToRgba(accent1, 0.8)}`,
        }}
      />
      <span
        style={{
          fontSize,
          fontWeight: 700,
          letterSpacing: fontSize * 0.34,
          color: hexToRgba("#ffffff", 0.82),
          textTransform: "uppercase",
        }}
      >
        {text}
      </span>
      <div
        style={{
          width: fontSize * 1.6,
          height: Math.max(1.5, fontSize * 0.12),
          background: accent1,
          boxShadow: `0 0 ${10 + k * 16}px ${hexToRgba(accent1, 0.8)}`,
        }}
      />
    </div>
  );
};