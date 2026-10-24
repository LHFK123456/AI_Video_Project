#!/usr/bin/env node
/**
 * 生成一段带真实鼓点的测试音频（WAV）
 * 底鼓 + 军鼓 + 踩镲 + 贝斯 + 和弦，128 BPM
 * 用于验证鼓点检测精度，不放进正式素材
 *
 * 用法: node scripts/make-test-audio.mjs [输出路径] [--bpm 128] [--dur 12] [--sr 44100]
 */

import fs from "node:fs";

const args = process.argv.slice(2);
let out = "assets/test-beat.wav";
let BPM = 128;
let DUR = 12;
let SR = 44100;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--bpm") BPM = Number(args[++i]);
  else if (args[i] === "--dur") DUR = Number(args[++i]);
  else if (args[i] === "--sr") SR = Number(args[++i]);
  else out = args[i];
}

const N = Math.floor(SR * DUR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const rand = (() => {
  let s = 12345;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff * 2 - 1;
  };
})();

function add(start, gen) {
  const i0 = Math.floor(start * SR);
  for (let i = 0; i < gen.length; i++) {
    const k = i0 + i;
    if (k >= 0 && k < N) {
      L[k] += gen[i];
      R[k] += gen[i];
    }
  }
}

/* 底鼓：正弦扫频 120→45Hz + 点击瞬态 */
function kick() {
  const d = 0.32;
  const n = Math.floor(d * SR);
  const b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = 45 + 95 * Math.exp(-t * 26);
    ph += (2 * Math.PI * f) / SR;
    const env = Math.exp(-t * 9);
    const click = i < 60 ? rand() * 0.5 * (1 - i / 60) : 0;
    b[i] = Math.sin(ph) * env * 0.95 + click;
  }
  return b;
}

/* 军鼓：噪声 + 200Hz 体 */
function snare() {
  const d = 0.2;
  const n = Math.floor(d * SR);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 24);
    b[i] = (rand() * 0.62 + Math.sin(2 * Math.PI * 195 * t) * 0.38) * env * 0.55;
  }
  return b;
}

/* 踩镲：高通噪声 */
function hat(decay = 55) {
  const d = 0.06;
  const n = Math.floor(d * SR);
  const b = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const v = rand();
    const hp = v - prev; // 简易高通
    prev = v;
    b[i] = hp * Math.exp(-t * decay) * 0.2;
  }
  return b;
}

/* 贝斯 + 和弦，给频谱更多内容 */
function pad(freq, start, dur) {
  const n = Math.floor(dur * SR);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.15);
    b[i] =
      (Math.sin(2 * Math.PI * freq * t) * 0.24 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.1 +
        Math.sin(2 * Math.PI * freq * 3 * t) * 0.045) *
      env *
      0.5;
  }
  return b;
}

const beat = 60 / BPM;
const bar = beat * 4;
const bars = Math.ceil(DUR / bar);

const K = kick();
const S = snare();
const H = hat();

for (let b = 0; b < bars; b++) {
  const t0 = b * bar;
  // 四四拍：底鼓 1、3 拍，军鼓 2、4 拍
  add(t0, K);
  add(t0 + beat * 2, K);
  add(t0 + beat * 1.5, K);
  add(t0 + beat * 1, S);
  add(t0 + beat * 3, S);
  // 八分踩镲
  for (let i = 0; i < 8; i++) add(t0 + beat * 0.5 * i, H);
  // 附点：反拍镲
  add(t0 + beat * 0.75, hat(70));
  // 贝斯根音（A1）与和弦
  add(t0, pad(55, beat * 1.9));
  add(t0 + beat * 2, pad(73.42, beat * 1.9));
  if (b % 2 === 1) add(t0, pad(220, bar * 0.95));
}

/* 母带：软限幅 */
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]));
const gain = peak > 0 ? 0.92 / peak : 1;
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), i * 4 + 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0);
hdr.writeUInt32LE(36 + data.length, 4);
hdr.write("WAVE", 8);
hdr.write("fmt ", 12);
hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24);
hdr.writeUInt32LE(SR * 4, 28);
hdr.writeUInt16LE(4, 32);
hdr.writeUInt16LE(16, 34);
hdr.write("data", 36);
hdr.writeUInt32LE(data.length, 40);

const dir = out.replace(/[\\/][^\\/]+$/, "");
if (dir) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(out, Buffer.concat([hdr, data]));
console.log(`✔ ${out}  ${BPM}BPM  ${DUR}s  ${(fs.statSync(out).size / 1024).toFixed(0)}KB`);
console.log(`  预期拍点数: ${Math.floor(DUR / (60 / BPM)) + 1}`);