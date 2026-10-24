/**
 * 排版全量验算 —— 渲染前先把 29 句在 4 种画幅下算一遍。
 *
 * 检查项：
 *   - 行数是否超过该画幅上限
 *   - 最宽行是否溢出安全区（这是硬指标，溢出即失败）
 *   - 字号是否落在阶梯上（保证全片字号节奏统一）
 *   - 是否有孤字尾行（"Why do we live / like" 这种，业余感来源）
 *
 * 用法: node scripts/check-layout.mjs [-v]
 */
import fs from "node:fs";

/* ---------- 从生成的表里读取字宽，保证与渲染完全一致 ---------- */
const src = fs.readFileSync("src/song/lib/glyphs.ts", "utf8");
const GLYPH_W = {};
for (const m of src.matchAll(/^\s+"?(.+?)"?:\s*([\d.]+),$/gm)) {
  GLYPH_W[m[1].replace(/\\\\/g, "\\")] = Number(m[2]);
}
const FALLBACK_W = Number(src.match(/FALLBACK_W = ([\d.]+)/)[1]);
const CJK_W = 1;

/* 字重系数：爆发期用 weight 600，浏览器合成粗体会让拉丁字变宽约 6.2%。
   排版一律按这个更宽的字重规划，两种字重共用同一套字号阶梯。 */
const WEIGHT_SCALE = {
  semiboldLatin: Number(src.match(/semiboldLatin:\s*([\d.]+)/)[1]),
  semiboldCJK: Number(src.match(/semiboldCJK:\s*([\d.]+)/)[1]),
};

const isCJKChar = (ch) => {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x3000 && cp <= 0x30ff) ||
    (cp >= 0x3400 && cp <= 0x9fff) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
};
const glyphWidth = (ch) => (isCJKChar(ch) ? CJK_W : (GLYPH_W[ch] ?? FALLBACK_W));
/** 按 weight 600 计宽（与 LyricStage 的 units() 保持一致） */
const boldWidth = (ch) =>
  glyphWidth(ch) * (isCJKChar(ch) ? WEIGHT_SCALE.semiboldCJK : WEIGHT_SCALE.semiboldLatin);
const textWidth = (s) => {
  let w = 0;
  for (const ch of s) w += boldWidth(ch);
  return w;
};

/* 间距从 theme.ts 的唯一来源读，不再本地写死 */
const themeSrc = fs.readFileSync("src/song/lib/theme.ts", "utf8");
const gapBlock = themeSrc.slice(themeSrc.indexOf("export const LYRIC_GAP"));
const GAP_LATIN = Number(gapBlock.match(/word:\s*([\d.]+)/)[1]);
const GAP_CJK = Number(gapBlock.match(/cjk:\s*([\d.]+)/)[1]);

function units(en, words) {
  const mk = (text) => ({ text, width: textWidth(text), gap: isCJKChar(text) ? GAP_CJK : GAP_LATIN });
  if (words && words.length) {
    const out = [];
    for (const x of words) {
      const chars = Array.from(x.w);
      if (chars.length > 1 && /[\u3040-\u30ff\u3400-\u9fff]/.test(x.w)) {
        for (const ch of chars)
          out.push({ text: ch, width: glyphWidth(ch) * WEIGHT_SCALE.semiboldCJK, gap: GAP_CJK });
      } else out.push(mk(x.w));
    }
    return out;
  }
  const out = [];
  let buf = "";
  for (const ch of en) {
    if (ch === " ") {
      if (buf) { out.push(mk(buf)); buf = ""; }
      out.push({ text: " ", width: GAP_LATIN, gap: 0 });
    } else if (isCJKChar(ch)) {
      if (buf) { out.push(mk(buf)); buf = ""; }
      out.push({ text: ch, width: glyphWidth(ch) * WEIGHT_SCALE.semiboldCJK, gap: GAP_CJK });
    } else buf += ch;
  }
  if (buf) out.push(mk(buf));
  return out;
}

function balancedWrap(u, maxEm, rows) {
  const idx = [];
  for (let i = 0; i < u.length; i++) {
    if (u[i].text === " ") {
      if (idx.length === 0) continue;
      if (u[idx[idx.length - 1]].text === " ") continue;
    }
    idx.push(i);
  }
  while (idx.length && u[idx[idx.length - 1]].text === " ") idx.pop();
  if (idx.length === 0) return [];
  const n = idx.length;
  const S = [0];
  for (let i = 0; i < n; i++) S.push(S[i] + u[idx[i]].width + u[idx[i]].gap);
  const rowW = (q, p) => S[p] - S[q] - u[idx[p - 1]].gap;
  const target = rowW(0, n) / rows;
  const INF = Infinity;
  const dp = Array.from({ length: rows + 1 }, () => new Array(n + 1).fill(INF));
  const cut = Array.from({ length: rows + 1 }, () => new Array(n + 1).fill(-1));
  dp[0][0] = 0;
  for (let j = 1; j <= rows; j++)
    for (let p = j; p <= n; p++)
      for (let q = j - 1; q < p; q++) {
        if (dp[j - 1][q] === INF) continue;
        const w = rowW(q, p);
        if (w > maxEm) continue;
        const d = w - target;
        const cost = dp[j - 1][q] + d * d;
        if (cost < dp[j][p]) { dp[j][p] = cost; cut[j][p] = q; }
      }
  if (dp[rows][n] === INF) return null;
  const out = [];
  let p = n;
  for (let j = rows; j >= 1; j--) { const q = cut[j][p]; out.unshift(idx.slice(q, p)); p = q; }
  return out.map((r) => { let e = r.length; while (e > 0 && u[r[e - 1]].text === " ") e--; return r.slice(0, e); });
}

