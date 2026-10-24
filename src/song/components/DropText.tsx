import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, hash, pulseW, beatSpring } from "../lib/motion";

type Props = {
  text: string;
  kicks: { f: number; s: number }[];
  /** 文字进入的帧（= drop 帧） */
  inFrame: number;
  fontSize: number;
  letterSpacing: number;
  neon: string;
  neon2: string;
  /** 整体强度 */
  intensity: number;
};

/**
 * 爆发期文字：霓虹 + 剧烈缩放 + 震动 + 炸裂。
 *
 * 三层叠加：
 *  1) 弹簧缩放 —— 每记重低音让字二次起跳（回弹感）
 *  2) 相位震屏 —— 每个字按索引错开，形成冲击波扩散
 *  3) 霓虹辉光 —— 强度随鼓点跳动，亮粉色描边 + 多层 text-shadow
 */
export const DropText: React.FC<Props> = ({
  text,
  kicks,
  inFrame,
  fontSize,
  letterSpacing,
  neon,
  neon2,
  intensity,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const lines = text.split("\n");

  // 全局鼓点强度（取最近一记重低音）
  const punch = pulseW(kicks, frame, Math.round(fps * 0.16), 0.5);

  // 入场：从极大瞬间砸到位（前 18 帧）
  const enter = clamp((frame - inFrame) / 18);
  const enterE = 1 - Math.pow(1 - enter, 4);

  return (
    <AbsoluteFill
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: fontSize * 0.34,
      }}
    >
      {lines.map((line, li) => {
        const chars = Array.from(line);
        const n = chars.length;
        return (
          <div
            key={li}
            style={{
              display: "flex",
              justifyContent: "center",
              transform: `translateX(${(punch * 0.5 - 0.25) * 8 * intensity}px)`,
            }}
          >
            {chars.map((ch, ci) => {
              const idx = li * 100 + ci;

              // ---- 相位：从左到右错开，形成冲击波 ----
              const phase = (ci / Math.max(1, n)) * 0.55;

              // 每字的独立抖动（确定性）
              const jx = (hash(idx * 7.31 + Math.floor(frame / 2)) - 0.5) * 2;
              const jy = (hash(idx * 11.7 + Math.floor(frame / 2)) - 0.5) * 2;
              const shakeAmp = punch * 7 * intensity;

              // ---- 缩放：基础 1 + 弹簧冲击 ----
              const localSpring = beatSpring(kicks, frame - Math.round(phase * fps * 0.1), fps, {
                damping: 8,
                stiffness: 300,
                mass: 0.4,
                weight: false,
              });
              const scale =
                (0.55 + 0.45 * enterE) * (1 + localSpring * 0.26 * intensity + punch * 0.14 * intensity);

              // ---- 旋转：极小幅随机抖动，增加爆裂感 ----
              const rot = jx * punch * 4.2 * intensity;

              // ---- 霓虹辉光：随鼓点闪烁 ----
              const halo = 6 + punch * 26 * intensity;

              // 主色在两色间随鼓点切换，形成闪烁
              const flicker = hash(idx * 3.7 + frame * 0.9);
              const mainColor = punch > 0.55 && flicker > 0.62 ? neon2 : neon;

              // 入场时的拖影残像
              const trail = (1 - enterE) * 18;

              return (
                <span
                  key={ci}
                  style={{
                    display: "inline-block",
                    fontSize,
                    fontWeight: 800,
                    letterSpacing: `${letterSpacing}px`,
                    fontFamily:
                      '"HarmonyOS Sans SC", "Source Han Sans", "Noto Sans SC", "Microsoft YaHei", sans-serif',
                    color: mainColor,
                    transform: `
                      translate(${jx * shakeAmp + trail * 0.4}px, ${jy * shakeAmp}px)
                      scale(${scale})
                      rotate(${rot}deg)
                    `,
                    opacity: enterE,
                    textShadow: `
                      0 0 ${halo * 0.5}px ${mainColor},
                      0 0 ${halo}px ${mainColor},
                      0 0 ${halo * 2.2}px ${neon2},
                      0 0 ${halo * 4}px ${neon2},
                      0 0 ${halo * 6}px ${neon2}
                    `,
                    mixBlendMode: "screen",
                    whiteSpace: "pre",
                    filter: `saturate(${1 + punch * 0.8}) brightness(${1 + punch * 0.55})`,
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