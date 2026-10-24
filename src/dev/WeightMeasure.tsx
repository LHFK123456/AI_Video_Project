import React from "react";
import { AbsoluteFill } from "remotion";
import { makeTheme } from "../song/lib/theme";

/**
 * 字重宽度差异测量页（开发用）。
 *
 * 为什么需要：排版引擎的字宽表只在 weight 400 下测过，但爆发期用的是 600。
 * Windows 上的中文字体（微软雅黑）没有真正的 600 字重，浏览器会做"合成粗体"
 * （synthetic bold），笔画加粗的同时字宽也会变 —— 这正是"蓄力期不溢出、
 * 爆发期溢出"的根因。
 *
 * 方法：同一段文本分别用 400 / 500 / 600 / 700 各排一行，量墨迹宽度，
 * 得到各字重相对 400 的放大系数。
 */
const SIZE = 72;
const ROW_H = 110;
const X0 = 36;

/** 取样文本：覆盖窄字符、宽字符、CJK、标点，尽量代表真实歌词的字符构成 */
export const SAMPLES = [
  "If all of us believe in living perfect",
  "Half empty broken dreams",
  "We are the fading light",
  "一半是幻想 一半是破碎",
];

export const WEIGHTS = [400, 500, 600, 700] as const;

export const MEASURE_META = { SIZE, ROW_H, X0, SAMPLES, WEIGHTS };

export const WeightMeasure: React.FC = () => {
  const T = makeTheme(1080, 1920);
  const rows: { text: string; w: number }[] = [];
  for (const s of SAMPLES) for (const w of WEIGHTS) rows.push({ text: s, w });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: X0,
            top: 40 + i * ROW_H,
            fontSize: SIZE,
            lineHeight: 1,
            fontWeight: r.w,
            fontFamily: T.font.sans,
            color: "#FFFFFF",
            letterSpacing: 0,
            whiteSpace: "pre",
          }}
        >
          {r.text}
        </div>
      ))}
    </AbsoluteFill>
  );
};