import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  EDITORIAL_MOTIFS,
  EDITORIAL_PALETTES,
  extractMonogram,
  formatImprintLabel,
  getEditorialCoverConfig,
  stringToHash,
} from '../src/lib/editorialCover'

describe('editorialCover generator and diversity tests', () => {
  it('deterministic hash generation', () => {
    const textA = 'article-123::source-abc::帝国与地瓜'
    const hash1 = stringToHash(textA)
    const hash2 = stringToHash(textA)
    assert.equal(hash1, hash2, 'Hash must be strictly deterministic')
    assert.ok(hash1 >= 0, 'Hash should be non-negative')
  })

  it('monogram extraction handles various sources and titles', () => {
    assert.equal(extractMonogram('无业游民', '帝国与地瓜'), '无')
    assert.equal(extractMonogram('财联社', '午间要闻'), '财')
    assert.equal(extractMonogram('BBC News', 'Global economy report'), 'B')
    assert.equal(extractMonogram('【晚点 LatePost】', '大厂故事'), '晚')
    assert.equal(extractMonogram('《读书》杂志', '卷首语'), '读')
    assert.equal(extractMonogram('', '出乎意料的第一封信'), '出')
    assert.equal(extractMonogram('', ''), '闻')
  })

  it('formatImprintLabel trims properly for watermarks', () => {
    assert.equal(formatImprintLabel('无业游民'), '无业游民')
    assert.equal(formatImprintLabel('【很长很长的信源名字超过了八个字】'), '很长很长的信源…')
    assert.equal(formatImprintLabel(''), 'CHRONICLE')
  })

  it('generates consistent EditorialCoverConfig for the same article', () => {
    const article = {
      id: 'post-101',
      title: '帝国与地瓜：间隔年的故事，让我很有感触',
      sourceLabel: '无业游民',
      sourceId: 'wuyeyoumin',
    }

    const config1 = getEditorialCoverConfig(article)
    const config2 = getEditorialCoverConfig(article)

    assert.equal(config1.seed, config2.seed)
    assert.equal(config1.monogram, '无')
    assert.equal(config1.motif, config2.motif)
    assert.equal(config1.palette.id, config2.palette.id)
    assert.equal(config1.issueTag, config2.issueTag)
    assert.equal(config1.volumeTag, config2.volumeTag)
    assert.match(config1.issueTag, /^№ \d{2}$/)
    assert.match(config1.volumeTag, /^VOL\. \d{2}$/)
  })

  it('distributes across diverse motifs and palettes across multiple articles', () => {
    const sampleArticles = [
      { id: '1', title: '帝国与地瓜：间隔年的故事，让我很有感触', sourceLabel: '无业游民' },
      { id: '2', title: '出乎意料的，我们收到了第一封听友来信', sourceLabel: '无业游民' },
      { id: '3', title: '开始的故事', sourceLabel: '无业游民' },
      { id: '4', title: '央行降准利好落地，股市震荡回升', sourceLabel: '财联社' },
      { id: '5', title: '科技周刊：AI 模型与终端重塑', sourceLabel: '少数派' },
      { id: '6', title: '深度调查：大厂出海的隐秘航道', sourceLabel: '晚点 LatePost' },
      { id: '7', title: 'Global Tech Trends 2026', sourceLabel: 'Wired' },
      { id: '8', title: '新质生产力与产业跃迁观察', sourceLabel: '经济观察报' },
      { id: '9', title: '建筑与光影的现代沉思', sourceLabel: '理想国' },
      { id: '10', title: '夜读随笔：在城市角落寻回宁静', sourceLabel: '单向街书店' },
    ]

    const motifSet = new Set<string>()
    const paletteSet = new Set<string>()

    for (const art of sampleArticles) {
      const cfg = getEditorialCoverConfig(art)
      motifSet.add(cfg.motif)
      paletteSet.add(cfg.palette.id)
      assert.ok(EDITORIAL_MOTIFS.includes(cfg.motif))
      assert.ok(EDITORIAL_PALETTES.some((p) => p.id === cfg.palette.id))
    }

    // 10 篇测试文章应展现充分的多样性，涵盖至少 4 个不同 motif 与 4 个不同 palette
    assert.ok(motifSet.size >= 4, `Expected diverse motifs, got ${motifSet.size}`)
    assert.ok(paletteSet.size >= 4, `Expected diverse palettes, got ${paletteSet.size}`)
  })
})
