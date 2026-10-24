import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { clamp, hash, pulseW, easeOutCubic } from "../lib/motion";
import { LYRIC_GAP, makeTheme, type Theme } from "../lib/theme";
import { glyphWidth, isCJKChar, textWidth, WEIGHT_SCALE } from "../lib/glyphs";
import type { LyricLine } from "../types";

type Props = {
  lines: LyricLine[];
  beats: { f: number; s: number }[];
  kicks: { f: number; s: number }[];
  /** 进入爆发期的帧 */
  dropFrame: number;
  fps: number;
  width: number;
  height: number;
};

/* ============================ 排版工具 ============================ */

const isCJK = isCJKChar;

/**
 * 单元间距（em）：直接取令牌层的唯一来源。
 *
 * 这两个值既是排版参数也是渲染参数，**必须同源**。
 * 早先渲染侧写死 0.04、令牌里写 0.05，两条路径各算一遍，
 * 结果就是"算得下、画出来却多出几像素"。
 */
const GAP_LATIN = LYRIC_GAP.word;
const GAP_CJK = LYRIC_GAP.cjk;

type Unit = { text: string; width: number; gap: number };

/**
 * 把一句英文拆成「显示单元」：拉丁按空格，CJK 逐字。
 *
 * 宽度一律按 **weight 600（爆发期）** 规划 —— 见 WEIGHT_SCALE 的说明。
 * 蓄力期用的是更细的字重、字更窄，于是天然留出几 % 余量；
 * 这样同一套字号阶梯能同时满足两种字重，不需要为爆发期单独降字号。
 */
function units(en: string, words?: { w: string }[]): Unit[] {
  const mk = (text: string): Unit => {
    const cjk = isCJK(text);
    // 用实测字宽表，不再用平均系数 —— 单字差异可达 3.5 倍（i 0.26 / m 0.91）
    return { text, width: textWidth(text, true), gap: cjk ? GAP_CJK : GAP_LATIN };
  };

  if (words && words.length) {
    // words 已是"显示单元"，但若某个单元里含多个 CJK 字（旧数据），就地拆开，
    // 保证日文也是逐字卡点而不是整块亮。
    const out: Unit[] = [];
    for (const x of words) {
      const chars = Array.from(x.w);
      if (chars.length > 1 && /[\u3040-\u30ff\u3400-\u9fff]/.test(x.w)) {
        for (const ch of chars) {
          out.push({ text: ch, width: glyphWidth(ch) * WEIGHT_SCALE.semiboldCJK, gap: GAP_CJK });
        }
      } else {
        out.push(mk(x.w));
      }
    }
    return out;
  }
  const out: Unit[] = [];
  let buf = "";
  for (const ch of en) {
    if (ch === " ") {
      if (buf) { out.push(mk(buf)); buf = ""; }
      out.push({ text: " ", width: GAP_LATIN, gap: 0 });
    } else if (isCJK(ch)) {
      if (buf) { out.push(mk(buf)); buf = ""; }
      out.push({ text: ch, width: glyphWidth(ch) * WEIGHT_SCALE.semiboldCJK, gap: GAP_CJK });
    } else buf += ch;
  }
  if (buf) out.push(mk(buf));
  return out;
}

/**
 * 均衡折行。
 *
 * 三个必须做对的点（都是实测踩出来的）：
 *
 *  1. **词间距要计入行宽**。行宽 = 各单元宽之和 + 单元之间的间距。
 *     漏算间距会低估 8~12%，实拍直接溢出安全区。
 *  2. **行数取最少可行解**。旧实现让"末行不计代价"，导致行数越多总代价越小，
 *     中文被拆成每行三四个字 —— 看起来像故障。现在先按 1、2、3 行顺序试，
 *     第一个能放下的行数就定下来，再在该行数内做最优断点。
 *  3. **末行也要计代价**。固定行数后，末行过短就是"孤字尾行"，
 *     这正是要避免的，必须和其余行一样受罚。
 *
 * 返回 null 表示该行数放不下（存在超宽行）。
 */
