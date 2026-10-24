/**
 * 探索脚本：打印人声频段能量时间线 + 停顿分布，用于确定歌词乐句边界。
 * 用法: node scripts/explore-vocal.mjs public/test.mp3
 */
import fs from "node:fs";
import { spawn } from "node:child_process";

const SR = 22050;
const WIN = 1024;
const HOP = 256;
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

const samples = await decode(process.argv[2] || "public/test.mp3");
const hann = new Float32Array(WIN);
for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

const frames = Math.floor((samples.length - WIN) / HOP) + 1;
const afps = SR / HOP;
const hzPerBin = SR / WIN;
const bin = (hz) => Math.max(1, Math.min(WIN / 2 - 1, Math.round(hz / hzPerBin)));

const B_VOCAL = [bin(250), bin(4500)];   // 主唱基频+泛音主要区
const B_HIGH = [bin(5000), bin(10000)];  // 齿音/气声
const re = new Float64Array(WIN), im = new Float64Array(WIN);
const mag = new Float64Array(WIN / 2);
const vocal = new Float32Array(frames);
const high = new Float32Array(frames);
const rms = new Float32Array(frames);
const cent = new Float32Array(frames);

for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  let sum = 0;
  for (let i = 0; i < WIN; i++) {
    const v = samples[off + i] || 0;
    sum += v * v;
    re[i] = v * hann[i];
    im[i] = 0;
  }
  rms[f] = Math.sqrt(sum / WIN);
  fft(re, im);
  let vs = 0, hs = 0, cs = 0, cn = 0;
  for (let k = 1; k < WIN / 2; k++) {
    const m = Math.hypot(re[k], im[k]);
    mag[k] = m;
    if (k >= B_VOCAL[0] && k < B_VOCAL[1]) vs += m;
    if (k >= B_HIGH[0] && k < B_HIGH[1]) hs += m;
    cs += m * (k * hzPerBin);
    cn += m;
  }
  vocal[f] = vs / (B_VOCAL[1] - B_VOCAL[0]);
  high[f] = hs / (B_HIGH[1] - B_HIGH[0]);
  cent[f] = cn ? cs / cn : 0;
}

const pct = (a, q) => {
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] || 0;
};
const vRef = pct(vocal, 0.95) || 1;
const vN = Array.from(vocal, (v) => Math.min(1, v / vRef));

/** 平滑 */
function smooth(a, r) {
  const n = a.length, o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { s += a[j]; c++; }
    o[i] = s / c;
  }
  return o;
}
const vS = smooth(vN, Math.round(0.09 * afps));

// 每 0.25s 打印一次柱状图
console.log("时间  能量  频谱质心  图示");
for (let t = 0; t < samples.length / SR; t += 0.25) {
  const i = Math.floor(t * afps);
  if (i >= frames) break;
  const v = vS[i];
  const bar = "█".repeat(Math.round(v * 40));
  const c = cent[i];
  console.log(
    `${t.toFixed(2).padStart(5)}  ${v.toFixed(2)}  ${String(Math.round(c)).padStart(5)}Hz  ${bar}`,
  );
}

/* 停顿检测：vocal 能量低于阈值持续 > minGap */
const thr = Math.max(0.10, pct(vS, 0.30) * 0.55);
const minGap = Math.round(0.13 * afps);
const gaps = [];
let st = -1;
for (let f = 0; f <= frames; f++) {
  const quiet = f < frames && vS[f] < thr;
  if (quiet && st < 0) st = f;
  else if (!quiet && st >= 0) {
    if (f - st >= minGap) gaps.push({ s: st / afps, e: f / afps });
    st = -1;
  }
}
console.log(`\n阈值 ${thr.toFixed(3)}，停顿段数 ${gaps.length}`);
console.log(gaps.map((g) => `${g.s.toFixed(2)}-${g.e.toFixed(2)}`).join("  "));