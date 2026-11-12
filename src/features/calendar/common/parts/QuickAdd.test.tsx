// すばやく足す（QuickAdd。12.1・6.13・D31・D42・D44・AMB-ITEMS-21・22. の段階2の終わりの確かめ）
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarItems, weekSingles } from '../../../../domain/calendar'
import { mkItem, T0 } from '../../../../domain/testData'
import type { ItemKind } from '../../../../domain/types'
import { actions } from '../../../../store/actions'
import { getData } from '../../../../store/appStore'
import { quickDraftKey, readLocal } from '../../../../store/localDrafts'
import { useToasts } from '../../../../store/uiStore'
import { renderView, setupCalendarTests } from '../../../../test/renderCalendar'
import { testIds } from '../testIds'
import { BLUR_SETTLE_MS, CLICK_WAIT_MS, QuickAdd, type QuickAddProps } from './QuickAdd'

setupCalendarTests()
afterEach(() => {
  vi.restoreAllMocks()
})

/** 週の列（入力欄の前と後に押せるボタンがある） */
function Column(props: QuickAddProps) {
  return (
    <div>
      <button type="button" data-testid="outside">
        ほかの所
      </button>
      <QuickAdd {...props} />
      <button type="button" data-testid="after">
        後ろの所
      </button>
    </div>
  )
}

async function open(p: { date?: string; kind?: ItemKind } = {}, data = {}) {
  const onClose = vi.fn()
  const r = await renderView(Column, { date: p.date ?? '2026-11-10', kind: p.kind ?? 'work', onClose }, { data })
  return { ...r, onClose, input: screen.getByTestId(testIds.quickAddInput) as HTMLInputElement }
}

const items = () => Object.values(getData().items)
const toasts = () => useToasts.getState().toasts
const button = () => screen.getByTestId(testIds.quickAddButton) as HTMLButtonElement

/** ページにフォーカスがあるか（document.hasFocus。jsdom は入力欄の blur の後に false を返すので、ここで決める） */
const pageFocused = (focused: boolean) => vi.spyOn(document, 'hasFocus').mockReturnValue(focused)

/** setTimeout を偽物にする（離してからの待ち・押さずに外れたフォーカスを決める待ち） */
const fakeTimers = () => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

/** 打った字を入れる（偽物のタイマーの間は userEvent を使わない） */
const typeText = (input: HTMLInputElement, text: string) => fireEvent.change(input, { target: { value: text } })

/**
 * 押さずに入力欄からフォーカスが外れた（iPhone のキーボードの上の✓（完了）・キーボードを閉じた）。ページはフォーカスを持ったまま
 * （窓・アプリの切り替えではない）
 */
function keyboardDone(input: HTMLInputElement) {
  pageFocused(true)
  act(() => input.blur())
}

