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
import { foldListInPlace, foldScrollTop, foldSpacerHeight } from './stackedFold'

setupCalendarTests()

const lists = () => useStackedLists.getState()

/** window・document の大きさを仮に決める（jsdom は 0。終わったら戻す） */
function fakeGeometry(p: { scrollY: number; scrollHeight: number; innerHeight: number }): () => void {
  const innerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
  Object.defineProperty(window, 'scrollY', { configurable: true, value: p.scrollY })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: p.innerHeight })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: p.scrollHeight })
  return () => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
    if (innerHeight) Object.defineProperty(window, 'innerHeight', innerHeight)
    delete (document.documentElement as unknown as Record<string, unknown>).scrollHeight
  }
}

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

  it('見出しが見えている時は、畳んでもページを動かさない（scrollTo を呼ばない）。フォーカスはそのリストの畳む・開くボタンへ（カレンダーの見出しへは移さない）', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const pane = screen.getByTestId(listTestIds.section('task'))
    pane.style.scrollMarginTop = '96px'
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as typeof window.scrollTo
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 900 } as DOMRect)
    screen.getByTestId(listTestIds.input('task')).focus()
    act(() => foldListInPlace('task'))
    expect(lists().collapsed.task).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByTestId(listTestIds.fold('task')))
  })

  it('ページの終わりが近い時は、畳んで縮む分（中身の高さ）だけブラウザが位置を上へ止め直さないように、いちばん下の空きを足りない分だけ先に足す（位置も見出しも動かさない）。足りている時は空きを替えない', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const pane = screen.getByTestId(listTestIds.section('task'))
    pane.style.scrollMarginTop = '96px'
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as typeof window.scrollTo
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 200, bottom: 900 } as DOMRect)
    vi.spyOn(screen.getByTestId(listTestIds.body('task')), 'getBoundingClientRect').mockReturnValue({
      height: 300,
    } as DOMRect)
    const spacer = screen.getByTestId('top-stack-spacer')
    // 畳む前: 1900 の高さで 800 の画面、位置は 1000（いちばん下は 1100）。畳むと 1600 になり、いちばん下は 800 まで
    const restore = fakeGeometry({ scrollY: 1000, scrollHeight: 1900, innerHeight: 800 })
    try {
      act(() => foldListInPlace('task'))
    } finally {
      restore()
    }
    expect(lists().collapsed.task).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(spacer.style.height).toBe('200px')

    // 足りている時（畳んでもいちばん下が今の位置より下）は替えない
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    spacer.style.height = ''
    const restore2 = fakeGeometry({ scrollY: 500, scrollHeight: 1900, innerHeight: 800 })
    try {
      act(() => foldListInPlace('task'))
    } finally {
      restore2()
    }
    expect(lists().collapsed.task).toBe(true)
    expect(spacer.style.height).toBe('')
  })

  it('長いリストを畳むと、畳んだ後のページが画面より短くなる時も、短い分まで空きを足して位置を保つ（ブラウザに位置を上へ止め直させない）', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const pane = screen.getByTestId(listTestIds.section('task'))
    pane.style.scrollMarginTop = '96px'
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as typeof window.scrollTo
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: 105, bottom: 1950 } as DOMRect)
    vi.spyOn(screen.getByTestId(listTestIds.body('task')), 'getBoundingClientRect').mockReturnValue({
      height: 1793,
    } as DOMRect)
    // 2575 の高さで 956 の画面、位置は 600。畳むと 782 になり画面より 174 短いので、600 を保つには 774 の空きが要る
    const restore = fakeGeometry({ scrollY: 600, scrollHeight: 2575, innerHeight: 956 })
    try {
      act(() => foldListInPlace('task'))
    } finally {
      restore()
    }
    expect(lists().collapsed.task).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByTestId('top-stack-spacer').style.height).toBe('774px')
  })

  it('見出しを切り替えの列のすぐ下まで戻した時は、戻した位置を保つように空きを足す', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const pane = screen.getByTestId(listTestIds.section('task'))
    pane.style.scrollMarginTop = '96px'
    window.scrollTo = vi.fn() as typeof window.scrollTo
    vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ top: -200, bottom: 500 } as DOMRect)
    vi.spyOn(screen.getByTestId(listTestIds.body('task')), 'getBoundingClientRect').mockReturnValue({
      height: 600,
    } as DOMRect)
    const restore = fakeGeometry({ scrollY: 1500, scrollHeight: 2400, innerHeight: 800 })
    try {
      act(() => foldListInPlace('task'))
    } finally {
      restore()
    }
    // 戻した位置は 1500 − 200 − 96 = 1204。畳むといちばん下は 2400 − 600 − 800 = 1000 なので 204 足す
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 1204, behavior: 'auto' })
    expect(screen.getByTestId('top-stack-spacer').style.height).toBe('204px')
  })

  it('変換の途中で入力欄にフォーカスがある時に打ちかけを捨てると、先にそのリストの畳む・開くボタンへフォーカスを移してから欄を空にする。続けて畳んでもフォーカスはそこ（closeShownList の順）', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const input = screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement
    input.focus()
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'すてる' } })
    const atBlur: string[] = []
    input.addEventListener('blur', () => atBlur.push(input.value))
    act(() => discardListDraft('task'))
    expect(atBlur).toEqual(['すてる'])
    expect(document.activeElement).toBe(screen.getByTestId(listTestIds.fold('task')))
    expect(input.value).toBe('')
    act(() => foldListInPlace('task'))
    expect(lists().collapsed.task).toBe(true)
    expect(document.activeElement).toBe(screen.getByTestId(listTestIds.fold('task')))
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

  it('見出しの［▾］で畳んだ時は、打ちかけを残す（3.6・開発）', async () => {
    await renderAt('/month/2026-11', { width: 'S' })
    await openTask()
    const input = screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '残す字' } })
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    expect((screen.getByTestId(listTestIds.input('task')) as HTMLTextAreaElement).value).toBe('残す字')
  })
})

