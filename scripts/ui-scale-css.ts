/**
 * 界面字号缩放：把构建产物里所有 px 字号统一挂到 `--ui-scale` 上。
 *
 * 界面（应用外壳）的字号在源码里是近千处硬编码的 `text-[Npx]`，
 * 逐个改写成 rem / calc 会让 iOS 补丁层在每次跟上游版本时都冲突。
 * 因此在产物 CSS 上做一次统一变换，源码保持零改动。
 *
 * 只匹配前面是 `{` 或 `;` 的 `font-size`，这样 `--reader-font-size` 这类自定义属性
 * 不会被误伤；阅读排版全部写成 `calc(var(--reader-font-size) * N)`，本来就不含 px。
 *
 * 输出保留原始 px 声明在前、`calc()` 覆盖在后：解析不了 `calc()` 乘法或没有
 * `--ui-scale` 的旧内核会退回原始字号，而不是丢掉整条声明。
 * （`calc(<长度> * <数>)` 在本项目的目标内核上本来就在用，见 index.css 的
 * `.reader-title { font-size: calc(var(--reader-font-size) * 1.74) }`。）
 */

/** 前导字符限定为 `{` 或 `;`，把 `--reader-font-size:` 之类的自定义属性排除在外 */
const FONT_SIZE_PX = /([;{])(\s*)font-size:\s*([0-9.]+)px(\s*!important)?/g

/** 本函数独有的产物标记；出现即说明这份 CSS 已经处理过 */
const MARKER = 'var(--ui-scale, 1)'

export function applyUiScale(css: string): string {
  // 幂等：标记只可能由本函数写入，重复调用不会把 calc() 叠成两层
  if (css.includes(MARKER)) return css

  return css.replace(
    FONT_SIZE_PX,
    (_match, lead: string, gap: string, size: string, important: string | undefined) => {
      const flag = important ?? ''
      return (
        `${lead}${gap}font-size:${size}px${flag};` +
        `font-size:calc(${size}px * var(--ui-scale, 1))${flag}`
      )
    },
  )
}
