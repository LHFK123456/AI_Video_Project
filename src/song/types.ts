export type Beat = { t: number; s: number };
export type Lyric = { start: number; end: number; text: string };

/** 分析结果（scripts/analyze-song.mjs 产出） */
export type SongAnalysis = {
  audio: string;
  duration: number;
  fps: number;
  totalFrames: number;
  bpm: number;
  /** 情绪爆发点（秒） */
  drop: number;
  /** 候选爆发点 */
  drops: { t: number; score: number; jump: number; before: number; after: number; silence: number }[];
  /** 全部起音 */
  beats: Beat[];
  /** 重低音鼓点 */
  kicks: Beat[];
  downbeats: number[];
  energy: number[];
  bass: number[];
  mid: number[];
  high: number[];
};

export type SongVideoProps = {
  /** 主标题，支持 \n 换行（无歌词时的兜底文案） */
  title: string;
  /** 爆发时显示的短句，留空则复用 title */
  dropTitle: string;
  /** 顶部小标签 */
  kicker: string;
  /** 分析数据（由 analyze-song.mjs 产出，经 Root 注入） */
  analysis: SongAnalysis;
  /** 逐句歌词时间轴（由 Whisper 词级时间戳对齐产出） */
  lyrics?: LyricLine[];
};

/**
 * 一个词的计时：用于逐词高亮（karaoke 效果）。
 * 这是爆款字幕视频最核心的机制——不是整句一起出现，
 * 而是唱到哪个词、那个词才亮，观众的视线被声音牵着走。
 */
export type WordTiming = {
  /** 词文本（含标点） */
  w: string;
  /** 起唱时刻（秒） */
  s: number;
  /** 收声时刻（秒） */
  e: number;
};

/** 一句歌词的时间轴条目 */
export type LyricLine = {
  id: number;
  /** 起唱时刻（秒），已按词级 ASR 对齐到音节起音 */
  start: number;
  /** 收声时刻（秒） */
  end: number;
  /** 主行（英文/日文原文） */
  en: string;
  /** 中文翻译 */
  zh: string;
  /** 对齐置信度 */
  conf?: "high" | "medium" | "low" | "absent";
  /** 逐词计时（可选；缺省时按字符均匀铺开） */
  words?: WordTiming[];
};

export type Phase = "build" | "drop";