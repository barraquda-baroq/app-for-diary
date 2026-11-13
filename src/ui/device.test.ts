// 端末の見分けと、ブラウザの「戻る」「進む」（popstate）を何として扱うか・カレンダーでの「戻る」の閉じ方（docs/SPEC.md の 2.5・3.1。
// 22. の段階2の終わりの確かめ・■22・■25）: iPhone・iPad（Mac を名乗る iPadOS の Safari もタッチの指の数で）は画面の端からのフリック、
// Android・PC は OS の戻る。閉じ方は、ホーム画面から開いた Android のアプリだけ「もう一度［戻る］を押すと閉じます」、ほかは聞く
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentExitStyle,
  currentPlatform,
  currentPopSource,
  detectPlatform,
  exitStyleOf,
  isStandalone,
  popSourceOf,
  type Platform,
} from './device'

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1',
  ipod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  // iPadOS の Safari は Mac を名乗る（Mac の Safari と同じ UA）
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  // タッチの画面の Windows の PC
  windowsTouch:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectPlatform', () => {
  it('UA の iPhone・iPad・iPod は iPhone・iPad（どのブラウザでも）', () => {
    for (const ua of [UA.iphone, UA.iphoneChrome, UA.ipod, UA.ipad]) expect(detectPlatform(ua, 5, 'iPhone')).toBe('ios')
  })

  it('Mac を名乗る iPadOS の Safari は、タッチの指が2本以上なら iPhone・iPad（UA の Macintosh か navigator.platform の MacIntel）', () => {
    expect(detectPlatform(UA.mac, 5, 'MacIntel')).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 AppleWebKit/605.1.15', 5, 'MacIntel')).toBe('ios')
    // Mac の Safari（タッチなし）・指1本だけの物は PC
    expect(detectPlatform(UA.mac, 0, 'MacIntel')).toBe('desktop')
    expect(detectPlatform(UA.mac, 1, 'MacIntel')).toBe('desktop')
  })

  it('Android と PC（タッチの画面の Windows も PC）', () => {
    expect(detectPlatform(UA.android, 5, 'Linux armv8l')).toBe('android')
    expect(detectPlatform(UA.windows, 0, 'Win32')).toBe('desktop')
    expect(detectPlatform(UA.windowsTouch, 10, 'Win32')).toBe('desktop')
  })
})

describe('popstate を何として扱うか', () => {
  it('iPhone・iPad は画面の端からのフリック、Android・PC は OS の戻る', () => {
    expect(popSourceOf('ios')).toBe('edge-flick')
    expect(popSourceOf('android')).toBe('os-back')
    expect(popSourceOf('desktop')).toBe('os-back')
  })

  it('いまの端末を navigator から見分ける（iPadOS の Safari: Mac の UA・MacIntel・指5本）', () => {
    vi.stubGlobal('navigator', { userAgent: UA.mac, platform: 'MacIntel', maxTouchPoints: 5 })
    expect(currentPlatform()).toBe('ios')
    expect(currentPopSource()).toBe('edge-flick')
    vi.stubGlobal('navigator', { userAgent: UA.android, platform: 'Linux armv8l', maxTouchPoints: 5 })
    expect(currentPopSource()).toBe('os-back')
  })
})

describe('カレンダーでの OS の「戻る」の閉じ方（■22・■25）', () => {
  it('ホーム画面から開いた Android のアプリ（表示の形が standalone）だけ、聞かずに「もう一度［戻る］を押すと閉じます」', () => {
    expect(exitStyleOf('android', true)).toBe('press-again')
  })

  it('Android のブラウザのタブと PC（ホーム画面に置いたアプリとして開いていても）は「Diary Studio を閉じますか？」と聞く', () => {
    expect(exitStyleOf('android', false)).toBe('ask')
    expect(exitStyleOf('desktop', false)).toBe('ask')
    expect(exitStyleOf('desktop', true)).toBe('ask')
  })

  it('iPhone・iPad は端からのフリックでモードを回すので、閉じ方は使わない（ホーム画面のアプリでも ask のまま）', () => {
    for (const standalone of [false, true]) expect(exitStyleOf('ios', standalone)).toBe('ask')
    expect(popSourceOf('ios')).toBe('edge-flick')
  })

  /** navigator と、表示の形（display-mode: standalone）を決める */
  function stub(ua: string, platform: string, touch: number, standalone: boolean) {
    vi.stubGlobal('navigator', { userAgent: ua, platform, maxTouchPoints: touch })
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: standalone && query === '(display-mode: standalone)',
      media: query,
    }))
  }

  it('いまの端末と表示の形から決める（ホーム画面の Android・Android のタブ・PC・iPhone）', () => {
    const cases: [string, string, number, boolean, Platform, 'ask' | 'press-again'][] = [
      [UA.android, 'Linux armv8l', 5, true, 'android', 'press-again'],
      [UA.android, 'Linux armv8l', 5, false, 'android', 'ask'],
      [UA.windows, 'Win32', 0, true, 'desktop', 'ask'],
      [UA.windows, 'Win32', 0, false, 'desktop', 'ask'],
      [UA.iphone, 'iPhone', 5, true, 'ios', 'ask'],
    ]
    for (const [ua, platform, touch, standalone, expected, style] of cases) {
      stub(ua, platform, touch, standalone)
      expect(currentPlatform()).toBe(expected)
      expect(isStandalone()).toBe(standalone)
      expect(currentExitStyle()).toBe(style)
    }
  })
})
