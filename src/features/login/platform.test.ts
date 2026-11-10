// 端末の見分けと、ログインの画面に「ホーム画面に追加してから使ってください」を出すか（docs/SPEC.md の 2.5・D44）
import { describe, expect, it } from 'vitest'
import { detectPlatform, needsHomeScreenNotice } from './platform'

describe('detectPlatform', () => {
  it('iPhone・iPad（Mac を名乗る iPadOS はタッチで見分ける）・Android・PC', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0)).toBe('desktop')
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/130.0 Mobile Safari/537.36')).toBe('android')
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36')).toBe('desktop')
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
