/** Web 端直接下载 R2 上始终覆盖为最新云端版的 APK，不再绕 GitHub Release。 */
export const ANDROID_APP_DOWNLOAD_URL =
  'https://news-update.aizeek.com/newsnook/latest-cloud.apk'

/** 原生 App 不展示下载自身的提示；桌面与手机浏览器都属于 Web。 */
export function shouldShowWebAppDownloadBanner(isNativePlatform: boolean): boolean {
  return !isNativePlatform
}
