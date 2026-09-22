/**
 * 偏好模型：类型、默认值、选项表与共享校验函数。
 * 叶子模块（不依赖 preferences/ 内其它文件）。
 */

import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_SCHEME,
  type ThemeMode,
  type ThemeScheme,
} from '../../lib/theme'
import type { CustomSchemePrefs } from '../../lib/customScheme'
import { DEFAULT_TRANSLATION_PREFS } from '../../features/translation/config'
import type { TranslationPrefs } from '../../features/translation/types'
import { DEFAULT_READ_ALOUD_PREFS } from '../../features/readAloud/config'
import type { ReadAloudPrefs } from '../../features/readAloud/types'
import { DEFAULT_PROXY_PREFS } from '../../features/proxy/config'
import type { ProxyPrefs } from '../../features/proxy/types'
import {
  CATEGORIES,
  FAVORITES_CATEGORY_ID,
  PORTAL_CATEGORY_SOURCES,
  PORTAL_VISIBLE_CATEGORY_IDS,
  RECOMMEND_CATEGORY_ID,
  type CategoryId,
  type NewsCategory,
} from '../categories'
import type { NewsSource } from '../registry'

export type FontFamilyId = 'sans' | 'serif' | 'system'

/**
 * 应用外壳（导航 / 设置 / 按钮 / 说明文字）的字体族。
 * 取值都落在 iOS 与桌面系统自带的 CJK 字体上，不依赖联网下载。
 */
export type UiFontFamilyId = 'system' | 'heiti' | 'songti' | 'kaiti' | 'yuanti'

/**
 * 界面字重档位。汉字在 iOS 上默认 400 偏细，这里整体抬升 Tailwind 的
 * `--font-weight-*` 主题变量，不逐个改写工具类。
 */
export type UiFontWeightId = 'regular' | 'medium' | 'bold'

/** 首页信息流版式：经典单栏保持旧版阅读节奏，cards 为新版双栏编辑卡片。 */
export type HomeFeedLayout = 'classic' | 'cards'

export interface TypographyPrefs {
  /** 正文字号倍率，基准 15.5px */
  fontScale: number
  lineHeight: number
  /** 段落间距，单位 em */
  paragraphGap: number
  fontFamily: FontFamilyId
  /** 正文段落首行缩进两字符（2em） */
  firstLineIndent: boolean
}

/**
 * 应用外壳（界面）字体：与 `TypographyPrefs` 分开——那边管正文排版，这里管界面本身。
 * `scale` 由构建期把生成的 px 字号统一挂到 `--ui-scale` 上，源码里没有第二份字号表。
 */
export interface UiPrefs {
  fontFamily: UiFontFamilyId
  /** 界面字号倍率；1 为原样 */
  scale: number
  /** 界面字重档位；regular 与原样一致 */
  weight: UiFontWeightId
  /** 阅读正文页的悬浮上下翻页手柄（可拖动）；true 为开启 */
  floatReaderNav: boolean
}

export const PRESTORE_PER_SOURCE_OPTIONS = [5, 10, 20, 50, 100] as const

export interface PrestorePrefs {
  enabled: boolean
  perSourceLimit: number
}

export interface CategoryNameOverride {
  label: string
  short: string
}

export const DEFAULT_PRESTORE_PREFS: PrestorePrefs = {
  enabled: false,
  perSourceLimit: 10,
}

export function normalizePrestoreLimit(value: unknown): number {
  return typeof value === 'number' && PRESTORE_PER_SOURCE_OPTIONS.some((option) => option === value)
    ? value
    : DEFAULT_PRESTORE_PREFS.perSourceLimit
}

export function normalizePrestorePrefs(raw: unknown): PrestorePrefs {
  const input = (raw ?? {}) as Partial<PrestorePrefs>
  return {
    enabled: input.enabled === true,
    perSourceLimit: normalizePrestoreLimit(input.perSourceLimit),
  }
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  fontFamily: 'system',
  scale: 1,
  weight: 'regular',
  floatReaderNav: true,
}

/** 界面字号允许区间；超出即夹紧，避免旧备份里的极端值把界面撑坏 */
export const UI_SCALE_RANGE = { min: 0.85, max: 1.5 } as const

export function normalizeUiScale(value: unknown): number {
  return clamp(value, DEFAULT_UI_PREFS.scale, UI_SCALE_RANGE.min, UI_SCALE_RANGE.max)
}

export function normalizeUiPrefs(raw: unknown): UiPrefs {
  const input = (raw ?? {}) as Partial<UiPrefs>
  return {
    fontFamily: UI_FONT_OPTIONS.some((option) => option.id === input.fontFamily)
      ? (input.fontFamily as UiFontFamilyId)
      : DEFAULT_UI_PREFS.fontFamily,
    scale: normalizeUiScale(input.scale),
    weight: UI_FONT_WEIGHT_OPTIONS.some((option) => option.id === input.weight)
      ? (input.weight as UiFontWeightId)
      : DEFAULT_UI_PREFS.weight,
    floatReaderNav:
      typeof input.floatReaderNav === 'boolean'
        ? input.floatReaderNav
        : DEFAULT_UI_PREFS.floatReaderNav,
  }
}

