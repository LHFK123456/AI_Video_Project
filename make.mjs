#!/usr/bin/env node
/**
 * 一键出片：分析音频 → 渲染视频
 *
 * 用法:
 *   node make.mjs <音频> [选项]
 *
 * 选项:
 *   --title "标题"        主标题，用 \n 换行
 *   --kicker "标签"       顶部小标签
 *   --subtitle "副标题"   底部说明
 *   --lyrics x.lrc        歌词（.lrc 或 .srt）
 *   --size h|v|s|all      输出尺寸：h横屏 v竖屏 s方形 all三种都出
 *   --fps 30              视频帧率
 *   --accent1 #FF3D68     主色
 *   --accent2 #00D9FF     辅色
 *   --bg #07070C          背景底色
 *   --intensity 1.4       动效强度 0.4~2
 *   --no-spectrum         不显示频谱
 *   --no-grid             不显示网格
 *   --no-lyrics           不烧歌词
 *   --preview             只渲染 540p 预览（快）
 *   --analyze-only        只分析不渲染
 *
 * 例:
 *   node make.mjs assets/song.mp3 --title "晴天" --lyrics assets/song.lrc --size all
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// make.mjs 位于项目根目录，根就是它自己所在目录
const ROOT = __dirname;

/* --------------------------------------------------------------- 参数 */

const argv = process.argv.slice(2);
const opts = {
  audio: "",
  title: "",
  kicker: "",
  subtitle: "",
  lyrics: "",
  size: "h",
  fps: 30,
  accent1: "#FF3D68",
  accent2: "#00D9FF",
  bg: "#07070C",
  intensity: 1,
  spectrum: true,
  grid: true,
  useLyrics: true,
  preview: false,
  analyzeOnly: false,
  bands: 48,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i] ?? "";
  if (a === "--title") opts.title = next();
  else if (a === "--kicker") opts.kicker = next();
  else if (a === "--subtitle") opts.subtitle = next();
  else if (a === "--lyrics") opts.lyrics = next();
  else if (a === "--size") opts.size = next().toLowerCase();
  else if (a === "--fps") opts.fps = Number(next()) || 30;
  else if (a === "--accent1") opts.accent1 = next();
  else if (a === "--accent2") opts.accent2 = next();
  else if (a === "--bg") opts.bg = next();
  else if (a === "--intensity") opts.intensity = Number(next()) || 1;
  else if (a === "--bands") opts.bands = Number(next()) || 48;
  else if (a === "--no-spectrum") opts.spectrum = false;
  else if (a === "--no-grid") opts.grid = false;
  else if (a === "--no-lyrics") opts.useLyrics = false;
  else if (a === "--preview") opts.preview = true;
  else if (a === "--analyze-only") opts.analyzeOnly = true;
  else if (a === "-h" || a === "--help") {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n/, ""));
    process.exit(0);
  } else if (a.startsWith("--")) {
    console.error(`[错误] 未知参数 ${a}`);
    process.exit(1);
  } else if (!opts.audio) opts.audio = a;
  else {
    console.error(`[错误] 多余的参数 ${a}`);
    process.exit(1);
  }
}

if (!opts.audio) {
  console.error("用法: node make.mjs <音频文件> [--title 标题] [--size h|v|s|all]");
  process.exit(1);
}
if (!fs.existsSync(opts.audio)) {
  console.error(`[错误] 音频不存在: ${opts.audio}`);
  process.exit(1);
}

/* ----------------------------------------------------------- 1. 分析 */

console.log("════════ 步骤 1/2  音频分析 ════════");
const analyzeArgs = ["scripts/analyze-beats.mjs", opts.audio, "--fps", String(opts.fps), "--bands", String(opts.bands)];
if (opts.title) analyzeArgs.push("--title", opts.title);
if (opts.lyrics) analyzeArgs.push("--lyrics", opts.lyrics);

const r1 = spawnSync(process.execPath, analyzeArgs, { cwd: ROOT, stdio: "inherit" });
if (r1.status !== 0) {
  console.error("[错误] 分析失败");
  process.exit(1);
}

if (opts.analyzeOnly) {
  console.log("\n✔ 仅分析完成，未渲染");
  process.exit(0);
}

/* --------------------------------------------------------- 2. 渲染 */

const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
const stem = path.basename(opts.audio, path.extname(opts.audio)).replace(/[\\/:*?"<>|]/g, "_");

const props = {
  title: opts.title || analysis.title,
  kicker: opts.kicker,
  subtitle: opts.subtitle,
  accent1: opts.accent1,
  accent2: opts.accent2,
  background: opts.bg,
  intensity: opts.intensity,
  showSpectrum: opts.spectrum,
  showLyrics: opts.useLyrics,
  showGrid: opts.grid,
};

const targets = [];
if (opts.preview) {
  targets.push({ id: "BeatVideoPreview", name: "_preview" });
} else if (opts.size === "all") {
  targets.push({ id: "BeatVideo", name: "" });
  targets.push({ id: "BeatVideoVertical", name: "_vertical" });
  targets.push({ id: "BeatVideoSquare", name: "_square" });
} else if (opts.size === "v") {
  targets.push({ id: "BeatVideoVertical", name: "" });
} else if (opts.size === "s") {
  targets.push({ id: "BeatVideoSquare", name: "" });
} else {
  targets.push({ id: "BeatVideo", name: "" });
}

const outDir = path.join(ROOT, "out");
fs.mkdirSync(outDir, { recursive: true });

// props 必须走文件：Windows shell 会吞掉 JSON 里的双引号
const propsFile = path.join(ROOT, ".props.tmp.json");
fs.writeFileSync(propsFile, JSON.stringify(props));

console.log("\n════════ 步骤 2/2  渲染视频 ════════");
console.log(`  时长 ${analysis.duration}s   ${analysis.totalFrames} 帧 @ ${analysis.fps}fps`);
console.log(`  BPM ${analysis.bpm}   拍点 ${analysis.beats.length} 个`);
console.log(`  标题「${props.title}」\n`);

const produced = [];
for (const t of targets) {
  const out = path.join(outDir, `${stem}${t.name}.mp4`);
  const args = [
    "remotion",
    "render",
    t.id,
    out,
    `--props=${propsFile}`,
    "--log=error",
  ];
  console.log(`▶ ${t.id} → ${path.basename(out)}`);
  const r = spawnSync("npx", args, { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`[错误] 渲染 ${t.id} 失败`);
    process.exit(1);
  }
  produced.push(out);
}

console.log("\n════════ 完成 ════════");
for (const p of produced) {
  const mb = (fs.statSync(p).size / 1024 / 1024).toFixed(1);
  console.log(`  ✔ ${p}  (${mb} MB)`);
}