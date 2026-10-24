/**
 * 候选歌词句边界检测：人声频段(300-4000Hz)相对低频的"突出度"曲线，
 * 找局部低谷作为句间停顿，并用起音点吸附边界。
 *
 * 用法: node scripts/lyric-boundaries.mjs public/test.mp3
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

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
const bIdx = (hz) => Math.max(1, Math.min(nBins - 1, Math.round(hz / hzPerBin)));

const re = new Float64Array(WIN), im = new Float64Array(WIN);
const mag = new Float64Array(frames * nBins);
for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  for (let i = 0; i < WIN; i++) { re[i] = (samples[off + i] || 0) * hann[i]; im[i] = 0; }
  fft(re, im);
  for (let k = 0; k < nBins; k++) mag[f * nBins + k] = Math.hypot(re[k], im[k]);
}

/* 分频段能量 */
const BANDS = {
  sub: [30, 110],
  low: [110, 300],
  voice: [300, 1200],
  pres: [1200, 3500],
  air: [3500, 9000],
  hi: [9000, 10800],
};
const bandCurves = {};
for (const [name, [lo, hi]] of Object.entries(BANDS)) {
  const a = bIdx(lo), b = bIdx(hi);
  const arr = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let k = a; k < b; k++) s += mag[f * nBins + k];
    arr[f] = s / Math.max(1, b - a);
  }
  const ref = pct(arr, 0.97) || 1;
  bandCurves[name] = Array.from(arr, (v) => Math.min(1, v / ref));
}

/* 谱通量（全带，用于起音） */
const flux = new Float32Array(frames);
for (let f = 1; f < frames; f++) {
  let s = 0;
  for (let k = bIdx(80); k < bIdx(8000); k++) {
    const d = Math.log1p(mag[f * nBins + k]) - Math.log1p(mag[(f - 1) * nBins + k]);
    if (d > 0) s += d;
  }
  flux[f] = s;
}
const fluxRef = pct(flux, 0.97) || 1;
const fluxN = Array.from(flux, (v) => Math.min(1, v / fluxRef));

/* 人声存在度：voice+presence 高于 sub 冲击 → 像在唱 */
const vocality = bandCurves.voice.map((v, i) => {
  const p = bandCurves.pres[i];
  const sub = bandCurves.sub[i];
  const body = v * 0.6 + p * 0.4;
  return Math.max(0, body - sub * 0.35);
});
const vRef = pct(vocality, 0.95) || 1;
const voc = Array.from(vocality, (v) => Math.min(1, v / vRef));

function smooth(a, r) {
  const n = a.length, o = new Float32Array(n);
  let s = 0, c = 0;
  for (let i = 0; i < Math.min(r, n); i++) { s += a[i]; c++; }
  for (let i = 0; i < n; i++) {
    if (i + r < n) { s += a[i + r]; c++; }
    if (i - r - 1 >= 0) { s -= a[i - r - 1]; c--; }
    o[i] = c > 0 ? s / c : 0;
  }
  return o;
}
const vS = smooth(voc, Math.round(0.055 * afps));   // ~55ms 平滑，保留音节起伏
const vSlow = smooth(voc, Math.round(0.20 * afps));  // 200ms 慢包络，看乐句轮廓

/* 用慢包络找局部低谷（句间停顿） */
const thrAbs = Math.max(0.10, pct(vSlow, 0.25));
const minGap = Math.round(0.14 * afps);
const gaps = [];
let st = -1;
for (let f = 0; f <= frames; f++) {
  const q = f < frames && vSlow[f] < thrAbs;
  if (q && st < 0) st = f;
  else if (!q && st >= 0) {
    if (f - st >= minGap) {
      // 谷底帧
      let bi = st, bv = vSlow[st];
      for (let i = st; i < f; i++) if (vSlow[i] < bv) { bv = vSlow[i]; bi = i; }
      gaps.push({ s: st / afps, e: f / afps, mid: bi / afps, depth: bv });
    }
    st = -1;
  }
}

console.log(`阈值 ${thrAbs.toFixed(3)}  停顿候选 ${gaps.length} 个`);
console.log("序  谷底(s)   持续     深度");
gaps.forEach((g, i) => {
  console.log(
    `${String(i + 1).padStart(2)}  ${g.mid.toFixed(2).padStart(7)}  ` +
    `${(g.e - g.s).toFixed(2)}s   ${g.depth.toFixed(3)}`,
  );
});

/* 按停顿切出的乐句 */
const bounds = [0, ...gaps.map((g) => g.mid), samples.length / SR];
const phrases = [];
for (let i = 0; i < bounds.length - 1; i++) {
  const s = bounds[i], e = bounds[i + 1];
  if (e - s < 0.40) continue;
  const i0 = Math.round(s * afps), i1 = Math.round(e * afps);
  let sum = 0;
  for (let f = i0; f < Math.min(i1, frames); f++) sum += vS[f];
  phrases.push({ s, e, avg: sum / Math.max(1, i1 - i0) });
}
console.log(`\n=== 乐句 ${phrases.length} 段 ===`);
phrases.forEach((p, i) => {
  console.log(`${String(i + 1).padStart(2)}  ${p.s.toFixed(2).padStart(6)} → ${p.e.toFixed(2).padStart(6)}   ${(p.e - p.s).toFixed(2)}s   强度 ${p.avg.toFixed(2)}`);
});

/* 导出逐 0.1s 轮廓供后续查看 */
const out = [];
for (let t = 0; t < samples.length / SR; t += 0.1) {
  const i = Math.round(t * afps);
  if (i >= frames) break;
  out.push({ t: +t.toFixed(2), v: +vS[i].toFixed(3), s: +vSlow[i].toFixed(3), f: +fluxN[i].toFixed(3) });
}
fs.writeFileSync("scripts/.vocal-profile.json", JSON.stringify(out));
console.log(`\n逐 0.1s 轮廓已存 scripts/.vocal-profile.json (${out.length} 点)`);