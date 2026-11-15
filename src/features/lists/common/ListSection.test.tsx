// 3つのリストの枠（src/features/lists/common/ListSection.tsx。docs/SPEC.md の 3.5・3.6・6.13）: 見出しの形と数、畳む・開く（山形でも見出しでも）、
// L の状態は端末に覚え、S・M は覚えない（それぞれの状態を使う）、裏に回って戻っても続く、畳む時に中のフォーカスを見出しのボタンへ移す
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PREFS_KEY, usePrefs, useStackedLists } from '../../../store/uiStore'
import { setupCalendarTests } from '../../../test/renderCalendar'
import { ListSection } from './ListSection'
import { listTestIds } from './testIds'

setupCalendarTests()

const saved = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as { collapsed?: Record<string, unknown> } | null

function Section({ stacked, count = 0 }: { stacked: boolean; count?: number }) {
  return (
    <ListSection list="task" stacked={stacked} count={count} headerExtra={<button type="button">すべて開く</button>}>
      <input aria-label="中の欄" data-testid="inner" />
    </ListSection>
  )
}

const section = () => screen.getByTestId(listTestIds.section('task'))
const collapsed = () => section().getAttribute('data-collapsed')

describe('S3 見出し（3.6・S3-FRAME-059〜064・S3-TASK-240）', () => {
  it('英語の名前・小さな日本語・まだ済んでいない数（読み上げは「まだ済んでいない n件」）・山形。開いている間だけ headerExtra', async () => {
    const user = userEvent.setup()
    render(<Section stacked={false} count={7} />)
    expect(within(section()).getByRole('heading', { level: 2 }).textContent).toBe('Task Listタスク')
    expect(screen.getByTestId(listTestIds.count('task')).textContent).toBe('7まだ済んでいない 7件')
    expect(screen.getByTestId(listTestIds.fold('task')).getAttribute('aria-label')).toBe('Task Listを畳む')
    expect(screen.getByText('すべて開く')).toBeTruthy()
    await user.click(screen.getByTestId(listTestIds.fold('task')))
    expect(screen.queryByText('すべて開く')).toBeNull()
    expect(screen.getByTestId(listTestIds.fold('task')).getAttribute('aria-label')).toBe('Task Listを開く')
  })

  it('見出しのどこを押しても畳む・開く（中のボタンを押した時は畳まない）。畳むと中身は .is-closed', async () => {
    const user = userEvent.setup()
    render(<Section stacked={false} />)
    await user.click(screen.getByText('すべて開く'))
    expect(collapsed()).toBe('false')
    await user.click(within(section()).getByText('Task List'))
    expect(collapsed()).toBe('true')
    expect(screen.getByTestId(listTestIds.body('task')).className).toContain('is-closed')
    await user.click(within(section()).getByText('タスク'))
    expect(collapsed()).toBe('false')
  })
})

describe('S3 畳んだ・開いた状態（3.5・3.6・6.13・S3-FRAME-050〜053・066・067・S3-TASK-241〜244・S3-ROUTINE-153〜156）', () => {
  it('L は端末ごとに覚える（diary-studio:prefs の collapsed.task）。初めは開いている', async () => {
    const user = userEvent.setup()
    render(<Section stacked={false} />)
    expect(collapsed()).toBe('false')
    await user.click(screen.getByTestId(listTestIds.fold('task')))
    expect(saved()?.collapsed).toMatchObject({ task: true })
    expect(useStackedLists.getState().collapsed.task).toBe(true)
  })

  it('S・M は畳んで始まり、開いても端末に覚えない（L の覚えた状態は持ち込まない）', async () => {
    const user = userEvent.setup()
    usePrefs.getState().setCollapsed({ task: false })
    const before = localStorage.getItem(PREFS_KEY)
    render(<Section stacked />)
    expect(collapsed()).toBe('true')
    await user.click(screen.getByTestId(listTestIds.fold('task')))
    expect(collapsed()).toBe('false')
    expect(useStackedLists.getState().collapsed.task).toBe(false)
    expect(localStorage.getItem(PREFS_KEY)).toBe(before)
  })

  it('幅を替えて L と S・M を行き来しても、それぞれの状態を使う', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Section stacked={false} />)
    await user.click(screen.getByTestId(listTestIds.fold('task')))
    expect(collapsed()).toBe('true')
    rerender(<Section stacked />)
    expect(collapsed()).toBe('true')
    await user.click(screen.getByTestId(listTestIds.fold('task')))
    expect(collapsed()).toBe('false')
    rerender(<Section stacked={false} />)
    expect(collapsed()).toBe('true')
    expect(usePrefs.getState().collapsed.task).toBe(true)
  })

  it('裏に回って戻っただけ（visibilitychange）では S・M の開いた状態は続く', async () => {
    const user = userEvent.setup()
    render(<Section stacked />)
    await user.click(screen.getByTestId(listTestIds.fold('task')))
    for (const state of ['hidden', 'visible'] as const) {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }
    expect(collapsed()).toBe('false')
  })

  it('畳む時に中（入力欄）にフォーカスがあれば、先に見出しの畳む・開くボタンへ移す（隠れた欄にキーボードを残さない）', async () => {
    render(<Section stacked />)
    fireEvent.click(screen.getByTestId(listTestIds.fold('task')))
    const inner = screen.getByTestId('inner')
    inner.focus()
    expect(document.activeElement).toBe(inner)
    // 見出しを押して畳む（指の端末では押したボタンにフォーカスが移らないので、欄にフォーカスが残っている）
    fireEvent.click(within(section()).getByText('Task List'))
    expect(collapsed()).toBe('true')
    expect(document.activeElement).toBe(screen.getByTestId(listTestIds.fold('task')))
  })
})
