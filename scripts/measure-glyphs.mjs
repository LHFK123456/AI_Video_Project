/**
 * 逐字符量出真实前进宽度，生成 src/song/lib/glyphs.ts
 *
 * 自动完成：渲染全部测量页 → 逐页量墨迹宽度 → 写表。
 * 用法: node scripts/measure-glyphs.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const FF = "D:/ffmpeg/bin/ffmpeg.exe";
const ENTRY = "src/dev/measure-entry.tsx";
const OUT = ".v2";

const SIZE = 72;
const ROW_H = 96;
const PER_PAGE = 18;
const W = 1080;
const H = 1920;
const REPEAT = 12;

const CHARSET = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ...".,!?;:'\"-()&/",
];
const pages = Math.ceil(CHARSET.length / PER_PAGE) + 1; // +1 专测空格

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const lum = (buf, x, y) => {
  const i = (y * W + x) * 3;
  return Math.max(buf[i], buf[i + 1], buf[i + 2]);
};

const out = {};

for (let p = 0; p < pages; p++) {
  const png = `${OUT}/m${p}.png`;
  console.log(`渲染测量页 ${p + 1}/${pages} …`);
  const res = spawnSync(
    "npx",
    ["remotion", "still", ENTRY, `Measure${p}`, png, "--log=error"],
    { shell: true, encoding: "utf8" },
  );
  if (res.status !== 0) {
    console.error(res.stdout, res.stderr);
    throw new Error(`渲染失败 page ${p}`);
  }

  const raw = spawnSync(FF, ["-v", "error", "-i", png, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
    maxBuffer: 3e8,
  });
  const buf = raw.stdout;

  // 最后一页是空格专测页
  const isSpacePage = p >= Math.ceil(CHARSET.length / PER_PAGE);
  if (isSpacePage) {
    const measureRow = (rowIdx) => {
      const yTop = 40 + rowIdx * ROW_H;
      let minX = Infinity, maxX = -1;
      for (let y = yTop; y < Math.min(yTop + 80, H); y++) {
        for (let x = 0; x < W; x++) {
          if (x < 12 && y < 12) continue;
          if (lum(buf, x, y) >= 90) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
        }
      }
      return maxX < 0 ? null : (maxX - minX + 1);
    };
    const tight = measureRow(0);   // 10 个 n
    const spaced = measureRow(1);  // n 空格 n 空格 …（10 个 n，9 个空格）
    if (tight && spaced) {
      // 宽度差 = 9 个空格
      const spaceW = ((spaced - tight) / 9) / SIZE;
      out[" "] = +spaceW.toFixed(4);
      console.log(`  空格 = ${spaceW.toFixed(4)}em（tight ${tight}px / spaced ${spaced}px）`);
    }
    continue;
  }

  const start = p * PER_PAGE;
  const slice = CHARSET.slice(start, start + PER_PAGE);

  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    const yTop = 40 + i * ROW_H;
    let minX = Infinity, maxX = -1;
    for (let y = yTop; y < Math.min(yTop + 80, H); y++) {
      for (let x = 0; x < W; x++) {
        if (x < 12 && y < 12) continue; // 跳过红色定位块
        if (lum(buf, x, y) >= 90) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (maxX < 0) {
      console.log(`  ⚠ ${JSON.stringify(ch)} 无墨迹，跳过`);
      continue;
    }
    out[ch] = +(((maxX - minX + 1) / REPEAT) / SIZE).toFixed(4);
  }
}

const cat = (re) => Object.entries(out).filter(([c]) => re.test(c)).map(([, v]) => v);
const lower = cat(/^[a-z]$/);
const upper = cat(/^[A-Z]$/);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`\n量到 ${Object.keys(out).length} / ${CHARSET.length} 个字符`);
console.log(`小写 ${lower.length} 个  平均 ${avg(lower).toFixed(3)}em  范围 ${Math.min(...lower).toFixed(3)}~${Math.max(...lower).toFixed(3)}`);
console.log(`大写 ${upper.length} 个  平均 ${avg(upper).toFixed(3)}em  范围 ${Math.min(...upper).toFixed(3)}~${Math.max(...upper).toFixed(3)}`);
console.log(`空格 ${out[" "] ?? "—"}em`);

const lines = Object.entries(out).map(([c, v]) => {
  let key;
  if (c === " ") key = '" "';
  else if (c === "'") key = '"\'"';
  else if (c === '"') key = '"\\""';
  else key = `"${c}"`;
  return `  ${key}: ${v},`;
});

const file = `/**
 * 字符前进宽度表（单位 em：字号为 1 时单字符占多少宽度）
 *
 * **这张表是实测出来的，不是估算的。**
 * 生成方式：
 *   1. src/dev/Measure.tsx 把每个字符重复 ${REPEAT} 次排成一行渲染
 *   2. scripts/measure-glyphs.mjs 量出整行墨迹宽度，除以 ${REPEAT}
 * 重新生成：node scripts/measure-glyphs.mjs
 *
 * 为什么不写一个平均值：同类字符差异极大（实测 i=0.27em、m=0.91em、W=0.94em）。
 * 用平均值会让窄字母多的词被高估宽度、白白降一档字号，
 * 而宽字母词被低估、直接溢出安全区。
 */
export const GLYPH_W: Record<string, number> = {
${lines.join("\n")}
};

/** 全角字符（中日文）统一按 1em */
export const CJK_W = 1;

/** 未知字符兜底：取小写字母平均值 */
export const FALLBACK_W = ${avg(lower).toFixed(3)};

/** 是否全角字符 */
export const isCJKChar = (ch: string): boolean => {
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x3000 && cp <= 0x30ff) ||
    (cp >= 0x3400 && cp <= 0x9fff) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
};

/** 单字符宽度（em） */
export const glyphWidth = (ch: string): number =>
  isCJKChar(ch) ? CJK_W : (GLYPH_W[ch] ?? FALLBACK_W);

/** 整串宽度（em），不含字距 */
export const textWidth = (s: string): number => {
  let w = 0;
  for (const ch of s) w += glyphWidth(ch);
  return w;
};
`;

fs.writeFileSync("src/song/lib/glyphs.ts", file, "utf8");
console.log(`\n✅ 已写入 src/song/lib/glyphs.ts`);