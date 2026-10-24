import React from "react";
import { Composition, registerRoot } from "remotion";
import { Measure, CHARSET, MEASURE_META } from "./Measure";
import { WeightMeasure, MEASURE_META as W_META } from "./WeightMeasure";

/**
 * 独立的测量入口，开发时逐页渲染：
 *   node scripts/measure-glyphs.mjs
 * （该脚本会自动渲染全部页并生成字宽表）
 */
const pages = Math.ceil(CHARSET.length / MEASURE_META.PER_PAGE) + 1; // +1 专测空格

/** 字重测量需要的高度：4 段文本 × 4 个字重 */
const W_ROWS = W_META.SAMPLES.length * W_META.WEIGHTS.length;

const MeasureRoot: React.FC = () => (
  <>
    {Array.from({ length: pages }, (_, p) => (
      <Composition
        key={p}
        id={`Measure${p}`}
        component={Measure}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ page: p }}
      />
    ))}
    <Composition
      id="WeightMeasure"
      component={WeightMeasure}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={Math.max(1920, 80 + W_ROWS * W_META.ROW_H)}
    />
  </>
);

registerRoot(MeasureRoot);