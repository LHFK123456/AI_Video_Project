/**
 * 人声乐句切分：用谐波性(HPSS) + 人声频段谱通量 检测演唱乐句边界。
 * 用法: node scripts/segment-vocal.mjs public/test.mp3 [--fps 60]
 */
import { spawn } from "node:child_process";

const SR = 22050;
const WIN = 1024;
const HOP = 128; // 更细的时间分辨率
const FF = "D:/ffmpeg/bin/ffmpeg.exe";

function decode(p) {
  return new Promise((res, rej) => {
    const pr = spawn(FF, ["-v", "error", "-i", p, "-ac", "1", "-ar", String(SR),
      "-f", "s16le", "-acodec", "pcm_s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const ch = [];
    let err = "";
    pr.stdout.on("data", (d) => ch.push(d));
    pr.stderr.on("data", (d) => (err += d));
    pr.on("close", (c) => {
      if (c !== 0) return rej(new Error(err));
      const b = Buffer.concat(ch);
      const n = Math.floor(b.length / 2);
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) o[i] = b.readInt16LE(i * 2) / 32768;
      res(o);
    });
  });
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const pct = (a, q) => {
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] || 0;
};

const samples = await decode(process.argv[2] || "public/test.mp3");
const hann = new Float32Array(WIN);
for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

const frames = Math.floor((samples.length - WIN) / HOP) + 1;
const afps = SR / HOP;
const hzPerBin = SR / WIN;
const nBins = WIN / 2;
const bin = (hz) => Math.max(1, Math.min(nBins - 1, Math.round(hz / hzPerBin)));

const re = new Float64Array(WIN), im = new Float64Array(WIN);
const spec = new Float32Array(frames * nBins);

for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  for (let i = 0; i < WIN; i++) {
    re[i] = (samples[off + i] || 0) * hann[i];
    im[i] = 0;
  }
  fft(re, im);
  for (let k = 0; k < nBins; k++) spec[f * nBins + k] = Math.hypot(re[k], im[k]);
}

/* ---- HPSS：中值滤波分离谐波/打击 ---- */
const HARM_T = Math.round(0.18 * afps); // 时间方向中值窗（谐波在此方向连续）
const PERC_F = 17;                       // 频率方向中值窗（打击在此方向宽带）

function medianAt(get, n, lo) {
  const a = Array.from({ length: n }, (_, i) => get(lo + i));
  a.sort((x, y) => x - y);
  return a[a.length >> 1];
}

const harmEnergy = new Float32Array(frames);   // 150~1800Hz 谐波能量（人声与主旋律）
const percEnergy = new Float32Array(frames);   // 全带打击能量
const L1 = bin(150), L2 = bin(1800);

for (let f = 0; f < frames; f++) {
  for (let k = L1; k < L2; k++) {
    const getT = (fi) => spec[fi * nBins + k];
    const getF = (ki) => spec[f * nBins + ki];
    const ht = medianAt(getT, Math.min(frames, HARM_T * 2 + 1), Math.max(0, f - HARM_T));
    const hf = medianAt(getF, PERC_F, Math.max(0, k - (PERC_F >> 1)));
    const v = spec[f * nBins + k];
    // 谐波掩蔽：时间方向平稳则视为谐波
    if (v >= ht * 0.85 && v > hf) harmEnergy[f] += v;
    percEnergy[f] += v;
  }
}

/* ---- 归一化 + 平滑 ---- */
const norm = (a, q = 0.97) => {
  const ref = pct(a, q) || 1;
  return Array.from(a, (v) => Math.min(1, v / ref));
};
const smooth = (a, r) => {
  const n = a.length, o = new Float32Array(n);
  let s = 0, c = 0;
  for (let i = 0; i < Math.min(r, n); i++) { s += a[i]; c++; }
  for (let i = 0; i < n; i++) {
    if (i + r < n) { s += a[i + r]; c++; }
    if (i - r - 1 >= 0) { s -= a[i - r - 1]; c--; }
    o[i] = c > 0 ? s / c : 0;
  }
  return o;
};

const hN = smooth(norm(harmEnergy), Math.round(0.05 * afps));
const pN = smooth(norm(percEnergy), Math.round(0.05 * afps));
// 人声性：谐波占比高 → 像人声；纯伴奏鼓点 → 打击占比高
const vocality = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  const tot = harmEnergy[f] + percEnergy[f] || 1;
  vocality[f] = (harmEnergy[f] / tot) * hN[f];
}
const vS = smooth(norm(vocality, 0.95), Math.round(0.10 * afps));

console.log("=== 谐波人声性曲线（每 0.5s）===");
for (let t = 0; t < samples.length / SR; t += 0.5) {
  const i = Math.floor(t * afps);
  if (i >= frames) break;
  const v = vS[i];
  console.log(`${t.toFixed(2).padStart(5)}  h=${hN[i].toFixed(2)} p=${pN[i].toFixed(2)}  voc=${v.toFixed(2)}  ${"█".repeat(Math.round(v * 40))}`);
}

/* ---- 乐句边界：vocality 谷底 ---- */
const thr = Math.max(0.08, pct(vS, 0.22));
const minGapF = Math.round(0.16 * afps);
const segs = [];
let st = 0, inGap = false, gapStart = 0;

for (let f = 1; f < frames; f++) {
  const below = vS[f] < thr;
  if (below && !inGap) { inGap = true; gapStart = f; }
  else if (!below && inGap) {
    inGap = false;
    if (f - gapStart >= minGapF) {
      if (gapStart > 0) segs.push({ s: st / afps, e: gapStart / afps });
      st = f;
    }
  }
}
if (st < frames - 1) segs.push({ s: st / afps, e: (frames - 1) / afps });

const good = segs.filter((g) => g.e - g.s >= 0.45);
console.log(`\n=== 候选乐句（阈值 ${thr.toFixed(3)}，共 ${good.length} 段）===`);
good.forEach((g, i) => {
  console.log(`${String(i + 1).padStart(2)}  ${g.s.toFixed(2).padStart(6)} → ${g.e.toFixed(2).padStart(6)}   dur ${(g.e - g.s).toFixed(2)}s`);
});