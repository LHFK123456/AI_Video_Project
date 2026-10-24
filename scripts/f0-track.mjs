/**
 * 基频轨迹法：自相关求 F0 → 找音高稳定的延音段（唱音）。
 * 唱音 = 同一音高持续 >120ms；伴奏琶音/鼓点音高不稳或无音高。
 *
 * 用法: node scripts/f0-track.mjs public/test.mp3 [--dump]
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

const pct = (a, q) => {
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] || 0;
};

const samples = await decode(process.argv[2] || "public/test.mp3");
const frames = Math.floor((samples.length - WIN) / HOP) + 1;
const afps = SR / HOP;

/* 自相关求 F0：搜索 70~500Hz */
const LAG_MIN = Math.floor(SR / 500);  // 44
const LAG_MAX = Math.floor(SR / 70);   // 315

const f0 = new Float32Array(frames);
const clarity = new Float32Array(frames);  // 自相关峰值 0~1
const rms = new Float32Array(frames);

for (let f = 0; f < frames; f++) {
  const off = f * HOP;
  // 去均值 + 能量
  let mean = 0;
  for (let i = 0; i < WIN; i++) mean += samples[off + i] || 0;
  mean /= WIN;
  let e = 0;
  for (let i = 0; i < WIN; i++) {
    const v = (samples[off + i] || 0) - mean;
    e += v * v;
  }
  rms[f] = Math.sqrt(e / WIN);
  if (e < 1e-7) continue;

  let bestLag = -1, bestR = 0, prevR = 0, rising = false;
  // 归一化自相关
  for (let lag = LAG_MIN; lag <= LAG_MAX; lag++) {
    let s = 0, n1 = 0, n2 = 0;
    for (let i = 0; i < WIN - lag; i++) {
      const a = (samples[off + i] || 0) - mean;
      const b = (samples[off + i + lag] || 0) - mean;
      s += a * b;
      n1 += a * a;
      n2 += b * b;
    }
    const den = Math.sqrt(n1 * n2);
    const r = den > 1e-9 ? s / den : 0;
    // 取第一个显著峰（避免倍频误判）
    if (r > prevR && !rising && prevR > 0.5 && prevR > bestR) {
      // 前一个点是峰
      bestR = prevR;
      bestLag = lag - 1;
      rising = true;
    }
    if (r < prevR) rising = false;
    prevR = r;
    if (r > bestR && !rising) { /* 继续 */ }
  }
  if (bestLag < 0) {
    // 回退：全局最大
    let mr = 0, ml = -1;
    for (let lag = LAG_MIN; lag <= LAG_MAX; lag++) {
      let s = 0, n1 = 0, n2 = 0;
      for (let i = 0; i < WIN - lag; i++) {
        const a = (samples[off + i] || 0) - mean;
        const b = (samples[off + i + lag] || 0) - mean;
        s += a * b;
      }
      if (s > mr) { mr = s; ml = lag; }
    }
    if (ml > 0) { bestLag = ml; bestR = 0.5; }
  }
  if (bestLag > 0) {
    f0[f] = SR / bestLag;
    clarity[f] = Math.max(0, bestR);
  }
}

const midi = new Float32Array(frames);
for (let f = 0; f < frames; f++) midi[f] = f0[f] > 0 ? 69 + 12 * Math.log2(f0[f] / 440) : 0;

const cRef = pct(clarity, 0.95) || 1;
const rRef = pct(rms, 0.95) || 1;
const voiced = new Uint8Array(frames);
for (let f = 0; f < frames; f++) {
  voiced[f] = clarity[f] > cRef * 0.35 && rms[f] > rRef * 0.05 && midi[f] > 0 ? 1 : 0;
}
const voicedRate = Array.from(voiced).reduce((a, b) => a + b, 0) / frames;
console.log(`有音高帧占比 ${(voicedRate * 100).toFixed(1)}%`);
console.log(`clarity 中位 ${pct(clarity, 0.5).toFixed(3)}  95分位 ${pct(clarity, 0.95).toFixed(3)}`);

/* 音高稳定段：连续 ≥120ms 且音高变化 < 1.2 半音 */
const MIN_DUR = Math.round(0.12 * afps);
const notes = [];
let st = -1, acc = 0, cnt = 0;
for (let f = 0; f <= frames; f++) {
  const ok = f < frames && voiced[f] === 1;
  const ref = cnt ? acc / cnt : 0;
  const stable = ok && (cnt === 0 || Math.abs(midi[f] - ref) < 1.2);
  if (stable) {
    if (st < 0) st = f;
    acc += midi[f];
    cnt++;
  } else if (st >= 0) {
    if (f - st >= MIN_DUR) notes.push({ s: st / afps, e: f / afps, m: acc / cnt });
    st = -1; acc = 0; cnt = 0;
  } else { acc = 0; cnt = 0; }
}
if (st >= 0 && frames - st >= MIN_DUR) notes.push({ s: st / afps, e: frames / afps, m: acc / cnt });

console.log(`音高稳定段 ${notes.length} 个，总覆盖 ${(notes.reduce((s, n2) => s + (n2.e - n2.s), 0)).toFixed(1)}s / ${(frames / afps).toFixed(1)}s`);

/* 每秒的音符数与覆盖 */
console.log("\n秒   音符数  覆盖   平均音高(semi)");
for (let t = 0; t < frames / afps; t += 1) {
  const inW = notes.filter((n2) => n2.s < t + 1 && n2.e > t);
  const cov = inW.reduce((s, n2) => s + (Math.min(n2.e, t + 1) - Math.max(n2.s, t)), 0);
  const ms = inW.reduce((s, n2) => s + n2.m, 0) / Math.max(1, inW.length);
  console.log(`${t.toFixed(0).padStart(3)}  ${String(inW.length).padStart(5)}  ${(cov * 100).toFixed(0).padStart(4)}%   ${ms.toFixed(1)}`);
}

if (process.argv.includes("--dump")) {
  console.log("\n音符明细：");
  notes.forEach((n2, i) =>
    console.log(`${String(i + 1).padStart(3)}  ${n2.s.toFixed(2).padStart(6)} → ${n2.e.toFixed(2).padStart(6)}  ${(n2.e - n2.s).toFixed(2)}s  midi ${n2.m.toFixed(1)}`),
  );
}

fs.writeFileSync("scripts/.f0notes.json", JSON.stringify(
  notes.map((n2) => ({ s: +n2.s.toFixed(3), e: +n2.e.toFixed(3), m: +n2.m.toFixed(2) })),
));