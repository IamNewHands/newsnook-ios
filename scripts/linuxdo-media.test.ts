import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  decodeLinuxDoMediaBase64,
  isLinuxDoHostedMedia,
  looksLikeLinuxDoImageBytes,
  releaseLinuxDoImageCache,
  resolveLinuxDoImageSrc,
  stripDataUrlPrefix,
} from '../src/features/linuxdo/media/imageSource'

// linux.do 主站图片落在 Cloudflare 托管挑战后面，必须走原生会话通道；CDN 是公开的。
assert.equal(
  isLinuxDoHostedMedia('https://linux.do/uploads/default/original/3X/9/d/9dd49731091ce8656e94433a26a3ef36062b3994.png'),
  true,
  'linux.do 主站图片需要原生通道',
)
assert.equal(
  isLinuxDoHostedMedia('https://cdn.ldstatic.com/letter_avatar/czm/48/6_22734026db12803ebb3e059622ac3534.png'),
  false,
  'CDN 头像直连即可，不该走原生通道',
)
assert.equal(isLinuxDoHostedMedia('https://linux.do.evil.example/x.png'), false, '后缀域名不算主站')
assert.equal(
  isLinuxDoHostedMedia('https://sub.linux.do/x.png'),
  true,
  'linux.do 子域同样在挑战后面，必须一起走会话通道（构建 43 的「未知原因」就是被这条漏掉的）',
)
assert.equal(isLinuxDoHostedMedia('http://linux.do/x.png'), false, '只有 https 才走原生通道')
assert.equal(isLinuxDoHostedMedia('/uploads/default/original/1X/a.png'), false, '相对地址不解析')
assert.equal(isLinuxDoHostedMedia(''), false, '空地址不解析')

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const decoded = new Uint8Array(decodeLinuxDoMediaBase64(Buffer.from(png).toString('base64')))
assert.deepEqual(Array.from(decoded), Array.from(png), 'base64 解码必须逐字节还原')
assert.throws(() => decodeLinuxDoMediaBase64('not-base64!!'), '非法 base64 必须抛错，交给调用方回退')

// 2xx 不等于图片：Cloudflare 挑战页与 Discourse 登录页都是 2xx 的 HTML。
// 只有字节确实是图片才允许转 blob，否则调用方会误判「解析成功」而放弃 optimized 备用地址。
const htmlBytes = new Uint8Array(Buffer.from('<!DOCTYPE html><html><body>Just a moment...</body></html>'))
assert.equal(looksLikeLinuxDoImageBytes(htmlBytes), false, 'HTML 挑战页不能被当成图片')
assert.equal(looksLikeLinuxDoImageBytes(new Uint8Array(0)), false, '空响应不能被当成图片')
assert.equal(looksLikeLinuxDoImageBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true, 'JPEG 魔数')
assert.equal(looksLikeLinuxDoImageBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true, 'PNG 魔数')
assert.equal(looksLikeLinuxDoImageBytes(new Uint8Array(Buffer.from('GIF89a'))), true, 'GIF 魔数')
assert.equal(
  looksLikeLinuxDoImageBytes(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])),
  true,
  'WEBP 魔数',
)
assert.equal(
  looksLikeLinuxDoImageBytes(Uint8Array.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66])),
  true,
  'AVIF/HEIC 容器魔数',
)

