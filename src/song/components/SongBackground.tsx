import React from "react";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { pulseW } from "../lib/motion";
import { makeTheme } from "../lib/theme";

type Props = {
  /** 0 = 蓄力期（幽暗），1 = 爆发期（提亮） */
  dropMix: number;
  kicks: { f: number; s: number }[];
  bass: number[];
  /** 实拍素材（烟雾）是否启用 */
  useFootage: boolean;
};

/**
 * 背景层 —— 简约高级风的"底"。
 *
 * 设计原则：**背景只负责压住画面，不参与表演。**
 *  1. 深炭黑竖向渐变打底，不是纯黑 —— 纯黑会显得像"没加载出来"，
 *     轻微抬升的底部让画面有厚度，也更接近高档印刷品的墨色。
 *  2. 一团极大半径、极低强度的中性光，缓慢漂移。它只做一件事：让暗部不死。
 *  3. 实拍烟雾素材去饱和后以 screen 叠加，只贡献质感和呼吸，
 *     不再随 drop 变成粉青 —— 颜色全程锁在中性区间。
 *  4. 暗角两段式，比原先更柔，边缘不出现"切边"的硬过渡。
 *
 * 与旧版的关键差异：**网格、扫描线、放射光线、粉青光晕全部移除。**
 * 这些元素是"热闹"的来源，与克制的高级感直接冲突。
 */
export const SongBackground: React.FC<Props> = ({ dropMix, kicks, bass, useFootage }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const T = makeTheme(width, height);

  const punch = pulseW(kicks, frame, Math.round(fps * 0.34), 0.35);
  const bassV = bass[Math.min(bass.length - 1, Math.max(0, frame))] ?? 0;

  /** 主光强度：蓄力期几乎不可见，爆发期抬到可感知但不刺眼的程度 */
  const ambient = T.glow.ambient * (0.75 + bassV * 0.5);
  const dropLight = T.glow.drop * (0.7 + punch * 0.3);
  const light = ambient * (1 - dropMix) + dropLight * dropMix;

  /** 极慢漂移，周期约 40 秒，观者感知不到在动，只觉得不呆板 */
  const driftX = Math.sin(frame * 0.0042) * T.width * 0.028;
  const driftY = Math.cos(frame * 0.0055) * T.height * 0.016;

  return (
    <AbsoluteFill style={{ backgroundColor: T.color.ink, overflow: "hidden" }}>
      {/* ============ 层 1：竖向墨色渐变 ============ */}
      <AbsoluteFill
        style={{
          // 落点直接用 ink 加深，不写第二个"差不多"的色值 —— 写死 #050506 会让底部偏蓝
          background: `linear-gradient(180deg, ${T.color.inkRaise} 0%, ${T.color.ink} 56%, #040404 100%)`,
        }}
      />

      {/* ============ 层 2：实拍烟雾，去饱和后只剩质感 ============ */}
      {useFootage ? (
        <AbsoluteFill style={{ opacity: 0.055 + dropMix * 0.075, mixBlendMode: "screen" }}>
          <OffthreadVideo
            src={staticFile("bg/smoke.mp4")}
            muted
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              // 全程接近无彩：蓄力期几乎纯灰，爆发期也只微微回暖
              filter: `saturate(${0.05 + dropMix * 0.10}) contrast(1.02) brightness(${0.30 + dropMix * 0.22})`,
              transform: `scale(${1.04 + dropMix * 0.03}) translateX(${driftX * 0.22}px)`,
            }}
          />
        </AbsoluteFill>
      ) : null}

      {/* ============ 层 3：单一中性主光，位置略偏上，模拟顶光 ============ */}
      <div
        style={{
          position: "absolute",
          left: `calc(50% + ${driftX}px)`,
          top: `calc(44% + ${driftY}px)`,
          width: T.width * 2.1,
          height: T.height * 1.5,
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(ellipse at 50% 50%,
            rgba(255,255,255,${light}) 0%,
            rgba(255,255,255,${light * 0.32}) 34%,
            transparent 68%)`,
          filter: "blur(80px)",
        }}
      />

      {/* ============ 层 4：点缀色微光，只在爆发期以极低强度出现 ============ */}
      {dropMix > 0.02 ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "-18%",
            width: T.width * 1.2,
            height: T.height * 0.8,
            transform: "translateX(-50%)",
            background: `radial-gradient(ellipse, ${T.color.accentSoft} 0%, transparent 62%)`,
            filter: "blur(90px)",
            opacity: dropMix * 0.55,
          }}
        />
      ) : null}

      {/* ============ 层 5：柔和暗角 ============ */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 78% 62% at 50% 48%, transparent 40%, rgba(0,0,0,${0.55 - dropMix * 0.12}) 100%)`,
        }}
      />

      {/* ============ 层 6：极细颗粒，消除渐变色带 ============ */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.02,
          background: `radial-gradient(circle at 24% 33%, rgba(255,255,255,0.6) 0.5px, transparent 0.6px),
                       radial-gradient(circle at 71% 68%, rgba(255,255,255,0.45) 0.5px, transparent 0.6px)`,
          backgroundSize: "3px 3px, 5px 5px",
          mixBlendMode: "screen",
        }}
      />
    </AbsoluteFill>
  );
};