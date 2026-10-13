import { resolveAiFeatureConfig } from './aiConfig'
import { normalizeChineseVariant } from './chineseVariant'
import { cleanOpenAiTranslation } from './openai'
import { detectLanguage, sampleTextForDetection } from './detectLanguage'
import { createTranslationProvider } from './providers'
import type {
  TranslateArticleOptions,
  TranslatedArticleContent,
  TranslationLanguage,
  TranslationPrefs,
  TranslationProvider,
  TranslationProviderId,
  TranslationSourceLanguage,
} from './types'
import { isLocalTranslationProviderId } from './types'

const SKIP_PARENTS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'])
/** 最内层语义块：既用于对比翻译的取块，也用于给段落内的多个文本节点分组。 */
const SEMANTIC_BLOCK_SELECTOR =
  'p,li,h1,h2,h3,h4,blockquote,figcaption,td,th,div,section,article'

/**
 * 单个「段落」的字符上界，同时也是超长文本的切分粒度。
 *
 * 免费端点（Edge `translatetext`）的耗时随请求体积上涨，脚本转换比翻译更明显：
 * 实测同一体积下繁→简要 ~15 秒而英译中只要 ~7 秒，超过 ~24k 字符直接 HTTP 500。
 * 批次本来有 `DEFAULT_BATCH_CHARS` 兜底，但它只在段落边界切——段落本身无上界时，
 * 「整篇正文塞在一个 div 里」就会变成一次几十 KB 的请求，于是超时。
 * 所以段落的原子性只保证到 3000 字符：再长就切开发，请求体积才真的有上界。
 */
export const MAX_GROUP_CHARS = 3000

function shouldTranslate(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && /[\p{L}\p{N}]/u.test(trimmed)
}

function trimParts(text: string): { prefix: string; content: string; suffix: string } {
  const content = text.trim()
  const start = text.indexOf(content)
  return {
    prefix: text.slice(0, start),
    content,
    suffix: text.slice(start + content.length),
  }
}

function isBlocked(element: Element): boolean {
  return [...SKIP_PARENTS].some((tag) => element.closest(tag.toLowerCase()))
}

function finalizeTranslatedText(text: string, targetLanguage: TranslationLanguage): string {
  return normalizeChineseVariant(cleanOpenAiTranslation(text), targetLanguage)
}

/** 句末标点：切分超长文本时优先落在这里，避免把一句话劈成两半。 */
function isSentenceBreak(text: string, index: number): boolean {
  const char = text[index]
  if (char === '\n') return true
  if ('。！？；…'.includes(char)) return true
  if ('.!?;'.includes(char)) {
    const next = text[index + 1]
    return next === undefined || /\s/.test(next)
  }
  return false
}

/**
 * 把超长文本切成不超过 `maxChars` 的片段，优先切在句末标点之后。
 * 单句本身就超长时按长度硬切——总比发一个几十 KB 的请求好。
 * 每个片段不小于 `maxChars` 的一半，避免标点密集的文本被切成一堆碎片。
 */
export function splitLongText(text: string, maxChars: number): string[] {
  if (maxChars <= 0 || text.length <= maxChars) return [text]
  const chunks: string[] = []
  const minChunk = Math.max(1, Math.floor(maxChars / 2))
  let start = 0
  while (text.length - start > maxChars) {
    const limit = start + maxChars
    let cut = -1
    for (let index = limit; index > start + minChunk; index -= 1) {
      if (isSentenceBreak(text, index - 1)) {
        cut = index
        break
      }
    }
    if (cut <= start) cut = limit
    chunks.push(text.slice(start, cut))
    start = cut
  }
  if (start < text.length) chunks.push(text.slice(start))
  return chunks
}

/**
 * 把超长文本节点就地切成若干兄弟节点（尽量切在句末），返回切分后的顺序节点。
 * 切开后每片各自成组，因此可以分批送出；翻译完按顺序填回，
 * 读者看到的是逐片补齐，而不是一次几十 KB 的请求卡到超时。
 * 这里手写插入而不用 `Text.splitText()`：linkedom（测试环境）没有实现它。
 */
function splitOversizedTextNode(node: Text, maxChars: number): Text[] {
  if (node.data.length <= maxChars) return [node]
  const parent = node.parentNode
  const ownerDocument = node.ownerDocument
  if (!parent || !ownerDocument) return [node]
  const chunks = splitLongText(node.data, maxChars)
  node.data = chunks[0]
  const pieces: Text[] = [node]
  let anchor: Node = node
  for (let index = 1; index < chunks.length; index += 1) {
    const piece = ownerDocument.createTextNode(chunks[index])
    parent.insertBefore(piece, anchor.nextSibling)
    pieces.push(piece)
    anchor = piece
  }
  return pieces
}

export function resolveSourceLanguage(
  sourceLanguage: TranslationSourceLanguage,
  providerId: TranslationProviderId,
  sample: string,
): { sourceLanguage: TranslationSourceLanguage; usedFallback: boolean } {
  if (sourceLanguage !== 'auto') {
    return { sourceLanguage, usedFallback: false }
  }
  if (!isLocalTranslationProviderId(providerId)) {
    return { sourceLanguage: 'auto', usedFallback: false }
  }
  const detected = detectLanguage(sample)
  return { sourceLanguage: detected.language, usedFallback: detected.usedFallback }
}