export interface Preferences {
  /** 分类展示顺序；未列出的分类按注册表顺序排在后面 */
  categoryOrder: CategoryId[]
  hiddenCategoryIds: CategoryId[]
  /** 分类 → 自定义信源；缺省表示沿用注册表默认 */
  categorySources: Record<CategoryId, string[]>
  /** 内置分类在当前预设内的显示名称覆盖；分类 id 与信源契约保持不变 */
  categoryNames: Record<CategoryId, CategoryNameOverride>
  /** 当前场景预设收藏的信源；由动态「收藏」分类统一展示 */
  favoriteSourceIds: string[]
  /** 用户自建的自定义分类列表 */
  customCategories?: NewsCategory[]
  /** 用户自建或导入的自定义订阅源 */
  customSources?: NewsSource[]
  typography: TypographyPrefs
  /** 应用外壳字体与字号；设备本地项，不参与云同步 */
  ui: UiPrefs
  theme: ThemeMode
  /** 风格方案：与明暗正交的配色主题，见 lib/theme.ts */
  scheme: ThemeScheme
  /** 自定义配色（scheme === 'custom' 时生效）：昼/夜各一组底色与强调色 */
  customScheme?: CustomSchemePrefs
  /** 首页信息流版式。新安装默认 cards；历史偏好缺字段时迁移为 classic。 */
  homeFeedLayout: HomeFeedLayout
  translation: TranslationPrefs
  readAloud: ReadAloudPrefs
  proxy: ProxyPrefs
  /** 切换/滑动到分类页时是否自动刷新（关闭时保留滚动阅读位置） */
  autoRefreshOnCategorySwitch?: boolean
  /**
   * 推荐栏总开关：关闭后所有预设都不显示动态「推荐」分类，普通分类不受影响；
   * 重新打开且预设内阅读仍达标时推荐栏自动恢复。默认开启。
   */
  recommendEnabled?: boolean
  /**
   * 墨水屏模式：关动画/弱化装饰/文章分页。与 theme 正交；默认 false。
   * 关闭后须完整恢复正常模式行为。
   */
  einkMode: boolean
  /** Android：仅 Wi-Fi 下自动加载阅读页图片和视频；默认 false */
  wifiOnlyAutoLoadMedia: boolean
  /** 当前预设的正文预存策略；关闭仅停止更新，不主动删除已预存正文 */
  prestore: PrestorePrefs
}

export const DEFAULT_TYPOGRAPHY: TypographyPrefs = {
  fontScale: 1,
  lineHeight: 1.9,
  paragraphGap: 1.1,
  fontFamily: 'sans',
  firstLineIndent: true,
}

const PORTAL_VISIBLE = new Set<string>(PORTAL_VISIBLE_CATEGORY_IDS)

/**
 * 门户经典默认栏之外的分类；新装 / 重置布局时隐藏。
 * 由 CATEGORIES 减去 PORTAL_VISIBLE_CATEGORY_IDS 派生，避免漏掉新 id。
 * 可见轨：热点 / 独家 / 中文主题栏 / 轻松 / 对应外刊栏；综合默认隐藏。
 * AI、游戏、深度与冷门细分留给场景预设或分类管理。
 */
export const DEFAULT_HIDDEN_CATEGORY_IDS: CategoryId[] = CATEGORIES.map(
  (category) => category.id,
).filter((id) => !PORTAL_VISIBLE.has(id))

export const DEFAULT_PREFERENCES: Preferences = {
  categoryOrder: [...PORTAL_VISIBLE_CATEGORY_IDS],
  hiddenCategoryIds: [...DEFAULT_HIDDEN_CATEGORY_IDS],
  categorySources: { ...PORTAL_CATEGORY_SOURCES },
  categoryNames: {},
  favoriteSourceIds: [],
  customCategories: [],
  customSources: [],
  typography: DEFAULT_TYPOGRAPHY,
  ui: DEFAULT_UI_PREFS,
  theme: DEFAULT_THEME_MODE,
  scheme: DEFAULT_THEME_SCHEME,
  homeFeedLayout: 'cards',
  translation: DEFAULT_TRANSLATION_PREFS,
  readAloud: DEFAULT_READ_ALOUD_PREFS,
  proxy: DEFAULT_PROXY_PREFS,
  autoRefreshOnCategorySwitch: true,
  recommendEnabled: true,
  einkMode: false,
  wifiOnlyAutoLoadMedia: false,
  prestore: DEFAULT_PRESTORE_PREFS,
}

/** 综合分类跟随「频道」页启用状态，不参与逐分类信源编辑 */
export const FOLLOWS_ENABLED_SOURCES: CategoryId = 'mix'

