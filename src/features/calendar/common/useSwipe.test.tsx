// 指で左右になぞる（useSwipe。docs/SPEC.md の 3.1・3.7）の、iPhone・iPad の画面の端の指: 画面の左右の端から EDGE_ZONE_PX の中で押して
// 内へ払った指は、ブラウザが身振りにしなかった時（前の払いの絵が消える前・その向きに履歴が無い時）の端からのフリックとして onEdge を
// 呼ぶ（モードを回す。前後の期間へは移らない）。文字を打っている間も（すばやく足すの入力欄にフォーカスがあっても）回す。外へ払った指・
// 押した後に利用者の「戻る」「進む」が来た指（ブラウザが身振りにした）では何もしない。Android・PC と、端から 20px より内側の指は
// 今までどおり onSwipe（前後の期間へ）。カレンダーの区切りに付けた時の動き（期間・モード）は CalendarView.test.tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as appHistory from '../../../history/appHistory'
import * as device from '../../../ui/device'
import { EDGE_ZONE_PX } from './swipe'
import { useSwipe } from './useSwipe'

function Area({ onSwipe, onEdge }: { onSwipe: (dir: 1 | -1) => void; onEdge?: (dir: 1 | -1) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSwipe(ref, true, onSwipe, onEdge)
  return (
    <div ref={ref} data-testid="area">
      <button type="button" data-testid="inside">
        押せる物
      </button>
      <input data-testid="field" />
    </div>
  )
}

const width = () => window.innerWidth

/** 指の PointerEvent（pointerType: touch・pointerId: 9） */
const finger = (type: string, x: number, y: number, pointerType = 'touch') =>
  new PointerEvent(type, { bubbles: true, pointerType, pointerId: 9, isPrimary: true, clientX: x, clientY: y })

/** 要素の上で押して、横へ dx（px）動かして離す（指の出来事だけ。ブラウザに取られない） */
function flick(el: Element, x: number, dx: number, y = 300, pointerType = 'touch') {
  act(() => {
    fireEvent(el, finger('pointerdown', x, y, pointerType))
    document.dispatchEvent(finger('pointermove', x + dx / 2, y, pointerType))
    document.dispatchEvent(finger('pointerup', x + dx, y, pointerType))
  })
}

/** 指の touch の出来事を document へ送る（jsdom には Touch が無いので、座標の入った物を持たせる） */
function touch(type: string, x: number, y: number, down: boolean) {
  const ev = new Event(type, { bubbles: true })
  const list = [{ clientX: x, clientY: y }]
  Object.defineProperty(ev, 'touches', { value: down ? list : [] })
  Object.defineProperty(ev, 'changedTouches', { value: list })
  document.dispatchEvent(ev)
}

function setup(withEdge = true) {
  const onSwipe = vi.fn()
  const onEdge = vi.fn()
  render(<Area onSwipe={onSwipe} onEdge={withEdge ? onEdge : undefined} />)
  return { onSwipe, onEdge, area: screen.getByTestId('area') }
}

beforeEach(() => {
  vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('iPhone・iPad の画面の端から払った指（ブラウザが身振りにしなかった時。3.1）', () => {
  it('左の端（5px）から右へ 100px 払うと onEdge(-1)（日→週→月→年の向き）。期間へは移らない', () => {
    const { onSwipe, onEdge, area } = setup()
    flick(area, 5, 100)
    expect(onEdge).toHaveBeenCalledTimes(1)
    expect(onEdge).toHaveBeenCalledWith(-1)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('右の端（幅 − 5px）から左へ 100px 払うと onEdge(1)', () => {
    const { onSwipe, onEdge, area } = setup()
    flick(area, width() - 5, -100)
    expect(onEdge).toHaveBeenCalledWith(1)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it(`端から ${EDGE_ZONE_PX}px より内側（100px）から払うと、今までどおり前後の期間へ（onSwipe）`, () => {
    const { onSwipe, onEdge, area } = setup()
    flick(area, 100, 100)
    flick(area, EDGE_ZONE_PX, 100)
    expect(onSwipe.mock.calls).toEqual([[-1], [-1]])
    expect(onEdge).not.toHaveBeenCalled()
  })

  it('すばやく足すの入力欄にフォーカスがあっても、端からの払いは回す（入力欄の外の端の指だけ）。内側からの払いは今までどおり何もしない', () => {
    const { onSwipe, onEdge, area } = setup()
    act(() => (screen.getByTestId('field') as HTMLInputElement).focus())
    flick(area, 100, 100)
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onEdge).not.toHaveBeenCalled()
    flick(area, width() - 4, -120)
    expect(onEdge).toHaveBeenCalledWith(1)
    expect(onSwipe).not.toHaveBeenCalled()
    // 入力欄の上から押した指は、端でも数えない（字を選ぶ・動かす指）
    flick(screen.getByTestId('field'), 4, 120)
    expect(onEdge).toHaveBeenCalledTimes(1)
  })

  it('押した後に利用者の「戻る」「進む」が来た（ブラウザが身振りにした）指では何もしない。比べる時刻は押した時の performance.now', () => {
    const { onSwipe, onEdge, area } = setup()
    const since = vi.spyOn(appHistory, 'userPopSince').mockReturnValue(true)
    const before = performance.now()
    flick(area, 5, 100)
    const after = performance.now()
    expect(onEdge).not.toHaveBeenCalled()
    expect(onSwipe).not.toHaveBeenCalled()
    expect(since).toHaveBeenCalledTimes(1)
    const t = since.mock.calls[0][0]
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(after)
    since.mockReturnValue(false)
    flick(area, 5, 100)
    expect(onEdge).toHaveBeenCalledTimes(1)
  })

  it('端から外へ払った指・短い指・縦の指では何もしない（期間へも移らない）', () => {
    const { onSwipe, onEdge, area } = setup()
    flick(area, width() - 5, 100)
    flick(area, 5, -100)
    flick(area, 5, 40)
    act(() => {
      fireEvent(area, finger('pointerdown', 5, 300))
      document.dispatchEvent(finger('pointerup', 15, 420))
    })
    expect(onEdge).not.toHaveBeenCalled()
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('ブラウザに取られた（pointercancel）後も touch の出来事で追い、内へ払えば回す', () => {
    const { onEdge, area } = setup()
    act(() => {
      fireEvent(area, finger('pointerdown', 3, 300))
      document.dispatchEvent(finger('pointermove', 12, 306))
      document.dispatchEvent(finger('pointercancel', 12, 306))
      touch('touchmove', 60, 310, true)
      touch('touchmove', 140, 318, true)
      touch('touchend', 160, 320, false)
    })
    expect(onEdge).toHaveBeenCalledWith(-1)
  })

  it('回した直後にカレンダーの中へ来た click は打ち消す（払った指で離した所のボタンを押さない）', () => {
    const { onEdge, area } = setup()
    const clicked = vi.fn()
    screen.getByTestId('inside').addEventListener('click', clicked)
    flick(area, 5, 100)
    expect(onEdge).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('inside'))
    expect(clicked).not.toHaveBeenCalled()
  })

  it('onEdge を渡していない所では、端からの払いも今までどおり onSwipe', () => {
    const { onSwipe, area } = setup(false)
    flick(area, 5, 100)
    expect(onSwipe).toHaveBeenCalledWith(-1)
  })

  it('マウスの時は端でも数えない（指だけ）', () => {
    const { onSwipe, onEdge, area } = setup()
    flick(area, 5, 100, 300, 'mouse')
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onEdge).not.toHaveBeenCalled()
  })
})

describe('Android・PC（OS の戻る）は今までどおり', () => {
  it('画面の端から払っても前後の期間へ（onSwipe。onEdge は呼ばない）。文字を打っている間はなぞっても移らない', () => {
    vi.mocked(device.currentPopSource).mockReturnValue('os-back')
    const { onSwipe, onEdge, area } = setup()
    flick(area, 5, 100)
    flick(area, width() - 5, -100)
    expect(onSwipe.mock.calls).toEqual([[-1], [1]])
    expect(onEdge).not.toHaveBeenCalled()
    act(() => (screen.getByTestId('field') as HTMLInputElement).focus())
    flick(area, 5, 100)
    expect(onSwipe).toHaveBeenCalledTimes(2)
    expect(onEdge).not.toHaveBeenCalled()
  })
})
