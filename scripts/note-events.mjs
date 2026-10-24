/**
 * 唱音事件检测：稳定基频 + 延音 = 人声。
 * 与打击/琶音的区别在于"音高稳定且持续"，用基频显著度的时间连续性判定。
 *
 * 用法: node scripts/note-events.mjs public/test.mp3
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const SR = 22050, WIN = 2048, HOP = 128;
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
const hzPerBin = SR / WIN;              // 10.77 Hz/bin
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

/* 基频显著度：在 100~800Hz 找最强峰，并检查其 2/3 次谐波是否也在峰上 */
const F0_LO = bIdx(100), F0_HI = bIdx(800);
const f0 = new Float32Array(frames);       // 每帧最强基频 Hz
const salience = new Float32Array(frames); // 基频显著度 0~1
const harmonicRatio = new Float32Array(frames);

for (let f = 0; f < frames; f++) {
  let bestK = -1, bestV = 0, sumM = 0;
  for (let k = F0_LO; k < F0_HI; k++) {
    const v = mag[f * nBins + k];
    sumM += v;
    if (v > bestV) { bestV = v; bestK = k; }
  }
  if (bestK < 0) continue;
  f0[f] = bestK * hzPerBin;
  // 谐波核对：2x / 3x 位置的能量
  let hSum = 0, hCnt = 0;
  for (const mult of [2, 3]) {
    const k = Math.round(bestK * mult);
    if (k < nBins) {
      let m = 0;
      for (let d = -2; d <= 2; d++) m = Math.max(m, mag[f * nBins + Math.min(nBins - 1, Math.max(1, k + d))]);
      hSum += m;
      hCnt++;
    }
  }
  const hAvg = hCnt ? hSum / hCnt : 0;
  // 显著度 = 峰值相对该帧均值的倍数，再乘谐波一致性
  const peakRatio = bestV / Math.max(1e-9, sumM / (F0_HI - F0_LO));
  const cons = Math.min(1, hAvg / Math.max(1e-9, bestV));
  salience[f] = Math.min(1, (peakRatio / 6) * (0.3 + 0.7 * cons));
  harmonicRatio[f] = cons;
}

/* 平滑 + 音高稳定性（连续帧基频接近 = 同一个唱音） */
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
const sal = smooth(salience, 3);

/* 半音级音高（相对 440） */
const midiOf = (hz) => (hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0);
const midi = new Float32Array(frames);
for (let f = 0; f < frames; f++) midi[f] = midiOf(f0[f]);

/* 唱音段：显著度高于阈值且音高在 ±1.5 半音内连续 */
const thr = Math.max(0.12, pct(sal, 0.55));
const notes = [];
let st = -1, lastMidi = 0;
for (let f = 0; f < frames; f++) {
  const ok = sal[f] > thr && Math.abs(midi[f] - lastMidi) < 1.6;
  if (ok && st < 0) { st = f; lastMidi = midi[f]; }
  else if (ok) { lastMidi = 0.7 * lastMidi + 0.3 * midi[f]; }
  else if (st >= 0) {
    if (f - st >= Math.round(0.075 * afps)) notes.push({ s: st / afps, e: f / afps });
    st = -1;
  }
}
if (st >= 0) notes.push({ s: st / afps, e: frames / afps });

console.log(`唱音段阈值 ${thr.toFixed(3)}  检出 ${notes.length} 个音`);

/* 每 1 秒的音符数与音符总时长占比 */
console.log("\n秒   音符数  发声占比  平均基频");
for (let t = 0; t < samples.length / SR; t += 1) {
  const inWin = notes.filter((n2) => n2.s < t + 1 && n2.e > t);
  const covered = inWin.reduce((s, n2) => s + (Math.min(n2.e, t + 1) - Math.max(n2.s, t)), 0);
  const fs_ = Math.round(t * afps), fe = Math.min(frames - 1, Math.round((t + 1) * afps));
  let hsum = 0, hc = 0;
  for (let f = fs_; f < fe; f++) if (sal[f] > thr) { hsum += f0[f]; hc++; }
  console.log(
    `${t.toFixed(0).padStart(3)}  ${String(inWin.length).padStart(5)}    ${(covered * 100).toFixed(0).padStart(4)}%   ${hc ? Math.round(hsum / hc) : 0}Hz`,
  );
}

/* 音符起点表（用于吸附） */
const starts = notes.map((n2) => +n2.s.toFixed(3));
fs.writeFileSync("scripts/.notes.json", JSON.stringify({
  thr,
  notes: notes.map((n2) => ({ s: +n2.s.toFixed(3), e: +n2.e.toFixed(3) })),
}));
console.log(`\n音符表已存 scripts/.notes.json`);