describe('S3 畳む前のスクロールの直し（foldScrollTop・foldSpacerHeight）', () => {
  it('見出しが見える所の上の端より上なら、そこへ戻す位置。見えていれば null（動かさない）', () => {
    expect(foldScrollTop(-500, 96, 2000)).toBe(1404)
    expect(foldScrollTop(96, 96, 2000)).toBeNull()
    expect(foldScrollTop(300, 96, 2000)).toBeNull()
    expect(foldScrollTop(-500, 96, 100)).toBe(0)
  })

  it('畳んだ後のいちばん下（高さ − 縮む分 − 画面）より今の位置が下なら、足りない分を今の空きに足した高さ。足りていれば・縮まなければ null', () => {
    const base = { scrollHeight: 1900, innerHeight: 800, spacer: 0, lost: 300 }
    expect(foldSpacerHeight({ ...base, scrollY: 1000 })).toBe(200)
    expect(foldSpacerHeight({ ...base, scrollY: 800 })).toBeNull()
    expect(foldSpacerHeight({ ...base, scrollY: 1000, spacer: 40 })).toBe(240)
    expect(foldSpacerHeight({ ...base, scrollY: 1000.4 })).toBe(201)
    expect(foldSpacerHeight({ ...base, scrollY: 1000, lost: 0 })).toBeNull()
    // いちばん上（0）にいる時は、ページが画面より短くなっても位置は動かないので要らない
    expect(foldSpacerHeight({ scrollY: 0, scrollHeight: 800, innerHeight: 839, spacer: 0, lost: 100 })).toBeNull()
    // 畳んだ後のページ（空きを除いて 800）が画面（839）より短い時は、短い分も足す: 位置 50 を保つには 800 + 空き − 839 ≥ 50 で 89
    // （前は 0 で止めて 50 にしていたので、ブラウザが位置を 11 に止め直して見出しが上へ跳んだ）
    expect(foldSpacerHeight({ scrollY: 50, scrollHeight: 900, innerHeight: 839, spacer: 0, lost: 100 })).toBe(89)
    // 今の空き（120）がある時も同じ: 1200 − 600 − 839 = −239 なので、300 を保つには 120 + 539 = 659
    expect(foldSpacerHeight({ scrollY: 300, scrollHeight: 1200, innerHeight: 839, spacer: 120, lost: 600 })).toBe(659)
  })
})
