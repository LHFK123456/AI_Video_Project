/**
 * 自适应乐句切分：局部相对阈值，避免长乐句被漏切。
 * 输出每个乐句的起止、时长、内部音节起音数，便于映射到歌词行。
 *
 * 用法: node scripts/phrase-align.mjs public/test.mp3
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

const norm = (a, q = 0.97) => {
  const ref = pct(a, q) || 1;
  return Array.from(a, (v) => Math.min(1, v / ref));
};
const subN = norm(sub), voiceN = norm(voice), presN = norm(pres);

// 人声显著度：中频强壮且不被低频冲击主导
const prom = voiceN.map((v, i) => Math.max(0, v * 0.65 + presN[i] * 0.35 - subN[i] * 0.30));

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
const pS = smooth(prom, Math.round(0.06 * afps));

// 局部最大值（±1.3s 窗口）作为自适应参照
const R = Math.round(1.3 * afps);
const localMax = new Float32Array(frames);
{
  const dq = [];
  for (let f = 0; f < frames; f++) {
    while (dq.length && pS[dq[dq.length - 1]] <= pS[f]) dq.pop();
    dq.push(f);
    while (dq[0] < f - R) dq.shift();
    localMax[f] = pS[dq[0]];
  }
  // 反向再走一遍，得到两侧都包含的局部最大
  const dq2 = [];
  for (let f = frames - 1; f >= 0; f--) {
    while (dq2.length && pS[dq2[dq2.length - 1]] <= pS[f]) dq2.pop();
    dq2.push(f);
    while (dq2[0] > f + R) dq2.shift();
    localMax[f] = Math.min(localMax[f], pS[dq2[0]]);
  }
}

const RATIO = 0.52;      // 低于局部最大的 52% 视为句间低谷
const MIN_GAP = Math.round(0.17 * afps);
const MIN_SEG = Math.round(0.30 * afps);

const quiet = new Uint8Array(frames);
for (let f = 0; f < frames; f++) {
  quiet[f] = localMax[f] > 0.02 && pS[f] < localMax[f] * RATIO ? 1 : 0;
}

const segs = [];
let st = -1;
for (let f = 0; f <= frames; f++) {
  const q = f < frames ? quiet[f] === 1 : 0;
  if (q && st < 0) st = f;
  else if (!q && st >= 0) {
    if (f - st >= MIN_GAP) segs.push({ gapStart: st, gapEnd: f });
    st = -1;
  }
}

// 由低谷切出乐句
const phrases = [];
let cur = 0;
for (const g of segs) {
  if (g.gapStart - cur >= MIN_SEG) {
    phrases.push({ s: cur / afps, e: g.gapStart / afps });
  }
  cur = g.gapEnd;
}
if (frames - cur >= MIN_SEG) phrases.push({ s: cur / afps, e: (frames - 1) / afps });

/* 每句内部的音节起音数（谱通量峰） */
const flux = new Float32Array(frames);
for (let f = 1; f < frames; f++) {
  let s = 0;
  for (let k = bIdx(200); k < bIdx(5000); k++) {
    const d = Math.log1p(mag[f * nBins + k]) - Math.log1p(mag[(f - 1) * nBins + k]);
    if (d > 0) s += d;
  }
  flux[f] = s;
}
const fRef = pct(flux, 0.99) || 1;
const fluxN = Array.from(flux, (v) => Math.min(1, v / fRef));

const onsetsIn = (s, e) => {
  const i0 = Math.round(s * afps), i1 = Math.round(e * afps);
  const res = [];
  for (let f = Math.max(1, i0); f < Math.min(frames - 1, i1); f++) {
    if (fluxN[f] > 0.10 && fluxN[f] >= fluxN[f - 1] && fluxN[f] > fluxN[f + 1]) {
      const last = res[res.length - 1];
      if (!last || f - last >= Math.round(0.07 * afps)) res.push(f);
    }
  }
  return res.map((f) => +(f / afps).toFixed(3));
};

const rows = phrases.map((p, i) => {
  const on = onsetsIn(p.s, p.e);
  const i0 = Math.round(p.s * afps), i1 = Math.round(p.e * afps);
  let sum = 0;
  for (let f = i0; f < Math.min(i1, frames); f++) sum += pS[f];
  return {
    i: i + 1,
    start: +p.s.toFixed(2),
    end: +p.e.toFixed(2),
    dur: +(p.e - p.s).toFixed(2),
    strength: +(sum / Math.max(1, i1 - i0)).toFixed(3),
    onsets: on.length,
    onsetTimes: on,
  };
});

const BPM = 104.4, beat = 60 / BPM;
console.log(`自适应分段：${rows.length} 句\n`);
console.log("序  起     止    时长   强度  音节数  首个音节  最后一个音节");
for (const r of rows) {
  const b0 = (r.start / beat).toFixed(1);
  const b1 = (r.end / beat).toFixed(1);
  console.log(
    `${String(r.i).padStart(2)}  ${r.start.toFixed(2).padStart(5)}  ${r.end.toFixed(2).padStart(5)}  ` +
    `${r.dur.toFixed(2).padStart(4)}  ${r.strength.toFixed(2)}   ${String(r.onsets).padStart(2)}    ` +
    `第${b0}拍      第${b1}拍`,
  );
}

fs.writeFileSync("scripts/.phrases.json", JSON.stringify({ bpm: BPM, beat, phrases: rows }, null, 2));
console.log("\n已存 scripts/.phrases.json");