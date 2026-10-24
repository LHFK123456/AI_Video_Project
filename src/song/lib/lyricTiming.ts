import type { LyricLine } from "../types";

/** 转场句：起唱早于 drop，因此在 drop 那一帧由白转霓虹 */
export const PIVOT_ID = 14;

export type Slot = {
  line: LyricLine;
  /** 起唱帧（含） */
  a: number;
  /** 从这一帧开始退场 */
  fadeStart: number;
  /** 退场持续帧数 */
  fadeLen: number;
  /** 完全消失帧（不含） */
  fadeEnd: number;
  style: "build" | "drop";
};

export type Schedule = {
  fps: number;
  slots: Slot[];
};

/** 每句结束后的余留时间（帧）：让字停一下再走，但绝不跨到下一句 */
const TAIL_BUILD = 0.26;
const TAIL_DROP = 0.2;

/**
 * 由歌词时间轴算出逐帧可见性表。
 *
 * 三条硬规则：
 *  1. 起唱帧之前绝不出现（frame < a → 不可见）
 *  2. 前一句的余留期被下一句的起唱硬截断（fadeEnd ≤ 下一句 a）
 *  3. 同一帧内最多一句处于完全可见状态，避免两句叠字
 */
export function buildSchedule(lines: LyricLine[], fps: number): Schedule {
  const usable = lines
    .filter((l) => Number.isFinite(l.start) && Number.isFinite(l.end))
    .sort((a, b) => a.start - b.start);

  const slots: Slot[] = [];

  for (let i = 0; i < usable.length; i++) {
    const l = usable[i];
    const isDrop = l.id > PIVOT_ID;
    const a = Math.round(l.start * fps);
    const b = Math.round(l.end * fps);
    const tail = isDrop ? Math.round(TAIL_DROP * fps) : Math.round(TAIL_BUILD * fps);

    const next = usable[i + 1];
    const nextA = next ? Math.round(next.start * fps) : Number.POSITIVE_INFINITY;

    // 余留期不得越过下一句起唱，否则两句会在同一位置重叠
    const fadeEnd = Math.min(b + tail, nextA);
    const fadeLen = Math.max(1, fadeEnd - b);

    slots.push({
      line: l,
      a,
      fadeStart: Math.max(a, b),
      fadeLen,
      fadeEnd,
      style: l.id === PIVOT_ID ? "build" : isDrop ? "drop" : "build",
    });
  }

  return { fps, slots };
}

/** 该帧应显示的句子（正常最多 1 条） */
export function slotsAt(s: Schedule, frame: number): Slot[] {
  return s.slots.filter((x) => frame >= x.a && frame < x.fadeEnd);
}

/**
 * 整句容器的不透明度：只负责退场。
 * 入场渐变必须由主行/译文各自负责——
 * 若在容器上做入场渐变，容器的延迟会"传染"给主行，
 * 导致唱起来了却还看不见字（译文延迟 0.2s 会拖累英文）。
 */
export function slotExitOpacity(slot: Slot, frame: number): number {
  if (frame < slot.a || frame >= slot.fadeEnd) return 0;
  const exitP = Math.min(1, Math.max(0, (frame - slot.fadeStart) / slot.fadeLen));
  return 1 - exitP * exitP;
}