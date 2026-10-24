/**
 * 输出「小节网格 × 人声性 × 低频」联合表，用于人工判读 22 句歌词的边界。
 * 用法: node scripts/grid-report.mjs public/test.mp3
 */
import { spawn } from "node:child_process";

const SR = 22050, WIN = 1024, HOP = 128;
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
  for (let i = 0; i < WIN; i++) { re[i] = (samples[off + i] || 0) * hann[i]; im[i] = 0; }
  fft(re, im);
  for (let k = 0; k < nBins; k++) spec[f * nBins + k] = Math.hypot(re[k], im[k]);
}

// 频段能量：低频(30-110) / 人声(250-4000) / 高频(4000-10000)
const bandE = (f, lo, hi) => {
  const a = bin(lo), b = bin(hi);
  let s = 0;
  for (let k = a; k < b; k++) s += spec[f * nBins + k];
  return s / (b - a);
};
const lowE = new Float32Array(frames), vocE = new Float32Array(frames), hiE = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  lowE[f] = bandE(f, 30, 110);
  vocE[f] = bandE(f, 250, 4000);
  hiE[f] = bandE(f, 4000, 10000);
}
const norm = (a, q = 0.97) => {
  const ref = pct(a, q) || 1;
  return Array.from(a, (v) => Math.min(1, v / ref));
};
const lowN = norm(lowE), vocN = norm(vocE), hiN = norm(hiE);

/* 人声性 = 中频显著高于低频打击时更可能是人声（简化：中频包络 - 低频冲击） */
const vocality = vocN.map((v, i) => Math.max(0, v - lowN[i] * 0.55));

const meanRange = (arr, t0, t1) => {
  const i0 = Math.max(0, Math.round(t0 * afps));
  const i1 = Math.min(arr.length, Math.round(t1 * afps));
  let s = 0;
  for (let i = i0; i < i1; i++) s += arr[i];
  return i1 > i0 ? s / (i1 - i0) : 0;
};

const BPM = 104.4;
const beat = 60 / BPM;
const bar = beat * 4;
const dur = samples.length / SR;

console.log(`BPM ${BPM}  拍长 ${beat.toFixed(3)}s  小节 ${bar.toFixed(3)}s  总长约 ${(dur / bar).toFixed(2)} 小节\n`);
console.log("小节   起-止(s)        低频   人声   高频   人声曲线");
for (let b = 0; b * bar < dur; b++) {
  const t0 = b * bar, t1 = Math.min(dur, t0 + bar);
  const lo = meanRange(lowN, t0, t1);
  const vo = meanRange(vocN, t0, t1);
  const hi = meanRange(hiN, t0, t1);
  // 小节内 8 分格的人声轮廓
  const cells = [];
  for (let q = 0; q < 8; q++) {
    const v = meanRange(vocality, t0 + (q * bar) / 8, t0 + ((q + 1) * bar) / 8);
    cells.push(" ▁▂▃▄▅▆▇█"[Math.min(8, Math.round(v * 8))]);
  }
  console.log(
    `${String(b + 1).padStart(3)}  ${t0.toFixed(2).padStart(6)}-${t1.toFixed(2).padStart(6)}  ` +
    `${lo.toFixed(2)}  ${vo.toFixed(2)}  ${hi.toFixed(2)}  ${cells.join("")}`,
  );
}