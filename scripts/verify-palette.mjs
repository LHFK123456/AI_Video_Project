/**
 * 配色验收 —— 统计画面的色相分布，确认「克制的中性配色」
 *
 * 判定标准：
 *  1. 饱和度：绝大多数像素必须接近无彩（S < 0.12），否则说明还有彩色元素残留
 *  2. 霓虹检测：统计粉(300-350) / 青(170-200) 两个旧配色区间的占比，必须 < 0.3%
 *  3. 中性偏移：把无彩像素的 R-B 差值做统计，正值偏暖、负值偏冷，用于确认是「暖中性」而非死灰
 *
 * 用法: node scripts/verify-palette.mjs <png...>
 */
import { spawnSync } from "node:child_process";

const FF = "D:/ffmpeg/bin/ffmpeg.exe";
const files = process.argv.slice(2);
if (!files.length) {
  console.error("用法: node scripts/verify-palette.mjs <png...>");
  process.exit(1);
}

const toRGB = (file) => {
  const r = spawnSync(
    FF,
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 5e8 },
  );
  if (r.status !== 0) throw new Error(r.stderr?.toString());
  return r.stdout;
};

const W = 1080,
  H = 1920;

for (const f of files) {
  const buf = toRGB(f);
  const n = Math.floor(buf.length / 3);

  let neutral = 0; // S < 0.12
  let colored = 0;
  let neonPink = 0;
  let neonCyan = 0;
  let sumRB = 0,
    neutralN = 0;
  let sumLum = 0;
  // 亮度直方图（16 档）
  const hist = new Array(16).fill(0);

  for (let i = 0; i < n; i++) {
    const R = buf[i * 3],
      G = buf[i * 3 + 1],
      B = buf[i * 3 + 2];
    const mx = Math.max(R, G, B),
      mn = Math.min(R, G, B);
    const S = mx === 0 ? 0 : (mx - mn) / mx;
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    sumLum += lum;
    hist[Math.min(15, Math.floor(lum / 16))]++;

    // 近黑像素（mx < 24）R/G/B 只差几个数值就会算出很高的饱和度，
    // 但人眼看来就是黑。这类像素必须先归入中性，否则"有彩占比"会虚高。
    if (mx < 24 || S < 0.12) {
      neutral++;
      sumRB += R - B;
      neutralN++;
    } else {
      colored++;
      // 计算色相
      let h = 0;
      const d = mx - mn;
      if (d !== 0) {
        if (mx === R) h = ((G - B) / d) % 6;
        else if (mx === G) h = (B - R) / d + 2;
        else h = (R - G) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      if (h >= 290 && h <= 350) neonPink++;
      if (h >= 165 && h <= 205) neonCyan++;
    }
  }

  const name = f.split(/[\\/]/).pop();
  console.log(`\n=== ${name}`);
  console.log(
    `  无彩像素 ${((neutral / n) * 100).toFixed(2)}%   有彩 ${((colored / n) * 100).toFixed(2)}%`,
  );
  console.log(
    `  霓虹粉 ${((neonPink / n) * 100).toFixed(3)}%   霓虹青 ${((neonCyan / n) * 100).toFixed(3)}%`,
  );
  console.log(
    `  平均 R-B (无彩区): ${(sumRB / Math.max(1, neutralN)).toFixed(2)}  ${sumRB / Math.max(1, neutralN) > 1 ? "偏暖" : sumRB / Math.max(1, neutralN) < -1 ? "偏冷" : "纯中性"}`,
  );
  console.log(`  平均亮度 ${(sumLum / n).toFixed(1)}`);
  // 亮度分布（只打印非零档）
  const bars = hist
    .map((c, i) => (c / n > 0.001 ? `${String(i * 16).padStart(3)}:${((c / n) * 100).toFixed(1)}%` : null))
    .filter(Boolean);
  console.log(`  亮度分布 ${bars.join(" ")}`);
}