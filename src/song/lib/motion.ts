import { spring, Easing, interpolate } from "remotion";
import type { Beat } from "../types";

export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export const easeOutExpo = Easing.bezier(0.16, 1, 0.3, 1);
export const easeOutCubic = Easing.bezier(0.33, 1, 0.68, 1);
export const easeInOutCubic = Easing.bezier(0.65, 0, 0.35, 1);
export const easeInQuad = Easing.bezier(0.55, 0.085, 0.68, 0.53);

/** 拍点转帧号 —— 必须 floor
 * 拍点若是 77.04 帧，第 77 帧就该响应；用精确浮点会让 age 为负、
 * 弹簧返回 0，动作整整延后一帧，肉眼可见地"踩不准"。
 */
export const beatFrames = (beats: Beat[], fps: number) =>
  beats.map((b) => ({ f: Math.floor(b.t * fps), s: b.s }));

/** 二分查找当前帧之前最近的一拍 */
export function lastBeat(
  frames: { f: number; s: number }[],
  frame: number,
): { f: number; s: number; age: number } | null {
  let lo = 0;
  let hi = frames.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].f <= frame) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return null;
  return { ...frames[idx], age: frame - frames[idx].f };
}

/** 拍点脉冲：每拍从 1 指数衰减到 0 */
export function pulse(
  frames: { f: number; s: number }[],
  frame: number,
  decayFrames = 9,
): number {
  const b = lastBeat(frames, frame);
  if (!b) return 0;
  const p = clamp(1 - b.age / decayFrames);
  return p * p;
}

/** 带强度权重的脉冲：弱拍只有小幅响应，强拍全量 */
export function pulseW(
  frames: { f: number; s: number }[],
  frame: number,
  decayFrames = 9,
  floor = 0.35,
): number {
  const b = lastBeat(frames, frame);
  if (!b) return 0;
  const p = clamp(1 - b.age / decayFrames);
  return p * p * (floor + (1 - floor) * b.s);
}

/** 踩点弹簧：每拍重新起跳，产生真实回弹 */
export function beatSpring(
  frames: { f: number; s: number }[],
  frame: number,
  fps: number,
  opts: { damping?: number; stiffness?: number; mass?: number; weight?: boolean } = {},
): number {
  const b = lastBeat(frames, frame);
  if (!b) return 0;
  const v = spring({
    frame: frame - b.f,
    fps,
    config: {
      damping: opts.damping ?? 11,
      stiffness: opts.stiffness ?? 190,
      mass: opts.mass ?? 0.55,
    },
    durationInFrames: Math.round(fps * 0.85),
  });
  return opts.weight === false ? v : v * (0.4 + 0.6 * b.s);
}

/** 帧区间映射，带安全裁剪 */
export function seg(
  frame: number,
  from: number,
  dur: number,
  easing: (n: number) => number = easeOutExpo,
): number {
  return interpolate(frame, [from, from + Math.max(1, dur)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
}

/** 确定性伪随机，保证同一帧多次渲染结果一致 */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 能量平滑，避免逐帧抖动 */
export function smoothEnergy(arr: number[], frame: number, radius = 2): number {
  let s = 0;
  let w = 0;
  for (let i = -radius; i <= radius; i++) {
    const k = frame + i;
    if (k < 0 || k >= arr.length) continue;
    const weight = radius + 1 - Math.abs(i);
    s += arr[k] * weight;
    w += weight;
  }
  return w ? s / w : 0;
}

/** 数组区间最大值，用于归一化 */
export function maxIn(arr: number[], from: number, to: number): number {
  let m = 0;
  for (let i = Math.max(0, from); i < Math.min(arr.length, to); i++) {
    if (arr[i] > m) m = arr[i];
  }
  return m;
}

/**
 * 分段节奏函数：蓄力期用稀疏的"呼吸"，爆发期用密集的"砸击"。
 * 返回 0~1 的激励值。
 */
export function sectionPulse(
  frame: number,
  dropFrame: number,
  kicks: { f: number; s: number }[],
  beats: { f: number; s: number }[],
  fps: number,
): { build: number; drop: number } {
  const isDrop = frame >= dropFrame;
  if (!isDrop) {
    // 蓄力期：只跟随较慢的起音，衰减慢，幅度小
    const p = pulseW(beats, frame, Math.round(fps * 0.34), 0.25);
    return { build: p, drop: 0 };
  }
  // 爆发期：跟随重低音鼓点，衰减快，幅度满
  const p = pulseW(kicks, frame, Math.round(fps * 0.15), 0.45);
  return { build: 0, drop: p };
}