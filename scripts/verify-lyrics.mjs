#!/usr/bin/env node
/**
 * 验证歌词是否真的烧入画面
 * 对比「歌词出现时」与「无歌词时」画面底部区域的亮像素数量
 *
 * 用法: node scripts/verify-lyrics.mjs <视频> --at 2.0 --before 0.2
 */

import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const video = argv[0];
if (!video) {
  console.error("用法: node scripts/verify-lyrics.mjs <视频> --at 2.0 --before 0.2");
  process.exit(1);
}

let at = 2.0;
let before = 0.2;
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--at") at = Number(argv[++i]);
  else if (argv[i] === "--before") before = Number(argv[++i]);
}

const ffmpeg = process.env.FFMPEG || "D:/ffmpeg/bin/ffmpeg.exe";
const W = 216;
const H = 384;

function grab(t) {
  const r = spawnSync(
    ffmpeg,
    ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1024 * 1024 * 40 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout;
}

/** 统计指定纵向范围内的「白色/亮色」像素，即文字 */
function textPixels(buf, y0Pct, y1Pct) {
  const y0 = Math.floor(H * y0Pct);
  const y1 = Math.floor(H * y1Pct);
  let bright = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const r = buf[o];
      const g = buf[o + 1];
      const b = buf[o + 2];
      total++;
      // 近白色（文字主体）
      if (r > 215 && g > 215 && b > 215) bright++;
    }
  }
  return { bright, total, pct: (bright / Math.max(1, total)) * 100 };
}

const a = grab(at);
const b = grab(before);

console.log(`视频 ${video}`);
console.log(`对比 t=${before}s（无歌词）与 t=${at}s（有歌词）\n`);

// 分区域检查
const regions = [
  { name: "上部 0-25%", y0: 0.0, y1: 0.25 },
  { name: "中部 25-55%", y0: 0.25, y1: 0.55 },
  { name: "下部 62-88%", y0: 0.62, y1: 0.88 },
  { name: "底部 88-100%", y0: 0.88, y1: 1.0 },
];

let lyricFound = false;
for (const r of regions) {
  const p1 = textPixels(b, r.y0, r.y1);
  const p2 = textPixels(a, r.y0, r.y1);
  const delta = p2.pct - p1.pct;
  const mark = delta > 0.15 ? "  ← 文字增加" : "";
  if (delta > 0.15) lyricFound = true;
  console.log(`  ${r.name.padEnd(14)} 前 ${p1.pct.toFixed(2)}%  后 ${p2.pct.toFixed(2)}%  差 ${delta > 0 ? "+" : ""}${delta.toFixed(2)}点${mark}`);
}

console.log(`\n结论: ${lyricFound ? "✔ 检测到文字出现（歌词已烧入）" : "✘ 未检测到明显文字变化"}`);