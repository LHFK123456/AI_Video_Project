import { spring, Easing, interpolate } from "remotion";
import type { Beat } from "../types";

export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export const easeOutExpo = Easing.bezier(0.16, 1, 0.3, 1);
export const easeOutBack = Easing.bezier(0.34, 1.56, 0.64, 1);
export const easeInOutCubic = Easing.bezier(0.65, 0, 0.35, 1);

/** 拍点转帧号
 * 用 floor 而非精确浮点：拍点 77.04 帧时，必须让第 77 帧就响应，
 * 否则 age 为负、弹簧返回 0，动作会整整延后一帧（33ms 的肉眼可见延迟）。
 */
export const beatFrames = (beats: Beat[], fps: number) =>
  beats.map((b) => ({ f: Math.floor(b.t * fps), s: b.s }));

/**
 * 最近一次落在当前帧或之前的拍
 * 返回该拍所在帧 与 距离当前帧的帧数
 */
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

/**
 * 踩点脉冲：每拍从 1 衰减到 0
 * shape: 'exp' 快速衰减（适合缩放）  'lin' 线性（适合扫光）
 */
export function pulse(
  frames: { f: number; s: number }[],
  frame: number,
  decayFrames = 9,
  shape: "exp" | "lin" = "exp",
): number {
  const b = lastBeat(frames, frame);
  if (!b) return 0;
  const p = clamp(1 - b.age / decayFrames);
  return shape === "exp" ? p * p : p;
}

/**
 * 踩点弹簧：每拍重新起跳，产生真实的回弹
 * 这是「文字随鼓点跳跃缩放」的核心
 */
export function beatSpring(
  frames: { f: number; s: number }[],
  frame: number,
  fps: number,
  opts: { damping?: number; stiffness?: number; mass?: number } = {},
): number {
  const b = lastBeat(frames, frame);
  if (!b) return 0;
  return spring({
    frame: frame - b.f,
    fps,
    config: {
      damping: opts.damping ?? 11,
      stiffness: opts.stiffness ?? 190,
      mass: opts.mass ?? 0.55,
    },
    durationInFrames: Math.round(fps * 0.85),
  });
}

/**
 * 正在接近下一拍时的「蓄力」值 0→1
 * 用于打击前的预备动作（anticipation）
 */
export function preBeat(
  frames: { f: number; s: number }[],
  frame: number,
  leadFrames = 4,
): number {
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i].f;
    if (f > frame && f - frame <= leadFrames) {
      return 1 - (f - frame) / leadFrames;
    }
    if (f > frame) break;
  }
  return 0;
}

/** 每小节（强拍）触发的冲击值，衰减更慢 */
export function downbeatHit(
  frames: { f: number; s: number }[],
  frame: number,
  decayFrames = 18,
): number {
  const b = lastBeat(frames, frame);
  if (!b) return 0;
  const p = clamp(1 - b.age / decayFrames);
  return p * p * p;
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

/** 确定性伪随机，保证每帧渲染一致 */
export function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 能量平滑：取最近 N 帧加权平均，避免闪烁 */
export function smoothEnergy(
  arr: number[],
  frame: number,
  radius = 2,
): number {
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