// iPhone・iPad の画面の端の幅（src/history/edgeZone.ts。docs/SPEC.md の 3.1・18.1 の「開発」。22. の「端からのフリックの3回目の直した版
// （788e842）を試した答え」）: 初めは 36px。設定の「開発」の「端の幅」で 20・28・36・44px から選び、端末（localStorage の
// diary-studio:edge-zone）に覚える。無い・知らない値は 36px。選んだ幅は、読み込み直さずにすぐ、端を決める所のどれにも効く
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
  it('初め（端末に覚えていない）は 36px。覚える所の名前は diary-studio:edge-zone', () => {
    localStorage.clear()
    expect(EDGE_ZONE_KEY).toBe('diary-studio:edge-zone')
    expect(edgeZonePx()).toBe(36)
  })

  it.each([20, 28, 36, 44])('%spx を選ぶと端末に覚え、すぐ読める', (px) => {
    setEdgeZonePx(px)
    expect(edgeZonePx()).toBe(px)
    expect(localStorage.getItem('diary-studio:edge-zone')).toBe(String(px))
  })

  it.each(['', 'abc', '0', '-20', '30', '36.5', '100', ' 20', '20px', 'null'])(
    '覚えていた値が知らない物（%j）の時は 36px',
    (raw) => {
      localStorage.setItem('diary-studio:edge-zone', raw)
      expect(edgeZonePx()).toBe(36)
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
    expect(edgeZonePx()).toBe(36)
    localStorage.setItem('diary-studio:edge-zone', '44')
    expect(edgeZonePx()).toBe(44)
  })

  it('端末に覚えられない（localStorage が使えない）時は、このページの間だけ選んだ幅を使う。読めない時は 36px', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない')
    })
    setEdgeZonePx(28)
    expect(edgeZonePx()).toBe(28)
    set.mockRestore()
    // 覚えられるようになったら、覚えた値を使う
    setEdgeZonePx(44)
    expect(edgeZonePx()).toBe(44)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('使えない')
    })
    expect(edgeZonePx()).toBe(36)
  })

  it('画面の端の決め方（edgeOfScreen）は、今の端の幅で決める（選ぶとすぐ効く）', () => {
    const win = { innerWidth: 390 } as unknown as Window
    expect(edgeOfScreen(30, win)).toBe(-1)
    expect(edgeOfScreen(360, win)).toBe(1)
    setEdgeZonePx(20)
    expect(edgeOfScreen(30, win)).toBeNull()
    expect(edgeOfScreen(360, win)).toBeNull()
    expect(edgeOfScreen(19, win)).toBe(-1)
    setEdgeZonePx(44)
    expect(edgeOfScreen(40, win)).toBe(-1)
    expect(edgeOfScreen(350, win)).toBe(1)
  })
})
