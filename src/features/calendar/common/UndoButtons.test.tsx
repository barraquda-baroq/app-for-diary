// 元に戻す・やり直すのボタン（docs/SPEC.md の 7.13・3.7・3.10。common/UndoButtons.tsx）: 週・日だけに出ること、戻す物・やり直す物が
// 無い時は押せないこと、読み上げとヒントが操作の名前を言うこと、押すと戻る・やり直すこと、お知らせの［元に戻す］で戻した物はボタンの
// 元に戻すの1つ分になること、年・月へ替えても並びが残ること、Ctrl/⌘+Z・Ctrl/⌘+Shift+Z・Ctrl+Y（文字を打っている間は効かない）
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkItem } from '../../../domain/testData'
import { actions } from '../../../store/actions'
import { getData, useApp } from '../../../store/appStore'
import { useToasts } from '../../../store/uiStore'
import { undoIdle } from '../../../store/undoStore'
import { renderAt, setupCalendarTests } from '../../../test/renderCalendar'
import { testIds } from './testIds'
import { undoShortcut } from './UndoButtons'

setupCalendarTests()
afterEach(() => {
  vi.restoreAllMocks()
})

const meeting = mkItem({ id: 'a', title: '定例会議', start: '2026-11-10' })
const undoBtn = () => screen.getByTestId(testIds.calUndo)
const redoBtn = () => screen.getByTestId(testIds.calRedo)
const settle = () => act(async () => void (await undoIdle()))

async function openWeek(width: 'L' | 'S' = 'L') {
  const user = userEvent.setup()
  const r = await renderAt('/week/2026-11-08', { width, data: { items: { a: meeting } } })
  return { ...r, user }
}

describe('出す所と押せる時', () => {
  it('週・日だけに出し、年・月では場所を残して消す（Task View と同じ場所に重ねる）', async () => {
    const { user } = await openWeek()
    const group = undoBtn().closest('.cal-undo') as HTMLElement
    expect(group.classList.contains('cal-tool-hidden')).toBe(false)
    expect(group.parentElement?.classList.contains('cal-slot')).toBe(true)
    expect(within(group.parentElement!).getByTestId(testIds.calTaskView).classList.contains('cal-tool-hidden')).toBe(true)
    await user.click(screen.getByTestId(testIds.calMode('day')))
    expect(undoBtn().closest('.cal-undo')?.classList.contains('cal-tool-hidden')).toBe(false)
    for (const m of ['month', 'year'] as const) {
      await user.click(screen.getByTestId(testIds.calMode(m)))
      expect(undoBtn().closest('.cal-undo')?.classList.contains('cal-tool-hidden')).toBe(true)
      expect(screen.getByTestId(testIds.calTaskView).classList.contains('cal-tool-hidden')).toBe(false)
    }
  })

  it('戻す物・やり直す物が無い時は押せない（aria-disabled）。読み上げは「元に戻す」「やり直す」だけ', async () => {
    await openWeek()
    expect(undoBtn().getAttribute('aria-disabled')).toBe('true')
    expect(redoBtn().getAttribute('aria-disabled')).toBe('true')
    expect(undoBtn().getAttribute('aria-label')).toBe('元に戻す')
    expect(redoBtn().getAttribute('aria-label')).toBe('やり直す')
    expect(undoBtn().getAttribute('title')).toBe('元に戻す')
  })
})

