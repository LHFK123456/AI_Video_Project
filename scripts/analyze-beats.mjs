#!/usr/bin/env node
/**
 * 鼓点 / 频谱分析器
 *
 * 把音频解码成 PCM → 短时傅里叶变换 → 谱通量(spectral flux)做起音检测
 * → 自适应阈值找峰值 → 估算 BPM → 输出逐帧频谱能量 + 节拍点
 *
 * 产物：
 *   public/audio.<ext>        音频副本（供 Remotion staticFile 使用）
 *   src/data/analysis.json    节拍、BPM、逐帧能量、歌词
 *   src/data/spectrum.json    逐帧 48 段频谱（驱动条形可视化）
 *
 * 用法：
 *   node scripts/analyze-beats.mjs <音频> [--title "标题"] [--lyrics x.lrc]
 *                                  [--fps 30] [--ffmpeg 路径]
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const o = { fps: 30, title: "", lyrics: "", ffmpeg: "", bands: 48 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--title") o.title = argv[++i] ?? "";
    else if (a === "--lyrics") o.lyrics = argv[++i] ?? "";
    else if (a === "--fps") o.fps = Number(argv[++i]) || 30;
    else if (a === "--ffmpeg") o.ffmpeg = argv[++i] ?? "";
    else if (a === "--bands") o.bands = Number(argv[++i]) || 48;
    else if (a.startsWith("--")) throw new Error(`未知参数 ${a}`);
    else rest.push(a);
  }
  o.audio = rest[0];
  return o;
}

function pickFfmpeg(explicit) {
  if (explicit) return explicit;
  const cands = [
    "ffmpeg",
    "D:/ffmpeg/bin/ffmpeg.exe",
    "C:/Users/BA291/WorkBuddy/ai/tools/ffmpeg/bin/ffmpeg.exe",
  ];
  for (const c of cands) {
    if (c === "ffmpeg") continue;
    if (fs.existsSync(c)) return c;
  }
  return "ffmpeg";
}

/* ------------------------------------------------------------ 解码音频 */

const SR = 22050;
const WIN = 1024;
const HOP = 256;

