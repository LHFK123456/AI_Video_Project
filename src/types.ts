export type Beat = { t: number; s: number };
export type Lyric = { start: number; end: number; text: string };

export type Analysis = {
  audio: string;
  title: string;
  duration: number;
  fps: number;
  totalFrames: number;
  bpm: number;
  beats: Beat[];
  downbeats: number[];
  lyrics: Lyric[];
  energy: number[];
  low: number[];
  mid: number[];
  high: number[];
};

export type BeatVideoProps = {
  /** 主标题，支持 \n 换行 */
  title: string;
  /** 顶部小标签，留空则不显示 */
  kicker: string;
  /** 副标题 / 底部说明 */
  subtitle: string;
  accent1: string;
  accent2: string;
  background: string;
  /** 动效强度 0.4 ~ 2 */
  intensity: number;
  showSpectrum: boolean;
  showLyrics: boolean;
  showGrid: boolean;
};