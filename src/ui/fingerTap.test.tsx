// 指で押して離した時に効く押す所（src/ui/fingerTap.ts。docs/SPEC.md の 3.9）: 指は、ブラウザが click を作るのを待たずに、指を
// 離した時に自分で click を送って1回効き、その touchend を止めてブラウザに click を作らせない。送った click は、ほかの所の click の
// 見張り（外を押して閉じたメニューが続く click を捨てる・すばやく足すが押し終わったとして閉じる）をふつうの click と同じに通る。
// なぞった・2本目の指・ブラウザが指を受け取った時は効かない。マウス・キーボードの click はこれまでどおり効く
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TAP_CLICK_GUARD_MS, TAP_SLOP_PX, useFingerTap } from './fingerTap'

function Tap({ onTap }: { onTap: () => void }) {
  const handlers = useFingerTap(onTap)
  return (
    <button type="button" {...handlers}>
      元に戻す
    </button>
  )
}

function setup() {
  const onTap = vi.fn()
  render(<Tap onTap={onTap} />)
  return { onTap, button: screen.getByRole('button', { name: '元に戻す' }) }
}

/** 指（番号 id）の位置 */
const at = (x: number, y: number, id = 1) => ({ identifier: id, clientX: x, clientY: y })

type Finger = ReturnType<typeof at>

/** 指の出来事を送る（jsdom の TouchEvent は Touch を作れないので、ふつうの Event に指の一覧を載せる）。止められたら false */
function touch(el: Element, type: string, touches: Finger[], changed: Finger[], cancelable = true): boolean {
  const e = new Event(type, { bubbles: true, cancelable })
  Object.assign(e, { touches, targetTouches: touches, changedTouches: changed })
  return el.dispatchEvent(e)
}

/** 指で押す（ほかに触れている指 others） */
function down(el: Element, x = 20, y = 20, others: Finger[] = []) {
  touch(el, 'touchstart', [...others, at(x, y)], [at(x, y)])
}

/** 指を動かす */
function move(el: Element, x: number, y: number) {
  touch(el, 'touchmove', [at(x, y)], [at(x, y)])
}

/** 指を離す（止められる出来事か cancelable・ほかに残っている指 others）。止めたら false */
function up(el: Element, x = 20, y = 20, { cancelable = true, others = [] as Finger[] } = {}): boolean {
  return touch(el, 'touchend', others, [at(x, y)], cancelable)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('指で押して離した時に効く（3.9）', () => {
  it('指を離した時に、click を待たずに1回効き、その touchend を止める（ブラウザに click を作らせない）', () => {
    const { onTap, button } = setup()
    down(button)
    expect(onTap).not.toHaveBeenCalled()
    expect(up(button)).toBe(false)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('送る click は、ほかの所の click の見張りを通る: 捕まえる段階で見ている所が先に知り、そこで止められた（外を押して閉じたメニューが捨てた）時は効かない', () => {
    const { onTap, button } = setup()
    const seen: string[] = []
    const watch = (e: Event) => seen.push(`${e.type}:${onTap.mock.calls.length}`)
    window.addEventListener('click', watch, true)
    down(button)
    up(button)
    // 見張りが知った時は、まだ効いていない（効くのはその後）
    expect(seen).toEqual(['click:0'])
    expect(onTap).toHaveBeenCalledTimes(1)
    window.removeEventListener('click', watch, true)
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    vi.useFakeTimers({ toFake: ['performance'] })
    vi.advanceTimersByTime(TAP_CLICK_GUARD_MS + 1)
    down(button)
    expect(up(button)).toBe(false)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('止めても click が来た時は、同じ押し方の物として効かせない。少したった後の click（マウス・キーボード）は効く', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const { onTap, button } = setup()
    down(button)
    up(button)
    fireEvent.click(button)
    expect(onTap).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(TAP_CLICK_GUARD_MS + 1)
    fireEvent.click(button)
    expect(onTap).toHaveBeenCalledTimes(2)
  })

  it(`押してから ${TAP_SLOP_PX}px より動かした（なぞった）時は効かず、touchend も止めない`, () => {
    const { onTap, button } = setup()
    down(button, 20, 20)
    move(button, 20, 32)
    expect(up(button, 20, 32)).toBe(true)
    // 動いた後に戻ってきても効かない
    down(button, 20, 20)
    move(button, 40, 20)
    expect(up(button, 20, 20)).toBe(true)
    // 離した所だけが離れていても効かない
    down(button, 20, 20)
    expect(up(button, 20 + TAP_SLOP_PX + 1, 20)).toBe(true)
    expect(onTap).not.toHaveBeenCalled()
    // 少しの揺れ（10px まで）は押した内
    down(button, 20, 20)
    move(button, 26, 26)
    expect(up(button, 26, 26)).toBe(false)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('2本目の指が触れた・ほかの指が残っている・ブラウザが指を受け取った（touchcancel・止められない touchend）時は効かない', () => {
    const { onTap, button } = setup()
    // 2本目の指
    down(button, 20, 20, [at(60, 60, 2)])
    up(button)
    // ほかの指が残っている
    down(button)
    expect(up(button, 20, 20, { others: [at(60, 60, 2)] })).toBe(true)
    // touchcancel
    down(button)
    touch(button, 'touchcancel', [], [at(20, 20)])
    up(button)
    // 止められない touchend（スクロールになった）
    down(button)
    expect(up(button, 20, 20, { cancelable: false })).toBe(true)
    // 押していない指の touchend
    up(button)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('マウス・キーボード（Enter・Space）の click はこれまでどおり1回ずつ効く', async () => {
    const user = userEvent.setup()
    const { onTap, button } = setup()
    await user.click(button)
    expect(onTap).toHaveBeenCalledTimes(1)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onTap).toHaveBeenCalledTimes(3)
  })
})
