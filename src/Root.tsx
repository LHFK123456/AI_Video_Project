import React from "react";
import { Composition, CalculateMetadataFunction } from "remotion";
import { SongVideo } from "./song/SongVideo";
import songData from "./data/song.json";
import lyricsData from "./data/lyrics.json";
import type { LyricLine, SongAnalysis, SongVideoProps } from "./song/types";

const A = songData as unknown as SongAnalysis;
const L = lyricsData as unknown as LyricLine[];

const defaultProps: SongVideoProps = {
  title: "FLAW(LESS)",
  dropTitle: "",
  kicker: "SawanoHiroyuki[nZk] × Yosh",
  analysis: A,
  lyrics: L,
};

/** 时长、帧率全部来自音频分析，换音频只需重跑 scripts/analyze-song.mjs */
const calculateMetadata: CalculateMetadataFunction<SongVideoProps> = () => ({
  durationInFrames: Math.max(1, A.totalFrames),
  fps: A.fps,
});

const sizes = [
  { id: "SongVideoVertical", width: 1080, height: 1920 },
  { id: "SongVideo", width: 1920, height: 1080 },
  { id: "SongVideoSquare", width: 1080, height: 1080 },
  { id: "SongVideoPreview", width: 540, height: 960 },
];

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {sizes.map((s) => (
        <Composition
          key={s.id}
          id={s.id}
          component={SongVideo}
          durationInFrames={Math.max(1, A.totalFrames)}
          fps={A.fps}
          width={s.width}
          height={s.height}
          defaultProps={defaultProps}
          calculateMetadata={calculateMetadata}
        />
      ))}
    </>
  );
};