// ルーチンの［詳しく］のパネル（src/features/lists/routine/RoutinePanel.tsx。docs/SPEC.md の 3.6・3.8・14.2）: 行の「…」から開き、件名・種類・
// 指定を直したそばから保存する（種類を替えると新しい種類のいちばん下へ。チェックの記録はそのままで、済みかどうかは計算し直す）、
// 済んでいる間は戻る日の行、［削除］で閉じる。地は --surface（区分の色にしない）、題の左に RepeatIcon、開いた時は件名の欄にフォーカスしない
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIST_IDS, LIST_TODAY, listData } from '../../../../e2e/fixtures/listData'
import { mkCheck } from '../../../domain/testData'
import type { AppData, RoutineCycle } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData, useApp } from '../../../store/appStore'
import { useToasts } from '../../../store/uiStore'
import { renderAt, setupCalendarTests } from '../../../test/renderCalendar'
import { sheetOf } from '../../calendar/common/sheets'
import { listTestIds } from '../common/testIds'
import { routinePanelTestIds } from './routineTestIds'

setupCalendarTests()
afterEach(() => {
  vi.restoreAllMocks()
})

const I = LIST_IDS
const byId = (id: string) => screen.getByTestId(id)
const panel = () => screen.queryByTestId(listTestIds.routinePanel)
const titlesIn = (c: RoutineCycle) =>
  within(byId(listTestIds.routineGroup(c)))
    .queryAllByTestId(/^list-routine-title-/)
    .map((el) => el.textContent)
const datesOf = (routineId: string) =>
  Object.values(getData().routineChecks)
    .filter((c) => c.routineId === routineId)
    .flatMap((c) => c.dates)
    .sort()

/** 作り物のデータで開き、そのルーチンの「…」→［詳しく］（済んだ行は「済み n件」を開いてから） */
async function openPanel(id: string, opts: { data?: Partial<AppData>; cycle?: RoutineCycle; done?: boolean } = {}) {
  const user = userEvent.setup()
  const r = await renderAt('/week/2026-11-08', { data: opts.data ?? listData(LIST_TODAY) })
  if (opts.done) await user.click(within(byId(listTestIds.routineDone(opts.cycle ?? 'daily'))).getByRole('button'))
  await user.click(byId(listTestIds.rowMore('routine', id)))
  await user.click(within(byId(listTestIds.rowMenu('routine'))).getByRole('menuitem', { name: '詳しく' }))
  return { ...r, user }
}

