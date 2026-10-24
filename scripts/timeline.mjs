/**
 * 综合时间线：低频 / 起音密度 / 高频(齿音气声) / 谱平坦度 四轨叠加。
 * 齿音与气声是人声的强指示（唱词里的 s/t/k 辅音、换气声）。
 *
 * 用法: node scripts/timeline.mjs public/test.mp3 [from] [to] [stepMs]
 */
import { spawn } from "node:child_process";

const SR = 22050, WIN = 1024, HOP = 64;
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
const stepMs = Number(process.argv[5] || 40);

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

const sub = new Float32Array(frames);   // 30-110 低频
const body = new Float32Array(frames);  // 250-1200 人声基频区
const sib = new Float32Array(frames);   // 5000-10000 齿音
const flat = new Float32Array(frames);  // 谱平坦度（噪声性）
const flux = new Float32Array(frames);

const S0 = bIdx(30), S1 = bIdx(110);
const B0 = bIdx(250), B1 = bIdx(1200);
const H0 = bIdx(5000), H1 = bIdx(10000);

for (let f = 0; f < frames; f++) {
  let sb = 0, bd = 0, hi = 0;
  for (let k = S0; k < S1; k++) sb += mag[f * nBins + k];
  for (let k = B0; k < B1; k++) bd += mag[f * nBins + k];
  for (let k = H0; k < H1; k++) hi += mag[f * nBins + k];
  sub[f] = sb / (S1 - S0);
  body[f] = bd / (B1 - B0);
  sib[f] = hi / (H1 - H0);

  // 谱平坦度：几何均值/算术均值（1=噪声, 0=纯音）
  let logSum = 0, sum = 0, cnt = 0;
  for (let k = B0; k < bIdx(6000); k++) {
    const v = mag[f * nBins + k] + 1e-10;
    logSum += Math.log(v);
    sum += v;
    cnt++;
  }
  flat[f] = cnt ? Math.exp(logSum / cnt) / (sum / cnt) : 0;

  if (f > 0) {
    let s = 0;
    for (let k = bIdx(200); k < bIdx(6000); k++) {
      const d = Math.log1p(mag[f * nBins + k]) - Math.log1p(mag[(f - 1) * nBins + k]);
      if (d > 0) s += d;
    }
    flux[f] = s;
  }
}

const norm = (a, q = 0.97) => {
  const ref = pct(a, q) || 1;
  return Array.from(a, (v) => Math.min(1, v / ref));
};
const subN = norm(sub), bodyN = norm(body), sibN = norm(sib), flatN = norm(flat, 0.99), fluxN = norm(flux, 0.99);

const sym = (v) => (v < 0.10 ? " " : v < 0.22 ? "." : v < 0.36 ? ":" : v < 0.50 ? "o" : v < 0.66 ? "O" : v < 0.82 ? "#" : "@");

const stepF = Math.max(1, Math.round((stepMs / 1000) * afps));
const cols = Math.floor((to - from) * afps / stepF);
const perLine = Math.round(2 / (stepF / afps)); // 每行 2 秒

console.log(`综合时间线 ${from}s→${to}s  每格 ${(stepF / afps * 1000).toFixed(0)}ms  每行 ${(perLine * stepF / afps).toFixed(1)}s`);
console.log(`V=人声基频区  低=低频鼓  齿=5k-10k齿音气声  平=谱平坦度  通=谱通量(起音)`);
console.log("");

const peak = (arr, i0, i1) => {
  let m = 0;
  for (let i = i0; i < i1 && i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
};

for (let c0 = 0; c0 < cols; c0 += perLine) {
  const t0 = from + (c0 * stepF) / afps;
  const L = { V: "", b: "", s: "", f: "", x: "" };
  for (let c = c0; c < Math.min(cols, c0 + perLine); c++) {
    const i0 = Math.round(from * afps) + c * stepF;
    const i1 = Math.min(frames, i0 + stepF);
    L.V += sym(peak(bodyN, i0, i1));
    L.b += sym(peak(subN, i0, i1) * 0.9);
    L.s += sym(peak(sibN, i0, i1));
    L.f += sym(peak(flatN, i0, i1));
    L.x += sym(peak(fluxN, i0, i1));
  }
  console.log(`     ${t0.toFixed(1).padStart(5)}s`);
  console.log(`  V  |${L.V}|`);
  console.log(`  低 |${L.b}|`);
  console.log(`  齿 |${L.s}|`);
  console.log(`  平 |${L.f}|`);
  console.log(`  通 |${L.x}|`);
  console.log("");
}