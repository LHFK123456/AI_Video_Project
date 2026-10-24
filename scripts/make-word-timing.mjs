/**
 * 由 Whisper 词级时间戳生成「逐词计时」。
 *
 * 输入：scripts/.whisper-aligned.json（whisper-align.py 产出）
 *       以及 src/data/lyrics.json（人工确认过的句子边界）
 * 输出：把 words 字段写回 lyrics.json
 *
 * 用法: node scripts/make-word-timing.mjs
 */
import fs from "node:fs";

const SRC_WORDS = "scripts/.whisper-aligned.json";
const SRC_LYRICS = "src/data/lyrics.json";

const raw = JSON.parse(fs.readFileSync(SRC_WORDS, "utf-8"));
const lyrics = JSON.parse(fs.readFileSync(SRC_LYRICS, "utf-8"));

/** 规范化：小写、去掉标点，用于模糊匹配 */
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']/gu, "")
    .trim();

/** 幻觉过滤：同一时刻堆叠的词、过度重复的词 */
function cleanWords(words) {
  const out = [];
  const seen = new Map();
  for (const w of words) {
    // 时长为 0 且置信度低的词，基本是幻觉铺屏
    if (w.e - w.s <= 0.001 && w.p < 0.5) continue;
    const key = `${norm(w.w)}@${Math.round(w.s * 10)}`;
    const c = (seen.get(key) || 0) + 1;
    seen.set(key, c);
    if (c > 1) continue;
    if (!norm(w.w)) continue;
    out.push(w);
  }
  return out.sort((a, b) => a.s - b.s);
}

const allWords = cleanWords(raw.words);

/**
 * 把一句话的文本拆成词，并把 ASR 词流对齐上去。
 * 用「文本相似度滑动窗口」找最佳匹配段，而不是硬性按索引对齐，
 * 因为 ASR 会漏词、会多词。
 */
function tokenizeLine(text) {
  // 保留标点的分词：按空格切，标点附着在词上。
  // 但含假名/汉字的 token 必须再按「字」拆开——
  // 否则「探し続けてるばかり」会被当成一个词，逐词高亮就退化成整句一起亮，
  // 日文段落也就失去了卡点的意义。
  const raw = text.split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of raw) {
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(t)) {
      for (const ch of Array.from(t)) out.push({ text: ch, key: norm(ch) });
    } else {
      out.push({ text: t, key: norm(t) });
    }
  }
  return out;
}

/** 在 words 的 [from, to] 区间里，为 line 找最佳起始索引 */
function bestWindow(lineTokens, words, from, to) {
  const keys = lineTokens.map((t) => t.key).filter(Boolean);
  if (!keys.length) return null;

  let best = { idx: -1, score: -1 };
  for (let i = from; i <= Math.min(to, words.length - 1); i++) {
    let score = 0;
    let matched = 0;
    // 尝试从 i 开始，按顺序匹配 keys
    let wi = i;
    for (const k of keys) {
      // 允许跳过最多 3 个 ASR 词（漏词/幻觉）
      let found = -1;
      for (let d = 0; d < 4 && wi + d < words.length; d++) {
        if (norm(words[wi + d].w) === k) {
          found = wi + d;
          break;
        }
      }
      if (found >= 0) {
        matched++;
        score += 1 + (k.length > 4 ? 0.3 : 0);
        wi = found + 1;
      }
    }
    if (matched === 0) continue;
    // 覆盖率优先，其次匹配数
    const cov = matched / keys.length;
    const sc = cov * 100 + matched;
    if (sc > best.score) best = { idx: i, score: sc, cov, matched };
  }
  return best.idx >= 0 ? best : null;
}

