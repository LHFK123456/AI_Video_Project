/**
 * verify-visual.mjs — 验证「先抑后扬」视觉逻辑
 *
 * 检查项：
 *  1) 蓄力期（drop 前）画面是否接近纯黑、只有白色细字
 *  2) 爆发期（drop 后）是否出现霓虹色（粉/青）
 *  3) 文字是否存在（白像素 / 彩色像素占比）
 *  4) 爆发期色彩饱和度是否显著高于蓄力期
 *
 * 用法: node scripts/verify-visual.mjs <dir-with-pngs> --drop 40.545 --fps 60
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const FF = "D:/ffmpeg/bin/ffmpeg.exe";

function parseArgs() {
  const o = { drop: 40.545, fps: 60 };
  const argv = process.argv.slice(2);
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--drop") o.drop = Number(argv[++i]);
    else if (argv[i] === "--fps") o.fps = Number(argv[++i]);
    else rest.push(argv[i]);
  }
  o.dir = rest[0];
  return o;
}

/** 读 PNG 为 RGB24 原始像素（借 ffmpeg 解码，避免引入依赖） */
function readPixels(png, w = 135, h = 240) {
  const r = spawnSync(
    FF,
    ["-v", "error", "-i", png, "-vf", `scale=${w}:${h}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 8e7 },
  );
  if (r.status !== 0) throw new Error(`解码失败 ${png}: ${r.stderr?.toString()}`);
  return { buf: r.stdout, w, h };
}

function analyze(png) {
  const { buf, w, h } = readPixels(png);
  let sumL = 0;
  let white = 0;
  let neon = 0;
  let satSum = 0;
  let colorful = 0;
  const n = w * h;

  // 分区统计（上/中/下）
  const zones = [
    { name: "上", from: 0, to: 0.33, l: 0, c: 0 },
    { name: "中", from: 0.33, to: 0.67, l: 0, c: 0 },
    { name: "下", from: 0.67, to: 1, l: 0, c: 0 },
  ];

  const maxL = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const r = buf[o];
      const g = buf[o + 1];
      const b = buf[o + 2];
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      sumL += L;
      maxL.push(L);

      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      satSum += sat;

      if (r > 200 && g > 200 && b > 200) white++;

      // 霓虹判定：亮且饱和，且偏粉或偏青
      const isPink = r > 150 && b > 90 && g < r * 0.75;
      const isCyan = g > 150 && b > 150 && r < g * 0.75;
      if ((isPink || isCyan) && mx > 90) {
        neon++;
        colorful++;
      }

      const fy = y / h;
      for (const z of zones) {
        if (fy >= z.from && fy < z.to) {
          z.l += L;
          if ((isPink || isCyan) && mx > 90) z.c++;
          z.count = (z.count || 0) + 1;
        }
      }
    }
  }

  maxL.sort((a, b) => a - b);

  return {
    avgL: sumL / n,
    p99L: maxL[Math.floor(maxL.length * 0.99)],
    maxL: maxL[maxL.length - 1],
    whitePct: (white / n) * 100,
    neonPct: (neon / n) * 100,
    satAvg: satSum / n,
    zones: zones.map((z) => ({
      name: z.name,
      avgL: z.l / Math.max(1, z.count || 1),
      neonPct: (z.c / Math.max(1, z.count || 1)) * 100,
    })),
  };
}

function main() {
  const o = parseArgs();
  if (!o.dir || !fs.existsSync(o.dir)) {
    console.error("用法: node scripts/verify-visual.mjs <含png的目录> --drop 40.5 --fps 60");
    process.exit(1);
  }

  const files = fs
    .readdirSync(o.dir)
    .filter((f) => /^f\d+\.png$/.test(f))
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

  if (!files.length) {
    console.error("目录中没有 f<帧号>.png 文件");
    process.exit(1);
  }

  const dropFrame = Math.floor(o.drop * o.fps);
  console.log(`爆发点 ${o.drop}s = 第 ${dropFrame} 帧\n`);
  console.log(
    "  帧号   阶段   平均亮度  p99亮度  白像素%  霓虹%  平均饱和  判定",
  );
  console.log("  " + "─".repeat(74));

  let buildAvgL = 0, buildN = 0;
  let dropAvgL = 0, dropN = 0;
  let buildSat = 0, dropSat = 0;

  for (const f of files) {
    const frame = parseInt(f.slice(1));
    const phase = frame < dropFrame ? "蓄力" : "爆发";
    const a = analyze(path.join(o.dir, f));

    let verdict = "";
    if (phase === "蓄力") {
      // 蓄力期：暗 + 饱和低 + 有白字
      const dark = a.avgL < 14;
      const lowSat = a.satAvg < 0.2;
      const hasText = a.whitePct > 0.05;
      verdict = `${dark ? "暗✓" : "暗✗"} ${lowSat ? "低饱和✓" : "低饱和✗"} ${hasText ? "有字✓" : "有字✗"}`;
      buildAvgL += a.avgL;
      buildSat += a.satAvg;
      buildN++;
    } else {
      const bright = a.avgL > 12;
      const neonOk = a.neonPct > 0.6;
      verdict = `${bright ? "有光✓" : "有光✗"} ${neonOk ? "霓虹✓" : "霓虹✗"}`;
      dropAvgL += a.avgL;
      dropSat += a.satAvg;
      dropN++;
    }

    console.log(
      `  ${String(frame).padStart(5)}  ${phase}  ` +
      `${a.avgL.toFixed(2).padStart(7)}  ${a.p99L.toFixed(0).padStart(6)}  ` +
      `${a.whitePct.toFixed(2).padStart(6)}  ${a.neonPct.toFixed(2).padStart(5)}  ` +
      `${a.satAvg.toFixed(3).padStart(7)}  ${verdict}`,
    );
  }

  console.log("\n════════ 阶段对比 ════════");
  const bL = buildAvgL / Math.max(1, buildN);
  const dL = dropAvgL / Math.max(1, dropN);
  const bS = buildSat / Math.max(1, buildN);
  const dS = dropSat / Math.max(1, dropN);
  console.log(`  蓄力期均值: 亮度 ${bL.toFixed(2)}  饱和 ${bS.toFixed(3)}`);
  console.log(`  爆发期均值: 亮度 ${dL.toFixed(2)}  饱和 ${dS.toFixed(3)}`);
  console.log(`  饱和度提升: ${(dS / Math.max(1e-6, bS)).toFixed(2)}x`);
  console.log("");
  console.log(bS > 0 && dS > bS * 1.6
    ? "  ✔ 先抑后扬成立：爆发期饱和度显著高于蓄力期"
    : "  ⚠ 先抑后扬对比不足，需加强");
}

main();