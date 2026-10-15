/**
 * 形式化编辑期刊封面配置与生成器 (Procedural Editorial Cover System)
 *
 * 为无图文章提供确定性、高雅多样、具备现代独立刊物装帧美感的矢量封面，
 * 解决双列与网格流中因图文混排导致的高度参差失衡，
 * 同时延续 NewsNook 宣纸、墨问、朱砂的人文美学。
 */

import type { Article } from './types'

export type EditorialMotif =
  | 'seal'        // 金石朱印 · Classical Seal Monogram
  | 'celestial'   // 天体星轨 · Celestial Orbitals
  | 'grid-swiss'  // 瑞士网格 · Swiss Typographic Grid
  | 'waves'       // 水墨等高 · Topographic Ink Waves
  | 'bauhaus'     // 包豪斯构 · Bauhaus Abstract Harmony
  | 'fluted'      // 建筑柱光 · Architectural Fluted Louver
  | 'halftone'    // 丝网星尘 · Stardust Halftone Matrix
  | 'bookplate'   // 典雅藏书 · Ex Libris Bookplate

export interface EditorialPalette {
  id: string
  name: string
  /** 夜读（深色模式）配色 */
  dark: {
    bgStart: string
    bgEnd: string
    accent: string
    accentSoft: string
    line: string
    lineSubtle: string
    text: string
  }
  /** 昼读（浅色模式）配色 */
  light: {
    bgStart: string
    bgEnd: string
    accent: string
    accentSoft: string
    line: string
    lineSubtle: string
    text: string
  }
}

/** 8 组源于中国传统矿物色与现代期刊设计的低饱和莫兰迪色系 */
export const EDITORIAL_PALETTES: readonly EditorialPalette[] = [
  {
    id: 'slate-ink',
    name: '墨韵玄青',
    dark: {
      bgStart: '#14181f',
      bgEnd: '#0d1015',
      accent: '#7b9ebc',
      accentSoft: '#3d4f61',
      line: 'rgba(123, 158, 188, 0.38)',
      lineSubtle: 'rgba(123, 158, 188, 0.14)',
      text: '#c9d8e5',
    },
    light: {
      bgStart: '#f0f3f6',
      bgEnd: '#e3e8ee',
      accent: '#3f5971',
      accentSoft: '#b5c5d4',
      line: 'rgba(63, 89, 113, 0.32)',
      lineSubtle: 'rgba(63, 89, 113, 0.12)',
      text: '#283847',
    },
  },
  {
    id: 'celadon-glaze',
    name: '汝窑天青',
    dark: {
      bgStart: '#121a18',
      bgEnd: '#0c1211',
      accent: '#6ea69e',
      accentSoft: '#37524e',
      line: 'rgba(110, 166, 158, 0.36)',
      lineSubtle: 'rgba(110, 166, 158, 0.14)',
      text: '#cce3e0',
    },
    light: {
      bgStart: '#edf3f1',
      bgEnd: '#dfeae6',
      accent: '#376861',
      accentSoft: '#a9c5bf',
      line: 'rgba(55, 104, 97, 0.30)',
      lineSubtle: 'rgba(55, 104, 97, 0.12)',
      text: '#22403b',
    },
  },
  {
    id: 'cinnabar-sand',
    name: '朱砂沉檀',
    dark: {
      bgStart: '#1b1313',
      bgEnd: '#110c0c',
      accent: '#c96f60',
      accentSoft: '#633730',
      line: 'rgba(201, 111, 96, 0.38)',
      lineSubtle: 'rgba(201, 111, 96, 0.14)',
      text: '#edd2cf',
    },
    light: {
      bgStart: '#f7eeec',
      bgEnd: '#eee0dd',
      accent: '#a34839',
      accentSoft: '#d8aba3',
      line: 'rgba(163, 72, 57, 0.30)',
      lineSubtle: 'rgba(163, 72, 57, 0.12)',
      text: '#5c271e',
    },
  },
  {
    id: 'amber-ochre',
    name: '琥珀流金',
    dark: {
      bgStart: '#1a1610',
      bgEnd: '#110e0a',
      accent: '#c49a5b',
      accentSoft: '#5e492b',
      line: 'rgba(196, 154, 91, 0.38)',
      lineSubtle: 'rgba(196, 154, 91, 0.14)',
      text: '#ede1cf',
    },
    light: {
      bgStart: '#f7f3ec',
      bgEnd: '#ede5d8',
      accent: '#946d33',
      accentSoft: '#d5bea1',
      line: 'rgba(148, 109, 51, 0.30)',
      lineSubtle: 'rgba(148, 109, 51, 0.12)',
      text: '#543d1a',
    },
  },
  {
    id: 'pine-moss',
    name: '松烟竹翠',
    dark: {
      bgStart: '#111915',
      bgEnd: '#0a110e',
      accent: '#6da689',
      accentSoft: '#335243',
      line: 'rgba(109, 166, 137, 0.36)',
      lineSubtle: 'rgba(109, 166, 137, 0.14)',
      text: '#cde3d6',
    },
    light: {
      bgStart: '#edf3ef',
      bgEnd: '#dfeae2',
      accent: '#356e52',
      accentSoft: '#a6c6b4',
      line: 'rgba(53, 110, 82, 0.30)',
      lineSubtle: 'rgba(53, 110, 82, 0.12)',
      text: '#1f4532',
    },
  },
  {
    id: 'dusk-violet',
    name: '暮山紫霭',
    dark: {
      bgStart: '#18121a',
      bgEnd: '#0f0b11',
      accent: '#9c73ad',
      accentSoft: '#4d3756',
      line: 'rgba(156, 115, 173, 0.36)',
      lineSubtle: 'rgba(156, 115, 173, 0.14)',
      text: '#e2d3e8',
    },
    light: {
      bgStart: '#f4edf5',
      bgEnd: '#e9ddeb',
      accent: '#724785',
      accentSoft: '#c2a8ce',
      line: 'rgba(114, 71, 133, 0.30)',
      lineSubtle: 'rgba(114, 71, 133, 0.12)',
      text: '#452654',
    },
  },
  {
    id: 'midnight-azure',
    name: '霁蓝星野',
    dark: {
      bgStart: '#121621',
      bgEnd: '#0a0d15',
      accent: '#6d8db8',
      accentSoft: '#344761',
      line: 'rgba(109, 141, 184, 0.36)',
      lineSubtle: 'rgba(109, 141, 184, 0.14)',
      text: '#d0dded',
    },
    light: {
      bgStart: '#eef2f7',
      bgEnd: '#e0e7f1',
      accent: '#395a85',
      accentSoft: '#abc0d9',
      line: 'rgba(57, 90, 133, 0.30)',
      lineSubtle: 'rgba(57, 90, 133, 0.12)',
      text: '#203550',
    },
  },
  {
    id: 'raw-parchment',
    name: '素宣研墨',
    dark: {
      bgStart: '#161617',
      bgEnd: '#0e0e0f',
      accent: '#a19a8e',
      accentSoft: '#4d4943',
      line: 'rgba(161, 154, 142, 0.36)',
      lineSubtle: 'rgba(161, 154, 142, 0.14)',
      text: '#e3dfd8',
    },
    light: {
      bgStart: '#f5f3ec',
      bgEnd: '#eae6dd',
      accent: '#635d52',
      accentSoft: '#c4beb3',
      line: 'rgba(99, 93, 82, 0.30)',
      lineSubtle: 'rgba(99, 93, 82, 0.12)',
      text: '#3b372f',
    },
  },
] as const

