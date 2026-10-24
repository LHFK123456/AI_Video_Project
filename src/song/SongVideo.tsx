import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { SongBackground } from "./components/SongBackground";
import { DropFX } from "./components/DropFX";
import { LyricStage } from "./components/LyricStage";
import { HookCard } from "./components/HookCard";
import { EndCard } from "./components/EndCard";
import { beatFrames, easeOutExpo, hash, seg } from "./lib/motion";
import { makeTheme } from "./lib/theme";
import type { SongVideoProps } from "./types";

type Props = SongVideoProps;

/**
 * 主合成 —— 简约高级风。
 *
 * 与旧版对比，这里的职责没变（编排时间轴），变的是"表演强度"：
 *  - drop 爆闪 0.72 → 0.26：旧版会短暂遮住画面，现在只是"呼吸一下"
 *  - 震屏 ±11px → ±4px：画面越稳越贵
 *  - 顶部标签 灰 → 香槟色细等宽，不发光
 *
 * 所有颜色、字号、间距都来自 lib/theme.ts，此处不再出现任何色值。
 */
export const SongVideo: React.FC<Props> = ({ title, kicker, analysis, lyrics }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const T = makeTheme(width, height);

  const A = analysis;
  const dropFrame = Math.floor(A.drop * fps);

  const kicks = beatFrames(A.kicks, fps);
  const beats = beatFrames(A.beats, fps);

  const hasLyrics = !!lyrics && lyrics.length > 0;

  // 第一句起唱帧：hook 卡必须在这之前退干净
  const firstLyric = hasLyrics ? Math.min(...lyrics!.map((l) => l.start)) : Infinity;
  const firstFrame = Math.floor(firstLyric * fps);

  // 最后一句收声 → 结尾卡
  const lastLyric = hasLyrics ? Math.max(...lyrics!.map((l) => l.end)) : 0;
  const lastFrame = Math.floor(lastLyric * fps);

  // drop 硬切：前后各 2/3 帧，几乎瞬时。
  // 保持"啪"一下的切换质感 —— 这是节奏点，不是渐变。
  const dropMix = interpolate(frame, [dropFrame - 1, dropFrame + 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOutExpo,
  });

  /* ---------------- drop 瞬间：极轻的一次呼吸 ---------------- */
  // 旧版 4 帧 / 0.72 白闪，会在最关键的霓虹帧盖住画面。
  // 中性配色下背景本来就亮，闪白必须压到"几乎察觉不到"的程度。
  const flashAge = frame - dropFrame;
  const flash = flashAge >= 0 && flashAge < 3 ? Math.pow(1 - flashAge / 3, 1.6) * 0.26 : 0;
  // 震屏幅度减到原来的三分之一，且衰减更快
  const quake = flashAge >= 0 && flashAge < 10 ? (1 - flashAge / 10) * 4 : 0;
  const qx = (hash(frame * 1.7) - 0.5) * quake;
  const qy = (hash(frame * 2.9) - 0.5) * quake;

  return (
    <AbsoluteFill style={{ backgroundColor: T.color.ink }}>
      {/* 完整 86 秒原声，未做任何剪辑 */}
      <Audio src={staticFile(A.audio)} />

      <SongBackground dropMix={dropMix} kicks={kicks} bass={A.bass} useFootage />

      <AbsoluteFill style={{ transform: `translate(${qx}px, ${qy}px)` }}>
        {/* 爆发期环境层：只剩一道细环 */}
        {dropMix > 0.01 ? (
          <AbsoluteFill style={{ opacity: dropMix }}>
            <DropFX kicks={kicks} />
          </AbsoluteFill>
        ) : null}

        {/* 开场钩子卡：0 → 第一句起唱前 */}
        {hasLyrics ? (
          <HookCard
            kicker={kicker}
            title={title}
            inFrame={Math.round(fps * 0.55)}
            outFrame={firstFrame - Math.round(fps * 0.85)}
            fps={fps}
            width={width}
            height={height}
          />
        ) : null}

        {/* 歌词舞台 */}
        {hasLyrics ? (
          <LyricStage
            lines={lyrics!}
            beats={beats}
            kicks={kicks}
            dropFrame={dropFrame}
            fps={fps}
            width={width}
            height={height}
          />
        ) : null}

        {/* 结尾卡：最后一句收声后 */}
        {hasLyrics ? (
          <EndCard
            inFrame={lastFrame + Math.round(fps * 0.25)}
            endFrame={A.totalFrames}
            fps={fps}
            width={width}
            height={height}
          />
        ) : null}
      </AbsoluteFill>

      {/* 顶部小标签：等宽细字 + 大字距，蓄力期极淡，爆发期转为香槟色（不发光） */}
      {kicker ? (
        <div
          style={{
            position: "absolute",
            top: T.layout.kickerTop,
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: T.size.label,
            letterSpacing: T.track.label,
            fontWeight: T.weight.regular,
            fontFamily: T.font.mono,
            color: dropMix > 0.5 ? T.color.accent : T.color.paperFaint,
            opacity: 0.5 + dropMix * 0.3,
            textTransform: "uppercase",
            // 字距会在末位后留出空白，左侧补同量保证视觉居中
            paddingLeft: T.track.label,
          }}
        >
          {kicker}
        </div>
      ) : null}

      {/* 爆闪：极轻 */}
      {flash > 0 ? (
        <AbsoluteFill style={{ backgroundColor: "#fff", opacity: flash, mixBlendMode: "screen" }} />
      ) : null}

      {/* 入场黑场 */}
      {frame < Math.round(fps * 0.45) ? (
        <AbsoluteFill
          style={{ backgroundColor: T.color.ink, opacity: 1 - seg(frame, 0, Math.round(fps * 0.45)) }}
        />
      ) : null}

      {/* 结尾淡出 */}
      {frame > A.totalFrames - Math.round(fps * 0.8) ? (
        <AbsoluteFill
          style={{
            backgroundColor: T.color.ink,
            opacity: seg(frame, A.totalFrames - Math.round(fps * 0.8), Math.round(fps * 0.8)),
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};