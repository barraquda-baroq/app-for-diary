// 3つのリストの行の並び（src/features/lists/common/ListRows.tsx・ListRow.tsx・DoneSection.tsx。docs/SPEC.md の 3.6。開発・P11）: まだの行 →
// 「済み n件」→ 済んだ行の1つの平らな並び。チェックで行が区切りをまたいでも作り直さない（フォーカスが残る）。「済み n件」は畳んだ状態を
// 端末に覚え（どの幅でも）、畳んでいる間は済んだ行を出さない。済んだ物が無い間は区切りを出さない
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { PREFS_KEY, usePrefs } from '../../../store/uiStore'
import { setupCalendarTests } from '../../../test/renderCalendar'
import { useDoneCollapsed } from './DoneSection'
import { DotCheck } from './DotCheck'
import { ListRow } from './ListRow'
import { ListRows } from './ListRows'
import { listTestIds } from './testIds'

setupCalendarTests()

interface Row {
  id: string
  title: string
  done: boolean
}

/** 行が作り直されたかを数える（作るたびに番号が増える） */
let made = 0
function TaskRow({ row, onToggle }: { row: Row; onToggle: (id: string) => void }) {
  const [serial] = useState(() => ++made)
  return (
    <ListRow list="task" id={row.id} done={row.done}>
      <DotCheck done={row.done} name={row.title} onToggle={() => onToggle(row.id)} data-testid={`check-${row.id}`} />
      <span data-testid={`serial-${row.id}`}>{serial}</span>
    </ListRow>
  )
}

function Harness() {
  const [rows, setRows] = useState<Row[]>([
    { id: 'a', title: '見積もりの返事', done: false },
    { id: 'b', title: '会議室の予約', done: false },
  ])
  const [collapsed, setCollapsed] = useDoneCollapsed({ list: 'task' })
  const toggle = (id: string) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, done: !r.done } : r)))
  return (
    <ListRows
      testId="rows"
      open={rows.filter((r) => !r.done)}
      done={rows.filter((r) => r.done)}
      doneSection={{ collapsed, onToggle: () => setCollapsed(!collapsed), testId: listTestIds.done('task') }}
      renderRow={(r) => <TaskRow row={r} onToggle={toggle} />}
    />
  )
}

describe('S3 行の並び（開発・P11・S3-FRAME-070〜074・S3-FRAME-289〜292）', () => {
  it('済みにした行は「済み n件」の下へ沈み、作り直さない（フォーカスが残る）。済んだ物が無い間は区切りを出さない', () => {
    usePrefs.getState().setCollapsed({ taskDone: false })
    render(<Harness />)
    expect(screen.queryByTestId(listTestIds.done('task'))).toBeNull()
    const serial = screen.getByTestId('serial-a').textContent
    const check = screen.getByTestId('check-a')
    check.focus()
    expect(check.getAttribute('aria-label')).toBe('『見積もりの返事』を済みにする')
    fireEvent.click(check)
    expect(screen.getByTestId(listTestIds.done('task')).textContent).toContain('済み 1件')
    expect(screen.getByTestId('serial-a').textContent).toBe(serial)
    expect(document.activeElement).toBe(screen.getByTestId('check-a'))
    expect(screen.getByTestId('check-a').getAttribute('aria-label')).toBe('『見積もりの返事』の済みを外す')
    expect(screen.getByTestId(listTestIds.row('task', 'a')).getAttribute('data-done')).toBe('true')
    // 並び: まだの行 → 区切り → 済んだ行
    const order = Array.from(screen.getByTestId('rows').children).map((el) => el.getAttribute('data-testid'))
    expect(order).toEqual([listTestIds.row('task', 'b'), listTestIds.done('task'), listTestIds.row('task', 'a')])
  })

  it('「済み n件」はふだん畳んでおき（済んだ行を出さない）、押すと開く。開いた・畳んだは端末ごとに覚える', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('check-a'))
    expect(screen.queryByTestId(listTestIds.row('task', 'a'))).toBeNull()
    const toggle = screen.getByRole('button', { name: /済み 1件/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    act(() => toggle.click())
    expect(screen.getByTestId(listTestIds.row('task', 'a'))).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').collapsed.taskDone).toBe(false)
  })
})