function balancedWrap(u: Unit[], maxEm: number, rows: number): number[][] | null {
  // 清理首尾与连续空格
  const idx: number[] = [];
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
  // 推进宽 A[i] = 内容宽 + 其后间距；行宽 = 行内 A 之和 - 行末间距
  const S = [0];
  for (let i = 0; i < n; i++) S.push(S[i] + u[idx[i]].width + u[idx[i]].gap);

  /** 第 q..p-1 个单元组成一行的宽度（不含行末间距） */
  const rowW = (q: number, p: number) => S[p] - S[q] - u[idx[p - 1]].gap;

  // 总宽（结尾不留间距）
  const total = rowW(0, n);
  const target = total / rows;

  const INF = Infinity;
  const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array(n + 1).fill(INF));
  const cut: number[][] = Array.from({ length: rows + 1 }, () => new Array(n + 1).fill(-1));
  dp[0][0] = 0;

  for (let j = 1; j <= rows; j++) {
    for (let p = j; p <= n; p++) {
      for (let q = j - 1; q < p; q++) {
        if (dp[j - 1][q] === INF) continue;
        const w = rowW(q, p);
        if (w > maxEm) continue; // 单行过宽，不可行
        // 最后一行也计代价：末行过短就是孤字尾行
        const d = w - target;
        const cost = dp[j - 1][q] + d * d;
        if (cost < dp[j][p]) {
          dp[j][p] = cost;
          cut[j][p] = q;
        }
      }
    }
  }

  if (dp[rows][n] === INF) return null;

  const out: number[][] = [];
  let p = n;
  for (let j = rows; j >= 1; j--) {
    const q = cut[j][p];
    out.unshift(idx.slice(q, p));
    p = q;
  }
  // 去掉每行末尾的空格
  return out.map((r) => {
    let e = r.length;
    while (e > 0 && u[r[e - 1]].text === " ") e--;
    return r.slice(0, e);
  });
}

/**
 * 自适应字号：**只在阶梯上取值**，且行数取最少可行解。
 *
 * 旧版每句各算一个字号（实测在 89~143px 之间乱跳），观众能感觉到画面在"膨胀收缩"。
 * 阶梯化之后，长句只会整档下降，全片字号节奏稳定 —— 这是"统一字号"的落地方式。
 */
function fit(
  en: string,
  maxW: number,
  maxRows: number,
  baseSize: number,
  steps: readonly number[],
  words?: { w: string }[],
) {
  const u = units(en, words);

  // 每一档字号都试"最少的行数"，取第一个成功的结果
  for (const step of steps) {
    const size = baseSize * step;
    const maxEm = maxW / size;
    for (let rows = 1; rows <= maxRows; rows++) {
      const r = balancedWrap(u, maxEm, rows);
      if (r) return { units: u, rows: r, size };
    }
  }

  // 兜底：最小档 + 放宽一行（理论上不会触发，但必须保证一定能出字）
  const size = baseSize * steps[steps.length - 1];
  const r = balancedWrap(u, (maxW * 1.4) / size, maxRows + 1);
  return { units: u, rows: r ?? [u.map((_, i) => i)], size };
}

/* ============================ 入场的极简扩散 ============================ */

/**
 * 爆发期每句入场的一圈细环扩散。
 * 旧版是 46 颗彩色碎屑炸裂 —— 太吵。这里只留一道 1px 的细环，
 * 像石子入水，克制但依然"有反应"。
 */
const Ripple: React.FC<{ seed: number; age: number; cx: number; cy: number; R: number; T: Theme }> = ({
  seed, age, cx, cy, R, T,
}) => {
  const p = clamp(age / 1.15);
  if (p >= 1) return null;
  const e = easeOutCubic(p);
  const r = R * (0.16 + e * 0.72);
  const o = (1 - p) * (1 - p) * 0.22;
  // 用 seed 让每句的环起点略有偏移，避免每条都一模一样
  const ox = (hash(seed * 2.13) - 0.5) * R * 0.06;

  return (
    <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <circle
        cx={cx + ox}
        cy={cy}
        r={r}
        fill="none"
        stroke={T.color.accent}
        strokeWidth={T.line.hair}
        opacity={o}
      />
    </svg>
  );
};

/* ============================ 主组件 ============================ */

/**
 * 歌词舞台 —— 简约高级风重制版。
 *
 * 保留的机制（一个都没动）：
 *  1. **逐词高亮** —— 唱到哪个词，那个词才亮。
 *  2. **一句一屏** —— 永远只有当前这句在画面中央。
 *  3. **空拍留暗** —— 没唱时画面几乎全暗。
 *  4. **drop 硬切** —— 第 14 句跨 drop，那一帧切换形态，不留渐变。
 *
 * 视觉上做的替换：
 *  未唱 = 淡灰"预告"（0.20 不透明度） → 已唱 = 暖白（不透明度 1.0）
 *  层级只靠**明度 + 字重**两级对照，不用颜色、不用描边、不用外发光堆叠。
 *  爆发期不再是霓虹粉 900 粗体，改为 weight 600 的暖白 + 极淡香槟字光，
 *  冲击力由字号放大与字距收紧承担，而不是靠颜色喊叫。
 */
