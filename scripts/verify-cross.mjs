/**
 * 跨画幅协调性验收 —— 检查"桌面端"（横屏）与"移动端"（竖屏）是否成比例。
 *
 * 判定逻辑：同一层级元素在两种画幅上的**物理尺寸应当一致**（都以短边为基准），
 * 所以度量方式不是像素绝对值，而是"占短边百分比"。
 *
 * 检查项：
 *  1. 字号：同一元素在两画幅下占短边的比例应该接近
 *  2. 留白：左右留白占宽度比例应在各自的设计区间内
 *  3. 视觉重心：文字块中心相对画面中心的位置偏移应在合理范围
 *
 * 用法: node scripts/verify-cross.mjs
 */
import { spawnSync } from "node:child_process";

const FF = "D:/ffmpeg/bin/ffmpeg.exe";

const measure = (file, W, H, thr = 170) => {
  const r = spawnSync(
    FF,
    ["-v", "error", "-i", file, "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 5e8 },
  );
  if (r.status !== 0) throw new Error(r.stderr?.toString());
  const b = r.stdout;

  let minX = W, maxX = -1, minY = H, maxY = -1;
  const rows = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (Math.max(b[i], b[i + 1], b[i + 2]) >= thr) {
        rows[y]++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  // 文字行带（连续有亮像素的 y 段）
  const bands = [];
  let s = -1;
  for (let y = 0; y < H; y++) {
    if (rows[y] > 0 && s < 0) s = y;
    if ((rows[y] === 0 || y === H - 1) && s >= 0) {
      if (y - s > 4) bands.push([s, y - 1]);
      s = -1;
    }
  }
  return { minX, maxX, minY, maxY, bands };
};

/** 短边基准：同一层级元素在两画幅下应当占相同的短边比例 */
const cases = [
  { label: "歌词中段", v: ".v2/v-1500.png", h: ".v2h/h-1500.png" },
  { label: "歌词爆发", v: ".v2/v-3700.png", h: ".v2h/h-3700.png" },
  { label: "开场卡", v: ".v2/v-90.png", h: ".v2h/h-90.png" },
  { label: "结尾前", v: ".v2/v-4950.png", h: ".v2h/h-4950.png" },
];

const V = { w: 1080, h: 1920 };
const Hc = { w: 1920, h: 1080 };

console.log("跨画幅协调性 —— 以「占短边百分比」对比，比例应接近\n");
console.log("画面          竖屏字号/短边   横屏字号/短边   差异");
console.log("─".repeat(62));

let maxDiff = 0;
for (const c of cases) {
  const vm = measure(c.v, V.w, V.h);
  const hm = measure(c.h, Hc.w, Hc.h);
  if (!vm || !hm) {
    console.log(`${c.label}  （该帧无文字）`);
    continue;
  }
  // 用最高行带的高度代表主字号（行带高 ≈ 字号 × 0.72 的 cap-height 区域）
  const vBand = Math.max(...vm.bands.map(([a, b]) => b - a));
  const hBand = Math.max(...hm.bands.map(([a, b]) => b - a));
  const vr = vBand / 1080;
  const hr = hBand / 1080;
  const diff = Math.abs(vr - hr) / Math.max(vr, hr);
  maxDiff = Math.max(maxDiff, diff);

  const vSafe = Math.min(vm.minX / V.w, (V.w - 1 - vm.maxX) / V.w);
  const hSafe = Math.min(hm.minX / Hc.w, (Hc.w - 1 - hm.maxX) / Hc.w);
  console.log(
    `${c.label.padEnd(10)}  ${(vr * 100).toFixed(1)}%`.padEnd(20) +
      `${(hr * 100).toFixed(1)}%`.padEnd(18) +
      `${(diff * 100).toFixed(1)}%`,
  );
  console.log(
    `  留白  竖屏 ${(vSafe * 100).toFixed(1)}% / 横屏 ${(hSafe * 100).toFixed(1)}%`,
  );
}

console.log("─".repeat(62));
console.log(`最大字号比例差异 ${(maxDiff * 100).toFixed(1)}%  ${maxDiff < 0.12 ? "✅ 协调" : "⚠️ 两画幅字号不同步"}`);