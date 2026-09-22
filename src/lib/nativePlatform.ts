export function shouldUseStartupSplash(platform: string, development: boolean): boolean {
  return platform === 'android' || platform === 'ios' || development
}
