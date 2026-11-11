// すばやく足す（QuickAdd。12.1・6.13・D31・D42・D44・AMB-ITEMS-21）
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { calendarItems, weekSingles } from '../../../../domain/calendar'
import { mkItem, T0 } from '../../../../domain/testData'
import type { ItemKind } from '../../../../domain/types'
import { getData } from '../../../../store/appStore'
import { quickDraftKey } from '../../../../store/localDrafts'
import { useToasts } from '../../../../store/uiStore'
import { renderView, setupCalendarTests } from '../../../../test/renderCalendar'
import { testIds } from '../testIds'
import { QuickAdd, type QuickAddProps } from './QuickAdd'

setupCalendarTests()

/** 週の列（入力欄の外に押せるボタンがある） */
function Column(props: QuickAddProps) {
  return (
    <div>
      <button type="button" data-testid="outside">
        ほかの所
      </button>
      <QuickAdd {...props} />
    </div>
  )
}

async function open(p: { date?: string; kind?: ItemKind } = {}, data = {}) {
  const onClose = vi.fn()
  const r = await renderView(Column, { date: p.date ?? '2026-11-10', kind: p.kind ?? 'work', onClose }, { data })
  return { ...r, onClose, input: screen.getByTestId(testIds.quickAddInput) as HTMLInputElement }
}

const items = () => Object.values(getData().items)

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
  it('Esc で閉じる。同じ Esc を下の小さな画面・休みを付ける状態へ渡さない', async () => {
    const user = userEvent.setup()
    const { onClose } = await open()
    const outer = vi.fn()
    window.addEventListener('keydown', outer)
    await user.keyboard('{Escape}')
    window.removeEventListener('keydown', outer)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })

  it('変換中の Esc（変換をやめる）では閉じない', async () => {
    const { input, onClose } = await open()
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('入力欄の外を押すと閉じる（入力欄の中を押しても閉じない）', async () => {
    const user = userEvent.setup()
    const { input, onClose } = await open()
    await user.click(input)
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
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