/** 为该句生成逐词时间 */
function buildWordTimings(line, words, cursor, fpsLike) {
  const tokens = tokenizeLine(line.en);
  const startIdx = Math.max(
    0,
    words.findIndex((w) => w.s >= line.start - 0.35),
  );
  const endIdx = (() => {
    let i = words.length - 1;
    while (i > startIdx && words[i].s > line.end + 0.35) i--;
    return i;
  })();

  const win = bestWindow(tokens, words, startIdx, endIdx);

  // —— 路径 A：ASR 对齐成功（覆盖率 ≥ 55%）——
  if (win && win.cov >= 0.55) {
    // 找出这句话覆盖到的 ASR 词范围
    let wi = win.idx;
    const picked = [];
    const keys = tokens.map((t) => t.key).filter(Boolean);
    let ki = 0;
    while (wi < words.length && ki < tokens.length) {
      const tok = tokens[ki];
      if (!tok.key) {
        picked.push({ tok, w: null });
        ki++;
        continue;
      }
      let found = -1;
      for (let d = 0; d < 4 && wi + d < words.length; d++) {
        if (norm(words[wi + d].w) === tok.key) {
          found = wi + d;
          break;
        }
      }
      if (found >= 0) {
        picked.push({ tok, w: words[found] });
        wi = found + 1;
      } else {
        picked.push({ tok, w: null });
      }
      ki++;
    }
    // 有 ASR 时间的词用真实时间；缺的用邻居插值
    const timed = picked.map((p) => ({
      text: p.tok.text,
      s: p.w ? p.w.s : null,
      e: p.w ? p.w.e : null,
    }));

    // 插值补齐
    for (let i = 0; i < timed.length; i++) {
      if (timed[i].s !== null) continue;
      let prev = null;
      let next = null;
      for (let j = i - 1; j >= 0; j--) if (timed[j].e !== null) { prev = timed[j]; break; }
      for (let j = i + 1; j < timed.length; j++) if (timed[j].s !== null) { next = timed[j]; break; }
      const a = prev ? prev.e : line.start;
      const b = next ? next.s : line.end;
      const gapCount = (() => {
        let n = 1;
        for (let j = i - 1; j >= 0 && timed[j].e === null; j--) n++;
        return n;
      })();
      const step = Math.max(0, (b - a) / Math.max(1, gapCount));
      timed[i].s = a;
      timed[i].e = Math.min(b, a + step * 0.9);
    }

    // 夹在句子边界内
    for (const t of timed) {
      t.s = Math.max(line.start, Math.min(line.end, t.s));
      t.e = Math.max(t.s + 0.02, Math.min(line.end + 0.12, t.e));
    }
    // 保证单调不减
    for (let i = 1; i < timed.length; i++) {
      if (timed[i].s < timed[i - 1].s) timed[i].s = timed[i - 1].s;
      if (timed[i].e < timed[i].s + 0.02) timed[i].e = timed[i].s + 0.02;
    }

    return timed.map((t) => ({ w: t.text, s: +t.s.toFixed(3), e: +t.e.toFixed(3) }));
  }

  // —— 路径 B：无可靠 ASR，按音节数（近似字符权重）均匀铺开 ——
  // CJK 每字 1 个音节权，拉丁词按元音组数估算
  const sylWeight = (t) => {
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(t)) return Array.from(t).length;
    const m = t.toLowerCase().match(/[aeiouy]+/g);
    return Math.max(1, m ? m.length : Math.ceil(t.length / 2.6));
  };
  const weights = tokens.map((t) => sylWeight(t.text));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0.4, line.end - line.start);

  let acc = 0;
  return tokens.map((t, i) => {
    const a = line.start + (acc / totalW) * span;
    acc += weights[i];
    const b = line.start + (acc / totalW) * span;
    return { w: t.text, s: +a.toFixed(3), e: +b.toFixed(3) };
  });
}

/* ============================ 主流程 ============================ */

let cursor = 0;
for (const line of lyrics) {
  const wt = buildWordTimings(line, allWords, cursor, 60);
  line.words = wt;
  const aligned = wt.filter((w) => w.s >= line.start - 0.1 && w.e <= line.end + 0.3).length;
  console.log(
    `#${String(line.id).padStart(2)}  ${line.start.toFixed(2)}-${line.end.toFixed(2)}  ` +
      `${wt.length} 词  ${wt.map((w) => w.w).join(" ").slice(0, 58)}`,
  );
}

fs.writeFileSync(SRC_LYRICS, JSON.stringify(lyrics, null, 1), "utf-8");
console.log(`\n✔ 已写入 ${SRC_LYRICS}（${lyrics.length} 句，全部带逐词计时）`);