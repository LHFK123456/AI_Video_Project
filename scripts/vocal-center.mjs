/**
 * 立体声中置分离提取人声：M=(L+R)/2, S=(L-R)/2，人声多在正中，S 会削弱它。
 * 用 center-isolated = M - k*S 的人声带能量作为"在唱"判据，并做乐句切分。
 *
 * 用法: node scripts/vocal-center.mjs public/test.mp3 [--roll 0 20]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const SR = 22050, WIN = 1024, HOP = 128;
const FF = "D:/ffmpeg/bin/ffmpeg.exe";

function decodeStereo(p) {
  return new Promise((res, rej) => {
    const pr = spawn(FF, ["-v", "error", "-i", p, "-ac", "2", "-ar", String(SR),
      "-f", "s16le", "-acodec", "pcm_s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const ch = [];
    let err = "";
    pr.stdout.on("data", (d) => ch.push(d));
    pr.stderr.on("data", (d) => (err += d));
    pr.on("close", (c) => {
      if (c !== 0) return rej(new Error(err));
      const b = Buffer.concat(ch);
      const n = Math.floor(b.length / 4);
      const L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        L[i] = b.readInt16LE(i * 4) / 32768;
        R[i] = b.readInt16LE(i * 4 + 2) / 32768;
      }
      res({ L, R });
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

const { L, R } = await decodeStereo(process.argv[2] || "public/test.mp3");
const n = L.length;
const hann = new Float32Array(WIN);
for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

const frames = Math.floor((n - WIN) / HOP) + 1;
const afps = SR / HOP;
const hzPerBin = SR / WIN;
const nBins = WIN / 2;
const bIdx = (hz) => Math.max(1, Math.min(nBins - 1, Math.round(hz / hzPerBin)));

const reL = new Float64Array(WIN), imL = new Float64Array(WIN);
const reR = new Float64Array(WIN), imR = new Float64Array(WIN);

const V0 = bIdx(220), V1 = bIdx(4000);
const centerE = new Float32Array(frames);  // 中置带能量
const sideE = new Float32Array(frames);    // 侧向带能量
const subE = new Float32Array(frames);

for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  for (let i = 0; i < WIN; i++) {
    reL[i] = (L[off + i] || 0) * hann[i];
    imL[i] = 0;
    reR[i] = (R[off + i] || 0) * hann[i];
    imR[i] = 0;
  }
  fft(reL, imL);
  fft(reR, imR);
  let ce = 0, se = 0, sb = 0;
  const S0 = bIdx(30), S1 = bIdx(110);
  for (let k = 1; k < nBins; k++) {
    const ml = Math.hypot(reL[k], imL[k]);
    const mr = Math.hypot(reR[k], imR[k]);
    const mid = (ml + mr) / 2;
    const side = Math.abs(ml - mr) / 2;
    if (k >= V0 && k < V1) { ce += mid; se += side; }
    if (k >= S0 && k < S1) sb += mid;
  }
  centerE[f] = ce / (V1 - V0);
  sideE[f] = se / (V1 - V0);
  subE[f] = sb / (S1 - S0);
}

/** 人声代理：中置能量中被"侧向"解释不掉的部分（中置占优 = 人声） */
const ratio = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  const tot = centerE[f] + sideE[f] || 1e-9;
  ratio[f] = centerE[f] / tot; // 0.5 = 完全居中, <0.5 = 偏侧
}
const cN = (() => {
  const ref = pct(centerE, 0.97) || 1;
  return Array.from(centerE, (v) => Math.min(1, v / ref));
})();
const sN = (() => {
  const ref = pct(sideE, 0.97) || 1;
  return Array.from(sideE, (v) => Math.min(1, v / ref));
})();
const subN = (() => {
  const ref = pct(subE, 0.97) || 1;
  return Array.from(subE, (v) => Math.min(1, v / ref));
})();

function smooth(a, r) {
  const m = a.length, o = new Float32Array(m);
  let s = 0, c = 0;
  for (let i = 0; i < Math.min(r, m); i++) { s += a[i]; c++; }
  for (let i = 0; i < m; i++) {
    if (i + r < m) { s += a[i + r]; c++; }
    if (i - r - 1 >= 0) { s -= a[i - r - 1]; c--; }
    o[i] = c > 0 ? s / c : 0;
  }
  return o;
}