describe('件名を打って Enter で足す（ITEMS-153〜155・160・161・ITEMS-014）', () => {
  it('開くとすぐ打てる（フォーカス）。入力欄は件名だけ', async () => {
    const { input, container } = await open()
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('aria-label')).toBe('11/10（火）の仕事の予定を足す')
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(1)
  })

  it('開始日と区分は押した場所、締め切り日・時刻は無し、calendar 生まれ・Task List に出さない、order は今', async () => {
    const user = userEvent.setup()
    const { input } = await open({ date: '2026-11-12', kind: 'private' })
    await user.type(input, '本を返す{Enter}')
    expect(items()).toHaveLength(1)
    expect(items()[0]).toMatchObject({
      title: '本を返す',
      kind: 'private',
      origin: 'calendar',
      start: '2026-11-12',
      due: null,
      startTime: null,
      endTime: null,
      listed: false,
      done: false,
      by: 'user',
      order: T0,
      createdAt: T0,
    })
  })

  it('足した後も開いたまま（空に戻り、フォーカスも残る）で続けて足せる', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.type(input, '打ち合わせ{Enter}')
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    await user.type(input, 'メールの返信{Enter}')
    expect(items().map((i) => i.title)).toEqual(['打ち合わせ', 'メールの返信'])
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIds.quickAddInput)).toBe(input)
  })

  it('開いた時と足した後に、入力欄を見える所まで出す（スクロールの中の列。視差効果を減らす設定ではすぐに）', async () => {
    const user = userEvent.setup()
    const spy = vi.mocked(Element.prototype.scrollIntoView)
    const { input } = await open()
    expect(spy).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' })
    spy.mockClear()
    await user.type(input, '打ち合わせ{Enter}')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.contexts[0]).toBe(input)
  })

  it('件名の前後の空白は落とす', async () => {
    const user = userEvent.setup()
    const { input } = await open()
    await user.type(input, '  見積もりの提出  {Enter}')
    expect(items()[0].title).toBe('見積もりの提出')
  })

  it('足した予定は、その日・その段の時刻の無い1日の予定のいちばん後（7.5）', async () => {
    const user = userEvent.setup()
    const before = mkItem({ id: 'b', title: '前からある予定', start: '2026-11-10', order: T0 - 1000 })
    const timed = mkItem({ id: 't', title: '時刻のある予定', start: '2026-11-10', startTime: '18:00', order: T0 - 2000 })
    const { input } = await open({}, { items: { b: before, t: timed } })
    await user.type(input, '経費の精算{Enter}')
    const day = weekSingles(calendarItems(getData().items), '2026-11-08', 'work')['2026-11-10']
    expect(day.map((c) => c.item.title)).toEqual(['時刻のある予定', '前からある予定', '経費の精算'])
  })

  it('決まりに合わない件名（201字）は足さずに知らせ、打った字は残す', async () => {
    const { input } = await open()
    const long = 'あ'.repeat(201)
    fireEvent.change(input, { target: { value: long } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(items()).toHaveLength(0)
    expect(input.value).toBe(long)
    expect(useToasts.getState().toasts.some((t) => t.kind === 'error')).toBe(true)
  })
})