const imageSourceSource = readFileSync('src/features/linuxdo/media/imageSource.ts', 'utf8')
assert.match(
  imageSourceSource,
  /if \(!contentType\.startsWith\('image\/svg'\) && !looksLikeLinuxDoImageBytes\(bytes\)\) \{[\s\S]{0,200}不是图片/,
  '取到非图片字节必须抛错回退，不能返回 blob',
)
// 承载形式：小图用 data: URL（WKWebView 的 origin 是 capacitor://，blob: 加载依赖该方案实现），
// 大图仍走 blob: 以免 base64 字符串把内存放大几倍。
assert.match(
  imageSourceSource,
  /const DATA_URL_MAX_BYTES = [\d_]+/,
  'data: URL 必须有字节上限',
)
assert.match(
  imageSourceSource,
  /bytes\.byteLength <= DATA_URL_MAX_BYTES[\s\S]{0,300}return `data:\$\{type\};base64,\$\{base64\}`/,
  '小图必须用 data: URL 承载',
)
assert.match(
  imageSourceSource,
  /noteResolved\(url, `\$\{hostOf\(url\)\} 已取字节/,
  '取字节成功也要留一条状态（带主机名），占位才能区分「通道没取到」与「取到了不能用」',
)
assert.equal(
  stripDataUrlPrefix('data:image/png;base64,AAAA'),
  'AAAA',
  '原生没剥干净 data: 前缀时 JS 侧要兜一次',
)
assert.equal(stripDataUrlPrefix('AAAA'), 'AAAA', '普通 base64 原样返回')

// 失败兜底（resolveImage）不再按主机白名单提前返回：真机实测正文图会落在站点 CDN 主机上，
// 按 linux.do 过滤会让它「没走会话通道」直接失败；主机判定交给原生守卫。
assert.doesNotMatch(
  imageSourceSource,
  /if \(!isLinuxDoHostedMedia\(url\)\) return url/,
  '失败兜底不得再按主机白名单提前返回',
)
assert.match(
  imageSourceSource,
  /noteStatus\(url, `\$\{hostOf\(url\)\} \$\{describeMediaError\(error\)\}`\)/,
  '失败记录必须带上主机名（真机上只能靠占位这行看到地址在哪台主机）',
)
assert.match(
  readFileSync('src/features/linuxdo/ui/useLinuxDoImageSrc.ts', 'utf8'),
  /if \(!isLinuxDoHostedMedia\(url\)\) return/,
  '提前解析的勋章路径仍要保留主机过滤，避免给 CDN 头像多发插件调用',
)

// 非原生（Web / 测试环境）一律回退原地址：这条通道绝不能把网页端图片弄坏。
const linuxDoImage = 'https://linux.do/uploads/default/original/1X/3a18b4b0da3e8cf96f7eea15241c3d251f28a39b.png'
assert.equal(await resolveLinuxDoImageSrc(linuxDoImage), linuxDoImage, '非原生环境原样返回')
assert.equal(
  await resolveLinuxDoImageSrc('https://cdn.ldstatic.com/letter_avatar/czm/48/6_22734026db12803ebb3e059622ac3534.png'),
  'https://cdn.ldstatic.com/letter_avatar/czm/48/6_22734026db12803ebb3e059622ac3534.png',
  'CDN 图片原样返回',
)
assert.equal(await resolveLinuxDoImageSrc('data:image/gif;base64,R0lGOD'), 'data:image/gif;base64,R0lGOD', '非 http 地址原样返回')
releaseLinuxDoImageCache()

// 原生契约：Swift 侧必须真的暴露 fetchMedia，否则 JS 侧只会拿到「未实现」。
const pluginSource = readFileSync('ios/App/App/LinuxDoSessionPlugin.swift', 'utf8')
assert.match(pluginSource, /CAPPluginMethod\(name: "fetchMedia"/, 'fetchMedia 必须注册进 pluginMethods')
assert.match(pluginSource, /@objc func fetchMedia\(_ call: CAPPluginCall\)/, 'fetchMedia 必须实现')
assert.match(pluginSource, /binary: Bool = false/, '隐藏传输必须支持 base64 取字节')
assert.match(pluginSource, /readAsDataURL\(blob\)/, '浏览器传输必须把响应读成 data URL')
assert.match(
  pluginSource,
  /isCloudflareChallenge\(status: status, body: text, headers: headers\)[\s\S]{0,1200}performBrowserMediaRequest/,
  '原生命中挑战后必须回落到浏览器传输',
)
assert.match(
  pluginSource,
  /guard Self\.isAllowedMediaUrl\(url\) else \{[\s\S]{0,160}LINUXDO_MEDIA_URL/,
  'fetchMedia 必须放行 linux.do 及子域与站点 CDN（*.ldstatic.com），否则 CDN 上的正文图会被插件直接拒绝',
)

const progressiveSource = readFileSync('src/hooks/useProgressiveImages.ts', 'utf8')
assert.match(progressiveSource, /resolveImage\?: \(url: string\) => Promise<string>/, 'useProgressiveImages 必须暴露 resolveImage')
assert.match(
  progressiveSource,
  /没走会话通道（地址不在 linux\.do）/,
  '失败占位必须能区分「通道没取到字节」与「根本没走通道」',
)
assert.match(progressiveSource, /state\.resolverTried = true/, '必须记录 resolver 是否被问过')
assert.match(
  progressiveSource,
  /for \(const candidate of candidates\) \{[\s\S]{0,600}if \(forceNativeFallback\) \{/,
  '自定义 resolver 必须逐个试完备用地址，才轮到通用原生兜底',
)
assert.match(
  progressiveSource,
  /if \(playable\.startsWith\('blob:'\)\) ownedBlobUrls\.add\(playable\)/,
  '只有通用原生兜底的 blob 才归 hook 撤销',
)

const cookedBodySource = readFileSync('src/features/linuxdo/ui/LinuxDoCookedBody.tsx', 'utf8')
assert.match(cookedBodySource, /resolveImage: resolveLinuxDoImageSrc/, '共享 cooked 渲染组件必须接上 Linux.do 媒体解析')
for (const surface of ['src/features/linuxdo/ui/ThreadViews.tsx', 'src/features/linuxdo/ui/UserProfileView.tsx', 'src/features/linuxdo/ui/CommunityViews.tsx']) {
  assert.match(readFileSync(surface, 'utf8'), /LinuxDoCookedBody/, `${surface} 必须复用共享 cooked 渲染组件`)
}
assert.match(
  readFileSync('src/features/linuxdo/ui/UserProfileView.tsx', 'utf8'),
  /useLinuxDoImageSrc\(badgeImageUrl\)/,
  '资料页勋章图必须走会话通道',
)
// 正文只放 2x 变体，原图按需取：灯箱的「查看原图」直连失败时回落到同一个会话通道。
assert.match(
  readFileSync('src/features/linuxdo/ui/ThreadViews.tsx', 'utf8'),
  /onResolveOriginal=\{resolveLinuxDoImageSrc\}/,
  '灯箱「查看原图」的兜底必须接上 Linux.do 媒体解析',
)

console.log('linuxdo media image source tests passed')
