// 端末の見分け（ログインの画面の iPhone の案内と、ホーム画面に追加の手順で使う）。NS の src/features/appSettings/settingsLogic.ts の
// detectPlatform と InstallHelp.tsx の useStandalone から（docs/SPEC.md の 2.5・2.7）

export type Platform = 'ios' | 'android' | 'desktop'

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  // iPadOS の Safari は Mac として名乗るので、タッチ対応かどうかで見分ける
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'desktop'
}

/** いまの端末 */
export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)
}

/** ホーム画面に追加したアプリとして開いている（iPhone の navigator.standalone か、表示の形が standalone） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}

/**
 * ログインの画面に「ホーム画面に追加してから使ってください」を出すか（iPhone・iPad をホーム画面のアプリでなく開いている時。
 * Safari とホーム画面のアプリはデータが別々になり、しばらく使わないとデータが消されることもあるため。docs/SPEC.md の 2.5・D44）
 */
export function needsHomeScreenNotice(platform: Platform, standalone: boolean): boolean {
  return platform === 'ios' && !standalone
}
