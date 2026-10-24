/** 生成起唱帧校验清单：每句取「起唱前 3 帧」与「起唱后 10 帧」两个采样点。 */
import lyrics from "../src/data/lyrics.json" with { type: "json" };

const fps = 60;
const rows = [];
for (const l of lyrics) {
  const a = Math.round(l.start * fps);
  rows.push({
    id: l.id,
    start: l.start,
    end: l.end,
    before: a - 3,
    after: a + 10,
    mid: Math.round(((l.start + l.end) / 2) * fps),
    tail: Math.round(l.end * fps) + 2,
    en: l.en.slice(0, 42),
  });
}
console.log(JSON.stringify(rows, null, 0));