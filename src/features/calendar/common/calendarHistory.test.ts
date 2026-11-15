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

describe('S3 リストから開く小さな画面（3.1・D51・S3-FRAME-004・S3-FRAME-018）', () => {
  const task = { sheet: { kind: 'detail', id: 'i1', from: 'task' } }
  const routine = { sheet: { kind: 'routine', id: 'r1' } }
  const favorite = { sheet: { kind: 'favorite', id: 'f1' } }
  const fromFavorite = { sheet: { kind: 'register', init: { start: '2026-11-10', title: '店を調べる' }, from: 'favorite' } }

  it('カレンダーの行き先の上の「タスク」の詳細・ルーチンとやりたいことのパネルは詳細、［予定にする］の登録は登録', () => {
    expect(screenOf({ pathname: '/week/2026-11-08', state: task })).toBe('detail')
    expect(screenOf({ pathname: '/month/2026-11', state: routine })).toBe('detail')
    expect(screenOf({ pathname: '/', state: favorite })).toBe('detail')
    expect(screenOf({ pathname: '/day/2026-11-10', state: fromFavorite })).toBe('register')
  })

  it('#/mim の上ではリストから開いた印を先に見る（L・M の MIM の横のリストから開いた物。［予定にする］は端からのフリックで捨てる ■27）', () => {
    expect(screenOf({ pathname: '/mim', state: task })).toBe('detail')
    expect(screenOf({ pathname: '/mim', state: routine })).toBe('detail')
    expect(screenOf({ pathname: '/mim', state: favorite })).toBe('detail')
    expect(screenOf({ pathname: '/mim', state: fromFavorite })).toBe('register')
    expect(screenOf({ pathname: '/mim', state: null })).toBe('other')
  })

  it('#/mim の上のカレンダーから開いた印（MIM を開いている間は SheetHost が無く見えない。複製のお知らせの［開く］を MIM で押した時など）は、今までどおりほかの画面', () => {
    expect(screenOf({ pathname: '/mim', state: detail })).toBe('other')
    expect(screenOf({ pathname: '/mim', state: register })).toBe('other')
    expect(screenOf({ pathname: '/mim', state: { ...detail, mimFromCalendar: true } })).toBe('other')
  })

  it('設定・ログイン・見つかりませんは、印があってもほかの画面のまま', () => {
    for (const p of ['/settings', '/login', '/month/2026-11/x'])
      for (const state of [task, routine, favorite, fromFavorite, register])
        expect(screenOf({ pathname: p, state })).toBe('other')
  })

  it('形の正しくない印（id が無い・from が決まった字でない・知らない kind）は印でない', () => {
    for (const sheet of [
      { kind: 'routine' },
      { kind: 'favorite', id: 3 },
      { kind: 'detail', id: 'i1', from: 'routine' },
      { kind: 'register', init: { start: '2026-11-10' }, from: 'task' },
      { kind: 'trash', id: 'x' },
    ]) {
      expect(screenOf({ pathname: '/month/2026-11', state: { sheet } }), JSON.stringify(sheet)).toBe('calendar')
      expect(screenOf({ pathname: '/mim', state: { sheet } }), JSON.stringify(sheet)).toBe('other')
    }
  })
})
