#!/usr/bin/env node
/**
 * 踩点精度验证
 *
 * 核心思路：在鼓点前一帧、鼓点帧、鼓点后一帧各取画面，
 * 若动效真由音频驱动，则「鼓点帧的变化量」应显著大于「前一帧的变化量」。
 * 逐拍统计命中率，量化踩点准确度。
 *
 * 用法: node scripts/verify-sync.mjs <视频> [--fps 30]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const video = argv[0];
if (!video) {
  console.error("用法: node scripts/verify-sync.mjs <视频>");
  process.exit(1);
}

const ffmpeg = process.env.FFMPEG || "D:/ffmpeg/bin/ffmpeg.exe";
const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
const fps = analysis.fps || 30;

const W = 192;
const H = 108;

function extract() {
  const r = spawnSync(
    ffmpeg,
    ["-v", "error", "-i", video, "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1024 * 1024 * 500 },
  );
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const buf = r.stdout;
  const fs2 = W * H * 3;
  const n = Math.floor(buf.length / fs2);
  const out = [];
  for (let i = 0; i < n; i++) out.push(buf.subarray(i * fs2, (i + 1) * fs2));
  return out;
}

const frames = extract();
console.log(`视频 ${frames.length} 帧 @ ${fps}fps，音频 ${analysis.duration}s`);

/** 逐像素平均绝对差，只看下半部（频谱最活跃）和中心（标题） */
function diff(a, b, region) {
  let s = 0;
  let c = 0;
  let [y0, y1] = [0, H];
  if (region === "center") [y0, y1] = [Math.floor(H * 0.28), Math.floor(H * 0.72)];
  else if (region === "bottom") [y0, y1] = [Math.floor(H * 0.55), H];
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      s += Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
      c += 3;
    }
  }
  return s / c;
}

// 全帧差异曲线
const dCurve = [0];
for (let i = 1; i < frames.length; i++) dCurve.push(diff(frames[i - 1], frames[i], "all"));

/* 每一拍：比较「拍点帧的变化」与「前后帧的基线变化」 */
const results = [];
for (const beat of analysis.beats) {
  const f = beat.t * fps;
  const idx = Math.round(f);
  if (idx < 2 || idx >= frames.length - 1) continue;

  // 拍点帧的变化量（取命中帧与前一帧之间）
  const onBeat = dCurve[idx];
  // 基线：拍点前 3~1 帧的平均变化（避开拍点本身）
  const base = [dCurve[idx - 3], dCurve[idx - 2], dCurve[idx - 1]].filter((v) => v != null);
  const baseAvg = base.reduce((a, b) => a + b, 0) / Math.max(1, base.length);
  // 拍点后 1~2 帧，判断峰值是否延后
  const after = Math.max(dCurve[idx + 1] ?? 0, dCurve[idx + 2] ?? 0);

  results.push({
    t: beat.t,
    idx,
    onBeat,
    baseAvg,
    after,
    ratio: baseAvg > 0.01 ? onBeat / baseAvg : 0,
  });
}

const valid = results.filter((r) => r.baseAvg > 0.01);
const hits = valid.filter((r) => r.ratio > 1.25);
const lagged = valid.filter((r) => r.ratio <= 1.25 && r.after / Math.max(0.01, r.baseAvg) > 1.25);

console.log(`\n逐拍检验（共 ${valid.length} 拍有效）`);
console.log("  拍点时刻   该帧变化   基线变化   倍数   判定");
for (const r of valid.slice(0, 20)) {
  const ok = r.ratio > 1.25 ? "✔ 命中" : r.after / Math.max(0.01, r.baseAvg) > 1.25 ? "△ 滞后" : "✘ 未命中";
  console.log(
    `  ${r.t.toFixed(3)}s   ${r.onBeat.toFixed(2).padStart(7)}   ${r.baseAvg.toFixed(2).padStart(7)}   ${r.ratio.toFixed(2).padStart(5)}   ${ok}`,
  );
}

const avgRatio = valid.reduce((a, b) => a + b.ratio, 0) / Math.max(1, valid.length);
console.log(`
──────── 汇总 ────────`);
console.log(`  命中（拍点帧变化 > 基线 1.25 倍）: ${hits.length}/${valid.length}  (${((hits.length / Math.max(1, valid.length)) * 100).toFixed(0)}%)`);
console.log(`  滞后（峰值晚 1~2 帧）            : ${lagged.length}`);
console.log(`  平均变化倍数                      : ${avgRatio.toFixed(2)}x`);
console.log(`  结论: ${hits.length / Math.max(1, valid.length) > 0.7 ? "✔ 踩点对齐良好" : "✘ 踩点未对齐，需要校正"}`);