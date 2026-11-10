// 端末とブラウザの見分けと、ログインの画面に「ホーム画面に追加してから使ってください」を出すか（docs/SPEC.md の 2.5・D44）
import { describe, expect, it } from 'vitest'
import { detectIosBrowser, detectPlatform, needsHomeScreenNotice } from './platform'

// 実際の UA の形（版の数字は例）
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1',
  ipadChrome:
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  // iPadOS の Safari は Mac を名乗る
  ipadSafariAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/130.0.2849.80 Mobile/15E148 Safari/605.1.15',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  iphoneGoogleApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/340.0.689664723 Mobile/15E148 Safari/604.1',
  iphoneDuckDuckGo:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15',
  // アプリの中の画面（LINE）。Version/ を名乗らない
  iphoneLine:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.18.0',
}

describe('detectPlatform', () => {
  it('iPhone・iPad（Mac を名乗る iPadOS はタッチで見分ける）・Android・PC', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0)).toBe('desktop')
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130.0 Mobile Safari/537.36')).toBe('android')
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36')).toBe('desktop')
  })

  it('iPhone・iPad の Chrome（CriOS）も iPhone・iPad', () => {
    expect(detectPlatform(UA.iphoneChrome, 5)).toBe('ios')
    expect(detectPlatform(UA.ipadChrome, 5)).toBe('ios')
  })
})

describe('detectIosBrowser', () => {
  it('Chrome は UA の CriOS で見分ける（iPhone・iPad）', () => {
    expect(detectIosBrowser(UA.iphoneChrome)).toBe('chrome')
    expect(detectIosBrowser(UA.ipadChrome)).toBe('chrome')
  })

  it('Safari（Mac を名乗る iPadOS の Safari も）', () => {
    expect(detectIosBrowser(UA.iphoneSafari)).toBe('safari')
    expect(detectIosBrowser(UA.ipadSafariAsMac)).toBe('safari')
  })

  it('Safari と同じ「Version/… Safari/…」も名乗るほかのブラウザや、アプリの中の画面は「ほか」', () => {
    expect(detectIosBrowser(UA.iphoneEdge)).toBe('other')
    expect(detectIosBrowser(UA.iphoneFirefox)).toBe('other')
    expect(detectIosBrowser(UA.iphoneGoogleApp)).toBe('other')
    expect(detectIosBrowser(UA.iphoneDuckDuckGo)).toBe('other')
    expect(detectIosBrowser(UA.iphoneLine)).toBe('other')
    expect(detectIosBrowser('')).toBe('other')
  })
})

describe('needsHomeScreenNotice', () => {
  it('iPhone・iPad をホーム画面のアプリでなく開いた時だけ', () => {
    expect(needsHomeScreenNotice('ios', false)).toBe(true)
    expect(needsHomeScreenNotice('ios', true)).toBe(false)
    expect(needsHomeScreenNotice('android', false)).toBe(false)
    expect(needsHomeScreenNotice('desktop', false)).toBe(false)
  })
})
