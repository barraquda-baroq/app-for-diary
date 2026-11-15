// 指で左右になぞる（useSwipe。docs/SPEC.md の 3.1・3.7）の、iPhone・iPad の画面の端の指: 画面の左右の端から端の幅（初めは
// EDGE_ZONE_PX の 36px。設定の「開発」の「端の幅」で 20・28・36・44px から選ぶ。src/history/edgeZone.ts）の中で押した指は、
// 端からのフリック（src/history/edgeFlick.ts が window で受け取ってモードを回す。同じ edgeOfScreen で決める）なので、ここでは数えない
// （前後の期間へ移らない。1回の払いでモードと期間の両方が替わらない）。端の幅より内側の指は今までどおり前後の期間へ。文字を打っている
// 間・入力欄の上から押した指はどれも数えない（端からのフリックと違い、フォーカスの無い入力欄の上からの指も数えない）。Android・PC は
// 端の指も今までどおり前後の期間へ。カレンダーの区切りに付けた時の動き（期間・モード）は CalendarView.test.tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setEdgeZonePx } from '../../../history/edgeZone'
import * as device from '../../../ui/device'
import { EDGE_ZONE_PX } from './swipe'
import { useSwipe } from './useSwipe'

function Area({ onSwipe }: { onSwipe: (dir: 1 | -1) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useSwipe(ref, true, onSwipe)
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

function setup() {
  const onSwipe = vi.fn()
  render(<Area onSwipe={onSwipe} />)
  return { onSwipe, area: screen.getByTestId('area') }
}

beforeEach(() => {
  vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setEdgeZonePx(EDGE_ZONE_PX)
  localStorage.clear()
})

describe('iPhone・iPad の画面の端の指は端からのフリック（ここでは数えない。3.1・3.7）', () => {
  it('左の端（5px・30px）から右へ・右の端（幅 − 5px・幅 − 30px）から左へ払っても、前後の期間へは移らない（初めの端の幅 36px の中。モードを回すのは src/history/edgeFlick.ts）', () => {
    const { onSwipe, area } = setup()
    flick(area, 5, 100)
    flick(area, width() - 5, -100)
    flick(area, 30, 100)
    flick(area, width() - 30, -100)
    flick(area, EDGE_ZONE_PX - 1, 100)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it(`端から ${EDGE_ZONE_PX}px より内側（40px・60px・100px）から払うと、今までどおり前後の期間へ（onSwipe）`, () => {
    const { onSwipe, area } = setup()
    flick(area, 40, 100)
    flick(area, 60, 100)
    flick(area, 100, 100)
    flick(area, EDGE_ZONE_PX, 100)
    flick(area, width() - 60, -100)
    expect(onSwipe.mock.calls).toEqual([[-1], [-1], [-1], [-1], [1]])
  })

  it('設定の「開発」で端の幅を替えると、付けたまま（読み込み直さずに）次の指から効く（端からのフリックと同じ幅。1回の払いでモードと期間の両方が替わらない）', () => {
    const { onSwipe, area } = setup()
    setEdgeZonePx(20)
    flick(area, 30, 100)
    flick(area, width() - 30, -100)
    expect(onSwipe.mock.calls).toEqual([[-1], [1]])
    flick(area, 19, 100)
    expect(onSwipe).toHaveBeenCalledTimes(2)
    setEdgeZonePx(44)
    flick(area, 40, 100)
    flick(area, width() - 40, -100)
    expect(onSwipe).toHaveBeenCalledTimes(2)
    flick(area, 50, 100)
    expect(onSwipe).toHaveBeenCalledTimes(3)
  })

  it('ブラウザに取られた（pointercancel）後も touch の出来事で追うのは内側の指だけ（端の指は初めから追わない）', () => {
    const { onSwipe, area } = setup()
    act(() => {
      fireEvent(area, finger('pointerdown', 3, 300))
      document.dispatchEvent(finger('pointermove', 12, 306))
      document.dispatchEvent(finger('pointercancel', 12, 306))
      touch('touchmove', 60, 310, true)
      touch('touchmove', 140, 318, true)
      touch('touchend', 160, 320, false)
    })
    expect(onSwipe).not.toHaveBeenCalled()
    act(() => {
      fireEvent(area, finger('pointerdown', 60, 300))
      document.dispatchEvent(finger('pointermove', 69, 306))
      document.dispatchEvent(finger('pointercancel', 69, 306))
      touch('touchmove', 120, 310, true)
      touch('touchmove', 200, 318, true)
      touch('touchend', 220, 320, false)
    })
    expect(onSwipe.mock.calls).toEqual([[-1]])
  })

  it('文字を打っている間（入力欄にフォーカスがある）は、内側の指も数えない（端の指の例外は無くした）。入力欄の上から押した指も数えない', () => {
    const { onSwipe, area } = setup()
    act(() => (screen.getByTestId('field') as HTMLInputElement).focus())
    flick(area, 100, 100)
    flick(area, width() - 4, -120)
    flick(screen.getByTestId('field'), 100, 120)
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('なぞって移った直後にカレンダーの中へ来た click は打ち消す（払った指で離した所のボタンを押さない）', () => {
    const { onSwipe, area } = setup()
    const clicked = vi.fn()
    screen.getByTestId('inside').addEventListener('click', clicked)
    flick(area, 100, 100)
    expect(onSwipe).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('inside'))
    expect(clicked).not.toHaveBeenCalled()
  })

  it('マウスの時は数えない（指だけ）', () => {
    const { onSwipe, area } = setup()
    flick(area, 100, 100, 300, 'mouse')
    expect(onSwipe).not.toHaveBeenCalled()
  })
})

describe('Android・PC（OS の戻る）は今までどおり', () => {
  it('画面の端から払っても前後の期間へ（onSwipe。端の幅を替えても同じ）。文字を打っている間はなぞっても移らない', () => {
    vi.mocked(device.currentPopSource).mockReturnValue('os-back')
    const read = vi.spyOn(Storage.prototype, 'getItem')
    const { onSwipe, area } = setup()
    flick(area, 5, 100)
    flick(area, width() - 5, -100)
    expect(onSwipe.mock.calls).toEqual([[-1], [1]])
    // 端の幅は読みもしない（Android・PC には端からのフリックが無い）
    expect(read.mock.calls.filter(([k]) => k === 'diary-studio:edge-zone')).toEqual([])
    read.mockRestore()
    act(() => (screen.getByTestId('field') as HTMLInputElement).focus())
    flick(area, 5, 100)
    expect(onSwipe).toHaveBeenCalledTimes(2)
  })
})