describe('足さない時（ITEMS-157・158）', () => {
  it('日本語の変換中の Enter（isComposing）では足さない', async () => {
    const { input } = await open()
    fireEvent.change(input, { target: { value: 'しりょう' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(items()).toHaveLength(0)
    expect(input.value).toBe('しりょう')
  })

  it('変換を決める Enter（Safari の keyCode 229）でも足さない', async () => {
    const { input } = await open()
    fireEvent.change(input, { target: { value: '資料' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(items()).toHaveLength(0)
  })

  it('空・空白だけの件名の Enter では足さない（開いたまま）', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.type(input, '{Enter}')
    await user.type(input, '   {Enter}')
    expect(items()).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('閉じる（ITEMS-156・FRAME-103・CALENDAR-268）', () => {
  it('Esc で閉じる（閉じたきっかけ escape。画面は「＋」の行へフォーカスを戻す）。同じ Esc を下の小さな画面・休みを付ける状態へ渡さない', async () => {
    const user = userEvent.setup()
    const { onClose } = await open()
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    await user.keyboard('{Escape}')
    window.removeEventListener('keydown', outer)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(outer).not.toHaveBeenCalled()
  })

  it('変換中の Esc（変換をやめる）では閉じない', async () => {
    const { input, onClose } = await open()
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('入力欄の外を押すと閉じる（閉じたきっかけ press。入力欄の中を押しても閉じない）', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.click(input)
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('press')
  })

  it('キーボードでフォーカスを外へ移した（Tab）時も閉じる（閉じたきっかけ focus。開いたまま Esc の効かない入力欄を残さない）', async () => {
    const user = userEvent.setup()
    const { onClose } = await open()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('focus')
  })

  it('窓・アプリを切り替えてフォーカスが外れた（行き先の無い blur）だけでは閉じない', async () => {
    const { input, onClose } = await open()
    fireEvent.blur(input, { relatedTarget: null })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('外を押した時は、押し終わってから閉じる（開発。押した指・掴んだカードの下で並びが動かないように）', () => {
  it('押している間（pointerdown・フォーカスの移り）は閉じず、click の時に1回だけ閉じる', async () => {
    const user = userEvent.setup()
    const { onClose } = await open()
    const outside = screen.getByTestId('outside')
    await user.pointer({ keys: '[MouseLeft>]', target: outside })
    // マウスを押すとフォーカスは押したボタンへ移る（入力欄の blur）が、まだ閉じない
    expect(document.activeElement).toBe(outside)
    expect(onClose).not.toHaveBeenCalled()
    await user.pointer({ keys: '[/MouseLeft]', target: outside })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('press')
  })

  it('pointercancel（なぞってスクロールした）ですぐ閉じる', async () => {
    const { onClose } = await open()
    const outside = screen.getByTestId('outside')
    fireEvent.pointerDown(outside)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerCancel(outside)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('離しても click が来ない時（長押し・ドラッグ）は、離してから CLICK_WAIT_MS で閉じる', async () => {
    const { onClose } = await open()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const outside = screen.getByTestId('outside')
    fireEvent.pointerDown(outside)
    act(() => {
      vi.advanceTimersByTime(CLICK_WAIT_MS * 3)
    })
    // 押している間は待つ
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerUp(outside)
    act(() => {
      vi.advanceTimersByTime(CLICK_WAIT_MS - 1)
    })
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('押し終わりを待っている間の Esc は、待たずにすぐ閉じる（escape）', async () => {
    const { input, onClose } = await open()
    fireEvent.pointerDown(screen.getByTestId('outside'))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('escape')
    fireEvent.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('押し終わりを待っている間に画面が外した（日・週が替わった）時は、後から閉じると伝えない', async () => {
    const { onClose, unmount } = await open()
    const outside = screen.getByTestId('outside')
    fireEvent.pointerDown(outside)
    unmount()
    fireEvent.click(document.body)
    fireEvent.pointerCancel(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('［足す］（入力欄の右の端の✓。Enter と同じ。22. の段階2の終わりの確かめ）', () => {
  it('入力欄の右の端に［足す］がある（読み上げ「足す」）。字が無い間は淡く（aria-disabled）、押しても足さない', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    expect(button().getAttribute('aria-label')).toBe('足す')
    expect(button().getAttribute('aria-disabled')).toBe('true')
    await user.click(button())
    await user.type(input, '   ')
    expect(button().getAttribute('aria-disabled')).toBe('true')
    await user.click(button())
    expect(items()).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    await user.type(input, '花を買う')
    expect(button().hasAttribute('aria-disabled')).toBe(false)
  })

  it('押すと Enter と同じく足し、開いたまま空に戻ってフォーカスは入力欄（足した予定はすぐ上に出るので、お知らせは出さない）', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open({ date: '2026-11-12', kind: 'private' })
    await user.type(input, '花を買う')
    await user.click(button())
    expect(items()).toHaveLength(1)
    expect(items()[0]).toMatchObject({
      title: '花を買う',
      kind: 'private',
      start: '2026-11-12',
      origin: 'calendar',
      listed: false,
    })
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(onClose).not.toHaveBeenCalled()
    expect(toasts()).toHaveLength(0)
    expect(localStorage.getItem(quickDraftKey('2026-11-12', 'private'))).toBeNull()
    await user.type(input, '本を返す')
    await user.click(button())
    expect(items().map((i) => i.title)).toEqual(['花を買う', '本を返す'])
  })

  it('押してもフォーカスは入力欄から動かない（mousedown を止める。iPhone のキーボードを閉じず、入力欄の blur も起こさない）', async () => {
    const { input } = await open()
    typeText(input, '電話')
    expect(fireEvent.mouseDown(button())).toBe(false)
    expect(document.activeElement).toBe(input)
  })

  it('Tab で［足す］へ移っても閉じない。Enter で足し、Esc はそこからも足さずに閉じる', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.type(input, '資料の確認')
    await user.tab()
    expect(document.activeElement).toBe(button())
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(items().map((i) => i.title)).toEqual(['資料の確認'])
    expect(document.activeElement).toBe(input)
    await user.type(input, '書きかけ')
    await user.tab()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(items()).toHaveLength(1)
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBe('書きかけ')
  })
})

describe('入力欄の外を押すと、字があれば足してから閉じる（22. の段階2の終わりの確かめ）', () => {
  it('押し終わった（click）時に足して閉じ（press）、「『件名』を足しました［元に戻す］」を出す。書きかけは消す', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open({ date: '2026-11-11', kind: 'private' })
    await user.type(input, '  旅行の準備 ')
    const outside = screen.getByTestId('outside')
    await user.pointer({ keys: '[MouseLeft>]', target: outside })
    // 押している間は足さず閉じない（並びを動かさない）
    expect(items()).toHaveLength(0)
    expect(onClose).not.toHaveBeenCalled()
    await user.pointer({ keys: '[/MouseLeft]', target: outside })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('press')
    expect(items()).toHaveLength(1)
    expect(items()[0]).toMatchObject({ title: '旅行の準備', kind: 'private', start: '2026-11-11', origin: 'calendar' })
    expect(localStorage.getItem(quickDraftKey('2026-11-11', 'private'))).toBeNull()
    const [toast] = toasts()
    expect(toast.message).toBe('『旅行の準備』を足しました')
    expect(toast.action?.label).toBe('元に戻す')
  })

  it('［元に戻す］で足した予定をゴミ箱へ移し、打った字を書きかけに戻す（次に開くと出る）', async () => {
    const trash = vi.spyOn(actions, 'trashItem').mockResolvedValue('entry-1')
    const user = userEvent.setup()
    const { input } = await open()
    await user.type(input, '見積もりの提出')
    await user.click(screen.getByTestId('outside'))
    const [added] = items()
    expect(added.title).toBe('見積もりの提出')
    expect(readLocal(quickDraftKey('2026-11-10', 'work'))).toBeNull()
    await act(async () => toasts()[0].action?.run())
    expect(trash).toHaveBeenCalledWith(added.id)
    await vi.waitFor(() => expect(readLocal(quickDraftKey('2026-11-10', 'work'))).toBe('見積もりの提出'))
  })

  it('［元に戻す］の時に、その日・その区分に新しい書きかけがあれば上書きしない。ゴミ箱へ移せなかった時は書きかけに戻さない', async () => {
    const trash = vi.spyOn(actions, 'trashItem').mockResolvedValue('entry-1')
    const user = userEvent.setup()
    const { input } = await open()
    await user.type(input, '一件目')
    await user.click(screen.getByTestId('outside'))
    localStorage.setItem(quickDraftKey('2026-11-10', 'work'), '新しい書きかけ')
    await act(async () => toasts()[0].action?.run())
    expect(trash).toHaveBeenCalledTimes(1)
    expect(readLocal(quickDraftKey('2026-11-10', 'work'))).toBe('新しい書きかけ')

    localStorage.clear()
    trash.mockRejectedValue(new Error('ゴミ箱へ移せない'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () =>
      toasts()
        .find((t) => t.message === '『一件目』を足しました')
        ?.action?.run(),
    )
    expect(readLocal(quickDraftKey('2026-11-10', 'work'))).toBeNull()
    expect(toasts().some((t) => t.kind === 'error')).toBe(true)
  })

  it('空・空白だけの時は、足さずに閉じる（お知らせも出さない）', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.type(input, '   ')
    await user.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledWith('press')
    expect(items()).toHaveLength(0)
    expect(toasts()).toHaveLength(0)
  })

  it('pointercancel（なぞってスクロールした）・離して click が来ない時（長押し）も、足して閉じる', async () => {
    const { input, onClose, unmount } = await open()
    typeText(input, '一件目')
    fireEvent.pointerDown(screen.getByTestId('outside'))
    fireEvent.pointerCancel(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledWith('press')
    expect(items().map((i) => i.title)).toEqual(['一件目'])
    unmount()

    const again = await open()
    fakeTimers()
    typeText(again.input, '二件目')
    fireEvent.pointerDown(screen.getByTestId('outside'))
    fireEvent.pointerUp(screen.getByTestId('outside'))
    advance(CLICK_WAIT_MS - 1)
    expect(items()).toHaveLength(0)
    advance(1)
    expect(again.onClose).toHaveBeenCalledWith('press')
    expect(items().map((i) => i.title)).toEqual(['二件目'])
  })

  it('押し終わる前に画面が外した（なぞって前後の日・週へ移った）時も、字があれば元の日に足す（閉じたとは伝えない）', async () => {
    const { input, onClose, unmount } = await open({ date: '2026-11-13', kind: 'work' })
    typeText(input, '請求書の発行')
    fireEvent.pointerDown(screen.getByTestId('outside'))
    unmount()
    fireEvent.click(document.body)
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toHaveLength(1)
    expect(items()[0]).toMatchObject({ title: '請求書の発行', start: '2026-11-13' })
    expect(toasts()[0].message).toBe('『請求書の発行』を足しました')
  })

  it('決まりに合わない件名（201字）は足さずに知らせて閉じる（書きかけは残る）', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    const long = 'あ'.repeat(201)
    typeText(input, long)
    await user.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledWith('press')
    expect(items()).toHaveLength(0)
    expect(toasts().some((t) => t.kind === 'error')).toBe(true)
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBe(long)
  })
})

describe('押さずにフォーカスが外れた（iPhone のキーボードの上の✓（完了）・キーボードを閉じた。22. の段階2の終わりの確かめ）', () => {
  it('BLUR_SETTLE_MS 待ってから、字があれば足して閉じ（blur）、「『件名』を足しました［元に戻す］」を出す', async () => {
    const { input, onClose } = await open({ date: '2026-11-12', kind: 'work' })
    fakeTimers()
    typeText(input, '電話をかける')
    keyboardDone(input)
    advance(BLUR_SETTLE_MS - 1)
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toHaveLength(0)
    advance(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('blur')
    expect(items()[0]).toMatchObject({ title: '電話をかける', start: '2026-11-12', kind: 'work' })
    expect(toasts()[0].message).toBe('『電話をかける』を足しました')
    expect(toasts()[0].action?.label).toBe('元に戻す')
    expect(localStorage.getItem(quickDraftKey('2026-11-12', 'work'))).toBeNull()
  })

  it('空の時は、足さずに閉じる（フォーカスの無い入力欄を残さない）', async () => {
    const { input, onClose } = await open()
    fakeTimers()
    keyboardDone(input)
    advance(BLUR_SETTLE_MS)
    expect(onClose).toHaveBeenCalledWith('blur')
    expect(items()).toHaveLength(0)
    expect(toasts()).toHaveLength(0)
  })

  it('待っている間に入力欄へ戻った時・押した時は、何もしない（押した時は押した方で決める）', async () => {
    const { input, onClose } = await open()
    fakeTimers()
    typeText(input, '資料')
    keyboardDone(input)
    act(() => input.focus())
    advance(BLUR_SETTLE_MS * 2)
    expect(onClose).not.toHaveBeenCalled()
    // 外れた後、待っている間に押した（ほかの「＋」など）: 押し終わってから1回だけ足して閉じる
    keyboardDone(input)
    fireEvent.pointerDown(screen.getByTestId('outside'))
    advance(BLUR_SETTLE_MS * 2)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('press')
    expect(items()).toHaveLength(1)
  })

  it('決まりに合わない件名（201字）は足さずに知らせ、開いたまま（打ち直せる）', async () => {
    const { input, onClose } = await open()
    fakeTimers()
    typeText(input, 'あ'.repeat(201))
    keyboardDone(input)
    advance(BLUR_SETTLE_MS)
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toHaveLength(0)
    expect(toasts().some((t) => t.kind === 'error')).toBe(true)
    expect(screen.getByTestId(testIds.quickAddInput)).toBe(input)
  })
})

describe('足さない時・閉じない時（22. の段階2の終わりの確かめ）', () => {
  it('Esc は足さずに閉じ、書きかけを残す（外を押し終わるのを待っている間も）', async () => {
    const { input, onClose } = await open()
    typeText(input, '書きかけの件名')
    fireEvent.pointerDown(screen.getByTestId('outside'))
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith('escape')
    expect(items()).toHaveLength(0)
    expect(toasts()).toHaveLength(0)
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBe('書きかけの件名')
  })

  it('Tab（Shift+Tab）でほかの物へ移した時は、足さずに閉じ（focus）、書きかけを残す', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.type(input, '書きかけの件名')
    await user.tab({ shift: true })
    expect(onClose).toHaveBeenCalledWith('focus')
    expect(items()).toHaveLength(0)
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBe('書きかけの件名')
  })

  it('［足す］からの Tab で外へ出た時も、足さずに閉じる', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.type(input, '書きかけの件名')
    await user.tab()
    expect(document.activeElement).toBe(button())
    await user.tab()
    expect(document.activeElement).toBe(screen.getByTestId('after'))
    expect(onClose).toHaveBeenCalledWith('focus')
    expect(items()).toHaveLength(0)
  })

  it('窓・アプリを切り替えて外れた（ページにフォーカスが無い）時は、足さず閉じない。戻った後のキーボードの✓では足す', async () => {
    const { input, onClose } = await open()
    fakeTimers()
    typeText(input, '会議の準備')
    pageFocused(false)
    act(() => input.blur())
    fireEvent.blur(window)
    advance(BLUR_SETTLE_MS * 3)
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toHaveLength(0)
    // 戻った（窓にフォーカス・入力欄にフォーカス）後は、ふつうに足す
    fireEvent.focus(window)
    act(() => input.focus())
    keyboardDone(input)
    advance(BLUR_SETTLE_MS)
    expect(onClose).toHaveBeenCalledWith('blur')
    expect(items().map((i) => i.title)).toEqual(['会議の準備'])
  })

  it('外れた後に窓の blur・ページが見えなくなる出来事が来た時（iPhone でアプリを離れた）も、足さず閉じない', async () => {
    const { input, onClose } = await open()
    fakeTimers()
    typeText(input, '会議の準備')
    keyboardDone(input)
    fireEvent.blur(window)
    advance(BLUR_SETTLE_MS * 3)
    expect(onClose).not.toHaveBeenCalled()

    act(() => input.focus())
    keyboardDone(input)
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    fireEvent(document, new Event('visibilitychange'))
    // アプリへ戻った（止まっていたタイマーが鳴っても足さない）
    hidden.mockReturnValue('visible')
    fireEvent(document, new Event('visibilitychange'))
    advance(BLUR_SETTLE_MS * 3)
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toHaveLength(0)
  })

  it('ドラッグを始めて画面がフォーカスを外した（押している間の blur）時は、足さず閉じない。指を離すまで並びは動かない（7.11）', async () => {
    const { input, onClose } = await open()
    fakeTimers()
    typeText(input, '書きかけの件名')
    const card = screen.getByTestId('outside')
    fireEvent.pointerDown(card)
    pageFocused(true)
    act(() => input.blur())
    advance(BLUR_SETTLE_MS * 5)
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toHaveLength(0)
    expect(screen.getByTestId(testIds.quickAddInput)).toBe(input)
  })

  it('日本語の変換中に外れた時は、足さず閉じない（変換を決める Enter・空の件名と同じく足さない）', async () => {
    const { input, onClose } = await open()
    fakeTimers()
    fireEvent.compositionStart(input)
    typeText(input, 'かいぎ')
    keyboardDone(input)
    advance(BLUR_SETTLE_MS * 3)
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toHaveLength(0)
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBe('かいぎ')
  })
})

describe('書きかけ（ITEMS-159・FRAME-264・D44）', () => {
  it('打った字を diary-studio:draft:quick:{日付}:{区分} に控える', async () => {
    const user = userEvent.setup()
    const { input } = await open({ date: '2026-11-11', kind: 'private' })
    await user.type(input, '旅行の準備')
    expect(localStorage.getItem('diary-studio:draft:quick:2026-11-11:private')).toBe('旅行の準備')
    expect(quickDraftKey('2026-11-11', 'private')).toBe('diary-studio:draft:quick:2026-11-11:private')
  })

  it('閉じても控えたままで、同じ日・同じ区分で開き直すと戻る（ほかの日・区分は別）', async () => {
    const user = userEvent.setup()
    const { input, onClose, unmount } = await open()
    await user.type(input, '書きかけの件名')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    unmount()
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBe('書きかけの件名')

    const again = await open()
    expect(again.input.value).toBe('書きかけの件名')
    again.unmount()
    const other = await open({ kind: 'private' })
    expect(other.input.value).toBe('')
  })

  it('開いたまま日付・区分が替わったら、その日・その区分の書きかけを読む', async () => {
    localStorage.setItem(quickDraftKey('2026-11-12', 'work'), '別の日の書きかけ')
    const user = userEvent.setup()
    const { input, setProps, onClose } = await open()
    await user.type(input, '今日の書きかけ')
    setProps({ date: '2026-11-12', kind: 'work', onClose })
    expect((screen.getByTestId(testIds.quickAddInput) as HTMLInputElement).value).toBe('別の日の書きかけ')
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBe('今日の書きかけ')
  })

  it('足したら書きかけを消す。空白だけの書きかけは控えない', async () => {
    const user = userEvent.setup()
    const { input } = await open()
    await user.type(input, '資料の確認')
    await user.keyboard('{Enter}')
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBeNull()
    await user.type(input, '   ')
    expect(localStorage.getItem(quickDraftKey('2026-11-10', 'work'))).toBeNull()
  })

  it('端末に保存できない（localStorage が使えない）時も足せる', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない')
    })
    try {
      const { input } = await open()
      await user.type(input, '打ち合わせ{Enter}')
      expect(items().map((i) => i.title)).toEqual(['打ち合わせ'])
    } finally {
      spy.mockRestore()
    }
  })
})
