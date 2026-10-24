/**
 * analyze-song.mjs — 歌曲结构分析器
 *
 * 输出：
 *   src/data/song.json
 *     - bpm             估计 BPM
 *     - beats[]         全部起音点 {t,s}
 *     - kicks[]         重低音鼓点（30~110Hz）精确时间戳 {t,s}
 *     - downbeats[]     每小节强拍时间
 *     - drop            情绪爆发点（秒），先抑后扬的分界
 *     - climaxes[]      候选爆发点及评分（便于人工复核）
 *     - energy/bass/mid/high   逐帧包络
 *     - spectrum[][]    逐帧频段
 *
 * 用法:
 *   node scripts/analyze-song.mjs <音频文件> [--fps 30] [--ffmpeg 路径]
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------ 参数 */

function parseArgs(argv) {
  const o = { fps: 30, ffmpeg: "", bands: 48 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fps") o.fps = Number(argv[++i]) || 30;
    else if (a === "--ffmpeg") o.ffmpeg = argv[++i] ?? "";
    else if (a === "--bands") o.bands = Number(argv[++i]) || 48;
    else if (a.startsWith("--")) throw new Error(`未知参数 ${a}`);
    else rest.push(a);
  }
  o.audio = rest[0];
  return o;
}

function pickFfmpeg(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const cands = ["D:/ffmpeg/bin/ffmpeg.exe", "D:/ffmpeg/bin/ffmpeg"];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return "ffmpeg";
}

/* -------------------------------------------------------------- 解码音频 */

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

/* ------------------------------------------------------------------ FFT */

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
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/* -------------------------------------------------------------- 工具函数 */

const pct = (arr, q) => {
  const s = Float64Array.from(arr).sort();
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] || 0;
};

const median = (arr) => pct(arr, 0.5);

/** 滑动平均（半径 r 帧） */
function smooth(arr, r) {
  const n = arr.length;
  const out = new Float32Array(n);
  let run = 0;
  const w = r * 2 + 1;
  for (let i = 0; i < Math.min(w, n); i++) run += arr[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - r);
    const b = Math.min(n - 1, i + r);
    if (i - r - 1 >= 0) run -= arr[i - r - 1];
    if (i + r < n) run += arr[i + r];
    out[i] = run / (b - a + 1);
  }
  return out;
}

function logBands(count, lo, hi) {
  const bins = WIN / 2;
  const hzPerBin = SR / WIN;
  const out = [];
  for (let i = 0; i < count; i++) {
    const f0 = lo * Math.pow(hi / lo, i / count);
    const f1 = lo * Math.pow(hi / lo, (i + 1) / count);
    let b0 = Math.max(1, Math.floor(f0 / hzPerBin));
    let b1 = Math.max(b0 + 1, Math.ceil(f1 / hzPerBin));
    out.push([b0, Math.min(b1, bins)]);
  }
  return out;
}

/**
 * 通用起音检测：给定逐帧曲线，用自适应阈值挑峰。
 * @returns {Array<{t:number,s:number}>}
 */
function pickOnsets(curve, analysisFps, opts = {}) {
  const { winSec = 0.35, k = 1.15, minGap = 0.105, floor = 0.004, refQ = 0.98 } = opts;
  const n = curve.length;
  const winF = Math.max(1, Math.round(winSec * analysisFps));
  const ref = pct(curve, refQ) || 1;
  const peaks = [];

  let runSum = 0;
  let runSq = 0;
  const initLen = Math.min(winF * 2 + 1, n);
  for (let i = 0; i < initLen; i++) {
    runSum += curve[i];
    runSq += curve[i] * curve[i];
  }

  for (let f = 1; f < n - 1; f++) {
    const a = Math.max(0, f - winF);
    const b = Math.min(n - 1, f + winF);
    if (f - winF - 1 >= 0) {
      runSum -= curve[f - winF - 1];
      runSq -= curve[f - winF - 1] ** 2;
    }
    if (f + winF < n) {
      runSum += curve[f + winF];
      runSq += curve[f + winF] ** 2;
    }
    const cnt = Math.max(1, b - a + 1);
    const mean = runSum / cnt;
    const varc = Math.max(0, runSq / cnt - mean * mean);
    const thr = mean + k * Math.sqrt(varc) + floor;
    const v = curve[f];
    if (v > thr && v >= curve[f - 1] && v > curve[f + 1] && v > ref * 0.04) {
      // 抛物线插值求亚帧峰值位置
      const y0 = curve[f - 1];
      const y1 = v;
      const y2 = curve[f + 1];
      const den = y0 - 2 * y1 + y2;
      const shift = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / den)) : 0;
      // 窗中心补偿：能量峰在窗中心而非窗起点
      const t = ((f + shift) * HOP) / SR + WIN / 2 / SR;
      peaks.push({ t, s: v / ref });
    }
  }

  // 最小间隔去重，保留更强者
  const out = [];
  for (const p of peaks) {
    const last = out[out.length - 1];
    if (last && p.t - last.t < minGap) {
      if (p.s > last.s) { last.t = p.t; last.s = p.s; }
    } else {
      out.push({ ...p });
    }
  }
  return out;
}

