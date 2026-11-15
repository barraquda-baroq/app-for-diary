// リストのメニュー・小窓の「戻る」（common/listPopups.ts と src/features/top/closeApp.ts の consumeBackPress。docs/SPEC.md の 3.1・■34。
// 開発）: 開いている間だけ閉じる関数が届き、「戻る」はそれを閉じて使い切る。画面の端のメニューの外に指を置いた時に開いていて、その指で
// 閉じた時（iPhone の端からのフリック）も、その指の間と離してから少しの間の「戻る」は1回だけ使い切る
import { act, cleanup, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarUi } from '../../../store/uiStore'
import { cancelAllDialogs, confirmDialog, hasOpenDialog } from '../../../ui/dialogs'
import { consumeBackPress } from '../../top/closeApp'
import { closeListPopups, listPopupOpen, PRESS_GRACE_MS, resetListPopupsForTests, useListPopup } from './listPopups'

/** 開け閉めできる小窓（開いている間だけ届ける） */
function Popup({ initial = true, onClose }: { initial?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initial)
  useListPopup(open, () => {
    onClose?.()
    setOpen(false)
  })
  return (
    <div>
      <button type="button" data-testid="toggle" onClick={() => setOpen((o) => !o)} />
      {open ? <div data-testid="popup" /> : null}
    </div>
  )
}

const down = () => window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: 2 }))
const touchEnd = () => window.dispatchEvent(new Event('touchend'))

describe('S3 リストのメニュー・小窓の「戻る」（listPopups）', () => {
  beforeEach(() => {
    resetListPopupsForTests()
    useCalendarUi.setState({ dragging: false })
  })
  afterEach(() => {
    cleanup()
    cancelAllDialogs()
    vi.useRealTimers()
  })

  it('開いている間だけ届き、closeListPopups はそれを閉じて true。開いている物が無ければ false', () => {
    const onClose = vi.fn()
    const r = render(<Popup onClose={onClose} />)
    expect(listPopupOpen()).toBe(true)
    let used = false
    act(() => {
      used = closeListPopups()
    })
    expect(used).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(r.queryByTestId('popup')).toBeNull()
    expect(listPopupOpen()).toBe(false)
    expect(closeListPopups()).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('外れた（描かなくなった）部品の物は届かない', () => {
    const r = render(<Popup />)
    r.unmount()
    expect(listPopupOpen()).toBe(false)
    expect(closeListPopups()).toBe(false)
  })

  it('押し始めに開いていて、その押しで閉じた時は、離すまでと離してから PRESS_GRACE_MS までの「戻る」を1回だけ使い切る', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const r = render(<Popup />)
    act(() => down())
    // 外を押したので閉じた（PopupMenu・Popover と同じ）
    act(() => r.getByTestId('toggle').click())
    expect(listPopupOpen()).toBe(false)
    expect(closeListPopups()).toBe(true)
    // 2回目は使い切らない
    expect(closeListPopups()).toBe(false)
    // 次の押しでも、開いていて閉じた
    act(() => r.getByTestId('toggle').click())
    act(() => down())
    act(() => r.getByTestId('toggle').click())
    act(() => touchEnd())
    vi.advanceTimersByTime(PRESS_GRACE_MS - 50)
    expect(closeListPopups()).toBe(true)
  })

  it('離してから PRESS_GRACE_MS より後の「戻る」（Android の［戻る］など）と、何も開いていない時に押した後の「戻る」は使い切らない', () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const r = render(<Popup />)
    act(() => down())
    act(() => r.getByTestId('toggle').click())
    act(() => touchEnd())
    vi.advanceTimersByTime(PRESS_GRACE_MS + 50)
    expect(closeListPopups()).toBe(false)
    // 何も開いていない時に押した指
    act(() => down())
    expect(closeListPopups()).toBe(false)
  })

  it('画面の端でない所に置いた指・メニューや小窓の中に置いた指（項目を選んだ）・マウスは控えない（その後の「戻る」は使い切らない）', () => {
    const r = render(
      <>
        <Popup />
        <div role="menu" data-testid="menu-inside" />
      </>,
    )
    const press = (init: PointerEventInit, target: EventTarget = window) => {
      act(() => {
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...init }))
      })
      act(() => r.getByTestId('toggle').click())
      const used = closeListPopups()
      act(() => touchEnd())
      // 次のために開き直す
      act(() => r.getByTestId('toggle').click())
      return used
    }
    expect(press({ pointerType: 'touch', clientX: 500 })).toBe(false)
    expect(press({ pointerType: 'touch', clientX: 2 }, r.getByTestId('menu-inside'))).toBe(false)
    expect(press({ pointerType: 'mouse', clientX: 2 })).toBe(false)
    // 端の外の指は控える（比べるため）
    expect(press({ pointerType: 'touch', clientX: 2 })).toBe(true)
  })

  it('consumeBackPress: 確かめのダイアログが先（ダイアログだけを閉じ、リストの小窓は残す）、掴んでいる間は何もしない、その次にリストのメニュー・小窓を閉じる', async () => {
    const r = render(<Popup />)
    void confirmDialog({ title: '確かめ' })
    expect(hasOpenDialog()).toBe(true)
    act(() => {
      expect(consumeBackPress()).toBe(true)
    })
    expect(hasOpenDialog()).toBe(false)
    expect(r.getByTestId('popup')).toBeTruthy()
    useCalendarUi.setState({ dragging: true })
    expect(consumeBackPress()).toBe(true)
    expect(r.getByTestId('popup')).toBeTruthy()
    useCalendarUi.setState({ dragging: false })
    act(() => {
      expect(consumeBackPress()).toBe(true)
    })
    expect(r.queryByTestId('popup')).toBeNull()
    expect(consumeBackPress()).toBe(false)
  })
})
