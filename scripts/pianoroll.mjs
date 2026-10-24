/**
 * 打印 50ms 分辨率的人声/低频俯视图，用于人工判读乐句与间奏。
 * 用法: node scripts/pianoroll.mjs public/test.mp3 [from] [to]
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
const from = Number(process.argv[3] || 0);
const to = Number(process.argv[4] || samples.length / SR);

const hann = new Float32Array(WIN);
for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

const frames = Math.floor((samples.length - WIN) / HOP) + 1;
const afps = SR / HOP;
const hzPerBin = SR / WIN;
const nBins = WIN / 2;
const bIdx = (hz) => Math.max(1, Math.min(nBins - 1, Math.round(hz / hzPerBin)));

const re = new Float64Array(WIN), im = new Float64Array(WIN);
const mag = new Float32Array(frames * nBins);
for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  for (let i = 0; i < WIN; i++) { re[i] = (samples[off + i] || 0) * hann[i]; im[i] = 0; }
  fft(re, im);
  for (let k = 0; k < nBins; k++) mag[f * nBins + k] = Math.hypot(re[k], im[k]);
}

const bandsOf = (lo, hi) => {
  const a = bIdx(lo), b = bIdx(hi);
  const arr = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let k = a; k < b; k++) s += mag[f * nBins + k];
    arr[f] = s / Math.max(1, b - a);
  }
  return arr;
};
const sub = bandsOf(30, 110);
const voice = bandsOf(300, 1200);
const pres = bandsOf(1200, 3500);
const air = bandsOf(6000, 10000);

const norm = (a, q = 0.97) => {
  const ref = pct(a, q) || 1;
  return Array.from(a, (v) => Math.min(1, v / ref));
};
const subN = norm(sub), voiceN = norm(voice), presN = norm(pres), airN = norm(air);

// 人声显著度：中频强、低频弱
const prom = voiceN.map((v, i) => Math.max(0, v * 0.62 + presN[i] * 0.38 - subN[i] * 0.32));

const sym = (v) => (v < 0.05 ? " " : v < 0.13 ? "." : v < 0.24 ? ":" : v < 0.38 ? "o" : v < 0.55 ? "O" : "#");

// 每 50ms 一格
const step = 0.05;
const cols = Math.round((to - from) / step);
console.log(`俯视图 ${from}s → ${to}s  (每格 50ms, 每行 2.0s)`);
console.log(`字符: 空格=无   .=很弱   :=弱   o=中   O=强   #=很强    下方 | = 重低音鼓点`);
console.log("");

const perLine = 40; // 2.0s
for (let c0 = 0; c0 < cols; c0 += perLine) {
  const t0 = from + c0 * step;
  let vocLine = "";
  let bassLine = "";
  for (let c = c0; c < Math.min(cols, c0 + perLine); c++) {
    const t = from + c * step;
    const i = Math.round(t * afps);
    if (i >= frames) break;
    // 取该格内最大人声显著度（音节起音不该被平均掉）
    let m = 0;
    for (let j = i; j < Math.min(frames, i + 2); j++) m = Math.max(m, prom[j]);
    vocLine += sym(m);
    bassLine += subN[i] > 0.45 ? "|" : " ";
  }
  console.log(`${t0.toFixed(1).padStart(5)} |${vocLine}|`);
  console.log(`      |${bassLine}|`);
}