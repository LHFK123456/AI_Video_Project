import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { clamp, easeOutCubic, easeOutExpo } from "../lib/motion";
import { makeTheme } from "../lib/theme";

type Props = {
  kicker: string;
  title: string;
  inFrame: number;
  outFrame: number;
  fps: number;
  width: number;
  height: number;
};

/**
 * 开场钩子卡（0 → 第一句起唱前）。
 *
 * 功能没变（歌曲名 + 艺人 + 一行钩子 + 进度暗示），变的是表达方式：
 *  - 主标题从 weight 900 降到 500，靠**大字距 + 大留白**建立重量，而不是堆黑体
 *  - 粉青渐变的发光分隔线 → 一条从中向两端展开的 1px 中性细线
 *  - 进度条从霓虹满色 → 中性白，且只保留必要的暗示作用
 *  - 所有间距统一到 8 倍数刻度，视觉节奏与歌词页一致
 */
export const HookCard: React.FC<Props> = ({ kicker, title, inFrame, outFrame, fps, width, height }) => {
  const frame = useCurrentFrame();
  if (frame < inFrame || frame >= outFrame + fps * 0.45) return null;

  const T = makeTheme(width, height);

  const inP = clamp((frame - inFrame) / (fps * 0.62));
  const outP = clamp((frame - outFrame) / (fps * 0.45));
  const op = easeOutCubic(inP) * (1 - outP * outP);

  /** 细线从中向两端展开 */
  const lineW = easeOutExpo(clamp((frame - inFrame - fps * 0.16) / (fps * 0.85)));

  const mainSize = T.size.display;

  // 极缓慢的缩放漂移，避免静止画面；幅度比旧版更小
  const drift = 1 + inP * 0.008;

  return (
    <AbsoluteFill style={{ opacity: op, pointerEvents: "none" }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${drift})`,
          paddingLeft: T.layout.safeX,
          paddingRight: T.layout.safeX,
        }}
      >
        {/* 上方小标：等宽字 + 大字距，这是"高级"的关键细节 */}
        <div
          style={{
            fontSize: T.size.label,
            letterSpacing: T.track.label,
            fontWeight: T.weight.regular,
            color: T.color.paperFaint,
            marginBottom: T.space.md,
            opacity: clamp((frame - inFrame) / (fps * 0.45)),
            textTransform: "uppercase",
            fontFamily: T.font.mono,
            // 大字距会让最后一位后多出空白，右移补偿居中
            paddingLeft: T.track.label,
          }}
        >
          {kicker}
        </div>

        {/* 主标题：大字距 + 中等字重，靠留白建立分量 */}
        <div
          style={{
            fontSize: mainSize,
            fontWeight: T.weight.medium,
            letterSpacing: "0.06em",
            lineHeight: T.leading.display,
            color: T.color.paper,
            textAlign: "center",
            fontFamily: T.font.sans,
            opacity: clamp((frame - inFrame - fps * 0.1) / (fps * 0.5)),
            transform: `translateY(${
              (1 - easeOutCubic(clamp((frame - inFrame - fps * 0.1) / (fps * 0.5)))) * mainSize * 0.22
            }px)`,
            textShadow: `0 0 ${mainSize * 0.6}px rgba(255,255,255,0.08)`,
          }}
        >
          {title}
        </div>

        {/* 中性细分隔线：从中心向两侧展开，无发光 */}
        <div
          style={{
            marginTop: T.space.md,
            marginBottom: T.space.md,
            width: T.layout.measure * 0.22 * lineW,
            height: T.line.hair,
            borderRadius: T.radius.hair,
            background: T.color.hair,
          }}
        />

        {/* 提问钩子：三级文字，细体，宽行高 */}
        <div
          style={{
            fontSize: T.size.body,
            fontWeight: T.weight.light,
            letterSpacing: T.track.body,
            color: T.color.paperSoft,
            textAlign: "center",
            lineHeight: T.leading.body,
            opacity: clamp((frame - inFrame - fps * 0.38) / (fps * 0.55)),
            fontFamily: T.font.sans,
          }}
        >
          这首歌只唱了 86 秒
          <br />
          却把「完美」拆成了两半
        </div>
      </AbsoluteFill>

      {/* 底部细进度条：中性白，比旧版短一截，更含蓄 */}
      <div
        style={{
          position: "absolute",
          left: (width - T.layout.measure * 0.4) / 2,
          width: T.layout.measure * 0.4,
          bottom: height * (T.portrait ? 0.135 : 0.115),
          height: T.line.hair,
          borderRadius: T.radius.hair,
          backgroundColor: T.color.hairSoft,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamp((frame - inFrame) / Math.max(1, outFrame - inFrame)) * 100}%`,
            height: "100%",
            borderRadius: T.radius.hair,
            backgroundColor: T.color.paperSoft,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};