export const LyricStage: React.FC<Props> = ({ lines, beats, kicks, dropFrame, fps, width, height }) => {
  const frame = useCurrentFrame();
  const T = makeTheme(width, height);

  const sorted = React.useMemo(
    () => [...lines].filter((l) => Number.isFinite(l.start) && Number.isFinite(l.end)).sort((a, b) => a.start - b.start),
    [lines],
  );

  // 当前句：帧落在 [start, end + 余留] 内。
  // 余留必须够长 —— 这首歌很多句子是"一口气连着唱"，
  // 句末到下一句起唱常有 0.2~0.3s 空隙，若在这里淡出，
  // 画面会在最需要冲击的地方闪黑一下（drop 处尤其致命）。
  const TAIL = 0.34;
  /**
   * 每句的显示区间 [start, displayEnd]。
   * 下一句起唱时，上一句**不能已经消失** —— 否则会出现"上一句淡完 → 下一句还没起"
   * 的一帧空窗，视觉上就是画面闪黑一下（每句闪一次，非常廉价）。
   * 所以这里让上一句延到"下一句起唱后 + 0.16s"，两句短暂交叉。
   */
  const displayEnd = (l: LyricLine, i: number): number => {
    const next = sorted[i + 1];
    const natural = (l.end + TAIL) * fps;
    if (!next) return natural;
    return Math.min((l.end + 0.9) * fps, next.start * fps + fps * 0.16);
  };

  let activeIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (frame >= sorted[i].start * fps && frame < displayEnd(sorted[i], i)) {
      activeIdx = i;
    }
  }
  const active = activeIdx >= 0 ? sorted[activeIdx] : undefined;
  const activeEndFrame = activeIdx >= 0 ? displayEnd(sorted[activeIdx], activeIdx) : 0;

  const inDrop = frame >= dropFrame;
  const punch = pulseW(kicks, frame, Math.round(fps * 0.2), 0.5);
  const breath = pulseW(beats, frame, Math.round(fps * 0.52), 0.3);

  /**
   * 舞台震动：爆发期才抖，且幅度比旧版小一半。
   * 高级感来自"稳"，抖动只是让画面不僵，不该让人看不清字。
   */
  const shakeAmt = inDrop ? punch * (T.portrait ? 1.6 : 1.2) : 0;
  const sx = (hash(frame * 1.7) - 0.5) * shakeAmt;
  const sy = (hash(frame * 2.9) - 0.5) * shakeAmt;

  const contentTop = T.layout.contentTop;
  const maxW = T.layout.measure;
  const maxRows = T.layout.maxRows;

  /* ---------- 空拍：只留极淡呼吸，画面几乎全暗 ---------- */
  const isIdle = !active;
  const idleGlow = 0.014 + breath * 0.018;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {/* 空拍呼吸光：极弱，几乎看不见，但画面不会"死" */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 62% 44% at 50% ${(contentTop / height) * 100}%, rgba(255,255,255,${
            idleGlow * (isIdle ? 1 : 0.35)
          }) 0%, transparent 68%)`,
        }}
      />

      <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px)` }}>
        {active ? (
          <LineView
            key={active.id}
            line={active}
            frame={frame}
            fps={fps}
            width={width}
            height={height}
            contentTop={contentTop}
            maxW={maxW}
            maxRows={maxRows}
            baseSize={T.size.lyric}
            T={T}
            punch={punch}
            dropFrame={dropFrame}
            displayEnd={activeEndFrame}
          />
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ============================ 单句渲染 ============================ */

type LineProps = {
  line: LyricLine;
  frame: number;
  fps: number;
  width: number;
  height: number;
  contentTop: number;
  maxW: number;
  maxRows: number;
  /** 歌词基准字号（阶梯的顶档） */
  baseSize: number;
  T: Theme;
  punch: number;
  dropFrame: number;
  /** 该句实际显示到哪一帧（可能比 end 晚，用于填句间空隙） */
  displayEnd: number;
};

const LineView: React.FC<LineProps> = ({
  line, frame, fps, width, height, contentTop, maxW, maxRows, baseSize, T, punch, dropFrame, displayEnd,
}) => {
  const a = line.start * fps;
  // 第 14 句横跨 drop：drop 之前仍是常规态，drop 那一帧才切换。
  // 这样"形态变化"和"鼓点爆发"严格同一帧，不会早 1.25 秒。
  const dropStyle = line.id > 14 || (line.id === 14 && frame >= dropFrame);
  const pivot = line.id === 14;

  const age = frame - a;
  /**
   * 容器退场：紧贴 displayEnd 的最后 0.1s 才淡。
   * 因为 displayEnd 已延到"下一句起唱 +0.16s"，上一句在线性上是"被下一句盖住"
   * 而不是"自己先消失"，这段 fadeWin 只是收个尾，避免硬切。
   */
  const fadeWin = fps * 0.1;
  const exitP = clamp((frame - (displayEnd - fadeWin)) / fadeWin);
  const containerOpacity = 1 - exitP * exitP;

  const fitted = React.useMemo(
    () => fit(line.en, maxW, maxRows, baseSize, T.lyricSteps, line.words?.map((w) => ({ w: w.w }))),
    [line.en, line.words, maxW, maxRows, baseSize, T.lyricSteps],
  );

  const zhSize = Math.min(
    Math.max(fitted.size * 0.30, T.size.caption * 0.92),
    (maxW * 0.92) / Math.max(1, Array.from(line.zh).length),
  );

  const wordList = line.words ?? [];

  // 中文延迟 0.2s 淡入
  const zhIn = easeOutCubic(clamp((frame - (a + fps * 0.24)) / (fps * 0.42)));

  // 第 14 句跨 drop：drop 那一帧"炸"开，同时轻微放大回弹。
  // 这是整支片子唯一的翻折点，必须比别处更狠 —— 但用幅度表达，不用颜色。
  const pivotAge = frame - dropFrame;
  const pivotPop =
    pivot && pivotAge >= 0 && pivotAge < fps * 0.3 ? 1 + (1 - pivotAge / (fps * 0.3)) * 0.18 : 1;

  /** 中文译行与主行的间距，跟随字号按比例走，任何画幅都一致 */
  const zhGap = fitted.size * (T.portrait ? 0.42 : 0.38);

  return (
    <AbsoluteFill style={{ opacity: containerOpacity, transform: `scale(${pivotPop})` }}>
      {/* 爆发期：每句入场的一圈极淡细环 */}
      {dropStyle && age >= 0 && age < fps * 1.15 ? (
        <Ripple
          seed={line.id}
          age={age / fps}
          cx={width / 2}
          cy={contentTop}
          R={Math.min(width, height) * 0.42}
          T={T}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: contentTop,
          transform: "translateY(-50%)",
        }}
      >
        {/* ---------- 主行：逐词高亮 ---------- */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            // 行间距：多行时给足呼吸，这是"留白"落到歌词上的地方
            gap: fitted.size * (T.portrait ? 0.26 : 0.20),
          }}
        >
          {fitted.rows.map((row, ri) => (
            <div
              key={ri}
              style={{
                display: "flex",
                justifyContent: "center",
                whiteSpace: "nowrap",
                alignItems: "baseline",
              }}
            >
              {row.map((ui) => {
                const u = fitted.units[ui];
                const wt = wordList[ui];

                // 这个词的起唱时刻（秒 → 帧）
                const ws = wt ? wt.s * fps : a;
                const we = wt ? wt.e * fps : line.end * fps;

                // 已唱部分：从 ws 开始 0.14s 内点亮（比旧版略慢，更从容）
                const lit = clamp((frame - ws) / (fps * 0.14));
                // "正在唱"的窗口：用于额外的字光与微量放大
                const singing = frame >= ws - fps * 0.02 && frame <= we + fps * 0.08;

                if (u.text === " ") {
                  // 空格单元的 width 本身就是词距，直接用，不再额外加 margin
                  return <span key={ui} style={{ display: "inline-block", width: fitted.size * u.width }} />;
                }

                /**
                 * 间距直接取单元自带的 gap —— 与折行测算用的是同一份数据。
                 * 若两处各写一套数值，就一定会出现"算得下、画出来却溢出"。
                 *
                 * 行末不留间距；若后面紧跟空格单元，也不加（空格已提供词距），
                 * 否则会出现"双倍词距"，整行宽度失控。
                 */
                const nextUi = row[row.indexOf(ui) + 1];
                const nextIsSpace = nextUi !== undefined && fitted.units[nextUi].text === " ";
                const isLast = row[row.length - 1] === ui;
                const gap = isLast || nextIsSpace ? 0 : fitted.size * u.gap;

                if (!dropStyle) {
                  /* ===== 蓄力期：细体暖白，逐字浮现 ===== */
                  // 逐字浮现：整句共享 0.3s 的铺开窗口，第一个字在起唱帧就有大部分不透明度
                  const appear = clamp(
                    (frame - a - (ui / Math.max(1, fitted.units.length)) * fps * 0.28) / (fps * 0.16),
                  );
                  const e = 0.94 + 0.06 * easeOutCubic(appear);
                  // 未唱：低不透明度的"预告"；已唱：完全暖白
                  const op = 0.34 + 0.66 * lit;
                  return (
                    <span
                      key={ui}
                      style={{
                        display: "inline-block",
                        fontSize: fitted.size,
                        // 字重只跳一级：未唱 300，已唱 400。够区分，但不吵
                        fontWeight: lit > 0.5 ? T.weight.regular : T.weight.light,
                        lineHeight: T.leading.lyric,
                        marginRight: gap,
                        color: T.color.paper,
                        fontFamily: T.font.sans,
                        opacity: op * e,
                        transform: `translateY(${(1 - e) * fitted.size * 0.1}px)`,
                        textShadow: lit > 0.7 ? `0 0 ${fitted.size * 0.7}px rgba(255,255,255,${T.glow.textWeak})` : undefined,
                        whiteSpace: "pre",
                        // 等宽数字，避免逐帧变化时字宽跳动
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {u.text}
                    </span>
                  );
                }

                /* ===== 爆发期：加粗一级 + 极淡香槟字光，跟随鼓点微颤 ===== */
                const jitter = singing ? punch : punch * 0.3;
                const jx = (hash(ui * 7.31 + line.id + Math.floor(frame / 2)) - 0.5) * 2 * jitter * (T.portrait ? 3.2 : 2.4);
                const jy = (hash(ui * 11.7 + line.id + Math.floor(frame / 2)) - 0.5) * 2 * jitter * (T.portrait ? 3.2 : 2.4);
                const rot = jx * 0.16;
                // 唱到的词只放大 3.5%，靠"呼吸"而不是"跳动"制造存在感
                const scale = (0.988 + 0.012 * lit) * (singing ? 1 + punch * 0.035 : 1);
                const halo = singing ? T.glow.textStrong + punch * 0.1 : T.glow.textWeak;

                return (
                  <span
                    key={ui}
                    style={{
                      display: "inline-block",
                      fontSize: fitted.size,
                      // 爆发期字重 600：这是全片最重的字，但不再用 900
                      fontWeight: T.weight.semibold,
                      lineHeight: T.leading.lyric,
                      marginRight: gap,
                      color: T.color.paper,
                      fontFamily: T.font.sans,
                      // 未唱的词压到很淡，唱到才完全亮起
                      opacity: 0.30 + 0.70 * lit,
                      transform: `translate(${jx}px, ${jy}px) scale(${scale}) rotate(${rot}deg)`,
                      // 只用两层柔光，不堆 4~5 层霓虹
                      textShadow: `0 0 ${fitted.size * 0.5}px rgba(255,255,255,${halo}), 0 0 ${
                        fitted.size * 1.6
                      }px ${T.color.accentSoft}`,
                      whiteSpace: "pre",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {u.text}
                  </span>
                );
              })}
            </div>
          ))}
        </div>

        {/* ---------- 中文译行：细体小字，延迟淡入 ---------- */}
        {line.zh ? (
          <div
            style={{
              marginTop: zhGap,
              textAlign: "center",
              fontSize: zhSize,
              fontWeight: T.weight.light,
              letterSpacing: T.track.caption,
              lineHeight: T.leading.caption,
              // 译行永远是次级：低不透明度，不与主行争
              color: T.color.paperSoft,
              fontFamily: T.font.sans,
              opacity: zhIn * 0.92,
              transform: `translateY(${(1 - zhIn) * zhSize * 0.5}px)`,
              paddingLeft: T.layout.safeX * 0.5,
              paddingRight: T.layout.safeX * 0.5,
            }}
          >
            {line.zh}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};