/**
 * 测量各字重相对 weight 400 的宽度放大系数。
 *
 * 背景：字宽表（src/song/lib/glyphs.ts）是在 weight 400 下测的，
 * 但爆发期渲染用 weight 600。Windows 的中文字体没有真正的 600 字重，
 * 浏览器会做合成粗体，笔画加粗的同时字宽也会变宽 —— 这是"蓄力期不溢出、
 * 爆发期溢出"的根因。拿到系数后，排版引擎在 600 字重下要按系数放大字宽估算。
 *
 * 用法: node scripts/measure-weights.mjs
 */
import { spawnSync } from "node:child_process";

const FF = "D:/ffmpeg/bin/ffmpeg.exe";
const OUT = ".v2/weightmeasure.png";
const SIZE = 72;
const ROW_H = 110;
const X0 = 36;
const SAMPLES = [
  "If all of us believe in living perfect",
  "Half empty broken dreams",
  "We are the fading light",
  "一半是幻想 一半是破碎",
];
const WEIGHTS = [400, 500, 600, 700];

console.log("渲染字重测量页…");
const r = spawnSync(
  "npx",
  ["remotion", "still", "src/dev/measure-entry.tsx", "WeightMeasure", OUT, "--log=error"],
  { cwd: process.cwd(), shell: true, encoding: "utf8" },
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

// 解码
const img = spawnSync(FF, ["-v", "error", "-i", OUT, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
  maxBuffer: 5e8,
});
if (img.status !== 0) throw new Error(img.stderr?.toString());
const buf = img.stdout;
const probe = spawnSync(FF, ["-v", "error", "-i", OUT, "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
  maxBuffer: 5e8,
});
const W = 1080;
const H = Math.floor(probe.stdout.length / W);
const gray = probe.stdout;
const lum = (x, y) => gray[y * W + x];

/** 某一行的墨迹左右边界 */
const inkWidth = (rowIdx) => {
  const yTop = 40 + rowIdx * ROW_H;
  let minX = Infinity;
  let maxX = -1;
  for (let y = yTop; y < Math.min(yTop + ROW_H - 8, H); y++) {
    for (let x = 0; x < W; x++) {
      if (lum(x, y) >= 90) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return maxX < 0 ? null : maxX - minX + 1;
};

const ratios = {};
let row = 0;
for (const s of SAMPLES) {
  const widths = {};
  for (const w of WEIGHTS) {
    widths[w] = inkWidth(row);
    row++;
  }
  const base = widths[400];
  const rel = WEIGHTS.map((w) => widths[w] / base);
  console.log(`\n"${s.slice(0, 34)}…"`);
  console.log(`  400:${widths[400]}  500:${widths[500]}  600:${widths[600]}  700:${widths[700]}`);
  console.log(`  相对 400: ${rel.map((x, i) => `${WEIGHTS[i]}=${x.toFixed(4)}`).join("  ")}`);
  for (const w of WEIGHTS) {
    if (!ratios[w]) ratios[w] = [];
    ratios[w].push(widths[w] / base);
  }
}

console.log("\n=== 汇总（取样本最大值，宁可估宽）===");
for (const w of WEIGHTS) {
  const arr = ratios[w];
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  const max = Math.max(...arr);
  console.log(`  weight ${w}: 平均 ${avg.toFixed(4)}  最大 ${max.toFixed(4)}`);
}