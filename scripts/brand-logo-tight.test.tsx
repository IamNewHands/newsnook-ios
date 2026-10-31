import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})

const { createRoot } = await import('react-dom/client')
const { BrandLogo } = await import('../src/components/BrandLogo')
const root = createRoot(document.getElementById('root')!)

// 1. 测试默认 BrandLogo：渲染为带标准尺寸的 img 标签
await act(async () => {
  root.render(<BrandLogo size={32} />)
})
const container = document.getElementById('root')!
const img = container.querySelector('img')
assert.ok(img, '非 tight 模式下应渲染原生 img 标签以兼容现有大图标场景')
assert.equal(img.getAttribute('width'), '32')

// 2. 测试 tight 模式 BrandLogo：渲染为内联 SVG，精确紧贴图形边界
await act(async () => {
  root.render(<BrandLogo tight size={18} resolvedTheme="light" />)
})
const svg = container.querySelector('svg[data-brand-logo="tight"]')
assert.ok(svg, 'tight 模式下应渲染 data-brand-logo="tight" 的内联 SVG')
assert.equal(svg.getAttribute('viewBox'), '217.5 234.1 659.5 604', 'viewBox 应紧贴图形真实像素边界')
assert.equal(svg.getAttribute('width'), '18')
assert.ok(svg.querySelector('linearGradient'), '浅色主题下应具备主题蓝色渐变')

await act(async () => {
  root.render(<BrandLogo tight size={18} resolvedTheme="dark" />)
})
const darkSvg = container.querySelector('svg[data-brand-logo="tight"]')
assert.ok(darkSvg, '深色模式下应成功渲染')
const darkPath = darkSvg.querySelector('path')
assert.equal(darkPath?.getAttribute('fill'), '#FFFFFF', '深色主题下应填充纯白')

console.log('brand-logo-tight: ok')
