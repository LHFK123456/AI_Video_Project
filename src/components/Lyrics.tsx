import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { clamp } from "../lib/beats";
import type { Lyric } from "../types";

type Props = {
  lyrics: Lyric[];
  accent1: string;
  accent2: string;
  fontSize: number;
  /** 底部位置（像素） */
  bottom: number;
  /** 显示窗口：句子结束后额外保留秒数 */
  hangover?: number;
};

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 歌词：逐字点亮（卡拉OK式），配合缩放与发光。
 * 上一句淡出、下一句淡入，避免硬切。
 */
export const Lyrics: React.FC<Props> = ({
  lyrics,
  accent1,
  accent2,
  fontSize,
  bottom,
  hangover = 0.45,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  if (!lyrics.length) return null;

  // 找出当前应显示的句子（含 hangover 窗口）
  let current: Lyric | null = null;
  let next: Lyric | null = null;
  for (let i = 0; i < lyrics.length; i++) {
    const l = lyrics[i];
    if (t >= l.start - 0.28 && t <= l.end + hangover) {
      current = l;
      next = lyrics[i + 1] ?? null;
      break;
    }
  }
  if (!current) return null;

  const inP = clamp((t - (current.start - 0.28)) / 0.28);
  const outP = current.end + hangover > t
    ? 1
    : clamp(1 - (t - (current.end + hangover)) / 0.3);
  const opacity = Math.min(inP, outP);
  // 离场时上移并模糊
  const exitShift = (1 - outP) * -fontSize * 0.3;

  const chars = Array.from(current.text);
  const span = Math.max(0.25, current.end - current.start);
  const per = span / Math.max(1, chars.length);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${exitShift}px)`,
        paddingInline: "8%",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          fontSize,
          fontWeight: 800,
          lineHeight: 1.32,
          letterSpacing: fontSize * 0.02,
          padding: `${fontSize * 0.24}px ${fontSize * 0.62}px`,
          borderRadius: fontSize * 0.5,
          background: hexToRgba("#000000", 0.32),
          backdropFilter: "blur(6px)",
          textAlign: "center",
        }}
      >
        {chars.map((ch, i) => {
          const cs = current!.start + i * per;
          const lit = clamp((t - cs) / Math.max(0.08, per * 0.85));
          const isLit = lit > 0.01;
          // 刚点亮的字有轻微弹起
          const pop = isLit ? Math.sin(Math.min(1, lit) * Math.PI) * 0.06 : 0;

          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                color: isLit ? "#ffffff" : hexToRgba("#ffffff", 0.42),
                transform: `scale(${1 + pop}) translateY(${-pop * fontSize * 0.5}px)`,
                textShadow: isLit
                  ? `0 0 ${fontSize * 0.22}px ${hexToRgba(accent1, 0.55 * lit)}, 0 0 ${fontSize * 0.5}px ${hexToRgba(accent2, 0.3 * lit)}, 0 2px 6px rgba(0,0,0,0.7)`
                  : "0 2px 6px rgba(0,0,0,0.7)",
                transition: "none",
              }}
            >
              {ch}
            </span>
          );
        })}
        {/* 下一句预告：极淡 */}
        {next && t > current.end + hangover - 0.35 && (
          <span
            style={{
              display: "block",
              width: "100%",
              marginTop: fontSize * 0.18,
              fontSize: fontSize * 0.58,
              color: hexToRgba("#ffffff", 0.34 * outP),
            }}
          >
            {next.text}
          </span>
        )}
      </div>
    </div>
  );
};

/** 没有歌词时，显示 BPM 与节拍指示 */
export const BeatIndicator: React.FC<{
  bpm: number;
  beats: { f: number; s: number }[];
  accent1: string;
  fontSize: number;
  bottom: number;
}> = ({ bpm, beats, accent1, fontSize, bottom }) => {
  const frame = useCurrentFrame();

  const dots = beats
    .map((b, i) => ({ ...b, i }))
    .filter((b) => b.f <= frame && frame - b.f < 12)
    .slice(-4);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: fontSize * 0.8,
      }}
    >
      <span
        style={{
          fontSize,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: fontSize * 0.2,
          fontWeight: 600,
        }}
      >
        {bpm} BPM
      </span>
      <div style={{ display: "flex", gap: fontSize * 0.3 }}>
        {[0, 1, 2, 3].map((k) => {
          const d = dots.find((x) => x.i % 4 === k);
          const act = d ? 1 - (frame - d.f) / 12 : 0;
          return (
            <div
              key={k}
              style={{
                width: fontSize * 0.42,
                height: fontSize * 0.42,
                borderRadius: "50%",
                backgroundColor: hexToRgba(accent1, 0.18 + act * 0.82),
                boxShadow: act > 0.05 ? `0 0 ${act * 14}px ${hexToRgba(accent1, act)}` : "none",
                transform: `scale(${1 + act * 0.45})`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};