export class TranslationService {
  private readonly provider: TranslationProvider

  constructor(provider: TranslationProvider) {
    this.provider = provider
  }

  async translateArticle(
    title: string,
    html: string,
    prefs: Pick<TranslationPrefs, 'sourceLanguage' | 'targetLanguage' | 'displayMode'>,
    options?: TranslateArticleOptions,
  ): Promise<TranslatedArticleContent> {
    const sample = sampleTextForDetection(title, html)
    const resolved = resolveSourceLanguage(prefs.sourceLanguage, this.provider.id, sample)
    const resolvedPrefs = {
      ...prefs,
      sourceLanguage: resolved.sourceLanguage,
    }
    const document = new DOMParser().parseFromString(
      `<!doctype html><html><body>${html}</body></html>`,
      'text/html',
    )
    const content =
      prefs.displayMode === 'compare'
        ? await this.translateComparison(document, title, resolvedPrefs, options)
        : await this.translateReplacement(document, title, resolvedPrefs, options)
    return {
      ...content,
      resolvedSourceLanguage: resolved.sourceLanguage,
      usedFallback: resolved.usedFallback,
    }
  }

  private async translateReplacement(
    document: Document,
    title: string,
    prefs: Pick<TranslationPrefs, 'sourceLanguage' | 'targetLanguage'>,
    options?: TranslateArticleOptions,
  ): Promise<TranslatedArticleContent> {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const candidates: Text[] = []
    let current = walker.nextNode()

    while (current) {
      const node = current as Text
      const parent = node.parentElement
      if (parent && !isBlocked(parent) && shouldTranslate(node.data)) candidates.push(node)
      current = walker.nextNode()
    }

    // 超长文本节点先就地切开，段落才有字符上界（见 MAX_GROUP_CHARS）。
    const nodes = candidates.flatMap((node) => splitOversizedTextNode(node, MAX_GROUP_CHARS))
    const parts = nodes.map((node) => trimParts(node.data))

    /**
     * 段落分组：`<p>正文 <a>链接</a> 结尾</p>` 会被拆成多个文本节点，
     * 若它们落在不同批次，读者会先看到「半段译文 + 半段原文」。
     * 同组文本永远同批送出，批次因此在组边界上切。
     * 组内字符数同时封顶，否则「整篇一个 div」的正文会变成一次几十 KB 的请求。
     */
    const groupIds: number[] = [0]
    let nextGroupId = 0
    let groupBlock: Element | null = null
    let groupChars = 0

    for (const node of nodes) {
      const block = node.parentElement?.closest(SEMANTIC_BLOCK_SELECTOR) ?? null
      // 没有块级祖先的裸文本节点各自成组。
      if (block === null || block !== groupBlock || groupChars + node.data.length > MAX_GROUP_CHARS) {
        nextGroupId += 1
        groupBlock = block
        groupChars = 0
      }
      groupChars += node.data.length
      groupIds.push(nextGroupId)
    }

    const texts = [title.trim(), ...parts.map((part) => part.content)]
    let currentTitle = title
    let completedCount = 0
    let lastPartialAt = 0

    options?.onProgress?.({ completed: 0, total: texts.length })
    let translations: string[]
    try {
      translations = await this.provider.translate({
        texts,
        groupIds,
        sourceLanguage: prefs.sourceLanguage,
        targetLanguage: prefs.targetLanguage,
        signal: options?.signal,
        onBatch: (batchTranslations, startIndex) => {
          batchTranslations.forEach((translatedText, i) => {
            const textIndex = startIndex + i
            const normalized = finalizeTranslatedText(translatedText, prefs.targetLanguage)
            if (textIndex === 0) {
              currentTitle = normalized
            } else {
              const nodeIndex = textIndex - 1
              const node = nodes[nodeIndex]
              const part = parts[nodeIndex]
              if (node && part) {
                node.data = `${part.prefix}${normalized}${part.suffix}`
                node.parentElement?.setAttribute('data-translated', 'true')
              }
            }
          })
          completedCount += batchTranslations.length
          options?.onProgress?.({ completed: completedCount, total: texts.length })
          // 序列化整篇 HTML 很贵：约 120ms 节流一次，最后一批必发
          const now = Date.now()
          const isLast = completedCount >= texts.length
          if (options?.onPartial && (isLast || now - lastPartialAt >= 120)) {
            lastPartialAt = now
            options.onPartial({ title: currentTitle, html: document.body.innerHTML })
          }
        },
      })
    } catch (error) {
      // Provider 会尽量完成其它段落后再汇总失败；异常离开前把最后状态强制交给 Reader，
      // 避免 120ms 的序列化节流吞掉刚刚成功的末尾段落。
      if (completedCount > 0 && options?.onPartial) {
        options.onPartial({ title: currentTitle, html: document.body.innerHTML })
      }
      throw error
    }
    if (translations.length !== texts.length) throw new Error('翻译服务返回的段落数量不匹配')

    nodes.forEach((node, index) => {
      const part = parts[index]
      const normalized = finalizeTranslatedText(translations[index + 1], prefs.targetLanguage)
      node.data = `${part.prefix}${normalized}${part.suffix}`
      node.parentElement?.setAttribute('data-translated', 'true')
    })
    options?.onProgress?.({ completed: texts.length, total: texts.length })
    return {
      title: finalizeTranslatedText(translations[0] ?? currentTitle, prefs.targetLanguage),
      html: document.body.innerHTML,
    }
  }