describe('S3 ルーチンの［詳しく］のパネル（14.2・3.6。S3-ROUTINE-121・123〜125・145・S3-FRAME-249〜251）', () => {
  it('「…」→［詳しく］で開く（履歴に routine の印）。題「ルーチン」と RepeatIcon、地は --surface、件名の欄にはフォーカスしない', async () => {
    const { router } = await openPanel(I.stretch)
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'routine', id: I.stretch })
    const p = panel()!
    expect(within(p).getByRole('heading', { level: 2 }).textContent).toBe('ルーチン')
    expect(p.querySelector('.modal-title-icon svg')).not.toBeNull()
    expect(p.classList.contains('list-sheet')).toBe(true)
    expect(p.getAttribute('data-kind')).toBeNull()
    expect((byId(routinePanelTestIds.title) as HTMLInputElement).value).toBe('ストレッチ')
    expect(document.activeElement).not.toBe(byId(routinePanelTestIds.title))
    expect(p.contains(document.activeElement)).toBe(true)
    expect(byId(routinePanelTestIds.cycle('daily')).getAttribute('aria-pressed')).toBe('true')
    // 毎日は指定を持たない。まだ済んでいないので戻る日の行も無い
    expect(within(p).queryByText('指定')).toBeNull()
    expect(screen.queryByTestId(routinePanelTestIds.returnLine)).toBeNull()
  })

  it('件名は欄から出た時に保存（前後の空白を落とす）。空にした時は保存せず、保存してある件名に戻す', async () => {
    const { user } = await openPanel(I.stretch)
    const title = () => byId(routinePanelTestIds.title) as HTMLInputElement
    await user.clear(title())
    await user.type(title(), '  夜のストレッチ ')
    // 欄の外（パネルの題）を押して欄から出る
    await user.click(within(panel()!).getByRole('heading', { level: 2 }))
    expect(getData().routines[I.stretch].title).toBe('夜のストレッチ')
    await user.clear(title())
    await user.click(within(panel()!).getByRole('heading', { level: 2 }))
    expect(getData().routines[I.stretch].title).toBe('夜のストレッチ')
    expect(title().value).toBe('夜のストレッチ')
  })

  it('種類を替えると新しい種類のいちばん下へ。合わない指定は外し、チェックの記録はそのまま、済みかどうかを計算し直す', async () => {
    const data = listData(LIST_TODAY)
    // 月曜にチェックした毎日の物（火曜の今日はまだ）
    const check = mkCheck(I.stretch, '2026-11', ['2026-11-09'])
    const { user } = await openPanel(I.stretch, {
      data: { ...data, routineChecks: { ...data.routineChecks, [check.id]: check } },
    })
    await user.click(byId(routinePanelTestIds.cycle('weekly')))
    expect(getData().routines[I.stretch]).toMatchObject({ cycle: 'weekly', weekdays: [] })
    expect(datesOf(I.stretch)).toEqual(['2026-11-09'])
    // 毎週（指定なし）は日曜 11/8 に戻るので、月曜のチェックで済み。パネルに戻る日の行
    expect(byId(routinePanelTestIds.returnLine).textContent).toBe('11/15（日）に戻ります')
    expect(byId(routinePanelTestIds.cycle('weekly')).getAttribute('aria-pressed')).toBe('true')
    // 曜日を選ぶとすぐ保存（水曜: 戻る日は 11/4 なので、まだ済み）
    await user.click(within(panel()!).getByRole('button', { name: '水曜日' }))
    expect(getData().routines[I.stretch].weekdays).toEqual([3])
    expect(byId(routinePanelTestIds.returnLine).textContent).toBe('11/11（水）に戻ります')
    // 毎年へ: 曜日は外れ、月と日の両方を選ぶまでは書かない
    await user.click(byId(routinePanelTestIds.cycle('yearly')))
    expect(getData().routines[I.stretch]).toMatchObject({ cycle: 'yearly', weekdays: [], yearMonth: null, yearDay: null })
    await user.selectOptions(within(panel()!).getByLabelText('月'), '3')
    expect(getData().routines[I.stretch].yearMonth).toBeNull()
    await user.selectOptions(within(panel()!).getByLabelText('日'), '15')
    expect(getData().routines[I.stretch]).toMatchObject({ yearMonth: 3, yearDay: 15 })
    // 一覧では毎年のかたまりのいちばん下
    await user.keyboard('{Escape}')
    expect(panel()).toBeNull()
    expect(titlesIn('yearly')).toEqual(['確定申告の書類'])
    expect(byId(listTestIds.routineDone('yearly')).textContent).toMatch(/済み 1件/)
  })

  it('済んでいる間は戻る日の行（指の端末は行に乗せられないので、ここで見る）', async () => {
    await openPanel(I.waterPlants, { done: true })
    expect(byId(routinePanelTestIds.returnLine).textContent).toBe('11/11（水）に戻ります')
  })

  it('［削除］は行の［削除］と同じ（確かめずにゴミ箱へ・お知らせ）で、パネルを閉じる', async () => {
    const trash = vi.spyOn(actions, 'trashRoutine').mockImplementation(async (id) => {
      useApp.setState((st) => {
        const routines = { ...st.data.routines }
        delete routines[id]
        return { data: { ...st.data, routines } }
      })
      return 'e1'
    })
    const { user, router } = await openPanel(I.garbage)
    await user.click(byId(routinePanelTestIds.remove))
    expect(trash).toHaveBeenCalledWith(I.garbage)
    await vi.waitFor(() => expect(panel()).toBeNull())
    expect(sheetOf(router.state.location.state)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useToasts.getState().toasts.at(-1)?.message).toBe('『ゴミ出し』を削除しました')
  })

  it('Esc・［×］で閉じる（1つ戻る）', async () => {
    const { user, router } = await openPanel(I.rentCheck)
    await user.keyboard('{Escape}')
    expect(panel()).toBeNull()
    expect(router.state.historyAction).toBe('POP')
    await user.click(byId(listTestIds.rowMore('routine', I.rentCheck)))
    await user.click(within(byId(listTestIds.rowMenu('routine'))).getByRole('menuitem', { name: '詳しく' }))
    await user.click(byId('modal-close'))
    expect(panel()).toBeNull()
  })
})