/**
 * 聚合分类：信源由布局推导而非逐分类编辑（综合=频道启用列表；推荐=预设启用信源并集）。
 * 不接受 categorySources 覆盖，持久化时同样跳过。
 */
export function isAggregateCategoryId(categoryId: CategoryId): boolean {
  return (
    categoryId === FOLLOWS_ENABLED_SOURCES ||
    categoryId === FAVORITES_CATEGORY_ID ||
    categoryId === RECOMMEND_CATEGORY_ID
  )
}

export const FONT_FAMILY_OPTIONS: { id: FontFamilyId; label: string; cssVar: string }[] = [
  { id: 'sans', label: '黑体', cssVar: 'var(--font-reader-sans)' },
  { id: 'serif', label: '宋体', cssVar: 'var(--font-reader-serif)' },
  { id: 'system', label: '系统', cssVar: 'var(--font-reader-system)' },
]

export const FONT_SCALE_OPTIONS: { label: string; value: number }[] = [
  { label: '小', value: 0.88 },
  { label: '较小', value: 0.94 },
  { label: '标准', value: 1 },
  { label: '较大', value: 1.1 },
  { label: '大', value: 1.22 },
]

/**
 * 界面字体选项。字体栈只列系统自带字体：
 * iOS 有苹方 / 宋体 / 楷体 / 圆体，桌面端回落到 SimSun / KaiTi，Android 回落到 Noto。
 * `system` 的取值刻意与 index.css 的 `:root` 默认值一致——默认档必须零观感变化。
 */
export const UI_FONT_OPTIONS: {
  id: UiFontFamilyId
  label: string
  /** 界面正文字体栈，写入 --ui-font */
  body: string
  /** 界面标题字体栈，写入 --ui-font-display */
  display: string
}[] = [
  {
    id: 'system',
    label: '默认',
    body: "'Noto Sans SC', 'PingFang SC', system-ui, sans-serif",
    display: "'Noto Serif SC', 'Songti SC', serif",
  },
  {
    id: 'heiti',
    label: '黑体',
    body: "'Heiti SC', 'PingFang SC', 'Noto Sans SC', sans-serif",
    display: "'Heiti SC', 'PingFang SC', sans-serif",
  },
  {
    id: 'songti',
    label: '宋体',
    body: "'Songti SC', 'Noto Serif SC', 'SimSun', serif",
    display: "'Songti SC', 'Noto Serif SC', serif",
  },
  {
    id: 'kaiti',
    label: '楷体',
    body: "'Kaiti SC', 'STKaiti', 'KaiTi', serif",
    display: "'Kaiti SC', 'STKaiti', 'KaiTi', serif",
  },
  {
    id: 'yuanti',
    label: '圆体',
    body: "'Yuanti SC', 'YouYuan', 'PingFang SC', sans-serif",
    display: "'Yuanti SC', 'YouYuan', 'PingFang SC', sans-serif",
  },
]

/** 界面字号档位：界面里最小的一批字只有 10px，所以向上给了更大的步长 */
export const UI_SCALE_OPTIONS: { label: string; value: number }[] = [
  { label: '较小', value: 0.92 },
  { label: '标准', value: 1 },
  { label: '较大', value: 1.1 },
  { label: '大', value: 1.2 },
  { label: '特大', value: 1.32 },
]

/** 取界面字体选项；未知 id 回落到默认档，保证 CSS 变量永远有值 */
export function resolveUiFontOption(id: UiFontFamilyId): (typeof UI_FONT_OPTIONS)[number] {
  return UI_FONT_OPTIONS.find((option) => option.id === id) ?? UI_FONT_OPTIONS[0]
}

/**
 * 界面字重档位。`data-ui-weight` 的取值直接对应 index.css 里的
 * `:root[data-ui-weight='…']` 覆盖块，因此 id 不能随手改。
 * regular 不加 data 属性也行（默认值就是 Tailwind 缺省），但为可读性仍然会写。
 */
export const UI_FONT_WEIGHT_OPTIONS: {
  id: UiFontWeightId
  label: string
  caption: string
}[] = [
  { id: 'regular', label: '标准', caption: '与原样一致' },
  { id: 'medium', label: '中粗', caption: '整体加粗一档' },
  { id: 'bold', label: '加粗', caption: '整体加粗两档' },
]

export const LINE_HEIGHT_OPTIONS: { label: string; value: number }[] = [
  { label: '紧凑', value: 1.65 },
  { label: '标准', value: 1.9 },
  { label: '舒展', value: 2.15 },
]

export const PARAGRAPH_GAP_OPTIONS: { label: string; value: number }[] = [
  { label: '紧凑', value: 0.8 },
  { label: '标准', value: 1.1 },
  { label: '宽松', value: 1.5 },
]

export function uniqueValid(ids: unknown, known: Set<string>): string[] {
  if (!Array.isArray(ids)) return []
  const valid = ids.filter((id): id is string => typeof id === 'string' && known.has(id))
  return [...new Set(valid)]
}

export function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
