const HOME_DOUBLE_TAP_WINDOW_MS = 350

interface HomeNavigationTapOptions {
  isHome: boolean
  previousTapAt: number | null
  now: number
  onNavigateHome: () => void
  onRefresh: () => void
}

export function handleHomeNavigationTap({
  isHome,
  previousTapAt,
  now,
  onNavigateHome,
  onRefresh,
}: HomeNavigationTapOptions): number | null {
  if (!isHome) {
    onNavigateHome()
    return null
  }

  if (previousTapAt !== null && now >= previousTapAt && now - previousTapAt <= HOME_DOUBLE_TAP_WINDOW_MS) {
    onRefresh()
    return null
  }

  return now
}
