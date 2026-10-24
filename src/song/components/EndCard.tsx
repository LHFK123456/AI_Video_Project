import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { clamp, easeOutCubic } from "../lib/motion";
import { makeTheme } from "../lib/theme";

type Props = {
  inFrame: number;
  endFrame: number;
  fps: number;
  width: number;
  height: number;
};

/**
 * 结尾卡（最后一句收声 → 片尾）。
 *
 * 功能不变：一句回扣主题的话 + 一个不廉价的互动引导。
 * 视觉上把"霓虹描边 + 三层外发光"全部去掉，只剩：
 *  - 暖白主句（weight 500）
 *  - 一条 1px 中性细线
 *  - 次级灰的引导语
 * 收尾靠"光慢慢退去"，而不是靠颜色继续喊。
 */
export const EndCard: React.FC<Props> = ({ inFrame, endFrame, fps, width, height }) => {
  const frame = useCurrentFrame();
  if (frame < inFrame) return null;

  const T = makeTheme(width, height);

  const p = clamp((frame - inFrame) / (fps * 0.78));
  const e = easeOutCubic(p);
  const fade = clamp((endFrame - frame) / (fps * 1.0));

  const mainSize = T.size.display * 0.62;

  // 呼吸：让画面不死，幅度极小
  const breath = 1 + Math.sin(frame * 0.026) * 0.004;

  return (
    <AbsoluteFill style={{ opacity: e * fade, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${breath})`,
          paddingLeft: T.layout.safeX,
          paddingRight: T.layout.safeX,
        }}
      >
        {/* 主句：回扣「一半」这个主题 */}
        <div
          style={{
            fontSize: mainSize,
            fontWeight: T.weight.medium,
            lineHeight: 1.34,
            textAlign: "center",
            color: T.color.paper,
            letterSpacing: "0.04em",
            fontFamily: T.font.sans,
            opacity: clamp((frame - inFrame) / (fps * 0.55)),
            transform: `translateY(${(1 - e) * mainSize * 0.2}px)`,
            // 只有一层极淡的字面光，保证在暗底上不"浮"
            textShadow: `0 0 ${mainSize * 0.5}px rgba(255,255,255,0.1)`,
          }}
        >
          一半是幻想
          <br />
          {/* 第二行用点缀色区分，这是全片唯一使用香槟色的正文位置 */}
          <span style={{ color: T.color.accent }}>一半是破碎</span>
        </div>

        {/* 中性细线 */}
        <div
          style={{
            marginTop: T.space.md,
            marginBottom: T.space.md,
            width: T.layout.measure * 0.16 * e,
            height: T.line.hair,
            borderRadius: T.radius.hair,
            background: T.color.hair,
          }}
        />

        {/* 互动引导：三级信息，最弱的一层 */}
        <div
          style={{
            fontSize: T.size.body,
            fontWeight: T.weight.light,
            letterSpacing: T.track.caption,
            color: T.color.paperSoft,
            textAlign: "center",
            lineHeight: T.leading.caption,
            opacity: clamp((frame - inFrame - fps * 0.4) / (fps * 0.6)),
            fontFamily: T.font.sans,
          }}
        >
          你卡在哪一半？
          <br />
          <span style={{ color: T.color.paperFaint }}>评论区留一句</span>
        </div>
      </AbsoluteFill>

      {/* 结尾的余光：极其克制的中心提亮，随 fade 收束 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 60% 42% at 50% 50%, rgba(255,255,255,${
            0.03 * fade
          }) 0%, transparent 70%)`,
          opacity: fade,
        }}
      />
    </AbsoluteFill>
  );
};