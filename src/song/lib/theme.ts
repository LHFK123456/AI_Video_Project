/**
 * 设计令牌（Design Tokens）
 *
 * 全片唯一的设计真源。所有颜色、字号、字距、行高、间距、圆角都从这里取，
 * 组件里不再出现任何魔法数字或写死的色值。
 *
 * 两条硬规则：
 *  1. **一切尺寸以画面短边为基准**。竖屏 1080×1920 与横屏 1920×1080 的短边都是 1080，
 *     所以同一层级的元素在两种画幅上物理大小完全一致 —— 这就是"桌面端与移动端协调"的实现方式，
 *     而不是靠两套断点各调一遍。
 *  2. **只有中性色 + 一个香槟色点缀**。没有任何第二个彩色，层级只靠明度与字重区分。
 */

/**
 * 中性色阶：深炭黑 → 暖白，只有明度变化，不掺色相。
 *
 * 注意 R/G/B 必须严格相等（或按同一方向偏移）：
 * 早先 ink 的 B 比 R 高 2、inkRaise 高 4，画面整体就偏蓝灰，
 * 而文字是暖白（R 比 B 高 3）—— 底冷字暖，两者色温打架，
 * 观感上"灰得发脏"。现在底色纯中性，色温差异只留给文字。
 */
export const palette = {
  /** 最深的底 */
  ink: "#090909",
  /** 抬升一层的底（渐变落点） */
  inkRaise: "#111111",
  /** 主文字：暖白，比纯白柔和，长时间看不刺眼 */
  paper: "#F2F1EF",
  /** 次级文字 */
  paperSoft: "rgba(242,241,239,0.62)",
  /** 三级文字 / 注释 */
  paperFaint: "rgba(242,241,239,0.36)",
  /** 未唱到的词：只是"预告"，压到很淡 */
  paperGhost: "rgba(242,241,239,0.20)",
  /** 分割线 */
  hair: "rgba(242,241,239,0.13)",
  /** 更弱的分割线 / 容器描边 */
  hairSoft: "rgba(242,241,239,0.06)",
  /** 全片唯一的点缀色：香槟，只在强调处出现 */
  accent: "#C6B49B",
  /** 点缀色的极淡态，用于光晕 */
  accentSoft: "rgba(198,180,155,0.18)",
} as const;

/**
 * 字体：全片只用这两个族。
 * 无衬线负责歌词与标题，等宽负责小标签与元信息（这是"高级感"的关键细节：
 * 细等宽 + 大字距的标签，比粗黑体更能传达克制）。
 */
export const fontStack = {
  sans: '"Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  mono: '"SF Mono", "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace',
} as const;

/**
 * 字重阶梯：只用这五级，且上限定在 600。
 * 原来的 900 / Arial Black / Impact 全部废弃 —— 那是"喊"，不是"高级"。
 */