/* -------------------------------------------------------------- 主流程 */

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.audio || !fs.existsSync(o.audio)) {
    console.error("用法: node scripts/analyze-song.mjs <音频> [--fps 30]");
    process.exit(1);
  }

  const ffmpeg = pickFfmpeg(o.ffmpeg);
  console.log(`▶ 解码 ${path.basename(o.audio)}`);
  const samples = await decode(ffmpeg, o.audio);
  const duration = samples.length / SR;
  const analysisFps = SR / HOP;
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1);
  console.log(`  时长 ${duration.toFixed(2)}s   分析 ${frames} 帧 @${analysisFps.toFixed(1)}/s`);

  /* ---------------- STFT ---------------- */
  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));

  const bands = logBands(o.bands, 40, 11000);
  const nBands = bands.length;
  const bandCurves = Array.from({ length: nBands }, () => new Float32Array(frames));
  const bassArr = new Float32Array(frames);   // 30~110Hz 重低音
  const subArr = new Float32Array(frames);    // 20~60Hz 超低
  const midArr = new Float32Array(frames);
  const highArr = new Float32Array(frames);
  const rmsArr = new Float32Array(frames);

  const hzPerBin = SR / WIN;
  const binOf = (hz) => Math.max(1, Math.min(WIN / 2 - 1, Math.round(hz / hzPerBin)));
  const KICK_LO = binOf(30);
  const KICK_HI = binOf(110);
  const SUB_LO = binOf(20);
  const SUB_HI = binOf(60);

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

    let kb = 0, sb = 0, md = 0, hi = 0;
    for (let k = KICK_LO; k < KICK_HI; k++) kb += mag[k];
    for (let k = SUB_LO; k < SUB_HI; k++) sb += mag[k];
    bassArr[f] = kb / (KICK_HI - KICK_LO);
    subArr[f] = sb / Math.max(1, SUB_HI - SUB_LO);

    for (let b = 0; b < nBands; b++) {
      const [b0, b1] = bands[b];
      let s = 0;
      for (let k = b0; k < b1; k++) s += mag[k];
      s /= b1 - b0;
      bandCurves[b][f] = s;
      const center = 40 * Math.pow(11000 / 40, (b + 0.5) / nBands);
      if (center >= 220 && center < 2200) md += s;
      if (center >= 2200) hi += s;
    }
    midArr[f] = md;
    highArr[f] = hi;
  }

  /* ---------------- 全频起音（谱通量）---------------- */
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    let s = 0;
    for (let b = 0; b < nBands; b++) {
      const d = Math.log1p(bandCurves[b][f]) - Math.log1p(bandCurves[b][f - 1]);
      if (d > 0) s += d;
    }
    flux[f] = s;
  }
  const allOnsets = pickOnsets(flux, analysisFps, { winSec: 0.35, k: 1.15, minGap: 0.105 });

  /* ---------------- 重低音鼓点（30~110Hz 专用）---------------- */
  const kickFlux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = Math.log1p(bassArr[f]) - Math.log1p(bassArr[f - 1]);
    kickFlux[f] = d > 0 ? d : 0;
  }
  const kickOnsets = pickOnsets(kickFlux, analysisFps, {
    winSec: 0.4, k: 0.85, minGap: 0.13, floor: 0.003, refQ: 0.97,
  });

  /* ---------------- BPM 估计（自相关法）----------------
   * IOI 直方图法容易把八分音符当四分音符、算成两倍 BPM。
   * 改用低频包络自相关：取全曲最强周期，并检查其整数倍是否同样成立，
   * 借此排除倍频/半频误判。
   */
  const autoBpm = (() => {
    // 用整曲低频包络（重低音最能代表节拍骨架）
    const x = new Float64Array(bassArr.length);
    const m = bassArr.reduce((s, v) => s + v, 0) / Math.max(1, bassArr.length);
    for (let i = 0; i < bassArr.length; i++) x[i] = bassArr[i] - m;

    const maxLag = Math.min(Math.floor(2.2 * analysisFps), Math.floor(x.length / 2));
    const minLag = Math.floor(0.28 * analysisFps); // 上限约 214 BPM
    const ac = new Float64Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      const n = x.length - lag;
      for (let i = 0; i < n; i++) s += x[i] * x[i + lag];
      ac[lag] = s / Math.max(1, n);
    }
    let mx = 0;
    for (let lag = minLag; lag <= maxLag; lag++) mx = Math.max(mx, ac[lag]);
    if (mx <= 0) return 0;
    for (let lag = minLag; lag <= maxLag; lag++) ac[lag] /= mx;

    // 局部极大
    const cands = [];
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0.35) {
        cands.push({ lag, v: ac[lag] });
      }
    }
    if (!cands.length) return 0;
    cands.sort((a, b) => b.v - a.v);

    // 优先选"能被更大周期整除"的那个（真拍而非细分）
    const best = cands[0];
    let period = best.lag;
    // 若存在 2 倍周期且相关度仍很高，说明当前是半拍，取 2 倍
    const dbl = cands.find((c) => Math.abs(c.lag - best.lag * 2) <= 1 && c.v > best.v * 0.75);
    if (dbl) period = dbl.lag;
    // 反之若 1/2 周期相关度接近，说明当前是倍频，取一半
    const half = cands.find((c) => Math.abs(c.lag - best.lag / 2) <= 1 && c.v > best.v * 0.9);
    if (half && !dbl) period = half.lag;

    const sec = period / analysisFps;
    return sec > 0 ? 60 / sec : 0;
  })();

  // 与 IOI 法交叉验证：取两者中更接近常见舞曲区间的
  const iois = [];
  for (let i = 1; i < allOnsets.length; i++) iois.push(allOnsets[i].t - allOnsets[i - 1].t);
  let ioiBpm = 0;
  let bestScore = 0;
  for (let bpm = 60; bpm <= 210; bpm += 0.5) {
    const period = 60 / bpm;
    let score = 0;
    for (const io of iois) {
      const r = io / period;
      for (const [mult, w] of [[1, 1], [0.5, 0.9], [2, 0.55], [3, 0.35], [4, 0.22]]) {
        const d = Math.abs(r - mult);
        if (d < 0.09) score += w * (1 - d / 0.09);
      }
    }
    if (score > bestScore) { bestScore = score; ioiBpm = bpm; }
  }

  let bpm = autoBpm || ioiBpm;
  // 折叠到 70~180 的常用区间，避免 200+ 的倍频
  while (bpm > 180) bpm /= 2;
  while (bpm > 0 && bpm < 70) bpm *= 2;
  bpm = Math.round(bpm * 10) / 10;

  /* ---------------- 归一化（提前，供后续检测使用）---------------- */
  const norm = (arr, gamma = 1, q = 0.97) => {
    const ref = pct(arr, q) || 1;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = Math.min(1, Math.pow(arr[i] / ref, gamma));
    return out;
  };
  const rmsN = norm(rmsArr, 0.7);
  const bassN = norm(bassArr, 0.7);
  const midN = norm(midArr, 0.7);
  const highN = norm(highArr, 0.7);
  const bandN = bandCurves.map((c) => norm(c, 0.62));
  const rmsS = smooth(rmsArr, Math.round(0.6 * analysisFps));

  /* ---------------- 情绪爆发点检测 ----------------
   * 判据：先有一段"低频静默"（breakdown），紧接着低频持续恢复。
   * 做法：找所有静默段 → 检查每段结束后 2s 的低频活动率 →
   *       活动率高且静默够长的那个结束点就是 drop。
   * 这样能精确定位到"砸下来"的那一下，不受滑动平均滞后影响。
   */
  const bassThr = Math.max(0.32, pct(bassN, 0.55) * 0.85);
  const bassOn = new Float32Array(frames);
  for (let f = 0; f < frames; f++) bassOn[f] = bassN[f] > bassThr ? 1 : 0;

  const actWin = Math.round(2.0 * analysisFps);
  const rateAt = (f0, f1) => {
    let c = 0, n = 0;
    for (let i = Math.max(0, f0); i < Math.min(frames, f1); i++) { c += bassOn[i]; n++; }
    return n ? c / n : 0;
  };

  const total = duration;
  const minSilenceSec = 0.7;
  const minSilence = Math.round(minSilenceSec * analysisFps);

  // 找连续静默段
  const silences = [];
  {
    let start = -1;
    for (let f = 0; f <= frames; f++) {
      const quiet = f < frames && bassOn[f] === 0;
      if (quiet && start < 0) start = f;
      else if (!quiet && start >= 0) {
        if (f - start >= minSilence) silences.push({ start, end: f, len: f - start });
        start = -1;
      }
    }
  }

  const climaxes = [];
  for (const s of silences) {
    const tEnd = s.end / analysisFps;
    if (tEnd < Math.max(4, total * 0.15) || tEnd > total * 0.9) continue;

    const afterRate = rateAt(s.end, s.end + actWin);
    const beforeRate = rateAt(Math.max(0, s.start - actWin), s.start);
    if (afterRate < 0.55) continue;

    const silenceSec = s.len / analysisFps;
    const jump = afterRate - beforeRate;
    // 静默越长、之后越密，越像真正的 breakdown→drop
    const score = afterRate * 0.5 + jump * 0.3 + Math.min(1, silenceSec / 2.5) * 0.2;

    climaxes.push({
      t: +tEnd.toFixed(2),
      score: +score.toFixed(3),
      jump: +jump.toFixed(3),
      before: +beforeRate.toFixed(3),
      after: +afterRate.toFixed(3),
      silence: +silenceSec.toFixed(2),
    });
  }
  climaxes.sort((a, b) => b.score - a.score);
  const topClimaxes = climaxes.slice(0, 12);

  /* ---------------- 回退：能量阶跃上升检测 ----------------
   * 静默法依赖"breakdown 段存在"。如果音频已经把 breakdown 剪掉了
   * （先抑后扬的典型做法：剪掉过渡段让 drop 直接砸下），静默段就
   * 不再存在，climaxes 会是空的，drop 只能退到 total*0.4 —— 完全错位。
   * 此时改用低频 + 整体能量的"阶跃上升"定位：取 t 之后 2s 相对
   * t 之前 1.2s 的增量最大的那个点，再吸附到重低音鼓点。
   */
  if (!climaxes.length) {
    const meanAt = (arr, t0, t1) => {
      const i0 = Math.max(0, Math.round(t0 * analysisFps));
      const i1 = Math.min(arr.length, Math.round(t1 * analysisFps));
      let s = 0;
      for (let i = i0; i < i1; i++) s += arr[i];
      return i1 > i0 ? s / (i1 - i0) : 0;
    };
    const loT = Math.max(4, total * 0.15);
    const hiT = total * 0.9;
    let bestT = loT;
    let bestV = -Infinity;
    for (let t = loT; t < hiT; t += 0.05) {
      const dBass = meanAt(bassN, t, t + 2) - meanAt(bassN, t - 1.2, t);
      const dEnergy = meanAt(rmsN, t, t + 2) - meanAt(rmsN, t - 1.2, t);
      const v = dBass + dEnergy * 0.6;
      if (v > bestV) { bestV = v; bestT = t; }
    }
    const bAfter = meanAt(bassN, bestT, bestT + 2);
    const bBefore = meanAt(bassN, bestT - 1.2, bestT);
    const eAfter = meanAt(rmsN, bestT, bestT + 2);
    const eBefore = meanAt(rmsN, bestT - 1.2, bestT);
    console.log(
      `  · 未检到低频静默段（breakdown 可能已被剪掉），回退能量跃升检测：` +
      `${bestT.toFixed(2)}s  低频 ${bBefore.toFixed(2)}→${bAfter.toFixed(2)}  ` +
      `能量 ${eBefore.toFixed(2)}→${eAfter.toFixed(2)}`,
    );
    topClimaxes.push({
      t: +bestT.toFixed(2),
      score: +Math.min(1, Math.max(0, bestV)).toFixed(3),
      jump: +(bAfter - bBefore).toFixed(3),
      before: +bBefore.toFixed(3),
      after: +bAfter.toFixed(3),
      silence: 0,
    });
  }

  let drop = topClimaxes.length ? topClimaxes[0].t : total * 0.4;

  // 微调：静默结束点往往比真实鼓击早一点点，吸附到最近的重低音鼓点
  {
    let snapped = drop;
    let bestD = 0.6;
    for (const k of kickOnsets) {
      const d = Math.abs(k.t - drop);
      if (d < bestD) { bestD = d; snapped = k.t; }
    }
    drop = snapped;
  }

  /* ---------------- 逐帧特征 ---------------- */
  const vfTotal = Math.max(1, Math.round(total * o.fps));
  const frameAt = (arr, f) => {
    const t0 = f / o.fps;
    const t1 = (f + 1) / o.fps;
    const i0 = Math.floor(t0 * analysisFps);
    const i1 = Math.max(i0 + 1, Math.ceil(t1 * analysisFps));
    let s = 0, n = 0;
    for (let i = i0; i < i1 && i < arr.length; i++) { s += arr[i]; n++; }
    return n ? s / n : 0;
  };

  const energy = [], bass = [], mid = [], high = [], spectrum = [];
  for (let f = 0; f < vfTotal; f++) {
    energy.push(+frameAt(rmsN, f).toFixed(4));
    bass.push(+frameAt(bassN, f).toFixed(4));
    mid.push(+frameAt(midN, f).toFixed(4));
    high.push(+frameAt(highN, f).toFixed(4));
    const row = new Array(nBands);
    for (let b = 0; b < nBands; b++) row[b] = +frameAt(bandN[b], f).toFixed(3);
    spectrum.push(row);
  }

  /* ---------------- 拍点整理 ---------------- */
  const beats = allOnsets.map((p) => ({
    t: +p.t.toFixed(3),
    s: +Math.min(1, Math.pow(p.s, 0.75)).toFixed(3),
  }));
  const kicks = kickOnsets.map((p) => ({
    t: +p.t.toFixed(3),
    s: +Math.min(1, Math.pow(p.s, 0.7)).toFixed(3),
  }));

  // 强拍：每 4 个起音取最强
  const downbeats = [];
  for (let i = 0; i < beats.length; i += 4) {
    let bi = i;
    for (let k = i; k < Math.min(i + 4, beats.length); k++) if (beats[k].s > beats[bi].s) bi = k;
    downbeats.push(beats[bi].t);
  }

  /* ---------------- 落盘 ---------------- */
  const dataDir = path.join(ROOT, "src", "data");
  fs.mkdirSync(dataDir, { recursive: true });

  const analysis = {
    audio: path.basename(o.audio),
    duration: +total.toFixed(3),
    fps: o.fps,
    totalFrames: vfTotal,
    bpm,
    drop: +drop.toFixed(3),
    drops: topClimaxes,
    beats,
    kicks,
    downbeats,
    energy,
    bass,
    mid,
    high,
  };

  fs.writeFileSync(path.join(dataDir, "song.json"), JSON.stringify(analysis));
  fs.writeFileSync(path.join(dataDir, "song-spectrum.json"), JSON.stringify(spectrum));

  /* ---------------- 报告 ---------------- */
  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0);
  console.log("");
  console.log("════════ 分析结果 ════════");
  console.log(`  BPM            ${bpm}`);
  console.log(`  时长           ${total.toFixed(2)}s  (${vfTotal} 帧 @${o.fps}fps)`);
  console.log(`  起音点         ${beats.length} 个`);
  console.log(`  重低音鼓点     ${kicks.length} 个`);
  console.log(`  爆发点         ${drop.toFixed(3)}s  (第 ${(drop * o.fps).toFixed(0)} 帧)`);
  console.log("");
  console.log("  Top 候选爆发点（score / 低频活动率 前→后 / 静默时长）:");
  for (const c of topClimaxes.slice(0, 6)) {
    console.log(
      `    ${String(c.t).padStart(6)}s  score ${String(c.score).padStart(6)}  ` +
      `${(c.before * 100).toFixed(0)}% → ${(c.after * 100).toFixed(0)}%   静默 ${c.silence}s`,
    );
  }
  console.log("");
  console.log(`  ✔ src/data/song.json          ${kb(path.join(dataDir, "song.json"))} KB`);
  console.log(`  ✔ src/data/song-spectrum.json ${kb(path.join(dataDir, "song-spectrum.json"))} KB`);
}

main().catch((e) => {
  console.error("\n[分析失败] " + e.message);
  process.exit(1);
});