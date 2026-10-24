import React from "react";
import { AbsoluteFill } from "remotion";
import { makeTheme } from "../song/lib/theme";

/**
 * 逐字符前进宽度测量页（开发用，不属于成片）。
 *
 * 为什么需要：排版引擎必须知道"每个字符占多少 em"。靠经验系数估，
 * 估窄了文字溢出安全区（最难看），估宽了字号被迫降档（浪费版面）。
 * 而同类字符差异极大 —— 实测 i=0.27em、m=0.91em、W=0.94em，用一个平均值必然出错。
 *
 * 方法：每个字符重复 12 次排成一行，量出整行墨迹宽度，除以重复次数
 * 得到单字符前进宽度（含 side bearing，与浏览器排版一致）。
 *
 * 一屏放不下 68 个字符，用 page 属性分批渲染，脚本逐页量。
 */
const SIZE = 72;
const ROW_H = 96;
const X0 = 36;
const REPEAT = 12;
const PER_PAGE = 18;

export const CHARSET = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ..."0123456789",
  ...".,!?;:'\"-()&/",
];

/**
 * 空格无法靠"重复空格"量（无墨迹，画面上看不见）。
 * 用配对法：先量 N 个 n 的宽度，再量 n-空格-n-空格… 的宽度，
 * 差值就是 n-1 个空格的宽度。
 */
export const SPACE_CASE = {
  tight: "n".repeat(10),
  spaced: Array(10).fill("n").join(" "),
};

export const MEASURE_META = { SIZE, ROW_H, X0, REPEAT, PER_PAGE, TOTAL: CHARSET.length + 2 };

export const Measure: React.FC<{ page?: number }> = ({ page = 0 }) => {
  const T = makeTheme(1080, 1920);

  // 最后一页专测空格：两条基准行
  const isSpacePage = page >= Math.ceil(CHARSET.length / PER_PAGE);
  const rows: { text: string; key: string }[] = isSpacePage
    ? [
        { key: "spaceTight", text: SPACE_CASE.tight },
        { key: "spaceSpaced", text: SPACE_CASE.spaced },
      ]
    : CHARSET.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).map((ch, i) => ({
        key: `c${page * PER_PAGE + i}`,
        text: ch.repeat(REPEAT),
      }));

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {/* 左上角红色定位块：脚本据此确认原点与页号 */}
      <div style={{ position: "absolute", left: 0, top: 0, width: 8, height: 8, backgroundColor: "#ff0000" }} />
      {rows.map((r, i) => (
        <div
          key={r.key}
          style={{
            position: "absolute",
            left: X0,
            top: 40 + i * ROW_H,
            fontSize: SIZE,
            lineHeight: 1,
            fontWeight: T.weight.regular,
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