function fit(en, maxW, maxRows, baseSize, steps, words) {
  const u = units(en, words);
  for (const step of steps) {
    const size = baseSize * step;
    const maxEm = maxW / size;
    for (let rows = 1; rows <= maxRows; rows++) {
      const r = balancedWrap(u, maxEm, rows);
      if (r) return { units: u, rows: r, size, step };
    }
  }
  const size = baseSize * steps[steps.length - 1];
  const r = balancedWrap(u, (maxW * 1.4) / size, maxRows + 1);
  return { units: u, rows: r ?? [u.map((_, i) => i)], size, step: steps[steps.length - 1], overflow: true };
}

const L = JSON.parse(fs.readFileSync("src/data/lyrics.json", "utf8"));
const STEPS = [1, 0.86, 0.74, 0.63];

const canvases = [
  { name: "竖屏 1080×1920", w: 1080, h: 1920 },
  { name: "横屏 1920×1080", w: 1920, h: 1080 },
  { name: "方形 1080×1080", w: 1080, h: 1080 },
  { name: "预览 540×960", w: 540, h: 960 },
];

const verbose = process.argv.includes("-v");
let problems = 0;

for (const c of canvases) {
  const portrait = c.h > c.w * 1.15;
  const square = !portrait && c.h / c.w > 0.9;
  const short = Math.min(c.w, c.h);
  const u = short / 100;
  const safeX = c.w * (portrait ? 0.09 : square ? 0.1 : 0.12);
  /* 与 theme.ts 的 layout.measure 完全同源：从 safeX 推导，不再独立取值 */
  const maxW = Math.min(
    c.w - 2 * safeX - u * 2,
    portrait ? c.w : square ? c.w * 0.84 : Math.min(c.w * 0.72, short * 1.12),
  );
  const maxRows = portrait || square ? 3 : 2;
  const base = short * (portrait ? 0.118 : square ? 0.104 : 0.118);

  console.log(`\n=== ${c.name}   测量宽 ${maxW.toFixed(0)}px   基准字号 ${base.toFixed(0)}px   最多 ${maxRows} 行`);
  const used = new Set();
  for (const l of L) {
    const f = fit(l.en, maxW, maxRows, base, STEPS, l.words?.map((x) => ({ w: x.w })));
    const widths = f.rows.map((r) => {
      let w = 0;
      for (const i of r) w += f.units[i].width + f.units[i].gap;
      return (w - f.units[r[r.length - 1]].gap) * f.size;
    });
    used.add(f.size.toFixed(1));
    const over = widths.some((x) => x > maxW + 1);
    const tooMany = f.rows.length > maxRows;
    const lastRow = f.rows[f.rows.length - 1];
    // 孤字尾行：末行只有 1 个词，且宽度不到最宽行的 35%，
    // 这才叫"一个字孤零零挂在最后"；若末行有足够体量则不算问题。
    const lastW = widths[widths.length - 1];
    const maxRowW = Math.max(...widths);
    const lastWords = lastRow.filter((i) => f.units[i].text !== " ").length;
    const orphan = f.rows.length > 1 && lastWords <= 1 && lastW < maxRowW * 0.35;
    const bad = over || tooMany || orphan || f.overflow;
    if (bad) problems++;
    if (bad || verbose) {
      console.log(
        ` ${String(l.id).padStart(2)} ${f.size.toFixed(0)}px 档${(f.step * 100).toFixed(0)}% ${f.rows.length}行 ` +
          `宽${widths.map((x) => x.toFixed(0)).join("/")}` +
          `${over ? " 溢出" : ""}${tooMany ? " 行数超限" : ""}${orphan ? " 孤字尾行" : ""} | ` +
          f.rows.map((r) => r.map((i) => f.units[i].text).join("")).join(" ‖ "),
      );
    }
  }
  console.log(`  用到字号：${[...used].sort((a, b) => b - a).map((s) => s + "px").join(" / ")}`);
}

console.log(`\n${problems === 0 ? "✅ 全部通过" : `❌ 发现 ${problems} 处问题`}`);
process.exit(problems === 0 ? 0 : 1);