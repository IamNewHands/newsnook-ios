/**
 * France 24 等站点在抓取环境里会把 YouTube 同意/广告拦截提示渲染成正文段落。
 * 这些占位文字没有信息量，应剔除；原站 YouTube embed iframe 则白名单保留。
 */
export const EMBED_NOISE =
  /(?:to display this content from youtube[\s\S]{0,160}(?:advertisement tracking|audience measurement|cookies))|(?:to watch this video[\s\S]{0,160}(?:youtube|advertisement|cookies|tracking))|(?:one of your browser extensions seems to be blocking (?:the video player|youtube))|(?:content is not available because[\s\S]{0,120}blocking youtube)|(?:pour afficher ce contenu youtube[\s\S]{0,120}publicit)|(?:un de vos bloqueurs de publicit)|(?:page\s+not\s+found)|(?:content you requested does not exist)|(?:is not available anymore)/i

export function hasEmbedNoise(html?: string): boolean {
  return Boolean(html && EMBED_NOISE.test(html))
}