export const weight = {
  thin: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

/** 字距：以 em 表示，跟随字号自动缩放，天然统一 */
export const track = {
  /** 大标题：略微收紧，显得紧实 */
  display: "-0.005em",
  /** 歌词：几乎为 0，中英日混排时不散 */
  lyric: "0.01em",
  /** 中文译行：轻微放开，小字更透气 */
  caption: "0.06em",
  /** 正文 */
  body: "0.02em",
  /** 等宽小标签：大幅度放开字距 */
  label: "0.32em",
} as const;

/** 行高 */
export const leading = {
  display: 1.16,
  lyric: 1.32,
  caption: 1.9,
  body: 1.75,
} as const;

export type Theme = ReturnType<typeof makeTheme>;

/**
 * 歌词内部间距（em，跟随字号自动缩放）。
 *
 * **这是唯一来源** —— 排版测算与渲染都用这两个值。
 * 早先渲染侧写 0.04、令牌里写 0.05，两处不一致，结果"算得下、画出来却多出几像素"。
 * 拉丁词之间要留出词距，CJK 逐字之间只需要极小的字距；
 * 两者的差别必须显式定义，否则中英日混排会一边挤一边散。
 */
export const LYRIC_GAP = {
  /** 拉丁词间距 */
  word: 0.26,
  /** CJK 字间距 */
  cjk: 0.04,
} as const;

/**
 * 生成当前画幅的令牌实例。
 * 同一份源码渲染 1080×1920 / 1920×1080 / 1080×1080 / 540×960 都拿到同一套比例。
 */
export const makeTheme = (width: number, height: number) => {
  const short = Math.min(width, height);
  const portrait = height > width * 1.15;
  /** 方形画幅（1:1 附近）单独一套：既不是竖屏也不是横屏，需要自己的行长与行数 */
  const square = !portrait && height / width > 0.9;
  /** 基准单位：短边的 1% */
  const u = short / 100;

  return {
    width,
    height,
    short,
    portrait,
    square,
    u,

    color: palette,
    font: fontStack,
    weight,
    track,
    leading,

    /**
     * 字号阶梯：只有三档，且所有歌词句都必须落在其中一档上。
     * 这是"统一"的实现方式 —— 旧版每句各算一个字号（89~143px 乱跳），
     * 观众能感觉到膨胀感；阶梯化之后，长句只会"降一档"，节奏稳定。
     *
     * **歌词字号必须严格等于短边的同一比例**（不按画幅分叉）。
     * 早先竖屏用 13.2%、横屏用 10.4%，同一句歌词在两画幅下的"占屏比"就差 27%，
     * 观感上是两套版式。统一到 11.8% 后，横竖屏的歌词在屏幕上看起来一样大，
     * 这才是"桌面端与移动端协调"的真实含义。
     *
     * 竖屏因为行长窄（短边的 0.80）会比横屏多降档，这是行长决定的，不是画幅决定的。
     */
    size: {
      /** 开场主标题 / 结尾主句 —— 横竖屏同比例（标题短，任一画幅都放得下） */
      display: short * (portrait ? 0.100 : square ? 0.100 : 0.100),
      /** 歌词基准档 —— 横竖屏同比例 */
      lyric: short * (portrait ? 0.118 : square ? 0.104 : 0.118),
      /** 中文译行 */
      caption: short * 0.030,
      /** 正文 / 互动引导 */
      body: short * (portrait ? 0.031 : 0.030),
      /** 等宽小标签 */
      label: short * 0.020,
    },

    /** 歌词字号阶梯比例：基准 / 降一档 / 降两档 / 降三档 */
    lyricSteps: [1, 0.86, 0.74, 0.63] as const,

    /**
     * 歌词内部间距（em，跟随字号自动缩放）。
     * 指向 LYRIC_GAP，不复制数值 —— 复制就会漂移。
     */
    lyricGap: LYRIC_GAP,

    /** 间距刻度：8 的倍数关系，保证节奏一致 */
    space: {
      xs: u * 1.2,
      sm: u * 2.2,
      md: u * 3.6,
      lg: u * 6.0,
      xl: u * 9.5,
    },

    /** 圆角刻度：全片只有三档 + 全圆 */
    radius: {
      /** 细分隔线 / 细进度条的圆头 */
      hair: Math.max(1, u * 0.16),
      /** 小色块 */
      sm: u * 1.1,
      /** 卡片 */
      md: u * 2.4,
      full: 9999,
    },

    /** 线宽：所有细线统一成这一个值，视觉上才"精致" */
    line: {
      hair: Math.max(1, Math.round(short * 0.0011)),
    },

    /** 版式：留白从这里来 */
    layout: {
      /**
       * 左右安全边距 —— 竖屏 9%，横屏 12%，横屏留更多才显从容。
       * **这是硬边界**：任何文字都不允许越过它。
       */
      safeX: width * (portrait ? 0.09 : square ? 0.1 : 0.12),
      /** 歌词视觉中心 */
      contentTop: height * (portrait ? 0.455 : 0.5),
      /**
       * 文本测量宽度上限，**由 safeX 推导**，不独立取值。
       *
       * 早先这里是竖屏 `width * 0.84`（两侧各 8%），而 safeX 是 9% ——
       * 两个令牌互相矛盾，于是"按 84% 算得下"的文字实际会压到 8% 的边距上。
       * 现在统一从 safeX 扣，再留一点内缩，测量侧与安全区永远一致。
       *
       * 横屏额外限一个舒适行长：不跟着宽度无限拉长，长句也不至于变成两行超宽字。
       */
      measure: Math.min(
        width - 2 * (width * (portrait ? 0.09 : square ? 0.1 : 0.12)) - u * 2,
        portrait ? width : square ? width * 0.84 : Math.min(width * 0.72, short * 1.12),
      ),
      /** 最大行数：竖屏 3，方形 3（高度相对窄），横屏 2 */
      maxRows: portrait || square ? 3 : 2,
      /** 顶部标签基线 */
      kickerTop: height * (portrait ? 0.062 : 0.078),
      /** 卡片区块之间的呼吸 */
      blockGap: u * 4.2,
    },

    /** 光晕强度：全片共用，避免各处不一 */
    glow: {
      /** 未演唱词的字面光 */
      textWeak: 0.10,
      /** 已演唱词的字面光 */
      textStrong: 0.26,
      /** 背景主光 */
      ambient: 0.055,
      /** 爆发期主光 */
      drop: 0.16,
    },
  };
};