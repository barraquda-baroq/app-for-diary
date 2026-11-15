// iPhone・iPad の画面の端の幅（src/history/edgeZone.ts。docs/SPEC.md の 3.1・18.1 の「開発」。22. の「端からのフリックの3回目の直した版
// （788e842）を試した答え」「端からのフリックの4回目の直した版（5e521a7）を試した答え」）: 初めは 44px（前は 36px）。設定の「開発」の
// 「端の幅」で 20・28・36・44px から選び、端末（localStorage の diary-studio:edge-zone）に覚える。無い・知らない値は 44px。覚えた幅は
// 初めの幅を替えてもそのまま（前に 36 を選んだ端末は 36 のまま）。選んだ幅は、読み込み直さずにすぐ、端を決める所のどれにも効く
// （端からのフリック・なぞり・すばやく足すの端を押した指。どれも edgeOfScreen が、ここで読んだ幅で決める）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EDGE_ZONE_PX } from '../features/calendar/common/swipe'
import { edgeOfScreen } from './edgeFlick'
import { EDGE_ZONE_KEY, edgeZonePx, setEdgeZonePx } from './edgeZone'

afterEach(() => {
  vi.restoreAllMocks()
  setEdgeZonePx(EDGE_ZONE_PX)
  localStorage.clear()
})

describe('端の幅（edgeZonePx・setEdgeZonePx）', () => {
  it('初め（端末に覚えていない）は 44px。覚える所の名前は diary-studio:edge-zone', () => {
    localStorage.clear()
    expect(EDGE_ZONE_KEY).toBe('diary-studio:edge-zone')
    expect(edgeZonePx()).toBe(44)
  })

  // 覚えた '44' は今の初めの幅と同じで、覚えた値を読んだのか分からないので入れない（読んだかは 20・28・36 で確かめる）
  it.each(['20', '28', '36'])(
    '前に覚えた幅（%s）は、初めの幅を 44px に替えてもそのまま（前の初めの 36 を選んだ端末は 36 のまま）',
    (raw) => {
      localStorage.setItem('diary-studio:edge-zone', raw)
      expect(edgeZonePx()).toBe(Number(raw))
    },
  )

  it.each([20, 28, 36, 44])('%spx を選ぶと端末に覚え、すぐ読める', (px) => {
    setEdgeZonePx(px)
    expect(edgeZonePx()).toBe(px)
    expect(localStorage.getItem('diary-studio:edge-zone')).toBe(String(px))
  })

  it.each(['', 'abc', '0', '-20', '30', '36.5', '100', ' 20', '20px', 'null'])(
    '覚えていた値が知らない物（%j）の時は 44px',
    (raw) => {
      localStorage.setItem('diary-studio:edge-zone', raw)
      expect(edgeZonePx()).toBe(44)
    },
  )

  it('選べない幅（30px・NaN）を渡しても替えない', () => {
    setEdgeZonePx(20)
    setEdgeZonePx(30)
    setEdgeZonePx(Number.NaN)
    expect(edgeZonePx()).toBe(20)
    expect(localStorage.getItem('diary-studio:edge-zone')).toBe('20')
  })

  it('ほかの所（ほかのタブ・前に開いた時）で覚えた値も、次に読む時に効く（読み込み直さない）', () => {
    expect(edgeZonePx()).toBe(44)
    localStorage.setItem('diary-studio:edge-zone', '36')
    expect(edgeZonePx()).toBe(36)
  })

  it('端末に覚えられない（localStorage が使えない）時は、このページの間だけ選んだ幅を使う。読めない時は 44px', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない')
    })
    setEdgeZonePx(28)
    expect(edgeZonePx()).toBe(28)
    set.mockRestore()
    // 覚えられるようになったら、覚えた値を使う
    setEdgeZonePx(36)
    expect(edgeZonePx()).toBe(36)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('使えない')
    })
    expect(edgeZonePx()).toBe(44)
  })

  it('画面の端の決め方（edgeOfScreen）は、今の端の幅で決める（選ぶとすぐ効く）', () => {
    const win = { innerWidth: 390 } as unknown as Window
    // 初めの 44px: 左は 44px より手前、右は 390 − 44 = 346px より先
    expect(edgeOfScreen(30, win)).toBe(-1)
    expect(edgeOfScreen(43, win)).toBe(-1)
    expect(edgeOfScreen(44, win)).toBeNull()
    expect(edgeOfScreen(346, win)).toBeNull()
    expect(edgeOfScreen(347, win)).toBe(1)
    expect(edgeOfScreen(360, win)).toBe(1)
    setEdgeZonePx(36)
    expect(edgeOfScreen(40, win)).toBeNull()
    expect(edgeOfScreen(350, win)).toBeNull()
    expect(edgeOfScreen(35, win)).toBe(-1)
    expect(edgeOfScreen(355, win)).toBe(1)
    setEdgeZonePx(20)
    expect(edgeOfScreen(30, win)).toBeNull()
    expect(edgeOfScreen(360, win)).toBeNull()
    expect(edgeOfScreen(19, win)).toBe(-1)
    setEdgeZonePx(44)
    expect(edgeOfScreen(40, win)).toBe(-1)
    expect(edgeOfScreen(350, win)).toBe(1)
  })
})
