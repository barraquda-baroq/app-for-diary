// スワイプで前後の期間へ移るかの決まり（docs/SPEC.md の 3.7: 60px 以上・水平から 30° 以内。左＝次・右＝前。S・M のどのモードでも。
// 長押ししてから動かす指はドラッグの掴み方なので、なぞったとみなさない）
import { describe, expect, it } from 'vitest'
import { isHold, SWIPE_HOLD_MS, SWIPE_MAX_DEG, SWIPE_MIN_PX, SWIPE_SLOP_PX, swipeDirection, swipeEnabled } from './swipe'

/** 長さ len・水平からの角度 deg（度）の動き */
const at = (len: number, deg: number, sign: 1 | -1 = -1) => {
  const r = (deg * Math.PI) / 180
  return [sign * len * Math.cos(r), len * Math.sin(r)] as const
}

describe('swipeDirection', () => {
  it('しきいは 60px・30°', () => {
    expect(SWIPE_MIN_PX).toBe(60)
    expect(SWIPE_MAX_DEG).toBe(30)
  })

  it.each([
    [-59, 0, null],
    [-60, 0, 1],
    [60, 0, -1],
    [59, 0, null],
    [-200, 0, 1],
    [200, 0, -1],
  ] as const)('横の長さ dx=%i・dy=%i → %s', (dx, dy, dir) => {
    expect(swipeDirection(dx, dy)).toBe(dir)
  })

  it('角度は水平から 29° なら横、31° なら縦（左へなぞる＝次、右へなぞる＝前）', () => {
    expect(swipeDirection(...at(120, 29))).toBe(1)
    expect(swipeDirection(...at(120, 31))).toBeNull()
    expect(swipeDirection(...at(120, 29, 1))).toBe(-1)
    expect(swipeDirection(...at(120, 31, 1))).toBeNull()
    // 上へなぞっても同じ（角度は上下を問わない）
    const [dx, dy] = at(120, 29)
    expect(swipeDirection(dx, -dy)).toBe(1)
  })

  it('ちょうど 30° は横（30° 以内）', () => {
    expect(swipeDirection(-100, 100 * Math.tan(Math.PI / 6) - 1e-9)).toBe(1)
  })

  it('縦のスクロール・動かない・数でない物は移らない', () => {
    expect(swipeDirection(-10, 300)).toBeNull()
    expect(swipeDirection(0, 0)).toBeNull()
    expect(swipeDirection(Number.NaN, 0)).toBeNull()
  })

  it('横の長さが 60px でも、角度が 30° を超えると移らない（60px・35°）', () => {
    expect(swipeDirection(-60, 60 * Math.tan((35 * Math.PI) / 180))).toBeNull()
  })
})

describe('isHold（長押ししてから動かした指はなぞったとみなさない。7.11 の 400ms・8px）', () => {
  it('動き始めるまで 399ms ならなぞる、400ms なら長押し', () => {
    expect([SWIPE_HOLD_MS, SWIPE_SLOP_PX]).toEqual([400, 8])
    expect(isHold(399)).toBe(false)
    expect(isHold(400)).toBe(true)
  })
})

describe('swipeEnabled（S・M のどのモードでも。ウィークリーも 22. の段階2の終わりの確かめの答えでなぞる。L はしない）', () => {
  it.each([
    ['year', 'S', true],
    ['month', 'S', true],
    ['day', 'S', true],
    ['week', 'S', true],
    ['month', 'M', true],
    ['week', 'M', true],
    ['month', 'L', false],
    ['day', 'L', false],
    ['week', 'L', false],
  ] as const)('%s・%s → %s', (mode, width, on) => {
    expect(swipeEnabled(mode, width)).toBe(on)
  })
})
