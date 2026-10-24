#!/usr/bin/env node
/**
 * 一键自检：环境 + 分析 + 渲染 + 验证
 * 用数据证明整条链路可用，不靠"应该没问题"
 *
 * 用法: node scripts/selftest.mjs
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath;

let pass = 0;
let fail = 0;
const results = [];

function check(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    const msg = fn();
    console.log(`✔ ${msg ?? ""}`);
    pass++;
    results.push({ name, ok: true, msg });
  } catch (e) {
    console.log(`✘ ${e.message}`);
    fail++;
    results.push({ name, ok: false, msg: e.message });
  }
}

function exists(p) {
  if (!fs.existsSync(p)) throw new Error(`不存在: ${p}`);
  return "存在";
}

function run(args, opts = {}) {
  const r = spawnSync(NODE, args, { cwd: ROOT, encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "").split("\n").slice(-3).join(" ").trim());
  return r.stdout;
}

console.log("\n══════════ 1. 环境检查 ══════════");
check("Node.js 版本", () => {
  const v = process.version;
  const major = Number(v.slice(1).split(".")[0]);
  if (major < 18) throw new Error(`需要 >=18，当前 ${v}`);
  return v;
});
check("remotion 依赖", () => {
  const p = path.join(ROOT, "node_modules", "remotion");
  exists(p);
  const pkg = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8"));
  return pkg.version;
});
check("media-utils 依赖", () => {
  const p = path.join(ROOT, "node_modules", "@remotion", "media-utils");
  exists(p);
  return "已安装";
});
check("ffmpeg 可执行", () => {
  const r = spawnSync("D:/ffmpeg/bin/ffmpeg.exe", ["-v", "error", "-version"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("无法运行");
  return r.stdout.split("\n")[0].slice(0, 40);
});
check("渲染浏览器", () => {
  const p = path.join(ROOT, "node_modules", ".remotion");
  exists(p);
  return "在项目内（不占 C 盘）";
});

console.log("\n══════════ 2. 源码检查 ══════════");
const requiredFiles = [
  "src/Root.tsx",
  "src/BeatVideo.tsx",
  "src/lib/beats.ts",
  "src/components/Background.tsx",
  "src/components/BeatTitle.tsx",
  "src/components/Spectrum.tsx",
  "src/components/Lyrics.tsx",
  "scripts/analyze-beats.mjs",
  "make.mjs",
];
for (const f of requiredFiles) {
  check(path.basename(f), () => exists(path.join(ROOT, f)));
}
check("TypeScript 类型检查", () => {
  const r = spawnSync("npx", ["tsc", "--noEmit"], { cwd: ROOT, encoding: "utf8", shell: true });
  if (r.status !== 0) throw new Error((r.stdout || "").split("\n")[0]);
  return "0 错误";
});

console.log("\n══════════ 3. 音频分析 ══════════");
check("鼓点分析", () => {
  run(["scripts/analyze-beats.mjs", "assets/test-beat.wav", "--title", "自检"]);
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
  if (!a.beats.length) throw new Error("没有检测到拍点");
  return `${a.bpm} BPM, ${a.beats.length} 拍, ${a.duration}s`;
});
check("分析产物完整", () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/spectrum.json"), "utf8"));
  if (!a.energy?.length || !a.low?.length || !a.high?.length) throw new Error("特征数组缺失");
  if (!s.length || !s[0]?.length) throw new Error("频谱为空");
  if (a.energy.length !== a.totalFrames) throw new Error("能量数组长度与帧数不符");
  return `${a.totalFrames} 帧 × ${s[0].length} 频段`;
});
check("拍点时间单调递增", () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
  for (let i = 1; i < a.beats.length; i++) {
    if (a.beats[i].t <= a.beats[i - 1].t) throw new Error(`第 ${i} 拍时间未递增`);
  }
  return "正常";
});
check("拍点在音频时长内", () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
  for (const b of a.beats) {
    if (b.t < 0 || b.t > a.duration) throw new Error(`拍点 ${b.t} 超出 0~${a.duration}`);
  }
  return "全部有效";
});
check("音频已复制到 public", () => {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
  exists(path.join(ROOT, "public", a.audio));
  return a.audio;
});

console.log("\n══════════ 4. 渲染测试 ══════════");
check("渲染 540p 预览", () => {
  const out = path.join(ROOT, "out", "_selftest.mp4");
  const r = spawnSync(
    "npx",
    ["remotion", "render", "BeatVideoPreview", out, "--log=error"],
    { cwd: ROOT, encoding: "utf8", shell: true, timeout: 300000 },
  );
  if (r.status !== 0) throw new Error((r.stdout || r.stderr || "").split("\n").slice(-2).join(" "));
  const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  return `${mb} MB`;
});
check("输出可被 ffprobe 解析", () => {
  const out = path.join(ROOT, "out", "_selftest.mp4");
  const r = spawnSync(
    "D:/ffmpeg/bin/ffprobe.exe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", out],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error("ffprobe 失败");
  return r.stdout.trim();
});
check("音视频时长对齐", () => {
  const out = path.join(ROOT, "out", "_selftest.mp4");
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/analysis.json"), "utf8"));
  const g = (sel) => {
    const r = spawnSync(
      "D:/ffmpeg/bin/ffprobe.exe",
      ["-v", "error", "-select_streams", sel, "-show_entries", "stream=duration", "-of", "csv=p=0", out],
      { encoding: "utf8" },
    );
    return Number(r.stdout.trim());
  };
  const vd = g("v:0");
  const ad = g("a:0");
  const diff = Math.abs(vd - ad);
  if (!(vd > 0) || !(ad > 0)) throw new Error(`视频 ${vd} 音频 ${ad}`);
  if (diff > 0.15) throw new Error(`偏差 ${diff.toFixed(3)}s 超标`);
  return `视频 ${vd.toFixed(2)}s / 音频 ${ad.toFixed(2)}s，偏差 ${(diff * 1000).toFixed(0)}ms`;
});

console.log("\n══════════ 5. 动效与踩点验证 ══════════");
check("画面确实在变（帧差异）", () => {
  const out = path.join(ROOT, "out", "_selftest.mp4");
  const r = spawnSync(NODE, ["scripts/verify-frames.mjs", out], { cwd: ROOT, encoding: "utf8" });
  const o = r.stdout;
  if (!/标题尺寸在变化:     ✔/.test(o) && !/标题尺寸在变化:.*✔/.test(o)) {
    throw new Error("未检测到标题缩放");
  }
  const m = o.match(/变化幅度: 宽 ([\d.]+)%  高 ([\d.]+)%/);
  return m ? `宽 ${m[1]}% 高 ${m[2]}%` : "已通过";
});
check("踩点对齐（逐拍命中率）", () => {
  const out = path.join(ROOT, "out", "_selftest.mp4");
  const r = spawnSync(NODE, ["scripts/verify-sync.mjs", out], { cwd: ROOT, encoding: "utf8" });
  const m = r.stdout.match(/命中（拍点帧变化 > 基线 1\.25 倍）: (\d+)\/(\d+)\s+\((\d+)%\)/);
  if (!m) throw new Error("无法解析验证结果");
  const rate = Number(m[3]);
  if (rate < 70) throw new Error(`命中率仅 ${rate}%`);
  return `${m[1]}/${m[2]} 拍命中 (${rate}%)`;
});

// 清理
try {
  fs.rmSync(path.join(ROOT, "out", "_selftest.mp4"), { force: true });
} catch {}

console.log("\n══════════ 结果 ══════════");
console.log(`  通过 ${pass}  失败 ${fail}  共 ${pass + fail}`);
if (fail > 0) {
  console.log("\n  失败项:");
  for (const r of results.filter((x) => !x.ok)) console.log(`    ✘ ${r.name}: ${r.msg}`);
}
console.log(`\n  ${fail === 0 ? "✔ 全部通过，可以直接出片" : "✘ 存在问题，见上方失败项"}\n`);
process.exit(fail === 0 ? 0 : 1);