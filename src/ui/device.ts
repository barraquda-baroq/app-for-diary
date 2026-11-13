// 端末の見分け（docs/SPEC.md の 2.5・2.7・3.1）。ログインの画面の iPhone の案内・ホーム画面に追加の手順（src/features/login/platform.ts が
// ここから読む）と、ブラウザの「戻る」「進む」（popstate）を何として扱うか・カレンダーでの「戻る」の閉じ方（src/history/appHistory.ts）の
// どれも、この1か所で決める。
// - iPhone・iPad（iOS・iPadOS の WebKit。どのブラウザもホーム画面のアプリも WebKit）: UA の iPhone・iPad・iPod か、Mac を名乗る
//   iPadOS の Safari（UA の Macintosh か navigator.platform の MacIntel で、タッチの指が2本以上）
// - Android: UA の Android
// - ほか（Windows・Mac・Linux・ChromeOS の PC）は PC
// iPhone・iPad には OS の戻るボタンが無く、画面のいちばん左の端から右へ払う・右の端から左へ払う身振りが、ブラウザの「戻る」「進む」
// そのもの（ページより先にブラウザが取り、ページには popstate だけが来る）。なので iPhone・iPad の popstate は「端からのフリック」、
// Android（戻るボタン・戻る身振り）と PC（ブラウザの戻る・進む）の popstate は「OS の戻る」として扱う（22. の段階2の終わりの確かめ）。
// カレンダーでの OS の「戻る」は、ホーム画面から開いた Android のアプリ（表示の形が standalone）だけ、聞かずに「もう一度［戻る］を
// 押すと閉じます」にし、Android のブラウザのタブと PC は「Diary Studio を閉じますか？」と聞く（■22・■25）

import type { ExitStyle, PopSource } from '../history/popRules'

export type Platform = 'ios' | 'android' | 'desktop'
export type { ExitStyle, PopSource }

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

/** ホーム画面に追加したアプリとして開いている（iPhone の navigator.standalone か、表示の形が standalone） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
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

/**
 * カレンダーでの OS の「戻る」の閉じ方（docs/SPEC.md の 3.1・■22・■25）: press-again = 聞かずに「もう一度［戻る］を押すと閉じます」と
 * 出し、出ている間のもう一度の［戻る］で閉じる（ホーム画面から開いた Android のアプリ。Android のアプリによくある形）、ask =
 * 「Diary Studio を閉じますか？」と聞く（Android のブラウザのタブ・PC。PC はホーム画面に置いたアプリとして開いていても聞く）。
 * iPhone・iPad は端からのフリックでモードを回すので使わない（ask）
 */
export function exitStyleOf(platform: Platform, standalone: boolean): ExitStyle {
  return platform === 'android' && standalone ? 'press-again' : 'ask'
}

/** いまの端末と表示の形の、カレンダーでの OS の「戻る」の閉じ方 */
export function currentExitStyle(): ExitStyle {
  return exitStyleOf(currentPlatform(), isStandalone())
}
