import React from "react";
import {
  AbsoluteFill,
  Audio,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Sequence,
} from "remotion";
import { Background } from "./components/Background";
import { BeatTitle, Kicker } from "./components/BeatTitle";
import { Spectrum } from "./components/Spectrum";
import { Lyrics, BeatIndicator } from "./components/Lyrics";
import {
  beatFrames,
  clamp,
  downbeatHit,
  easeOutExpo,
  pulse,
  seg,
  smoothEnergy,
} from "./lib/beats";
import analysis from "./data/analysis.json";
import spectrum from "./data/spectrum.json";
import type { Analysis, BeatVideoProps } from "./types";

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const BeatVideo: React.FC<BeatVideoProps> = ({
  title,
  kicker,
  subtitle,
  accent1,
  accent2,
  background,
  intensity,
  showSpectrum,
  showLyrics,
  showGrid,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const A = analysis as unknown as Analysis;

  const frames = React.useMemo(
    () => beatFrames(A.beats, fps),
    [A.beats, fps],
  );

  const isPortrait = height > width;
  const isSquare = Math.abs(height - width) < 40;

  // 标题字号自适应：竖屏高度充裕，可以更大更冲；横屏受宽度约束
  const longestLine = Math.max(...title.split("\n").map((l) => Array.from(l).length), 1);
  const lineCount = title.split("\n").length;
  const byWidth = (width * 0.86) / Math.max(1, longestLine * 0.98);
  const byHeight = (height * 0.4) / Math.max(1, lineCount);
  // 上限按画幅比例给：竖屏可用到宽度的 22%，横屏 13%
  const cap = isPortrait ? width * 0.22 : isSquare ? width * 0.16 : width * 0.13;
  const titleSize = Math.max(28, Math.min(byWidth, byHeight, cap));

  const en = smoothEnergy(A.energy, frame, 2);
  const hit = downbeatHit(frames, frame, fps * 0.5);
  const kick = pulse(frames, frame, fps * 0.2);

  // 全局镜头：随能量轻微推拉
  const camScale = 1 + en * 0.022 * intensity + hit * 0.012;
  const camShake = hit * intensity * 1.6;
  const sx = Math.sin(frame * 2.7) * camShake;
  const sy = Math.cos(frame * 3.3) * camShake;

  // 强拍白闪
  const flash = Math.pow(kick, 5) * 0.16 * intensity;

  // 开场：短暂压暗后迅速透出背景，让首拍落下时画面已经"在场"
  const introP = seg(frame, 0, fps * 0.32, easeOutExpo);
  const introDark = (1 - introP) * 0.72;

  // 结尾：最后 0.6 秒淡出
  const outro = interpolate(
    frame,
    [durationInFrames - Math.round(fps * 0.6), durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // 标题入场时间：强拍落下时更带感
  const firstDown = A.downbeats[0] ?? 0;
  const titleIn = Math.max(Math.round(firstDown * fps), Math.round(fps * 0.12));

  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <Audio src={staticFile(A.audio)} />

      {/* 背景层：受镜头影响 */}
      <AbsoluteFill
        style={{
          transform: `scale(${camScale}) translate(${sx}px, ${sy}px)`,
        }}
      >
        <Background
          accent1={accent1}
          accent2={accent2}
          background={background}
          beats={A.beats}
          energy={A.energy}
          intensity={intensity}
          showGrid={showGrid}
        />
      </AbsoluteFill>

      {/* 内容层 */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingInline: width * 0.08,
          paddingBottom: isPortrait ? height * 0.24 : height * 0.16,
          gap: titleSize * 0.3,
          transform: `translateY(${isPortrait ? -height * 0.03 : -height * 0.02}px)`,
        }}
      >
        {kicker.trim() && (
          <Kicker
            text={kicker}
            beats={A.beats}
            accent1={accent1}
            startFrame={Math.max(0, titleIn - Math.round(fps * 0.3))}
            fontSize={titleSize * 0.24}
          />
        )}

        <BeatTitle
          text={title}
          beats={A.beats}
          accent1={accent1}
          accent2={accent2}
          intensity={intensity}
          fontSize={titleSize}
          startFrame={titleIn}
          stagger={1.4}
          beatOffset={0.85}
        />

        {subtitle.trim() && (
          <Subtitle
            text={subtitle}
            accent1={accent1}
            fontSize={titleSize * 0.3}
            startFrame={titleIn + Math.round(fps * 0.45)}
          />
        )}
      </AbsoluteFill>

      {/* 频谱 */}
      {showSpectrum && (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
          <Spectrum
            spectrum={spectrum as number[][]}
            beats={A.beats}
            accent1={accent1}
            accent2={accent2}
            intensity={intensity}
            mirrored={isSquare}
            hasLyrics={showLyrics && A.lyrics.length > 0}
          />
        </AbsoluteFill>
      )}

      {/* 歌词 或 节拍指示 */}
      {showLyrics && A.lyrics.length > 0 ? (
        <Lyrics
          lyrics={A.lyrics}
          accent1={accent1}
          accent2={accent2}
          fontSize={isPortrait ? width * 0.058 : width * 0.03}
          bottom={isPortrait ? height * 0.14 : height * 0.115}
        />
      ) : (
        <Sequence from={titleIn + Math.round(fps * 0.8)} layout="none">
          <BeatIndicator
            bpm={A.bpm}
            beats={frames}
            accent1={accent1}
            fontSize={isPortrait ? width * 0.032 : width * 0.018}
            bottom={isPortrait ? height * 0.115 : height * 0.075}
          />
        </Sequence>
      )}

      {/* 冲击白闪 */}
      <AbsoluteFill
        style={{
          backgroundColor: hexToRgba("#ffffff", flash),
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />

      {/* 开场黑场 + 结尾淡出 */}
      <AbsoluteFill
        style={{
          backgroundColor: hexToRgba("#000000", clamp(Math.max(introDark, 1 - outro))),
          pointerEvents: "none",
        }}
      />

      {/* 扫描线质感 */}
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.022) 0px, rgba(255,255,255,0.022) 1px, transparent 1px, transparent 3px)",
          pointerEvents: "none",
          opacity: 0.55,
        }}
      />
    </AbsoluteFill>
  );
};

const Subtitle: React.FC<{
  text: string;
  accent1: string;
  fontSize: number;
  startFrame: number;
}> = ({ text, accent1, fontSize, startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = seg(frame, startFrame, fps * 0.45, easeOutExpo);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: fontSize * 0.5,
        opacity: p * 0.9,
        transform: `translateY(${(1 - p) * fontSize * 0.5}px)`,
      }}
    >
      <div
        style={{
          width: fontSize * 0.14,
          height: fontSize * 0.14,
          borderRadius: "50%",
          backgroundColor: accent1,
        }}
      />
      <span
        style={{
          fontSize,
          fontWeight: 600,
          letterSpacing: fontSize * 0.16,
          color: "rgba(255,255,255,0.7)",
        }}
      >
        {text}
      </span>
    </div>
  );
};