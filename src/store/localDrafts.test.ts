// 端末ごとの書きかけ（docs/SPEC.md の 6.13・12.1）: すばやく足すの書きかけのキーと、localStorage が使えない時も止まらないこと
import { afterEach, describe, expect, it, vi } from 'vitest'
import { quickDraftKey, readLocal, writeLocal } from './localDrafts'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('すばやく足すの書きかけ（12.1・FRAME-264）', () => {
  it('キーは diary-studio:draft:quick:{日付}:{区分}', () => {
    expect(quickDraftKey('2026-11-10', 'work')).toBe('diary-studio:draft:quick:2026-11-10:work')
    expect(quickDraftKey('2026-11-10', 'private')).toBe('diary-studio:draft:quick:2026-11-10:private')
  })

  it('書いて読み、null・空の文字で消す', () => {
    const key = quickDraftKey('2026-11-10', 'work')
    expect(readLocal(key)).toBeNull()
    writeLocal(key, '資料の確認')
    expect(readLocal(key)).toBe('資料の確認')
    expect(localStorage.getItem(key)).toBe('資料の確認')
    writeLocal(key, '')
    expect(localStorage.getItem(key)).toBeNull()
    writeLocal(key, 'もう一度')
    writeLocal(key, null)
    expect(readLocal(key)).toBeNull()
  })

  it('localStorage が使えない時（例外を投げる）も止まらず、読めない（null）だけ', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const key = quickDraftKey('2026-11-10', 'private')
    expect(() => writeLocal(key, '書きかけ')).not.toThrow()
    expect(() => writeLocal(key, null)).not.toThrow()
    expect(readLocal(key)).toBeNull()
  })
})