  private async translateComparison(
    document: Document,
    title: string,
    prefs: Pick<TranslationPrefs, 'sourceLanguage' | 'targetLanguage'>,
    options?: TranslateArticleOptions,
  ): Promise<TranslatedArticleContent> {
    // 只选最内层语义块，避免 blockquote > p、li > p 等结构被重复翻译。
    const semanticBlocks = Array.from(
      document.body.querySelectorAll<HTMLElement>(SEMANTIC_BLOCK_SELECTOR),
    ).filter(
      (element) =>
        !isBlocked(element) &&
        !element.querySelector(SEMANTIC_BLOCK_SELECTOR) &&
        shouldTranslate(element.textContent ?? ''),
    )
    const blocks =
      semanticBlocks.length || !shouldTranslate(document.body.textContent ?? '')
        ? semanticBlocks
        : [document.body]
    /**
     * 对比模式一个语义块一条，块本身仍然可能很长（「整篇一个 div」），
     * 所以同样按 `MAX_GROUP_CHARS` 切分，译文按块拼回去。
     */
    const blockPieces: string[][] = blocks.map(() => [])
    const items: { blockIndex: number; chunkIndex: number; text: string }[] = []
    blocks.forEach((block, blockIndex) => {
      for (const chunk of splitLongText((block.textContent ?? '').trim(), MAX_GROUP_CHARS)) {
        items.push({ blockIndex, chunkIndex: blockPieces[blockIndex].length, text: chunk })
        blockPieces[blockIndex].push('')
      }
    })
    const texts = [title.trim(), ...items.map((item) => item.text)]
    let currentTitle = title
    let completedCount = 0
    let lastPartialAt = 0

    const renderBlock = (blockIndex: number) => {
      const block = blocks[blockIndex]
      const translated = blockPieces[blockIndex].join('')
      if (!block || !translated) return
      let translationSpan = block.querySelector<HTMLElement>(':scope > .reader-translation')
      if (!translationSpan) {
        translationSpan = document.createElement('span')
        translationSpan.className = 'reader-translation'
        translationSpan.lang = prefs.targetLanguage
        block.append(translationSpan)
      }
      translationSpan.textContent = translated
      block.setAttribute('data-translated', 'true')
    }
    const applyTranslation = (textIndex: number, translatedText: string) => {
      const normalized = finalizeTranslatedText(translatedText, prefs.targetLanguage)
      if (textIndex === 0) {
        currentTitle = normalized
        return
      }
      const item = items[textIndex - 1]
      if (!item) return
      blockPieces[item.blockIndex][item.chunkIndex] = normalized
      renderBlock(item.blockIndex)
    }

    options?.onProgress?.({ completed: 0, total: texts.length })
    let translations: string[]
    try {
      translations = await this.provider.translate({
        texts,
        sourceLanguage: prefs.sourceLanguage,
        targetLanguage: prefs.targetLanguage,
        signal: options?.signal,
        onBatch: (batchTranslations, startIndex) => {
          batchTranslations.forEach((translatedText, i) => {
            applyTranslation(startIndex + i, translatedText)
          })
          completedCount += batchTranslations.length
          options?.onProgress?.({ completed: completedCount, total: texts.length })
          const now = Date.now()
          const isLast = completedCount >= texts.length
          if (options?.onPartial && (isLast || now - lastPartialAt >= 120)) {
            lastPartialAt = now
            options.onPartial({ title: currentTitle, html: document.body.innerHTML })
          }
        },
      })
    } catch (error) {
      if (completedCount > 0 && options?.onPartial) {
        options.onPartial({ title: currentTitle, html: document.body.innerHTML })
      }
      throw error
    }
    if (translations.length !== texts.length) throw new Error('翻译服务返回的段落数量不匹配')

    translations.slice(1).forEach((translatedText, index) => {
      applyTranslation(index + 1, translatedText)
    })
    options?.onProgress?.({ completed: texts.length, total: texts.length })
    return {
      title: finalizeTranslatedText(translations[0] ?? currentTitle, prefs.targetLanguage),
      html: document.body.innerHTML,
    }
  }
}

export function createTranslationService(prefs: TranslationPrefs): TranslationService {
  const config = isLocalTranslationProviderId(prefs.provider)
    ? undefined
    : prefs.provider === 'openai'
      ? resolveAiFeatureConfig(prefs, 'translation')
      : prefs.cloud[prefs.provider]
  return new TranslationService(createTranslationProvider(prefs.provider, config))
}
