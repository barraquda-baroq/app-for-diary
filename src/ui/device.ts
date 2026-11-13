// 端末の見分け（docs/SPEC.md の 2.5・2.7・3.1）。ログインの画面の iPhone の案内・ホーム画面に追加の手順（src/features/login/platform.ts が
// ここから読む）と、ブラウザの「戻る」「進む」（popstate）を何として扱うか（src/history/appHistory.ts）の両方が、この1か所で決める。
// - iPhone・iPad（iOS・iPadOS の WebKit。どのブラウザもホーム画面のアプリも WebKit）: UA の iPhone・iPad・iPod か、Mac を名乗る
//   iPadOS の Safari（UA の Macintosh か navigator.platform の MacIntel で、タッチの指が2本以上）
// - Android: UA の Android
// - ほか（Windows・Mac・Linux・ChromeOS の PC）は PC
// iPhone・iPad には OS の戻るボタンが無く、画面のいちばん左の端から右へ払う・右の端から左へ払う身振りが、ブラウザの「戻る」「進む」
// そのもの（ページより先にブラウザが取り、ページには popstate だけが来る）。なので iPhone・iPad の popstate は「端からのフリック」、
// Android（戻るボタン・戻る身振り）と PC（ブラウザの戻る・進む）の popstate は「OS の戻る」として扱う（22. の段階2の終わりの確かめ）

import type { PopSource } from '../history/popRules'

export type Platform = 'ios' | 'android' | 'desktop'
export type { PopSource }

/**
 * 端末の見分け。maxTouchPoints は navigator.maxTouchPoints、navPlatform は navigator.platform（iPadOS の Safari は UA を Mac にし、
 * navigator.platform も MacIntel を返すので、タッチの指の数で見分ける。Mac の Safari は 0）
 */
export function detectPlatform(userAgent: string, maxTouchPoints = 0, navPlatform = ''): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios'
  if ((/Macintosh/i.test(userAgent) || navPlatform === 'MacIntel') && maxTouchPoints > 1) return 'ios'
  if (/Android/i.test(userAgent)) return 'android'
  return 'desktop'
}

/** いまの端末 */
export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  return detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0, navigator.platform ?? '')
}

/**
 * ブラウザの「戻る」「進む」（popstate）が何から来るか: edge-flick = 画面の端からのフリック（iPhone・iPad）、
 * os-back = OS・ブラウザの戻る・進む（Android の戻るボタン・戻る身振り、PC のブラウザの戻る・進む・Alt+← →・マウスのボタン）
 */
export function popSourceOf(platform: Platform): PopSource {
  return platform === 'ios' ? 'edge-flick' : 'os-back'
}

/** いまの端末の popstate が何から来るか */
export function currentPopSource(): PopSource {
  return popSourceOf(currentPlatform())
}
