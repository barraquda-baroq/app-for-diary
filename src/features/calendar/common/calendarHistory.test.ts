// アプリの履歴に渡す画面の種類（docs/SPEC.md の 3.1）: カレンダー（トップと4つのモード）・登録・詳細（履歴の state.sheet）・ほかの画面
import { describe, expect, it } from 'vitest'
import { screenOf } from './calendarHistory'

const register = { sheet: { kind: 'register', init: { start: '2026-11-10', kind: 'work' } } }
const detail = { sheet: { kind: 'detail', id: 'i1' } }

describe('screenOf', () => {
  it('カレンダーの行き先（トップ #/ と4つのモード。正しくない日付の行き先も、置き換える前はカレンダー）', () => {
    for (const p of ['/', '/year/2026', '/month/2026-11', '/week/2026-11-08', '/day/2026-11-10', '/month/2026-13'])
      expect(screenOf({ pathname: p, state: null })).toBe('calendar')
    // MIM の印などほかの物があってもカレンダー
    expect(screenOf({ pathname: '/day/2026-11-10', state: { mimFromCalendar: true } })).toBe('calendar')
  })

  it('カレンダーの行き先に登録・詳細の画面の印があれば、登録・詳細', () => {
    expect(screenOf({ pathname: '/day/2026-11-10', state: register })).toBe('register')
    expect(screenOf({ pathname: '/month/2026-11', state: detail })).toBe('detail')
    // 形の正しくない印は印でない
    expect(screenOf({ pathname: '/month/2026-11', state: { sheet: { kind: 'detail' } } })).toBe('calendar')
  })

  it('MIM・設定・ログイン・見つかりませんは、ほかの画面', () => {
    for (const p of ['/mim', '/settings', '/login', '/month/2026-11/x', '/month'])
      expect(screenOf({ pathname: p, state: detail })).toBe('other')
  })
})
