/**
 * 简约风视觉验收 —— 一次性测量脚本（不属于产出流程）
 * 统计：平均亮度、近黑占比、最大饱和度、彩色像素占比、白像素占比
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const FF = "D:/ffmpeg/bin/ffmpeg.exe";
const dir = process.argv[2] || ".v2";
const W = 135, H = 240;

function px(p) {
  const r = spawnSync(FF, ["-v", "error", "-i", p, "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 8e7 });
  if (r.status !== 0) throw new Error(r.stderr?.toString());
  return r.stdout;
}

for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".png")).sort()) {
  const buf = px(`${dir}/${f}`);
  let sum = 0, nearBlack = 0, chroma = 0, white = 0, maxSat = 0;
  const n = buf.length / 3;
  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    sum += l;
    if (mx <= 26) nearBlack++;
    if (mx >= 200 && mn <= 90) chroma++;
    if (mx >= 190) white++;
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    if (mx > 70) maxSat = Math.max(maxSat, s);
  }
  console.log(
    `${f.padEnd(14)} 亮度 ${(sum / n).toFixed(3)}  近黑 ${((nearBlack / n) * 100).toFixed(1)}%  ` +
      `高饱和 ${((chroma / n) * 100).toFixed(2)}%  白 ${((white / n) * 100).toFixed(2)}%  最大饱和 ${maxSat.toFixed(2)}`,
  );
}