function decode(ffmpeg, audioPath) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      ffmpeg,
      ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", String(SR),
        "-f", "s16le", "-acodec", "pcm_s16le", "-"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(new Error(`无法启动 ffmpeg: ${e.message}`)));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg 解码失败:\n${err}`));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
      resolve(out);
    });
  });
}

/* ---------------------------------------------------------------- FFT */

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
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        const ur = re[a];
        const ui = im[a];
        re[a] = ur + vr;
        im[a] = ui + vi;
        re[b] = ur - vr;
        im[b] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/* --------------------------------------------------------- 频段定义 */

function logBands(count) {
  const lo = 40;
  const hi = 11000;
  const bins = WIN / 2;
  const hzPerBin = SR / WIN;
  const out = [];
  for (let i = 0; i < count; i++) {
    const f0 = lo * Math.pow(hi / lo, i / count);
    const f1 = lo * Math.pow(hi / lo, (i + 1) / count);
    const b0 = Math.max(1, Math.floor(f0 / hzPerBin));
    const b1 = Math.max(b0 + 1, Math.ceil(f1 / hzPerBin));
    out.push([b0, Math.min(b1, bins)]);
  }
  return out;
}

function pct(arr, q) {
  const s = Float64Array.from(arr).sort();
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))));
  return s[i] || 0;
}

/* ------------------------------------------------------------- 主流程 */

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.audio) {
    console.error("用法: node scripts/analyze-beats.mjs <音频文件> [--title 标题] [--lyrics x.lrc]");
    process.exit(1);
  }
  if (!fs.existsSync(o.audio)) {
    console.error(`[错误] 音频不存在: ${o.audio}`);
    process.exit(1);
  }

  const ffmpeg = pickFfmpeg(o.ffmpeg);
  console.log(`▶ 解码: ${path.basename(o.audio)}`);
  const samples = await decode(ffmpeg, o.audio);
  const duration = samples.length / SR;
  console.log(`  时长 ${duration.toFixed(2)}s  采样 ${samples.length}`);

  const analysisFps = SR / HOP;
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  console.log(`▶ 频谱分析 (${analysisFps.toFixed(1)} 帧/秒, 共 ${frames} 帧)`);

  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

  const bands = logBands(o.bands);
  const nBands = bands.length;
  const bandCurves = Array.from({ length: nBands }, () => new Float32Array(frames));
  const lowArr = new Float32Array(frames);
  const midArr = new Float32Array(frames);
  const highArr = new Float32Array(frames);
  const rmsArr = new Float32Array(frames);

  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  const mag = new Float64Array(WIN / 2);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let sum = 0;
    for (let i = 0; i < WIN; i++) {
      const v = samples[off + i] || 0;
      sum += v * v;
      re[i] = v * hann[i];
      im[i] = 0;
    }
    rmsArr[f] = Math.sqrt(sum / WIN);
    fft(re, im);

    for (let k = 0; k < WIN / 2; k++) mag[k] = Math.hypot(re[k], im[k]);

    let lo = 0, md = 0, hi = 0;
    for (let b = 0; b < nBands; b++) {
      const [b0, b1] = bands[b];
      let s = 0;
      for (let k = b0; k < b1; k++) s += mag[k];
      s /= b1 - b0;
      bandCurves[b][f] = s;

      const center = 40 * Math.pow(11000 / 40, (b + 0.5) / nBands);
      if (center < 220) lo += s;
      else if (center < 2200) md += s;
      else hi += s;
    }
    lowArr[f] = lo;
    midArr[f] = md;
    highArr[f] = hi;
  }

  /* ---- 谱通量起音检测 ---- */
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    let s = 0;
    for (let b = 0; b < nBands; b++) {
      const d = Math.log1p(bandCurves[b][f]) - Math.log1p(bandCurves[b][f - 1]);
      if (d > 0) s += d;
    }
    flux[f] = s;
  }
  const fluxRef = pct(flux, 0.98) || 1;

  const peakTimes = [];
  const peakStrength = [];
  const winF = Math.round(0.35 * analysisFps);
  let runSum = 0;
  let runSq = 0;
  const winLen = winF * 2 + 1;
  for (let i = 0; i < Math.min(winLen, frames); i++) {
    runSum += flux[i] || 0;
    runSq += (flux[i] || 0) ** 2;
  }
  for (let f = 1; f < frames - 1; f++) {
    const a = Math.max(0, f - winF);
    const b = Math.min(frames - 1, f + winF);
    if (f - winF - 1 >= 0) {
      runSum -= flux[f - winF - 1] || 0;
      runSq -= (flux[f - winF - 1] || 0) ** 2;
    }
    if (b + winF <= frames - 1 && f > winF) {
      runSum += flux[f + winF] || 0;
      runSq += (flux[f + winF] || 0) ** 2;
    }
    const n = Math.max(1, b - a + 1);
    const mean = runSum / n;
    const varc = Math.max(0, runSq / n - mean * mean);
    const thr = mean + 1.15 * Math.sqrt(varc) + 0.004;
    const v = flux[f];
    if (v > thr && v >= flux[f - 1] && v > flux[f + 1] && v > fluxRef * 0.04) {
      // 抛物线插值：在帧间找亚帧精度的真实峰值
      const y0 = flux[f - 1];
      const y1 = v;
      const y2 = flux[f + 1];
      const den = y0 - 2 * y1 + y2;
      const shift = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
      // 窗中心校正：能量峰值出现在窗中心而非窗起点
      const t = (f + shift) * HOP / SR + WIN / 2 / SR;
      peakTimes.push(t);
      peakStrength.push(v / fluxRef);
    }
  }

  /* ---- 最小间隔去重（保留更强者）---- */
  const minGap = 0.105;
  const keptT = [];
  const keptS = [];
  for (let i = 0; i < peakTimes.length; i++) {
    const t = peakTimes[i];
    const s = peakStrength[i];
    if (keptT.length && t - keptT[keptT.length - 1] < minGap) {
      if (s > keptS[keptS.length - 1]) {
        keptT[keptT.length - 1] = t;
        keptS[keptS.length - 1] = s;
      }
    } else {
      keptT.push(t);
      keptS.push(s);
    }
  }

  /* ---- BPM 估计 ---- */
  const iois = [];
  for (let i = 1; i < keptT.length; i++) iois.push(keptT[i] - keptT[i - 1]);
  const hist = new Map();
  let bestBpm = 0;
  let bestScore = 0;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const period = 60 / bpm;
    let score = 0;
    for (const io of iois) {
      const r = io / period;
      for (const [mult, w] of [[1, 1], [0.5, 0.9], [2, 0.55], [3, 0.35], [4, 0.22]]) {
        const d = Math.abs(r - mult);
        if (d < 0.09) score += w * (1 - d / 0.09);
      }
    }
    hist.set(bpm, score);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }
  const bpm = Math.round(bestBpm * 10) / 10;

  /* ---- 归一化逐帧特征 ---- */
  const norm = (arr, gamma = 1) => {
    const ref = pct(arr, 0.97) || 1;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = Math.min(1, Math.pow(arr[i] / ref, gamma));
    return out;
  };
  const rmsN = norm(rmsArr, 0.7);
  const lowN = norm(lowArr, 0.7);
  const midN = norm(midArr, 0.7);
  const highN = norm(highArr, 0.7);
  const bandN = bandCurves.map((c) => norm(c, 0.62));

  /* ---- 映射到视频帧 ---- */
  const vfTotal = Math.max(1, Math.round(duration * o.fps));
  const frameAt = (arr, f) => {
    const t0 = f / o.fps;
    const t1 = (f + 1) / o.fps;
    const a0 = Math.floor(t0 * analysisFps);
    const a1 = Math.max(a0 + 1, Math.ceil(t1 * analysisFps));
    let s = 0;
    let n = 0;
    for (let i = a0; i < a1 && i < arr.length; i++) {
      s += arr[i];
      n++;
    }
    return n ? s / n : 0;
  };

  const energy = new Array(vfTotal);
  const low = new Array(vfTotal);
  const mid = new Array(vfTotal);
  const high = new Array(vfTotal);
  const spectrum = new Array(vfTotal);
  for (let f = 0; f < vfTotal; f++) {
    energy[f] = +frameAt(rmsN, f).toFixed(4);
    low[f] = +frameAt(lowN, f).toFixed(4);
    mid[f] = +frameAt(midN, f).toFixed(4);
    high[f] = +frameAt(highN, f).toFixed(4);
    const row = new Array(nBands);
    for (let b = 0; b < nBands; b++) row[b] = +frameAt(bandN[b], f).toFixed(3);
    spectrum[f] = row;
  }

  /* ---- 拍点整理 + 强拍 ---- */
  const beats = keptT.map((t, i) => ({
    t: +t.toFixed(3),
    s: +Math.min(1, Math.pow(keptS[i], 0.75)).toFixed(3),
  }));

  const downbeats = [];
  const per = 4;
  for (let i = 0; i < beats.length; i += per) {
    let bi = i;
    for (let k = i; k < Math.min(i + per, beats.length); k++) {
      if (beats[k].s > beats[bi].s) bi = k;
    }
    downbeats.push(beats[bi].t);
  }

  /* ---- 歌词解析 ---- */
  let lyrics = [];
  if (o.lyrics && fs.existsSync(o.lyrics)) {
    lyrics = parseLyrics(fs.readFileSync(o.lyrics, "utf8"), o.lyrics);
    console.log(`  歌词 ${lyrics.length} 句`);
    for (const l of lyrics) l.end = Math.min(duration, l.end);
  }

  /* ---- 落盘 ---- */
  const ext = path.extname(o.audio) || ".mp3";
  const pubDir = path.join(ROOT, "public");
  const dataDir = path.join(ROOT, "src", "data");
  fs.mkdirSync(pubDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const audioName = "audio" + ext;
  fs.copyFileSync(o.audio, path.join(pubDir, audioName));

  const analysis = {
    audio: audioName,
    title: o.title || path.basename(o.audio, ext),
    duration: +duration.toFixed(3),
    fps: o.fps,
    totalFrames: vfTotal,
    bpm,
    beats,
    downbeats,
    lyrics,
    energy,
    low,
    mid,
    high,
  };
  fs.writeFileSync(path.join(dataDir, "analysis.json"), JSON.stringify(analysis));
  fs.writeFileSync(path.join(dataDir, "spectrum.json"), JSON.stringify(spectrum));

  const sizeA = (fs.statSync(path.join(dataDir, "analysis.json")).size / 1024).toFixed(0);
  const sizeS = (fs.statSync(path.join(dataDir, "spectrum.json")).size / 1024).toFixed(0);
  console.log(`\n✔ 完成`);
  console.log(`  BPM ${bpm}   拍点 ${beats.length} 个   强拍 ${downbeats.length} 个`);
  console.log(`  视频帧 ${vfTotal} @ ${o.fps}fps`);
  console.log(`  src/data/analysis.json  ${sizeA} KB`);
  console.log(`  src/data/spectrum.json  ${sizeS} KB`);
  console.log(`  public/${audioName}`);
}

/* ------------------------------------------------------------ 歌词 */

function parseLyrics(text, file) {
  const isLrc = /\.lrc$/i.test(file) || /^\[\d{1,2}:\d{2}/m.test(text);
  const out = [];
  if (isLrc) {
    const re = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    for (const raw of text.split(/\r?\n/)) {
      const stamps = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(raw))) {
        const mm = Number(m[1]);
        const ss = Number(m[2]);
        const frac = m[3] ? Number("0." + m[3]) : 0;
        stamps.push(mm * 60 + ss + frac);
      }
      const body = raw.replace(re, "").trim();
      if (!body || !stamps.length) continue;
      for (const t of stamps) out.push({ start: +t.toFixed(3), end: 0, text: body });
    }
    out.sort((a, b) => a.start - b.start);
  } else {
    const blocks = text.split(/\r?\n\r?\n/);
    const t = (s) => {
      const m = s.match(/(\d{2}):(\d{2})[:.,](\d{2,3})/);
      if (!m) return null;
      return Number(m[1]) * 60 + Number(m[2]) + Number("0." + m[3]);
    };
    for (const b of blocks) {
      const lines = b.split(/\r?\n/).filter((l) => l.trim());
      const times = [];
      const body = [];
      for (const l of lines) {
        const v = t(l);
        if (v !== null && !/-->/.test(l)) times.push(v);
        else if (!/^\d+$/.test(l.trim()) && !/-->/.test(l)) body.push(l.trim());
      }
      if (times.length >= 2) out.push({ start: times[0], end: times[1], text: body.join(" ") });
    }
  }
  // 补 end：下一句开头（留 0.35s 间隔）
  for (let i = 0; i < out.length; i++) {
    if (!out[i].end) {
      const next = out[i + 1];
      out[i].end = next ? Math.max(out[i].start + 0.4, next.start - 0.35) : out[i].start + 3.2;
    }
  }
  return out.filter((l) => l.text);
}

main().catch((e) => {
  console.error(`\n[错误] ${e.message}`);
  process.exit(1);
});