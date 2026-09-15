/** Web 端统一指向最新 Release，由发布页展示当前可下载的 APK 变体。 */
export const ANDROID_APP_DOWNLOAD_URL = 'https://github.com/t59688/newsnook/releases/latest'

/** 原生 App 不展示下载自身的提示；桌面与手机浏览器都属于 Web。 */
export function shouldShowWebAppDownloadBanner(isNativePlatform: boolean): boolean {
  return !isNativePlatform
}
