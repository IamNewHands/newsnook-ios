import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const publicDir = join(projectRoot, 'public')
const assetsDir = join(projectRoot, 'assets')
const assetRoot = join(projectRoot, 'ios', 'App', 'App', 'Assets.xcassets')
const iconPath = join(assetRoot, 'AppIcon.appiconset', 'AppIcon-512@2x.png')
const splashRoot = join(assetRoot, 'Splash.imageset')
const splashPaths = [
  join(splashRoot, 'splash-2732x2732.png'),
  join(splashRoot, 'splash-2732x2732-1.png'),
  join(splashRoot, 'splash-2732x2732-2.png'),
]

/** 与 scripts/generate-android-assets.mjs 的 SPLASH_BG 保持一致。 */
const SPLASH_BG = '#0E0F12'
/** 品牌蓝：图标底色，浅色标压在它上面。 */
const ICON_BG = '#0C6FFF'

/**
 * 与 scripts/generate-android-assets.mjs 的 findSource 同构：按候选名 × 候选目录 ×
 * 候选扩展名依次探测。
 *
 * 上游在 1.8.x 把品牌标从 `assets/logo.svg` 移到了 `public/logo-light.svg` 与
 * `public/logo-dark.svg`，硬编码旧路径会让 iOS 资源生成直接失败。改成候选探测后，
 * 上游再改名也不会断。
 */
function findSource(basenames, dirs = [publicDir, assetsDir]) {
  const extensions = ['.svg', '.png', '.webp', '.jpg', '.jpeg']
  for (const dir of dirs) {
    for (const base of basenames) {
      for (const ext of extensions) {
        const path = join(dir, `${base}${ext}`)
        if (existsSync(path)) return path
      }
    }
  }
  return null
}

// 图标压在品牌蓝上、启动画面压在深底上，两处都需要**浅色**标，优先 logo-light。
const logoPath =
  findSource(['logo-light']) ?? findSource(['logo-dark']) ?? findSource(['logo'])

if (!logoPath) {
  throw new Error(
    '缺少品牌标：需要 public/logo-light.svg（或 logo-dark / logo，也接受 assets/ 下的同名文件）',
  )
}
if (!existsSync(assetRoot)) {
  throw new Error('未找到 iOS Assets.xcassets，请先执行 npx cap add ios')
}

await sharp(logoPath)
  .resize(1024, 1024, { fit: 'contain' })
  .flatten({ background: ICON_BG })
  .png()
  .toFile(iconPath)

const splashLogo = await sharp(logoPath)
  .resize(520, 520, { fit: 'contain' })
  .png()
  .toBuffer()

const splash = await sharp({
  create: {
    width: 2732,
    height: 2732,
    channels: 4,
    background: SPLASH_BG,
  },
})
  .composite([{ input: splashLogo, gravity: 'centre' }])
  .png()
  .toBuffer()

for (const path of splashPaths) writeFileSync(path, splash)

console.log(
  `[ios-assets] 已生成 1024x1024 图标与 2732x2732 启动画面（标源：${logoPath.slice(projectRoot.length + 1)}）`,
)
