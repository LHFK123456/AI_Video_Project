import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, pulseW } from "../lib/motion";
import { makeTheme } from "../lib/theme";

type Props = {
  kicks: { f: number; s: number }[];
  /** 素材强度（保留参数以兼容调用方，内部只做轻微缩放） */
  intensity?: number;
};

/**
 * 爆发期环境层 —— 极简版。
 *
 * 旧版有 16 条放射光线、110/54 颗粒子、双冲击波环、中心高光。
 * 那套是"烟花"，与简约高级风完全相反。现在只保留：
 *
 *  1. **一圈细环** —— 每记重低音从中心向外扩散，线宽 1px，不透明度峰值仅 0.14。
 *     它是唯一还在"响应鼓点"的视觉元素，其余交给歌词本身的微颤。
 *  2. **极淡的中心提亮** —— 随 punch 呼吸，只负责让画面在鼓点上"透一口气"。
 *
 * 为什么敢删这么狠：**当画面里只剩文字和一道细环，观众的注意力无处可逃。**
 * 这就是克制带来的高级感 —— 不是加得更少，而是删得更狠。
 */
export const DropFX: React.FC<Props> = ({ kicks }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const T = makeTheme(width, height);

  const punch = pulseW(kicks, frame, Math.round(fps * 0.26), 0.4);

  // 找到最近一记重低音的"年龄"，用于驱动细环扩散
  let age = Infinity;
  for (let i = kicks.length - 1; i >= 0; i--) {
    if (kicks[i].f <= frame) {
      age = frame - kicks[i].f;
      break;
    }
  }

  // 细环扩散：寿命拉长到 0.9s，比旧版慢，显得从容
  const ringP = Number.isFinite(age) ? clamp(age / (fps * 0.9)) : 1;
  // 半径从 0.18 扩到 0.78，控制在安全区内，不触到画框
  const ringR = 0.18 + ringP * 0.60;
  // 不透明度：二次衰减，峰值 0.14 —— 只是"暗示"，不是"特效"
  const ringO = (1 - ringP) * (1 - ringP) * 0.14;

  const cx = width / 2;
  const cy = height * 0.48;
  const R = Math.min(width, height);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {/* 中心极淡提亮：随鼓点呼吸，给画面留一口气 */}
      <div
        style={{
          position: "absolute",
          left: cx,
          top: cy,
          width: R * 0.95,
          height: R * 0.95,
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle, rgba(255,255,255,${0.022 + punch * 0.02}) 0%, transparent 62%)`,
          filter: "blur(40px)",
        }}
      />

      {/* 唯一还在响应鼓点的元素：一圈 1px 细环 */}
      {ringO > 0.004 ? (
        <div
          style={{
            position: "absolute",
            left: cx,
            top: cy,
            width: R * 2 * ringR,
            height: R * 2 * ringR,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            border: `${T.line.hair}px solid ${T.color.accent}`,
            opacity: ringO,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};