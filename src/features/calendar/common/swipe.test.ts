// スワイプで前後の期間へ移るかの決まり（docs/SPEC.md の 3.7: 60px 以上・水平から 30° 以内。左＝次・右＝前。S・M のどのモードでも。
// 長押ししてから動かす指はドラッグの掴み方なので、なぞったとみなさない。大きく払った時: 横に払い始めた指は全体で 45° まで・
// ブラウザに取られた後も追う。22. の段階2の終わりの確かめ）
import { describe, expect, it } from 'vitest'
import {
  endSwipe,
  isHold,
  moveSwipe,
  startSwipe,
  SWIPE_ARC_MAX_DEG,
  SWIPE_CLICK_GUARD_MS,
  SWIPE_HOLD_MS,
  SWIPE_LEAD_PX,
  SWIPE_MAX_DEG,
  SWIPE_MIN_PX,
  SWIPE_SLOP_PX,
  swipeDirection,
  swipeEnabled,
  takeSwipe,
  type SwipeTrack,
} from './swipe'

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

/** 指の動き: 押した所 [x, y] から、点を [x, y, ms（押してからの時刻）] の順に動かす。途中で null を返したら null */
type Step = readonly [number, number, number] | 'cancel'
function follow(from: readonly [number, number], steps: readonly Step[]): SwipeTrack | null {
  let s: SwipeTrack | null = startSwipe(from[0], from[1], 1000)
  for (const step of steps) {
    if (!s) return null
    s = step === 'cancel' ? takeSwipe(s) : moveSwipe(s, step[0], step[1], 1000 + step[2])
  }
  return s
}
/** follow の後に、最後の点で離した時の向き */
function flick(from: readonly [number, number], steps: readonly Step[]): 1 | -1 | null {
  const s = follow(from, steps)
  const last = [...steps].reverse().find((p): p is readonly [number, number, number] => p !== 'cancel')
  return s && last ? endSwipe(s, last[0], last[1]) : null
}
/** a から b へ、縦に bulge（px。負は上へふくらむ）の弧を n 回に分けてなぞる点（ms は 1回 stepMs） */
function arc(a: readonly [number, number], b: readonly [number, number], n: number, bulge: number, stepMs: number): Step[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + bulge * 4 * t * (1 - t), stepMs * (i + 1)] as const
  })
}
/** 親指の弧: a から b へ、初めは水平に、終わりほど縦へ逸れる（縦は進んだ割合の2乗）点を n 回に分けて（ms は 1回 stepMs） */
function thumb(a: readonly [number, number], b: readonly [number, number], n: number, stepMs: number): Step[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t * t, stepMs * (i + 1)] as const
  })
}

describe('大きく払った時（22. の段階2の終わりの確かめ: 画面の外から外へ大きく払うと替わらない）', () => {
  it('しきい: 払い始めは 24px までの向き、横に払い始めた指は全体で 45° まで、移った後 300ms の click は打ち消す', () => {
    expect([SWIPE_LEAD_PX, SWIPE_ARC_MAX_DEG, SWIPE_CLICK_GUARD_MS]).toEqual([24, 45, 300])
  })

  it('親指の弧（横に払い始め、終わりが上へ逸れる。全体は 34°）でも次へ。前の決まり（押した所と離した所だけで 30°）では移らなかった', () => {
    // 右の端の 30px 内側から、300px 左へ 120ms。終わりは 200px 上（1回目の動きは水平から 4° ほど）
    const steps = thumb([360, 500], [60, 300], 10, 12)
    expect(swipeDirection(60 - 360, 300 - 500)).toBeNull()
    expect(flick([360, 500], steps)).toBe(1)
    // 右へ払っても同じ（前へ）。下へ逸れても同じ
    expect(flick([30, 500], thumb([30, 500], [330, 300], 10, 12))).toBe(-1)
    expect(flick([360, 300], thumb([360, 300], [60, 500], 10, 12))).toBe(1)
  })

  it('すばやく長く払う（3回の動きで 330px・50ms。終わりが上へ逸れて全体は 33°）も次へ', () => {
    const steps: Step[] = [
      [240, 492, 16],
      [120, 440, 33],
      [30, 285, 50],
    ]
    expect(swipeDirection(30 - 360, 285 - 500)).toBeNull()
    expect(flick([360, 500], steps)).toBe(1)
  })

  it('20% の弧で上へふくらんで戻る大きな払い（全体は水平）は、前の決まりと同じく次へ', () => {
    expect(flick([380, 500], arc([380, 500], [20, 495], 12, -70, 10))).toBe(1)
  })

  it('初めから斜め（31° のまっすぐな払い）・全体が 45° を超える弧・縦のスクロールは移らない', () => {
    const r = Math.tan((31 * Math.PI) / 180)
    expect(flick([360, 500], arc([360, 500], [60, 500 - 300 * r], 8, 0, 15))).toBeNull()
    // 横に払い始めても、終わりが大きく上へ（全体 47°）
    expect(flick([360, 500], thumb([360, 500], [160, 285], 8, 15))).toBeNull()
    // 少し横へ動いてから縦のスクロール
    expect(flick([200, 600], arc([200, 600], [170, 200], 8, 0, 15))).toBeNull()
  })

  it('長押ししてから大きく払った指（ドラッグの掴み方）はなぞったとみなさない', () => {
    expect(follow([360, 500], [[340, 500, SWIPE_HOLD_MS]])).toBeNull()
    expect(follow([360, 500], [[340, 500, SWIPE_HOLD_MS - 1]])?.moved).toBe(true)
  })

  it('初めに少し縦へ動いてブラウザに取られた（pointercancel）指も、横に払い続けて離せば次へ（touch の出来事で追う）', () => {
    // 1回目の動き（10px 左・12px 上）でブラウザが縦のスクロールとして取る。その後は 300px 左・40px 上まで
    const steps: Step[] = [[350, 488, 12], 'cancel', ...arc([350, 488], [60, 460], 8, 0, 12)]
    const s = follow([360, 500], steps)
    expect(s?.taken).toBe(true)
    expect(s?.lead).toBe('side')
    expect(flick([360, 500], steps)).toBe(1)
  })

  it('ブラウザに取られた後は、はっきり横（全体で 30° 以内）の時だけ。払い始めが縦と決まった指・縦のスクロールは数えない', () => {
    // 横に払い始めてから取られ、終わりが上へ逸れた（全体 34°）: 取られていなければ移るが、取られた後は移らない
    const curve = thumb([360, 500], [60, 300], 10, 12)
    expect(flick([360, 500], curve)).toBe(1)
    expect(flick([360, 500], [curve[0], 'cancel', ...curve.slice(1)])).toBeNull()
    // 払い始め（24px まで）が縦と決まってから取られた: そこでやめる
    expect(follow([360, 500], [[352, 470, 16], 'cancel'])).toBeNull()
    // 縦に動き始めて取られた（まだ 24px に届かない）後、縦に送り続けた: 24px で縦と決まってやめる
    expect(follow([360, 500], [[356, 488, 16], 'cancel', [350, 420, 40]])).toBeNull()
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