export const EDITORIAL_MOTIFS: readonly EditorialMotif[] = [
  'seal',
  'celestial',
  'grid-swiss',
  'waves',
  'bauhaus',
  'fluted',
  'halftone',
  'bookplate',
] as const

export interface EditorialCoverConfig {
  /** 稳定哈希种子 */
  seed: number
  /** 配色板 */
  palette: EditorialPalette
  /** 形式美学原型 */
  motif: EditorialMotif
  /** 提取的刊印单字（中文宋体/大写字母） */
  monogram: string
  /** 期刊号，如 "№ 07" */
  issueTag: string
  /** 副标，如 "VOL. 03" */
  volumeTag: string
  /** 出版信源标签简写 */
  imprintLabel: string
  /** 渐变倾角（0, 45, 90, 135 ...） */
  gradientAngle: number
}

/** 极速同步字符串 32 位正整数哈希 (DJB2 变体) */
export function stringToHash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

/**
 * 从信源名称或标题中提取一个最有气质的单字：
 * - 优先取信源名称里的首个表意汉字或英文字母（如“无业游民” -> “无”；“财联社” -> “财”；“BBC” -> “B”）
 * - 次优从标题中提取
 * - 兜底为“闻”
 */
export function extractMonogram(sourceLabel?: string, title?: string): string {
  if (sourceLabel) {
    // 过滤掉所有空格、标点符号、emoji、特殊符号
    const cleanSource = sourceLabel.replace(/[\s\d\p{P}\p{S}]/gu, '')
    if (cleanSource.length > 0) {
      return cleanSource[0]!.toUpperCase()
    }
  }

  if (title) {
    const cleanTitle = title.replace(/[\s\d\p{P}\p{S}]/gu, '')
    if (cleanTitle.length > 0) {
      return cleanTitle[0]!.toUpperCase()
    }
  }

  return '闻'
}

/** 生成信源刊记短名，控制在 4-8 个字符以内，适合极小号排版水印 */
export function formatImprintLabel(sourceLabel?: string): string {
  if (!sourceLabel) return 'CHRONICLE'
  const trimmed = sourceLabel.trim().replace(/[《》【】[\]()]/g, '')
  if (trimmed.length <= 8) return trimmed
  return trimmed.slice(0, 7) + '…'
}

/**
 * 根据文章元数据计算确定性的期刊封面设计配置
 */
export function getEditorialCoverConfig(article: Partial<Article>): EditorialCoverConfig {
  const identity = `${article.id || ''}::${article.sourceId || ''}::${article.title || ''}`
  const seed = stringToHash(identity)

  const paletteIndex = seed % EDITORIAL_PALETTES.length
  const motifIndex = Math.floor(seed / 11) % EDITORIAL_MOTIFS.length

  const issueNum = String(1 + (seed % 99)).padStart(2, '0')
  const volNum = String(1 + ((seed >> 4) % 12)).padStart(2, '0')

  const gradientAngle = ((seed >> 2) % 8) * 45

  const monogram = extractMonogram(article.sourceLabel, article.title)
  const imprintLabel = formatImprintLabel(article.sourceLabel)

  return {
    seed,
    palette: EDITORIAL_PALETTES[paletteIndex]!,
    motif: EDITORIAL_MOTIFS[motifIndex]!,
    monogram,
    issueTag: `№ ${issueNum}`,
    volumeTag: `VOL. ${volNum}`,
    imprintLabel,
    gradientAngle,
  }
}
