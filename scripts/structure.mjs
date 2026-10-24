/**
 * 结构分析：立体声宽度 + 频段能量 + 鼓点网格，输出每 0.5s 的结构表。
 * 用法: node scripts/structure.mjs public/test.mp3
 */
import { spawn } from "node:child_process";

const SR = 22050, WIN = 2048, HOP = 256;
const FF = "D:/ffmpeg/bin/ffmpeg.exe";

function decodeS(p) {
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

const { L, R } = await decodeS(process.argv[2] || "public/test.mp3");
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

const centerW = new Float32Array(frames);  // 中置宽带能量
const sideW = new Float32Array(frames);    // 侧向宽带能量
const vocalBand = new Float32Array(frames);
const subBand = new Float32Array(frames);
const hiBand = new Float32Array(frames);

const V0 = bIdx(250), V1 = bIdx(3800);
const S0 = bIdx(30), S1 = bIdx(110);
const H0 = bIdx(5000), H1 = bIdx(10000);
const W0 = bIdx(120), W1 = bIdx(9000);

for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  for (let i = 0; i < WIN; i++) {
    reL[i] = (L[off + i] || 0) * hann[i]; imL[i] = 0;
    reR[i] = (R[off + i] || 0) * hann[i]; imR[i] = 0;
  }
  fft(reL, imL); fft(reR, imR);
  let cw = 0, sw = 0, vb = 0, sb = 0, hb = 0;
  for (let k = W0; k < W1; k++) {
    const ml = Math.hypot(reL[k], imL[k]);
    const mr = Math.hypot(reR[k], imR[k]);
    cw += (ml + mr) / 2;
    sw += Math.abs(ml - mr) / 2;
  }
  for (let k = V0; k < V1; k++) {
    vocalBand[f] += (Math.hypot(reL[k], imL[k]) + Math.hypot(reR[k], imR[k])) / 2;
  }
  vocalBand[f] /= (V1 - V0);
  for (let k = S0; k < S1; k++) {
    subBand[f] += (Math.hypot(reL[k], imL[k]) + Math.hypot(reR[k], imR[k])) / 2;
  }
  subBand[f] /= (S1 - S0);
  for (let k = H0; k < H1; k++) {
    hiBand[f] += (Math.hypot(reL[k], imL[k]) + Math.hypot(reR[k], imR[k])) / 2;
  }
  hiBand[f] /= (H1 - H0);
  centerW[f] = cw / (W1 - W0);
  sideW[f] = sw / (W1 - W0);
}

const norm = (a, q = 0.97) => {
  const ref = pct(a, q) || 1;
  return Array.from(a, (v) => Math.min(1, v / ref));
};
const vN = norm(vocalBand), sN = norm(subBand), hN = norm(hiBand);

// 中置占比：越高越像"居中人声"
const mono = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  const t = centerW[f] + sideW[f];
  mono[f] = t > 1e-9 ? centerW[f] / t : 0.5;
}

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
const mS = smooth(mono, Math.round(0.12 * afps));

// 人声代理：中置占比高 × 中频能量强
const proxy = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  proxy[f] = Math.max(0, (mS[f] - 0.5) * 2.4) * vN[f];
}
const pN = norm(proxy, 0.95);
const pS = smooth(pN, Math.round(0.10 * afps));

const step = 0.5;
console.log("时间    中置占比  人声代理  中频   低频   高频   代理图示");
for (let t = 0; t < n / SR; t += step) {
  const f = Math.round(t * afps);
  if (f >= frames) break;
  let pm = 0, mm = 0, vm = 0, sm = 0, hm = 0, c = 0;
  for (let i = f; i < Math.min(frames, Math.round((t + step) * afps)); i++) {
    pm += pS[i]; mm += mS[i]; vm += vN[i]; sm += sN[i]; hm += hN[i]; c++;
  }
  if (!c) break;
  pm /= c; mm /= c; vm /= c; sm /= c; hm /= c;
  console.log(
    `${t.toFixed(1).padStart(5)}  ${mm.toFixed(3)}   ${pm.toFixed(2)}   ${vm.toFixed(2)}  ${sm.toFixed(2)}  ${hm.toFixed(2)}  ${"█".repeat(Math.round(pm * 36))}`,
  );
}