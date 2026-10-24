/**
 * 版式几何验收 —— 测量文字包围盒是否居中、是否溢出安全区
 * 用法: node scripts/verify-layout.mjs <png> [--w 1080] [--h 1920] [--thr 120]
 */
import { spawnSync } from "node:child_process";

const FF = "D:/ffmpeg/bin/ffmpeg.exe";
const args = process.argv.slice(2);
const file = args[0];
let W = 1080, H = 1920, thr = 120;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--w") W = Number(args[++i]);
  else if (args[i] === "--h") H = Number(args[++i]);
  else if (args[i] === "--thr") thr = Number(args[++i]);
}

const r = spawnSync(
  FF,
  ["-v", "error", "-i", file, "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
  { maxBuffer: 3e8 },
);
if (r.status !== 0) throw new Error(r.stderr?.toString());
const buf = r.stdout;

/** 逐行、逐列统计亮像素，得到行/列投影 */
const rowCount = new Array(H).fill(0);
const colCount = new Array(W).fill(0);
let count = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const mx = Math.max(buf[i], buf[i + 1], buf[i + 2]);
    if (mx >= thr) {
      rowCount[y]++;
      colCount[x]++;
      count++;
    }
  }
}

const rows = [];
let start = -1;
for (let y = 0; y < H; y++) {
  if (rowCount[y] > 0 && start < 0) start = y;
  if ((rowCount[y] === 0 || y === H - 1) && start >= 0) {
    rows.push({ top: start, bottom: y - 1 });
    start = -1;
  }
}

let xMin = 0, xMax = W - 1;
while (xMin < W && colCount[xMin] === 0) xMin++;
while (xMax > 0 && colCount[xMax] === 0) xMax--;

/** 只统计"有实质内容"的行带（至少 2px 高），过滤噪点 */
const bands = rows
  .filter((b) => b.bottom - b.top >= 2)
  .map((b) => {
    const h = b.bottom - b.top + 1;
    const cx = (b.top + b.bottom) / 2;
    return { ...b, h, cx: cx.toFixed(0), cxPct: ((cx / H) * 100).toFixed(1) };
  });

console.log(`文件 ${file}  ${W}x${H}  thr=${thr}`);
console.log(`亮像素 ${count} (${((count / (W * H)) * 100).toFixed(2)}%)`);
console.log(`横向范围 x=${xMin}..${xMax}  左留白 ${((xMin / W) * 100).toFixed(1)}%  右留白 ${(((W - 1 - xMax) / W) * 100).toFixed(1)}%`);
console.log(`剩余文本行带 (${bands.length}):`);
for (const b of bands) {
  console.log(`  y ${b.top}..${b.bottom}  高 ${b.h}  中心 ${b.cx} (${b.cxPct}%)`);
}