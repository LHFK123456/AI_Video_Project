/** 逐帧校验歌词可见性：确认没有提前、没有延后、没有叠字。
 *
 * 用 esbuild 直接打包 TS 模块后在 Node 里跑，与渲染用的是同一份逻辑。
 * 用法: node scripts/verify-schedule.mjs
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const outfile = path.join(os.tmpdir(), `lyricTiming-${Date.now()}.mjs`);
await build({
  entryPoints: ["src/song/lib/lyricTiming.ts"],
  bundle: true,
  format: "esm",
  outfile,
  logLevel: "silent",
});

const { buildSchedule, slotsAt, PIVOT_ID } = await import(pathToFileURL(outfile).href);
const lyrics = JSON.parse(fs.readFileSync("src/data/lyrics.json", "utf8"));
const FPS = 60;
const TOTAL = 3490;

const sch = buildSchedule(lyrics, FPS);

console.log("=".repeat(78));
console.log("逐帧可见性校验 (fps=60, 全片 3490 帧)");
console.log("=".repeat(78));

/* ---- 1. 起唱准时性 ---- */
console.log("\n[1] 起唱时刻（第 1 帧出现即为准时）");
console.log(`${"#".padStart(3)}  ${"时间轴".padStart(8)}  ${"起唱帧".padStart(7)}  ${"实测".padStart(8)}  ${"误差".padStart(7)}  状态`);
let exact = 0;
for (const s of sch.slots) {
  const at = s.a;
  const visibleAt = slotsAt(sch, at).some((x) => x.line.id === s.line.id);
  const visibleBefore = slotsAt(sch, at - 1).some((x) => x.line.id === s.line.id);
  const err = (at - Math.round(s.line.start * FPS)) / FPS;
  if (visibleAt && !visibleBefore && Math.abs(err) < 1e-9) exact++;
  console.log(
    `${String(s.line.id).padStart(3)}  ${String(s.line.start).padStart(8)}  ${String(at).padStart(7)}  ` +
      `${String(visibleAt ? "可见" : "缺失").padStart(8)}  ${(err * 1000).toFixed(0).padStart(6)}ms  ` +
      `${visibleAt && !visibleBefore ? "准时" : "异常"}`,
  );
}
console.log(`\n准时 ${exact}/${sch.slots.length}`);

/* ---- 2. 提前出现检查 ---- */
console.log("\n[2] 提前出现检查（起唱帧之前必须完全不可见）");
let early = [];
for (const s of sch.slots) {
  for (let f = 0; f < s.a; f++) {
    if (slotsAt(sch, f).some((x) => x.line.id === s.line.id)) {
      early.push({ id: s.line.id, frame: f, at: s.a });
      break;
    }
  }
}
console.log(early.length === 0 ? "  通过：没有任何一句提前出现" : `  失败：${JSON.stringify(early)}`);

/* ---- 3. 叠字检查 ---- */
console.log("\n[3] 叠字检查（同一帧最多一句）");
let overlaps = [];
for (let f = 0; f < TOTAL; f++) {
  const vis = slotsAt(sch, f);
  if (vis.length > 1) overlaps.push({ frame: f, t: (f / FPS).toFixed(2), ids: vis.map((x) => x.line.id) });
}
if (overlaps.length === 0) {
  console.log("  通过：全片无任何一帧出现两句同屏");
} else {
  console.log(`  警告：${overlaps.length} 帧有叠字`);
  overlaps.slice(0, 8).forEach((o) => console.log(`    第${o.frame}帧 (${o.t}s) → 句 ${o.ids.join(" + ")}`));
}

/* ---- 4. 空白段检查 ---- */
console.log("\n[4] 空白段检查（没唱歌时必须无一字）");
// 空白段从上一句「完全消失」之后算起（收声后的淡出余留属正常收尾，不算空白段）
const gaps = [];
let prevEnd = 0;
for (let i = 0; i < sch.slots.length; i++) {
  const s = sch.slots[i];
  const next = sch.slots[i + 1];
  const gapStart = s.fadeEnd / FPS;
  const gapEnd = next ? next.a / FPS : TOTAL / FPS;
  if (gapEnd - gapStart > 0.8) gaps.push([gapStart, gapEnd, s.line.id, next ? next.line.id : null]);
  prevEnd = Math.max(prevEnd, s.fadeEnd / FPS);
}
void prevEnd;

let gapOk = true;
for (const [s, e, from, to] of gaps) {
  const f0 = Math.round(s * FPS);
  const f1 = Math.round(e * FPS);
  let dirty = 0;
  for (let f = f0; f < f1; f++) if (slotsAt(sch, f).length) dirty++;
  const pct = f1 > f0 ? ((dirty / (f1 - f0)) * 100).toFixed(1) : "0.0";
  if (Number(pct) > 0) gapOk = false;
  const label = to ? `句${from}消失→句${to}起唱` : `句${from}消失→片尾`;
  console.log(
    `  ${s.toFixed(2).padStart(6)}-${e.toFixed(2).padStart(6)}s  (${(e - s).toFixed(2)}s)  有字帧 ${pct}%  ${Number(pct) === 0 ? "黑屏/呼吸" : "!! 有字"}  ${label}`,
  );
}
console.log(gapOk ? "\n  通过：所有空白段均无字幕" : "\n  失败：空白段出现字幕");

/* ---- 5. 收声检查 ---- */
console.log("\n[5] 收声检查（唱完后的余留时间）");
for (const s of sch.slots) {
  const tail = (s.fadeEnd - Math.round(s.line.end * FPS)) / FPS;
  console.log(
    `  句${String(s.line.id).padStart(2)}  收声 ${s.line.end.toFixed(2)}s → 消失 ${(s.fadeEnd / FPS).toFixed(2)}s  余留 ${(tail * 1000).toFixed(0).padStart(4)}ms`,
  );
}

/* ---- 6. 转场句检查 ---- */
console.log("\n[6] 分界检查（第14句白 → drop 瞬间转霓虹）");
const dropFrame = Math.round(40.545 * FPS);
const p = sch.slots.find((x) => x.line.id === PIVOT_ID);
console.log(`  drop 帧 = ${dropFrame} (40.545s)`);
console.log(`  第14句起唱帧 = ${p.a} (${p.line.start}s)，比 drop 早 ${((dropFrame - p.a) / FPS).toFixed(3)}s`);
console.log(`  第15句起唱帧 = ${sch.slots.find((x) => x.line.id === 15).a} (${sch.slots.find((x) => x.line.id === 15).line.start}s)，比 drop 晚 ${((sch.slots.find((x) => x.line.id === 15).a - dropFrame) / FPS).toFixed(3)}s`);
console.log(`  样式：14=build(白)  15=${sch.slots.find((x) => x.line.id === 15).style}`);

fs.rmSync(outfile, { force: true });