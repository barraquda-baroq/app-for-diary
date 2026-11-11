// 掴み方の決まり（gesture.ts。docs/SPEC.md の 7.10・7.11・D25）: マウスは 5px を超えて動かすと、指・ペンは 0.4秒（8px 以内）押し続けると
// 掴もうとした（attempt）になり、離すと release。それより前に離した・指が 8px を超えて動いた（スクロール）時は何もしない
import { describe, expect, it } from 'vitest'
import {
  activationOf,
  exceeds,
  gesture,
  IDLE,
  MOUSE_GRAB_PX,
  pointerKind,
  TOUCH_HOLD_MS,
  TOUCH_SLOP_PX,
  type GestureEffect,
  type GestureInput,
  type GestureState,
} from './gesture'

const down = (pointerType: string, o: Partial<Extract<GestureInput, { type: 'down' }>> = {}): GestureInput => ({
  type: 'down',
  pointerId: 1,
  pointerType,
  x: 100,
  y: 200,
  button: 0,
  isPrimary: true,
  ...o,
})
const move = (x: number, y: number, pointerId = 1): GestureInput => ({ type: 'move', pointerId, x, y })
const up = (pointerId = 1): GestureInput => ({ type: 'up', pointerId })
const cancel = (pointerId = 1): GestureInput => ({ type: 'cancel', pointerId })
const hold: GestureInput = { type: 'hold' }

/** 出来事を順に流し、最後の様子と、出た「する事」の並び */
function run(inputs: GestureInput[], from: GestureState = IDLE): { state: GestureState; effects: GestureEffect[] } {
  let state = from
  const effects: GestureEffect[] = []
  for (const input of inputs) {
    const step = gesture(state, input)
    state = step.state
    if (step.effect) effects.push(step.effect)
  }
  return { state, effects }
}

describe('値（SPEC 7.11）', () => {
  it('マウス 5px、指 0.4秒・8px', () => {
    expect([MOUSE_GRAB_PX, TOUCH_HOLD_MS, TOUCH_SLOP_PX]).toEqual([5, 400, 8])
    expect(activationOf('mouse')).toEqual({ kind: 'distance', px: 5 })
    expect(activationOf('touch')).toEqual({ kind: 'hold', ms: 400, slopPx: 8 })
    expect(activationOf('pen')).toEqual({ kind: 'hold', ms: 400, slopPx: 8 })
  })

  it('知らない pointerType は指と同じ', () => {
    expect(pointerKind('')).toBe('touch')
    expect(pointerKind('mouse')).toBe('mouse')
    expect(pointerKind('pen')).toBe('pen')
  })

  it('距離は「超えたか」で比べる（dnd-kit の Distance と同じ。斜めは直線の長さ）', () => {
    expect(exceeds(5, 0, 5)).toBe(false)
    expect(exceeds(5, 1, 5)).toBe(true)
    expect(exceeds(3, 4, 5)).toBe(false)
    expect(exceeds(4, 4, 5)).toBe(true)
    expect(exceeds(-6, 0, 5)).toBe(true)
  })
})

describe('マウス（CALENDAR-158）', () => {
  it('押したまま 5px を超えて動かすと掴もうとした。離すと release', () => {
    expect(run([down('mouse'), move(103, 200), move(104, 203)]).effects).toEqual([])
    const r = run([down('mouse'), move(103, 200), move(106, 200), move(140, 260), up()])
    expect(r.effects).toEqual(['attempt', 'release'])
    expect(r.state).toEqual(IDLE)
  })

  it('5px 以内で離すとクリック（何もしない）', () => {
    const r = run([down('mouse'), move(104, 203), up()])
    expect(r.effects).toEqual([])
    expect(r.state).toEqual(IDLE)
  })

  it('長押ししてもマウスは掴もうとしない（距離だけ）', () => {
    expect(run([down('mouse'), hold]).effects).toEqual([])
  })

  it('左ボタン以外・2本目の pointer は見ない', () => {
    expect(run([down('mouse', { button: 2 }), move(140, 200)]).effects).toEqual([])
    expect(run([down('mouse', { isPrimary: false }), move(140, 200)]).effects).toEqual([])
  })
})

describe('指・ペン（CALENDAR-159・160）', () => {
  it.each(['touch', 'pen'])('%s: 0.4秒押し続けると掴もうとした（その後は動いても同じ）。離すと release', (type) => {
    const r = run([down(type), move(104, 205), hold, move(100, 400), up()])
    expect(r.effects).toEqual(['attempt', 'release'])
  })

  it('8px 以内の揺れは続ける。8px を超えて動くとスクロール（見るのをやめ、その後の hold・up では何もしない）', () => {
    expect(run([down('touch'), move(108, 200), hold]).effects).toEqual(['attempt'])
    const r = run([down('touch'), move(100, 209), hold, up()])
    expect(r.effects).toEqual([])
    expect(r.state).toEqual(IDLE)
  })

  it('0.4秒より前に離すと軽く押した（何もしない）', () => {
    expect(run([down('touch'), up(), hold]).effects).toEqual([])
  })

  it('pointercancel（ブラウザがスクロールを始めた）は離したのと同じ', () => {
    expect(run([down('touch'), cancel()]).effects).toEqual([])
    expect(run([down('touch'), hold, cancel()]).effects).toEqual(['attempt', 'release'])
  })

  it('ほかの pointerId の動き・離しは見ない', () => {
    const r = run([down('touch'), move(100, 400, 2), up(2), hold])
    expect(r.effects).toEqual(['attempt'])
    expect(r.state).toEqual({ phase: 'attempting', pointerId: 1, pointer: 'touch' })
  })

  it('押している間の2回目の down は見ない（初めの押し方のまま）', () => {
    const r = run([down('touch'), down('mouse', { pointerId: 2 })])
    expect(r.state).toEqual({ phase: 'pressed', pointerId: 1, pointer: 'touch', x: 100, y: 200 })
  })
})