// 人声存在度：中置显著强于侧向，且能量不弱
const vocal = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  const centerBias = Math.max(0, (ratio[f] - 0.5) * 2); // 0~1
  vocal[f] = cN[f] * (0.35 + 0.65 * centerBias) - subN[f] * 0.10;
}
const vRef = pct(vocal, 0.96) || 1;
const V = Array.from(vocal, (v) => Math.max(0, Math.min(1, v / vRef)));
const Vs = smooth(V, Math.round(0.05 * afps));

const args = process.argv.slice(2);
const rollIdx = args.indexOf("--roll");
if (rollIdx >= 0) {
  const from = Number(args[rollIdx + 1] || 0);
  const to = Number(args[rollIdx + 2] || 20);
  const sym = (v) => (v < 0.06 ? " " : v < 0.15 ? "." : v < 0.27 ? ":" : v < 0.42 ? "o" : v < 0.58 ? "O" : "#");
  console.log(`人声俯视图 ${from}→${to}s  (50ms/格)`);
  const step = 0.05, per = 40;
  for (let t0 = from; t0 < to; t0 += per * step) {
    let line = "", bass = "";
    for (let c = 0; c < per; c++) {
      const t = t0 + c * step;
      const i = Math.round(t * afps);
      if (i >= frames) break;
      let mx = 0;
      for (let j = i; j < Math.min(frames, i + 2); j++) mx = Math.max(mx, V[j]);
      line += sym(mx);
      bass += subN[i] > 0.42 ? "|" : " ";
    }
    console.log(`${t0.toFixed(1).padStart(5)} |${line}|`);
    console.log(`      |${bass}|`);
  }
}

/* 自适应切句 */
const RAD = Math.round(1.2 * afps);
const lmax = new Float32Array(frames);
{
  const dq = [];
  for (let f = 0; f < frames; f++) {
    while (dq.length && Vs[dq[dq.length - 1]] <= Vs[f]) dq.pop();
    dq.push(f);
    while (dq[0] < f - RAD) dq.shift();
    lmax[f] = Vs[dq[0]];
  }
  const dq2 = [];
  for (let f = frames - 1; f >= 0; f--) {
    while (dq2.length && Vs[dq2[dq2.length - 1]] <= Vs[f]) dq2.pop();
    dq2.push(f);
    while (dq2[0] > f + RAD) dq2.shift();
    lmax[f] = Math.min(lmax[f], Vs[dq2[0]]);
  }
}

const RATIO = 0.55, MIN_GAP = Math.round(0.18 * afps), MIN_SEG = Math.round(0.32 * afps);
const quiet = new Uint8Array(frames);
for (let f = 0; f < frames; f++) quiet[f] = lmax[f] > 0.03 && Vs[f] < lmax[f] * RATIO ? 1 : 0;

const gaps = [];
let st = -1;
for (let f = 0; f <= frames; f++) {
  const q = f < frames ? quiet[f] === 1 : 0;
  if (q && st < 0) st = f;
  else if (!q && st >= 0) {
    if (f - st >= MIN_GAP) gaps.push({ s: st, e: f });
    st = -1;
  }
}

const segs = [];
let cur = 0;
for (const g of gaps) {
  if (g.s - cur >= MIN_SEG) segs.push({ s: cur / afps, e: g.s / afps });
  cur = g.e;
}
if (frames - cur >= MIN_SEG) segs.push({ s: cur / afps, e: (frames - 1) / afps });

console.log(`\n=== 中置人声切分：${segs.length} 段 ===`);
segs.forEach((s, i) => {
  const i0 = Math.round(s.s * afps), i1 = Math.round(s.e * afps);
  let sum = 0;
  for (let f = i0; f < Math.min(i1, frames); f++) sum += Vs[f];
  console.log(
    `${String(i + 1).padStart(2)}  ${s.s.toFixed(2).padStart(6)} → ${s.e.toFixed(2).padStart(6)}  ` +
    `${(s.e - s.s).toFixed(2)}s  强度 ${(sum / Math.max(1, i1 - i0)).toFixed(2)}`,
  );
});

fs.writeFileSync("scripts/.vocal-center.json", JSON.stringify({
  frames, afps,
  profile: Array.from({ length: Math.floor(n / SR / 0.02) }, (_, i) => {
    const f = Math.round(i * 0.02 * afps);
    return f < frames ? +Vs[f].toFixed(3) : 0;
  }),
}));