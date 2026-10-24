import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { clamp, easeOutCubic, hash, pulseW } from "../lib/motion";

type Props = {
  text: string;
  beats: { f: number; s: number }[];
  /** 文字开始浮现的帧 */
  startFrame: number;
  /** 每个字之间的间隔（帧） */
  stagger: number;
  fontSize: number;
  letterSpacing: number;
  /** 字颜色 */
  color: string;
  /** 是否竖排逐字（竖屏用） */
  vertical: boolean;
};

/**
 * 蓄力期文字：砖块式逐字浮现。
 * 每个字：从下方 14px 升起 + 透明度 0→1 + 极轻微模糊消散。
 * 全程不带霓虹、不带弹跳，保持克制压抑。
 */
export const BuildText: React.FC<Props> = ({
  text,
  beats,
  startFrame,
  stagger,
  fontSize,
  letterSpacing,
  color,
  vertical,
}) => {
  const frame = useCurrentFrame();

  // 蓄力期的轻微呼吸：跟随起音做极小幅度的缩放（1.0 ~ 1.012）
  const breathe = pulseW(beats, frame, 22, 0.2) * 0.012;
  // 逐字浮现的总体节奏：整段文字大约占用 stagger*字数 帧
  const lines = text.split("\n");

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: fontSize * 0.28,
        transform: `scale(${1 + breathe})`,
      }}
    >
      {lines.map((line, li) => {
        const chars = Array.from(line);
        return (
          <div
            key={li}
            style={{
              display: "flex",
              flexDirection: vertical ? "row" : "row",
              justifyContent: "center",
              flexWrap: "nowrap",
            }}
          >
            {chars.map((ch, ci) => {
              // 每个字独立的入场时间，形成"一块块砌上去"的节奏
              // 单字耗时 55 帧（约 0.9s），比之前慢一倍，更有"沉降"的重量感
              const idx = li * 100 + ci;
              const at = startFrame + idx * stagger;
              const p = clamp((frame - at) / 55);
              const e = easeOutCubic(p);

              // 微小的确定性抖动，让机械感更自然
              const nudge = (hash(idx * 3.17) - 0.5) * 2;

              const opacity = p <= 0 ? 0 : 0.08 + 0.92 * e;
              const rise = (1 - e) * fontSize * 0.3;
              const blur = (1 - e) * 2.2;

              // 字间距在浮现时略微收紧，像"压实"
              const track = (1 - e) * fontSize * 0.12;

              return (
                <span
                  key={ci}
                  style={{
                    display: "inline-block",
                    fontSize,
                    fontWeight: 200,
                    letterSpacing: `${letterSpacing}px`,
                    marginRight: track,
                    color,
                    fontFamily:
                      '"HarmonyOS Sans SC", "Source Han Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif',
                    transform: `translateY(${rise + nudge * 0.6}px)`,
                    opacity,
                    filter: blur > 0.1 ? `blur(${blur}px)` : undefined,
                    whiteSpace: "pre",
                  }}
                >
                  {ch === " " ? "\u00A0" : ch}
                </span>
              );
            })}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};