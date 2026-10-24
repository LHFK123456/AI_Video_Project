#!/usr/bin/env node
/**
 * 帧差异分析：验证动效是否真实发生
 * 不依赖人眼，用像素数据判断
 *
 * 用法: node scripts/verify-frames.mjs <视频> [--beat 0.469] [--fps 30]
 */

import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const video = argv[0];
if (!video) {
  console.error("用法: node scripts/verify-frames.mjs <视频> [--beat t] [--fps 30]");
  process.exit(1);
}
const ffmpeg = process.env.FFMPEG || "D:/ffmpeg/bin/ffmpeg.exe";
const W = 160;
const H = 90;

/** 解码整段视频为缩小后的 RGB 帧 */
function extract() {
  const r = spawnSync(
    ffmpeg,
    ["-v", "error", "-i", video, "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1024 * 1024 * 400 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const buf = r.stdout;
  const frameSize = W * H * 3;
  const n = Math.floor(buf.length / frameSize);
  const frames = [];
  for (let i = 0; i < n; i++) frames.push(buf.subarray(i * frameSize, (i + 1) * frameSize));
  return frames;
}

const frames = extract();
console.log(`解码 ${frames.length} 帧 (${W}x${H})`);

/** 中心区域亮度：反映标题的明暗/存在感 */
function centerBrightness(f) {
  let s = 0;
  let c = 0;
  const x0 = Math.floor(W * 0.2), x1 = Math.floor(W * 0.8);
  const y0 = Math.floor(H * 0.3), y1 = Math.floor(H * 0.7);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * W + x) * 3;
      s += 0.299 * f[o] + 0.587 * f[o + 1] + 0.114 * f[o + 2];
      c++;
    }
  }
  return s / c;
}

/** 两帧平均绝对差 */
function diff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 3) s += Math.abs(a[i] - b[i]);
  return s / (a.length / 3);
}

/** 亮像素包围盒（标题区域），用于测缩放 */
function brightBox(f, threshold = 190) {
  let minX = W, maxX = -1, minY = H, maxY = -1, count = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const lum = 0.299 * f[o] + 0.587 * f[o + 1] + 0.114 * f[o + 2];
      if (lum > threshold) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { w: maxX - minX + 1, h: maxY - minY + 1, count };
}

const bright = frames.map((f) => centerBrightness(f));
const maxB = Math.max(...bright);
const minB = Math.min(...bright);
console.log(`中心亮度 ${minB.toFixed(1)} ~ ${maxB.toFixed(1)}  (波动 ${(maxB - minB).toFixed(1)})`);

/* 逐帧差异峰值 → 应该落在鼓点上 */
const diffs = [];
for (let i = 1; i < frames.length; i++) diffs.push(diff(frames[i - 1], frames[i]));
const meanD = diffs.reduce((a, b) => a + b, 0) / diffs.length;
const maxD = Math.max(...diffs);
console.log(`帧间差异 平均 ${meanD.toFixed(2)}  最大 ${maxD.toFixed(2)}`);

/* 找差异尖峰 */
const spikes = [];
for (let i = 2; i < diffs.length - 2; i++) {
  if (diffs[i] > meanD * 1.55 && diffs[i] >= diffs[i - 1] && diffs[i] > diffs[i + 1]) {
    if (!spikes.length || i - spikes[spikes.length - 1].i > 3) spikes.push({ i, v: diffs[i] });
  }
}
console.log(`\n检测到动效突变点 ${spikes.length} 个:`);
for (const s of spikes.slice(0, 12)) {
  console.log(`  帧 ${s.i} (t=${(s.i / 30).toFixed(3)}s)  差异 ${s.v.toFixed(2)}`);
}

/* 标题缩放验证：连续采样亮像素包围盒宽度 */
console.log(`\n标题区域尺寸变化（每 2 帧采样）:`);
const boxes = [];
for (let i = 20; i < Math.min(frames.length, 90); i += 2) {
  const b = brightBox(frames[i]);
  if (b) boxes.push({ i, ...b });
}
if (boxes.length) {
  const widths = boxes.map((b) => b.w);
  const hgts = boxes.map((b) => b.h);
  console.log(`  宽度 ${Math.min(...widths)} ~ ${Math.max(...widths)}   高度 ${Math.min(...hgts)} ~ ${Math.max(...hgts)}`);
  console.log(`  变化幅度: 宽 ${(((Math.max(...widths) - Math.min(...widths)) / Math.max(...widths)) * 100).toFixed(1)}%  高 ${(((Math.max(...hgts) - Math.min(...hgts)) / Math.max(...hgts)) * 100).toFixed(1)}%`);
  for (const b of boxes.slice(0, 10)) console.log(`    帧${b.i}: ${b.w}x${b.h}  亮像素${b.count}`);
}

/* 判定 */
console.log("\n──── 判定 ────");
const okDiff = maxD > meanD * 2;
const okBright = maxB - minB > 4;
const okScale = boxes.length > 3 && Math.max(...boxes.map((b) => b.h)) - Math.min(...boxes.map((b) => b.h)) >= 2;
console.log(`帧间差异有明显突变: ${okDiff ? "✔ 是" : "✘ 否（动效可能没有生效）"}`);
console.log(`中心亮度有波动:     ${okBright ? "✔ 是" : "✘ 否"}`);
console.log(`标题尺寸在变化:     ${okScale ? "✔ 是（确实在缩放）" : "✘ 否（未检测到缩放）"}`);