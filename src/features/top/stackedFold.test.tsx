// S・M の積んだ所の、見ている所・積んだ所の形を出すことと、その場で畳むこと（src/features/top/TopPage.tsx の StackedTop・stackedFold.ts。
// docs/SPEC.md の 3.1・3.5・■34 の作者の答え）: 打ちかけを捨ててから畳む土台（closeShownList が使う discardListDraft・foldListInPlace）。
// カレンダーへスクロールで戻さず、見出しが隠れていれば切り替えの列のすぐ下まで戻すだけ。フォーカスはそのリストの中にあった時だけ、
// そのリストの畳む・開くボタンへ（カレンダーの見出しへは移さない）。履歴は動かさない
import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStackedLists } from '../../store/uiStore'
import { renderAt, setupCalendarTests } from '../../test/renderCalendar'
import { discardListDraft } from '../lists/common/listDraft'
import { draftKey } from '../lists/common/listInputModel'
import { listTestIds } from '../lists/common/testIds'
import { foldListInPlace, foldScrollTop } from './stackedFold'

setupCalendarTests()

const lists = () => useStackedLists.getState()

/** 区切りを開く（切り替えの列で飛ぶ） */
async function openTask() {
  fireEvent.click(screen.getByTestId('top-jump-task'))
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
  expect(lists().collapsed.task).toBe(false)
}

describe('S3 見ている所と積んだ所の形（3.5・■34 の「開いているリスト」）', () => {
  it('S・M は形（幅・S の全面の MIM か）と見ている所を出す。切り替えの列で押した物が見ている所になる', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    expect(lists().layout).toEqual({ width: 'S', fullMim: false })
    expect(lists().shown).toBe('calendar')
    await openTask()
    expect(lists().shown).toBe('task')
  })

  it('L は形が無く、見ている所はカレンダー', async () => {
    await renderAt('/month/2026-11', { width: 'L' })
    expect(lists().layout).toBeNull()
    expect(lists().shown).toBe('calendar')
  })

  it('S の全面の MIM は fullMim（リストを隠している）、見ている所はカレンダー。M の MIM は全面でない', async () => {
    const s = await renderAt('/mim', { width: 'S' })
    expect(lists().layout).toEqual({ width: 'S', fullMim: true })
    expect(lists().shown).toBe('calendar')
    s.unmount()
    expect(lists().layout).toBeNull()
    await renderAt('/mim', { width: 'M' })
    expect(lists().layout).toEqual({ width: 'M', fullMim: false })
  })
})

describe('S3 その場で畳む（foldListInPlace。■34）', () => {
  it('開いているリストを畳み、フォーカスがその中にあれば、そのリストの畳む・開くボタンへ移す（カレンダーの見出しへは移さない）。履歴は動かさない', async () => {
    const { router } = await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const input = screen.getByTestId(listTestIds.input('task'))
    input.focus()
    const key = router.state.location.key
    act(() => foldListInPlace('task'))
    expect(lists().collapsed.task).toBe(true)
    expect(document.activeElement).toBe(screen.getByTestId(listTestIds.fold('task')))
    expect(router.state.location.key).toBe(key)
  })

  it('フォーカスがほかの所にある時は動かさない。畳んであるリスト・L では何もしない', async () => {
    const r = await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const other = screen.getByTestId('top-jump-calendar')
    other.focus()
    act(() => foldListInPlace('task'))
    expect(document.activeElement).toBe(other)
    act(() => foldListInPlace('routine'))
    expect(lists().collapsed.routine).toBe(true)
    r.unmount()
    await renderAt('/month/2026-11', { width: 'L' })
    act(() => foldListInPlace('task'))
    expect(screen.getByTestId(listTestIds.section('task')).getAttribute('data-collapsed')).toBe('false')
  })

  it('見出しが切り替えの列の下に隠れている時は、切り替えの列のすぐ下まで戻すだけ（いちばん上のカレンダーへは戻さない）。見えていれば動かさない', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const pane = screen.getByTestId(listTestIds.section('task'))
    pane.style.scrollMarginTop = '96px'
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as typeof window.scrollTo
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 2000 })
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: -500, bottom: 300 } as DOMRect)
    act(() => foldListInPlace('task'))
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000 - 500 - 96, behavior: 'auto' })
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  it('打ちかけを捨ててから畳む（closeShownList の順）: 欄も端末の書きかけも空になり、畳む・開くで開き直しても空', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const input = screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '捨てる字' } })
    input.focus()
    act(() => {
      discardListDraft('task')
      foldListInPlace('task')
    })
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    expect((screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement).value).toBe('')
  })

  it('見出しの［▾］で畳んだ時は、打ちかけを残す（3.6・D16）', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const input = screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '残す字' } })
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    expect((screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement).value).toBe('残す字')
  })
})

describe('S3 畳む前のスクロールの直し（foldScrollTop）', () => {
  it('見出しが見える所の上の端より上なら、そこへ戻す位置。見えていれば null（動かさない）', () => {
    expect(foldScrollTop(-500, 96, 2000)).toBe(1404)
    expect(foldScrollTop(96, 96, 2000)).toBeNull()
    expect(foldScrollTop(300, 96, 2000)).toBeNull()
    expect(foldScrollTop(-500, 96, 100)).toBe(0)
  })
})
