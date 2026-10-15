/**
 * WebView / Chrome 69 CSS post-process helpers shared by vite build + tests.
 *
 * Tailwind v4 relies on `@property` initial values and `:where()` selectors.
 * Our build strips `@property` for Chrome < 85; lightningcss does not unwrap
 * `:where()` even when targeting Chrome 69. Without these fixes, utilities like
 * `divide-y` / `divide-haze` silently drop on Android WebView.
 */

/**
 * Replace `:where(inner)` with `inner`, balancing parentheses so nested
 * selectors like `:not(:last-child)` survive.
 */
export function unwrapWhereSelectors(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    if (css.startsWith(':where(', i)) {
      const start = i + ':where('.length
      let depth = 1
      let j = start
      while (j < css.length && depth > 0) {
        const ch = css[j]
        if (ch === '(') depth += 1
        else if (ch === ')') depth -= 1
        j += 1
      }
      out += css.slice(start, j - 1)
      i = j
      continue
    }
    out += css[i]
    i += 1
  }
  return out
}

/**
 * After `@property` is stripped, Tailwind's variable defaults live only inside a
 * complex `@supports` gate that some Android WebViews do not match. Inject an
 * unconditional fallback so border/divide/space utilities keep working.
 */
export const TW_VAR_FALLBACK_CSS =
  '*,:before,:after,::backdrop{--tw-translate-x:0px;--tw-translate-y:0px;--tw-legacy-scale-x:1;--tw-legacy-scale-y:1;--tw-legacy-rotate:0deg;--tw-border-style:solid;--tw-divide-y-reverse:0;--tw-space-y-reverse:0;--tw-space-x-reverse:0;--tw-gradient-position:initial;--tw-gradient-from:#0000;--tw-gradient-via:#0000;--tw-gradient-to:#0000;--tw-gradient-stops:initial;--tw-gradient-via-stops:initial;--tw-gradient-from-position:0%;--tw-gradient-via-position:50%;--tw-gradient-to-position:100%}'

/**
 * Tailwind 4 的独立 translate/rotate/scale 属性需要 Chrome 104+，
 * 但 NewsNook 仍支持 WebView 69。对已生成的工具类添加传统 transform：
 * - 使用各轴位移变量，覆盖弹层居中、标签移动和其他交互；
 * - 将 scale 百分比转换为旧内核可接受的无单位数字；
 * - 将旋转角度写入组合 transform，确保与位移/缩放叠加。
 * 在支持独立变换的现代 WebView 中不启用，防止重复变换。
 */
export function legacyMotionFallbackCss(css: string): string {
  const transform = 'transform:translate(var(--tw-translate-x,0px),var(--tw-translate-y,0px)) rotate(var(--tw-legacy-rotate,0deg)) scale(var(--tw-legacy-scale-x,1),var(--tw-legacy-scale-y,1))'
  const fallbacks: string[] = []
  const rules = /([^{}]+)\{([^{}]*)\}/g
  for (const match of css.matchAll(rules)) {
    const selector = match[1].trim()
    const body = match[2]
    if (!selector.startsWith('.') || /\btransform\s*:/.test(body)) continue

    const translated = /\btranslate:\s*var\(--tw-translate-x\)\s+var\(--tw-translate-y\)/.test(body)
    const scalar = body.match(/\bscale:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:;|$)/)
    const scaleX = body.match(/--tw-scale-x:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))%/)
    const scaleY = body.match(/--tw-scale-y:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))%/)
    const rotation = body.match(/\brotate:\s*(-?(?:\d+(?:\.\d+)?|\.\d+)deg)\s*(?:;|$)/)
    if (!translated && !scalar && !scaleX && !scaleY && !rotation) continue

    const declarations: string[] = []
    if (scalar) {
      declarations.push(`--tw-legacy-scale-x:${scalar[1]}`, `--tw-legacy-scale-y:${scalar[1]}`)
    } else {
      if (scaleX) declarations.push(`--tw-legacy-scale-x:${Number(scaleX[1]) / 100}`)
      if (scaleY) declarations.push(`--tw-legacy-scale-y:${Number(scaleY[1]) / 100}`)
    }
    if (rotation) declarations.push(`--tw-legacy-rotate:${rotation[1]}`)
    fallbacks.push(`${selector}{${[...declarations, transform].join(';')}}`)
  }
  return fallbacks.length ? `@supports not (translate: 0px 0px) {\n${fallbacks.join('\n')}\n}` : ''
}

export function applyWebViewCssCompat(css: string): string {
  const normalized = unwrapWhereSelectors(css)
  return `${normalized}\n${TW_VAR_FALLBACK_CSS}\n${legacyMotionFallbackCss(normalized)}\n`
}
