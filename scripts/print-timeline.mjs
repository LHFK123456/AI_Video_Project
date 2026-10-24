/**
 * 打印歌词时间轴清单 + 与音频数据的交叉校验。
 * 用法: node scripts/print-timeline.mjs
 */
import fs from "node:fs";

const lyrics = JSON.parse(fs.readFileSync("src/data/lyrics.json", "utf8"));
const song = JSON.parse(fs.readFileSync("src/data/song.json", "utf8"));
const fps = song.fps;
const drop = song.drop;
const dropFrame = Math.floor(drop * fps);

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const fmt = (v) => (v === null ? "—" : v.toFixed(2));
const frameOf = (v) => (v === null ? "—" : Math.floor(v * fps));

// 能量峰值：判断该时间段是否真有人声活动
const meanOf = (arr, t0, t1) => {
  if (t0 === null || t1 === null) return 0;
  const f0 = Math.max(0, Math.round(t0 * fps));
  const f1 = Math.min(arr.length, Math.round(t1 * fps));
  let s = 0;
  for (let i = f0; i < f1; i++) s += arr[i];
  return f1 > f0 ? s / (f1 - f0) : 0;
};

console.log("═".repeat(104));
console.log(`  歌词时间轴  |  音频 ${song.duration}s / ${song.totalFrames} 帧 @${fps}fps  |  BPM ${song.bpm}  |  drop ${drop}s (第${dropFrame}帧)`);
console.log("═".repeat(104));
console.log(
  `${padL("#", 2)}  ${pad("起始", 7)} ${pad("结束", 7)} ${pad("时长", 6)} ${pad("起始帧", 7)} ${pad("结束帧", 7)}  ` +
  `${pad("阶段", 6)} ${pad("能量", 6)} ${pad("低频", 6)}  歌词`,
);
console.log("─".repeat(104));

let prevEnd = 0;
const issues = [];

for (const L of lyrics) {
  const phase = L.start === null ? "—" : L.start >= drop ? "爆发" : "蓄力";
  const en = meanOf(song.energy, L.start, L.end);
  const bs = meanOf(song.bass, L.start, L.end);
  const dur = L.start === null ? "—" : (L.end - L.start).toFixed(2);

  console.log(
    `${padL(L.id, 2)}  ${pad(fmt(L.start), 7)} ${pad(fmt(L.end), 7)} ${pad(dur, 6)} ` +
    `${pad(frameOf(L.start), 7)} ${pad(frameOf(L.end), 7)}  ${pad(phase, 6)} ` +
    `${pad(en.toFixed(2), 6)} ${pad(bs.toFixed(2), 6)}  ${L.en}`,
  );
  console.log(`${" ".repeat(36)}中: ${L.zh}`);

  // 校验
  if (L.start !== null) {
    if (L.start < prevEnd - 0.001) {
      issues.push(`第${L.id}句起点 ${L.start}s 与上一句结束 ${prevEnd}s 重叠`);
    }
    if (L.end <= L.start) issues.push(`第${L.id}句时间为负`);
    if (en < 0.35) issues.push(`第${L.id}句能量偏低 (${en.toFixed(2)})，可能位置不准`);
    prevEnd = Math.max(prevEnd, L.end);
  } else {
    issues.push(`第${L.id}句无时间戳（音频中未出现）`);
  }
}

console.log("═".repeat(104));

// 空白段（没唱的时候）
console.log("\n【无人声空白段】（画面应保持黑屏/呼吸）");
let gaps = [];
let cur = 0;
for (const L of lyrics) {
  if (L.start === null) continue;
  if (L.start - cur > 0.35) gaps.push({ a: cur, b: L.start });
  cur = Math.max(cur, L.end);
}
if (song.duration - cur > 0.35) gaps.push({ a: cur, b: song.duration });
for (const g of gaps) {
  console.log(
    `  ${g.a.toFixed(2).padStart(6)} → ${g.b.toFixed(2).padStart(6)}  ` +
    `(${(g.b - g.a).toFixed(2)}s / ${Math.round((g.b - g.a) * fps)} 帧)`,
  );
}

// 阶段统计（按用户要求：前 13 句蓄力 / 后 9 句爆发）
const BUILD_N = 13;
const build = lyrics.filter((l) => l.id <= BUILD_N);
const dropL = lyrics.filter((l) => l.id > BUILD_N);
console.log(`\n【阶段划分（按句号 1-13 / 14-22）】`);
console.log(`  蓄力期 ${build.length} 句  #1-13   白细字逐字浮现，纯黑背景`);
console.log(`  爆发期 ${dropL.length} 句  #14-22  霓虹 / 震动 / 粒子`);

console.log(`\n【问题】${issues.length} 项`);
for (const i of issues) console.log("  · " + i);

console.log("\n【关键锚点对照】");
console.log(`  音频 drop 时刻        ${drop}s   (第 ${dropFrame} 帧)`);
const l13 = lyrics.find((l) => l.id === 13);
const l14 = lyrics.find((l) => l.id === 14);
const l15 = lyrics.find((l) => l.id === 15);
const last = lyrics.filter((l) => l.end !== null).pop();
console.log(`  第13句 (Far from dream) ${l13.start}s → ${l13.end}s`);
console.log(`  第14句 起点            ${l14.start}s  → 比 drop 早 ${(drop - l14.start).toFixed(3)}s`);
console.log(`  第15句 起点            ${l15.start}s  → 比 drop 晚 ${(l15.start - drop).toFixed(3)}s`);
console.log(`  最后一句结束           ${last.end}s  /  音频 ${song.duration}s`);

console.log("\n【分界提醒】");
console.log(`  歌词第14句在 ${l14.start}s 起唱，但音乐 drop 在 ${drop}s —— 相差 ${(drop - l14.start).toFixed(2)}s。`);
console.log(`  若严格按"14句起就霓虹"，霓虹会比音乐爆发早 ${(drop - l14.start).toFixed(2)}s 出现。`);