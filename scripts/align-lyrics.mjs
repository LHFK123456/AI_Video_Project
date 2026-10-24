/**
 * 歌词对齐：检测人声音节起音 → 用最长停顿作为句界 → 用音节数校验。
 * 用法: node scripts/align-lyrics.mjs public/test.mp3
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const SR = 22050, WIN = 1024, HOP = 64; // 更细 2.9ms 分辨率
const FF = "D:/ffmpeg/bin/ffmpeg.exe";

/* ------------------------------- 歌词 ------------------------------- */
const LYRICS = [
  ["Some build it up so they can break it down", "有的人筑起高楼 为了再全部倾覆", 10],
  ["Some stay the same and never miss a thing", "有的人从未改变 也不会错过什么", 10],
  ["Too much と足りない間を", "在过剩与不足之间", 10],
  ["探し続けてるばかり", "不断地寻求着平衡", 11],
  ["Live and learn or learn to live", "活到老学到老 或是学习如何活着", 8],
  ["Live it up or die trying", "坚持活下去 或是死在奋斗的时候", 8],
  ["スタートとエンドに", "事物的开始与结束", 8],
  ["こだわりはできやしない", "无法局限我的视野", 11],
  ["Half full of fantasies", "一半鼓鼓囊囊 全是幻想", 7],
  ["Half empty broken dreams", "一半空空荡荡 破碎的梦", 7],
  ["(Read between the lines)", "(领悟言外之意)", 5],
  ["Flawless is all it seems", "看起来全都是完美无缺的", 7],
  ["Far from dream", "梦想遥不可及", 4],
  ["Why do we live like", "我们为何要这样生活", 5],
  ["We are a dying breed?", "难道我们是濒临灭绝的物种？", 6],
  ["Most of us just keep starving for attention", "我们之中的大多数都渴望得到关注", 11],
  ["We are what we see", "我们就是自己眼中这样", 5],
  ["If all of us believe in living perfect", "如果每一个人都相信自己完美地活着", 10],
  ["Happiness will come unexpected", "幸福会毫无预兆地来到", 9],
  ["Don't let someone else take it for granted", "不要让别人把这视作理所当然", 10],
  ["Won't know what you've got until it's all gone and away", "在全都失去之前 你不会知道自己拥有什么", 14],
  ["Life is not so bad you gotta live it up", "生活没有那么糟糕 你得要坚持下去", 11],
];

/* ------------------------------ 解码 ------------------------------ */
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

/* 人声带谱通量（200-4500Hz）：音节起音检测 */
const A = bIdx(200), B = bIdx(4500);
const flux = new Float32Array(frames);
const voiceE = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  let s = 0, e = 0;
  for (let k = A; k < B; k++) {
    const m = mag[f * nBins + k];
    e += m;
    if (f > 0) {
      const d = Math.log1p(m) - Math.log1p(mag[(f - 1) * nBins + k]);
      if (d > 0) s += d;
    }
  }
  flux[f] = s;
  voiceE[f] = e / (B - A);
}

const fRef = pct(flux, 0.985) || 1;
const fluxN = Array.from(flux, (v) => Math.min(1, v / fRef));
const vRef = pct(voiceE, 0.97) || 1;
const voiceN = Array.from(voiceE, (v) => Math.min(1, v / vRef));

/* 起音挑峰：自适应阈值（局部均值 + k*标准差） */
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
const baseRaw = smooth(flux, Math.round(0.18 * afps));
const base = Array.from(baseRaw, (v) => Math.min(1, v / fRef));

const MIN_GAP = Math.round(0.085 * afps); // 音节最短间隔 85ms
const onsets = [];
for (let f = 2; f < frames - 2; f++) {
  const v = fluxN[f];
  if (v < 0.05) continue;
  if (!(v > fluxN[f - 1] && v >= fluxN[f + 1])) continue;
  if (v < base[f] * 1.35 + 0.02) continue;
  const o = { f, t: f / afps, v: v * (0.4 + 0.6 * voiceN[f]) };
  const last = onsets[onsets.length - 1];
  if (last && o.f - last.f < MIN_GAP) {
    if (o.v > last.v) { onsets[onsets.length - 1] = o; }
  } else onsets.push(o);
}

console.log(`检测到音节起音 ${onsets.length} 个   （歌词音节合计 ${LYRICS.reduce((s, l) => s + l[2], 0)} 个）`);
const rate = onsets.length / (frames / afps);
console.log(`平均起音密度 ${rate.toFixed(2)} 个/秒`);

/* 起音间隔 → 句界候选 */
const gaps = [];
for (let i = 1; i < onsets.length; i++) {
  const d = onsets[i].t - onsets[i - 1].t;
  gaps.push({ i, t: onsets[i - 1].t, next: onsets[i].t, d });
}
gaps.sort((a, b) => b.d - a.d);
console.log(`\n最长 30 个起音间隔：`);
gaps.slice(0, 30).forEach((g, i) =>
  console.log(`  ${String(i + 1).padStart(2)}  ${g.t.toFixed(2)} → ${g.next.toFixed(2)}   间隔 ${g.d.toFixed(3)}s`),
);

fs.writeFileSync("scripts/.onsets.json", JSON.stringify(onsets.map((o) => ({ t: +o.t.toFixed(3), v: +o.v.toFixed(3) }))));
console.log(`\n起音表已存 scripts/.onsets.json`);