describe('押す', () => {
  it('休みを付けると「元に戻す（11/11（水）を休みにした）」。押すと外れ、やり直すでまた付く', async () => {
    const { user } = await openWeek()
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-11')))
    expect(getData().offDays['2026-11-11']?.off).toBe(true)
    expect(undoBtn().getAttribute('aria-disabled')).toBeNull()
    expect(undoBtn().getAttribute('aria-label')).toBe('元に戻す（11/11（水）を休みにした）')
    expect(undoBtn().getAttribute('title')).toBe('元に戻す（11/11（水）を休みにした）')
    await user.click(undoBtn())
    await settle()
    expect(getData().offDays['2026-11-11']?.off).toBe(false)
    expect(undoBtn().getAttribute('aria-disabled')).toBe('true')
    expect(redoBtn().getAttribute('aria-label')).toBe('やり直す（11/11（水）を休みにした）')
    await user.click(redoBtn())
    await settle()
    expect(getData().offDays['2026-11-11']?.off).toBe(true)
    expect(redoBtn().getAttribute('aria-disabled')).toBe('true')
  })

  it('押せない時に押しても何もしない', async () => {
    const { user } = await openWeek()
    await user.click(undoBtn())
    await settle()
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('お知らせの［元に戻す］で戻すと、ボタンの元に戻すではもう出さず、やり直すに出る', async () => {
    const { user } = await openWeek()
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-12')))
    await user.click(screen.getByTestId(testIds.done('a')))
    expect(undoBtn().getAttribute('aria-label')).toBe('元に戻す（『定例会議』を完了にした）')
    const toast = screen.getByText('『定例会議』を完了にしました').closest('.toast') as HTMLElement
    await user.click(within(toast).getByRole('button', { name: '元に戻す' }))
    await settle()
    expect(getData().items.a.done).toBe(false)
    expect(undoBtn().getAttribute('aria-label')).toBe('元に戻す（11/12（木）を休みにした）')
    expect(redoBtn().getAttribute('aria-label')).toBe('やり直す（『定例会議』を完了にした）')
  })

  it('ボタンで戻すと、その操作のお知らせ（［元に戻す］）を消す', async () => {
    const { user } = await openWeek()
    await user.click(screen.getByTestId(testIds.done('a')))
    expect(screen.queryByText('『定例会議』を完了にしました')).not.toBeNull()
    await user.click(undoBtn())
    await settle()
    expect(screen.queryByText('『定例会議』を完了にしました')).toBeNull()
  })

  it('月・年へ替えて戻っても並びは残る（■24）', async () => {
    const { user } = await openWeek()
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-12')))
    await user.click(screen.getByTestId(testIds.calMode('month')))
    await user.click(screen.getByTestId(testIds.calMode('year')))
    await user.click(screen.getByTestId(testIds.calMode('day')))
    expect(undoBtn().getAttribute('aria-label')).toBe('元に戻す（11/12（木）を休みにした）')
    await user.click(undoBtn())
    await settle()
    expect(getData().offDays['2026-11-12']?.off).toBe(false)
  })
})

describe('キー（3.10）', () => {
  it('Ctrl+Z で元に戻す、Ctrl+Shift+Z・Ctrl+Y でやり直す', async () => {
    const { user } = await openWeek()
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-11')))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await settle()
    expect(getData().offDays['2026-11-11']?.off).toBe(false)
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })
    await settle()
    expect(getData().offDays['2026-11-11']?.off).toBe(true)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await settle()
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    await settle()
    expect(getData().offDays['2026-11-11']?.off).toBe(true)
  })

  it('文字を打っている間（入力欄の中）・年・月では効かない', async () => {
    const { user } = await openWeek()
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-11')))
    // すばやく足すの入力欄の中（ブラウザの字の元に戻す）
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-10', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput)
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    await settle()
    expect(getData().offDays['2026-11-11']?.off).toBe(true)
    fireEvent.keyDown(input, { key: 'Escape' })
    await user.click(screen.getByTestId(testIds.calMode('month')))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await settle()
    expect(getData().offDays['2026-11-11']?.off).toBe(true)
  })

  it('キーの読み方（Mac は ⌘、ほかは Ctrl。Alt・両方を押した時は読まない）', () => {
    const k = (key: string, o: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      ...o,
    })
    expect(undoShortcut(k('z', { ctrlKey: true }), false)).toBe('undo')
    expect(undoShortcut(k('Z', { ctrlKey: true, shiftKey: true }), false)).toBe('redo')
    expect(undoShortcut(k('y', { ctrlKey: true }), false)).toBe('redo')
    expect(undoShortcut(k('z', { metaKey: true }), false)).toBeNull()
    expect(undoShortcut(k('z', { metaKey: true }), true)).toBe('undo')
    expect(undoShortcut(k('z', { metaKey: true, shiftKey: true }), true)).toBe('redo')
    expect(undoShortcut(k('y', { metaKey: true }), true)).toBeNull()
    expect(undoShortcut(k('z', { ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(undoShortcut(k('z'), false)).toBeNull()
  })
})

describe('すばやく足すを開いたまま押す', () => {
  it('入力欄は閉じず、打っている字も足さない（戻すのはその前の操作）。Enter で足した物を戻すとゴミ箱へ', async () => {
    // ゴミ箱へ移すの代わり（この保存先は何も書かないので、表示のデータだけを動かす）
    vi.spyOn(actions, 'trashItem').mockImplementation(async (id) => {
      act(() =>
        useApp.setState((st) => {
          const { [id]: _gone, ...items } = st.data.items
          return { data: { ...st.data, items } }
        }),
      )
      return 'entry-1'
    })
    const { user } = await openWeek()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-10', 'work')))
    const input = screen.getByTestId(testIds.quickAddInput) as HTMLInputElement
    await user.type(input, '買い物{Enter}')
    const added = Object.values(getData().items).find((i) => i.title === '買い物')
    expect(added).toBeTruthy()
    expect(undoBtn().getAttribute('aria-label')).toBe('元に戻す（『買い物』を足した）')
    await user.type(input, '打ちかけ')
    await user.click(undoBtn())
    await settle()
    expect(screen.getByTestId(testIds.quickAddInput)).toBe(input)
    expect(input.value).toBe('打ちかけ')
    expect(getData().items[added!.id]).toBeUndefined()
    expect(Object.values(getData().items).some((i) => i.title === '打ちかけ')).toBe(false)
  })
})
