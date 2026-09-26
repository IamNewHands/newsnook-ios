import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.aizeek.newsnook',
  appName: 'News Nook',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    // Web 层用 viewport-fit=cover + CSS safe-area 自行管理安全区，与 Android 侧
    // SystemBars insetsHandling: 'disable' 的取舍一致，避免第二层内边距叠加。
    contentInset: 'never',
  },
  plugins: {
    SystemBars: {
      // NewsNook already owns safe-area propagation through MainActivity.
      // Disable Capacitor's second inset/padding layer, especially on Android
      // 15+ with WebView < 140, where it pads the WebView parent itself.
      insetsHandling: 'disable',
    },
  },
}

export default config
