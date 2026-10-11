export interface GalleryImage {
  src: string
  actionSrc?: string
  alt: string
}

export interface ImageGallery {
  items: GalleryImage[]
  index: number
}

/** 按正文顺序收集可查看的配图；保留已加载的代理/blob 地址，不越过媒体加载授权。 */
export function collectImageGallery(root: ParentNode | null, selected: GalleryImage): ImageGallery {
  const items: GalleryImage[] = []
  const seen = new Set<string>()
  for (const image of Array.from(root?.querySelectorAll<HTMLImageElement>('img') ?? [])) {
    if (image.matches('.reader-img-badge, .async-img-failed, [data-reader-role="badge"], [data-reader-role="decorative"], [data-reader-role="related-image"], [data-reader-role="zhihu-link-image"]') ||
      image.closest('[data-reader-deferred], [data-reader-role="related-item"], [data-reader-role="zhihu-link-card"]')) continue
    const src = image.currentSrc || image.getAttribute('src') || ''
    if (!src || seen.has(src)) continue
    seen.add(src)
    items.push({ src, alt: image.alt || '', actionSrc: image.getAttribute('data-linuxdo-original-src') || undefined })
  }
  let index = items.findIndex((image) => image.src === selected.src)
  if (index < 0) {
    items.unshift(selected)
    index = 0
  }
  return { items, index }
}
