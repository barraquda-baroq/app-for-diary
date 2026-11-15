// Routine List（src/features/lists/routine。docs/SPEC.md の 14.・3.6・6.7・6.13・6.15・■34・■35）をトップの画面の中で確かめる:
// 5つのかたまりと数・空のかたまりの＋・行の指定・チェックと外す（お知らせを出さない。前のチェックで済んだ行はチェックし直さない）・
// 2段の入力欄と［指定］・足す・その場で直す・削除と［元に戻す］・［すべて開く／畳む］・■34 で打ちかけを捨てる・0時を過ぎると記録を
// 書かずに戻る（タイマーと、裏から戻った時の visibilitychange）。［詳しく］のパネルは RoutinePanel.test.tsx
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIST_IDS, LIST_TODAY, listData } from '../../../../e2e/fixtures/listData'
import { mkCheck, mkRoutine } from '../../../domain/testData'
import type { AppData, RoutineCycle } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData, useApp } from '../../../store/appStore'
import { useCalendarUi, usePrefs, useToasts } from '../../../store/uiStore'
import { renderAt, setupCalendarTests } from '../../../test/renderCalendar'
import { discardListDraft } from '../common/listDraft'
import { draftKey } from '../common/listInputModel'
import { listTestIds } from '../common/testIds'

setupCalendarTests()
afterEach(() => {
  vi.restoreAllMocks()
})

const I = LIST_IDS
const byId = (id: string) => screen.getByTestId(id)
const group = (c: RoutineCycle) => byId(listTestIds.routineGroup(c))
const rowOf = (id: string) => screen.queryByTestId(listTestIds.row('routine', id))
const checkOf = (id: string) => byId(listTestIds.rowCheck('routine', id))
const input = () => byId(listTestIds.input('routine')) as HTMLInputElement
const specButton = () => screen.queryByTestId(listTestIds.routineSpecButton)
/** そのかたまりの行の件名（並んだ順。「済み n件」を開いていれば済んだ行も） */
const titlesIn = (c: RoutineCycle) =>
  within(group(c))
    .queryAllByTestId(/^list-routine-title-/)
    .map((el) => el.textContent)
const countText = (c: RoutineCycle) => group(c).querySelector('.rt-group-count [aria-hidden="true"]')?.textContent
const headCount = () => byId(listTestIds.count('routine')).querySelector('[aria-hidden="true"]')?.textContent
const datesOf = (routineId: string) =>
  Object.values(getData().routineChecks)
    .filter((c) => c.routineId === routineId)
    .flatMap((c) => c.dates)
    .sort()

async function open(opts: { data?: Partial<AppData>; width?: 'L' | 'S'; now?: Date } = {}) {
  const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
  const r = await renderAt('/week/2026-11-08', {
    data: opts.data ?? listData(LIST_TODAY),
    width: opts.width ?? 'L',
    now: opts.now,
  })
  if ((opts.width ?? 'L') === 'S') await user.click(byId(listTestIds.fold('routine')))
  return { ...r, user }
}

describe('S3 かたまりと行（14.1・14.2。S3-ROUTINE-100〜105・S3-ROUTINE-011〜016・S3-FRAME-240〜245）', () => {
  it('毎日 → 毎週 → 毎月 → 四半期 → 毎年 の5つ。見出しに名前と「済んだ数/全部」、空の四半期は名前と＋だけ', async () => {
    await open()
    const groups = byId(listTestIds.body('routine')).querySelectorAll('.rt-group')
    expect([...groups].map((g) => g.querySelector('.rt-group-name')?.textContent)).toEqual([
      '毎日',
      '毎週',
      '毎月',
      '四半期',
      '毎年',
    ])
    expect(countText('daily')).toBe('1/2')
    expect(countText('weekly')).toBe('0/2')
    expect(countText('monthly')).toBe('0/1')
    expect(countText('yearly')).toBe('0/1')
    // 空のかたまり: 数と山形は出さず、＋だけ
    expect(group('quarterly').classList.contains('is-empty')).toBe(true)
    expect(countText('quarterly')).toBeUndefined()
    expect(screen.queryByTestId(listTestIds.routineGroupFold('quarterly'))).toBeNull()
    expect(byId(listTestIds.routineGroupAdd('quarterly')).getAttribute('aria-label')).toBe('四半期のルーチンを足す')
    // 今の期間は出さない
    expect(group('weekly').querySelector('.rt-group-head')?.textContent).not.toMatch(/〜/)
  })

  it('行の右に指定（毎週は曜日を「・」で、毎月は「25日」、毎年は「3/15」）。毎日・指定なしは何も出さない（「—」も）', async () => {
    await open()
    expect(byId(listTestIds.routineSpecLabel(I.garbage)).textContent).toBe('月・木')
    expect(byId(listTestIds.routineSpecLabel(I.rentCheck)).textContent).toBe('25日')
    expect(byId(listTestIds.routineSpecLabel(I.taxPapers)).textContent).toBe('3/15')
    expect(screen.queryByTestId(listTestIds.routineSpecLabel(I.stretch))).toBeNull()
    expect(screen.queryByTestId(listTestIds.routineSpecLabel(I.weekReview))).toBeNull()
    expect(rowOf(I.stretch)?.textContent).not.toMatch(/—/)
  })

  it('済んだ行は「済み n件」（初めは畳む）へ沈む。開くと斜線の行で、点線の丸の読み上げは「…の済みを外す」と戻る日', async () => {
    const { user } = await open()
    expect(titlesIn('daily')).toEqual(['ストレッチ'])
    const done = byId(listTestIds.routineDone('daily'))
    expect(done.textContent).toMatch(/済み 1件/)
    await user.click(within(done).getByRole('button'))
    expect(titlesIn('daily')).toEqual(['ストレッチ', '植物に水をやる'])
    expect(rowOf(I.waterPlants)?.getAttribute('data-done')).toBe('true')
    expect(checkOf(I.waterPlants).getAttribute('aria-label')).toBe('『植物に水をやる』の済みを外す')
    // 戻る日（PC で乗せた時に出す字。読み上げは点線の丸の説明）
    expect(byId(listTestIds.routineReturn(I.waterPlants)).textContent).toBe('11/11（水）に戻ります')
    expect(checkOf(I.waterPlants).getAttribute('aria-describedby')).toBe(byId(listTestIds.routineReturn(I.waterPlants)).id)
    // 開いた・畳んだは端末ごとに覚える
    expect(usePrefs.getState().collapsed.routineDone.daily).toBe(false)
  })

  it('かたまりの山形・見出しで畳む・開く（端末ごとに覚える）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.routineGroupFold('weekly')))
    expect(group('weekly').getAttribute('data-collapsed')).toBe('true')
    expect(usePrefs.getState().collapsed.routineGroups.weekly).toBe(true)
    await user.click(within(group('weekly')).getByText('毎週'))
    expect(group('weekly').getAttribute('data-collapsed')).toBe('false')
    expect(usePrefs.getState().collapsed.routineGroups.weekly).toBe(false)
  })
})

describe('S3 チェックと外す（14.3・3.9。S3-ROUTINE-040・043・107・109・110）', () => {
  it('「済み n件」を開いている時にチェックすると、済みへ移った行を目立たせる', async () => {
    const { user } = await open()
    await user.click(within(byId(listTestIds.routineDone('daily'))).getByRole('button'))
    await user.click(checkOf(I.stretch))
    expect(useCalendarUi.getState().flash?.keys).toEqual([`list:routine:${I.stretch}`])
    expect(rowOf(I.stretch)?.getAttribute('data-done')).toBe('true')
  })

  it('チェックすると今日を記録し、行は「済み n件」へ。お知らせは出さず、数が替わる。外すと記録を消して元の所へ', async () => {
    const { user } = await open()
    await user.click(checkOf(I.stretch))
    expect(datesOf(I.stretch)).toEqual([LIST_TODAY])
    expect(countText('daily')).toBe('2/2')
    expect(headCount()).toBe('4')
    expect(titlesIn('daily')).toEqual([])
    expect(byId(listTestIds.routineDone('daily')).textContent).toMatch(/済み 2件/)
    expect(useToasts.getState().toasts).toEqual([])
    // 行は畳んだ「済み n件」へ隠れたので、その区切りを目立たせる
    expect(useCalendarUi.getState().flash?.keys).toEqual(['list:routine:done:daily'])
    // 開いて外す（戻った行を目立たせる）
    await user.click(within(byId(listTestIds.routineDone('daily'))).getByRole('button'))
    await user.click(checkOf(I.stretch))
    expect(datesOf(I.stretch)).toEqual([])
    expect(useCalendarUi.getState().flash?.keys).toEqual([`list:routine:${I.stretch}`])
    expect(titlesIn('daily')).toEqual(['ストレッチ', '植物に水をやる'])
    expect(countText('daily')).toBe('1/2')
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('S3-ROUTINE-043: 前の日のチェックで済んでいる行（毎週 月・木を月曜に）を押すと外す（今日を書き足さない）', async () => {
    const data = listData(LIST_TODAY)
    const check = mkCheck(I.garbage, '2026-11', ['2026-11-09'])
    const { user } = await open({ data: { ...data, routineChecks: { ...data.routineChecks, [check.id]: check } } })
    await user.click(within(byId(listTestIds.routineDone('weekly'))).getByRole('button'))
    expect(rowOf(I.garbage)?.getAttribute('data-done')).toBe('true')
    await user.click(checkOf(I.garbage))
    expect(datesOf(I.garbage)).toEqual([])
    expect(rowOf(I.garbage)?.getAttribute('data-done')).toBeNull()
  })

  it('チェックの日は押した時の端末の今日（画面の今日がまだ前の日のままでも）', async () => {
    const { user } = await open({ now: new Date(2026, 10, 10, 23, 59, 59) })
    // 0時を過ぎたが、画面の今日を計算し直すタイマーはまだ（裏にあった時など）
    vi.setSystemTime(new Date(2026, 10, 11, 0, 0, 0, 500))
    await user.click(checkOf(I.stretch))
    expect(datesOf(I.stretch)).toEqual(['2026-11-11'])
  })

  it('フォーカスのあった行が畳んだ「済み n件」へ隠れる時は、その区切りへフォーカスを移す', async () => {
    const { user } = await open()
    checkOf(I.stretch).focus()
    await user.keyboard('{Enter}')
    expect(rowOf(I.stretch)).toBeNull()
    expect(document.activeElement).toBe(within(byId(listTestIds.routineDone('daily'))).getByRole('button'))
  })
})

describe('S3 入力欄（2段。14.2・■35。S3-ROUTINE-083〜093・S3-FRAME-236〜239）', () => {
  it('上の段に［日｜週｜月｜四半期｜年］、毎週・毎月・毎年の時だけ［指定］。選んだ種類は端末が覚える', async () => {
    const { user } = await open()
    const above = input().closest('.list-input-box')?.querySelector('.list-input-above')
    expect(above?.querySelectorAll('[data-testid^="routine-cycle-"]')).toHaveLength(5)
    expect(byId(listTestIds.routineCycle('daily')).getAttribute('aria-pressed')).toBe('true')
    expect(specButton()).toBeNull()
    for (const c of ['weekly', 'monthly', 'yearly'] as const) {
      await user.click(byId(listTestIds.routineCycle(c)))
      expect(specButton()?.textContent).toBe('指定')
    }
    await user.click(byId(listTestIds.routineCycle('quarterly')))
    expect(specButton()).toBeNull()
    expect(usePrefs.getState().routineAddCycle).toBe('quarterly')
    expect(JSON.parse(localStorage.getItem('diary-studio:prefs') ?? '{}').routineAddCycle).toBe('quarterly')
  })

  it('毎週: ［指定］で月と木を選んで Enter で足す（その種類のいちばん下。指定は「指定なし」に戻り、種類はそのまま。欄は空でフォーカスが残る）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.routineCycle('weekly')))
    await user.click(specButton()!)
    const picker = byId(listTestIds.routineSpecPicker)
    await user.click(within(picker).getByRole('button', { name: '木曜日' }))
    await user.click(within(picker).getByRole('button', { name: '月曜日' }))
    expect(within(picker).getByRole('button', { name: '月曜日' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(picker).getByRole('button', { name: '閉じる' }))
    expect(screen.queryByTestId(listTestIds.routineSpecPicker)).toBeNull()
    expect(specButton()?.textContent).toBe('月・木')
    await user.click(input())
    await user.type(input(), '資源ごみ{Enter}')
    expect(titlesIn('weekly')).toEqual(['ゴミ出し', '週の振り返り', '資源ごみ'])
    const added = Object.values(getData().routines).find((r) => r.title === '資源ごみ')
    expect(added).toMatchObject({ cycle: 'weekly', weekdays: [1, 4], monthDay: null, yearMonth: null, yearDay: null })
    expect(input().value).toBe('')
    expect(document.activeElement).toBe(input())
    expect(specButton()?.textContent).toBe('指定')
    expect(usePrefs.getState().routineAddCycle).toBe('weekly')
    expect(localStorage.getItem(draftKey('routine'))).toBeNull()
  })

  it('毎月は日、毎年は月と日を選ぶ（日の数は月に合わせ、2/29 も選べる）。毎年で片方だけの時は指定なしで足す', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.routineCycle('monthly')))
    await user.click(specButton()!)
    await user.selectOptions(within(byId(listTestIds.routineSpecPicker)).getByLabelText('日'), '31')
    expect(specButton()?.textContent).toBe('31日')
    await user.type(input(), '月末の振り返り{Enter}')
    expect(Object.values(getData().routines).find((r) => r.title === '月末の振り返り')).toMatchObject({
      cycle: 'monthly',
      monthDay: 31,
    })

    await user.click(byId(listTestIds.routineCycle('yearly')))
    await user.click(specButton()!)
    const picker = byId(listTestIds.routineSpecPicker)
    await user.selectOptions(within(picker).getByLabelText('月'), '2')
    const days = within(picker).getByLabelText('日') as HTMLSelectElement
    expect([...days.options].map((o) => o.value).slice(-2)).toEqual(['28', '29'])
    // 月だけの間は「指定」のまま。そのまま足すと指定なし
    expect(specButton()?.textContent).toBe('指定')
    await user.type(input(), '年の計画{Enter}')
    expect(Object.values(getData().routines).find((r) => r.title === '年の計画')).toMatchObject({
      cycle: 'yearly',
      yearMonth: null,
      yearDay: null,
    })
    await user.click(specButton()!)
    await user.selectOptions(within(byId(listTestIds.routineSpecPicker)).getByLabelText('月'), '2')
    await user.selectOptions(within(byId(listTestIds.routineSpecPicker)).getByLabelText('日'), '29')
    expect(specButton()?.textContent).toBe('2/29')
    await user.type(input(), 'うるう年の点検{Enter}')
    expect(Object.values(getData().routines).find((r) => r.title === 'うるう年の点検')).toMatchObject({
      yearMonth: 2,
      yearDay: 29,
    })
  })

  it('［指定］の窓は外を押す・Esc でも閉じ、［指定なし］で選んだ物を外す', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.routineCycle('weekly')))
    await user.click(specButton()!)
    await user.click(within(byId(listTestIds.routineSpecPicker)).getByRole('button', { name: '土曜日' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId(listTestIds.routineSpecPicker)).toBeNull()
    expect(specButton()?.textContent).toBe('土')
    await user.click(specButton()!)
    await user.click(within(byId(listTestIds.routineSpecPicker)).getByRole('button', { name: '指定なし' }))
    expect(specButton()?.textContent).toBe('指定')
    await user.click(input())
    expect(screen.queryByTestId(listTestIds.routineSpecPicker)).toBeNull()
  })

  it('空・空白だけは足さない。201字は足さずに知らせ、字は欄に残る', async () => {
    const { user } = await open()
    const before = Object.keys(getData().routines).length
    await user.type(input(), '   {Enter}')
    expect(Object.keys(getData().routines)).toHaveLength(before)
    const long = 'あ'.repeat(201)
    fireEvent.change(input(), { target: { value: long } })
    await user.click(byId(listTestIds.add('routine')))
    expect(Object.keys(getData().routines)).toHaveLength(before)
    expect(useToasts.getState().toasts.map((t) => t.message)).toContain('件名は1〜200字で入れてください')
    expect(input().value).toBe(long)
  })

  it('畳んでいるかたまりへ足すと、そのかたまりを開く', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.routineGroupFold('daily')))
    expect(group('daily').getAttribute('data-collapsed')).toBe('true')
    await user.type(input(), '朝の散歩{Enter}')
    expect(group('daily').getAttribute('data-collapsed')).toBe('false')
    expect(titlesIn('daily')).toEqual(['ストレッチ', '朝の散歩'])
  })

  it('空のかたまりの＋: その種類を選んで入力欄へフォーカスする', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.routineGroupAdd('quarterly')))
    expect(usePrefs.getState().routineAddCycle).toBe('quarterly')
    expect(byId(listTestIds.routineCycle('quarterly')).getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(input())
    // 欄が見えない所にあっても、見える所まで送る
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(input())
    await user.keyboard('税の見直し{Enter}')
    expect(group('quarterly').classList.contains('is-empty')).toBe(false)
    expect(titlesIn('quarterly')).toEqual(['税の見直し'])
  })

  it('［指定］の窓が開いている時の「戻る」（consumeBackPress）は、窓だけを閉じる。字と選んだ［指定］は残る（3.1・■34。開発）', async () => {
    const { consumeBackPress } = await import('../../top/closeApp')
    const { user } = await open()
    await user.click(byId(listTestIds.routineCycle('weekly')))
    await user.click(specButton()!)
    await user.click(within(byId(listTestIds.routineSpecPicker)).getByRole('button', { name: '水曜日' }))
    fireEvent.change(input(), { target: { value: '書きかけ' } })
    let used = false
    act(() => {
      used = consumeBackPress()
    })
    expect(used).toBe(true)
    expect(screen.queryByTestId(listTestIds.routineSpecPicker)).toBeNull()
    expect(input().value).toBe('書きかけ')
    expect(specButton()!.textContent).toBe('水')
    expect(consumeBackPress()).toBe(false)
  })

  it('■34: 打ちかけを捨てると、字といっしょに［指定］も空にし、窓も閉じる（足さない）', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.routineCycle('weekly')))
    await user.click(specButton()!)
    await user.click(within(byId(listTestIds.routineSpecPicker)).getByRole('button', { name: '水曜日' }))
    fireEvent.change(input(), { target: { value: '書きかけ' } })
    const before = Object.keys(getData().routines).length
    act(() => discardListDraft('routine'))
    expect(input().value).toBe('')
    expect(specButton()?.textContent).toBe('指定')
    expect(screen.queryByTestId(listTestIds.routineSpecPicker)).toBeNull()
    expect(Object.keys(getData().routines)).toHaveLength(before)
    expect(localStorage.getItem(draftKey('routine'))).toBeNull()
  })
})

describe('S3 その場で直す・削除（14.2・6.15・3.9。S3-ROUTINE-120・141〜143）', () => {
  it('件名を押すと1行の欄。Enter で保存、空にして離れると元に戻す', async () => {
    const { user } = await open()
    await user.click(byId(listTestIds.rowTitle('routine', I.stretch)))
    const edit = byId(listTestIds.rowEdit('routine', I.stretch)) as HTMLInputElement
    expect(document.activeElement).toBe(edit)
    await user.clear(edit)
    await user.type(edit, '朝のストレッチ{Enter}')
    expect(getData().routines[I.stretch].title).toBe('朝のストレッチ')
    await user.click(byId(listTestIds.rowTitle('routine', I.stretch)))
    await user.clear(byId(listTestIds.rowEdit('routine', I.stretch)))
    await user.click(input())
    expect(getData().routines[I.stretch].title).toBe('朝のストレッチ')
    expect(byId(listTestIds.rowTitle('routine', I.stretch)).textContent).toBe('朝のストレッチ')
  })

  it('「…」→［削除］は確かめずにゴミ箱へ移して「『件名』を削除しました［元に戻す］」。［元に戻す］はゴミ箱のその1件を戻す', async () => {
    // ゴミ箱の出し入れは端末の記録に当てる（テストの保存先は何も書かないので、移した後の形を置く）。チェックの記録ごと戻すことは
    // common/listToasts.test.ts（本物の保存先）で確かめる
    const trash = vi.spyOn(actions, 'trashRoutine').mockImplementation(async (id) => {
      useApp.setState((st) => {
        const routines = { ...st.data.routines }
        delete routines[id]
        const entry = { id: 'e1' } as AppData['trashEntries'][string]
        return { data: { ...st.data, routines, trashEntries: { ...st.data.trashEntries, e1: entry } } }
      })
      return 'e1'
    })
    const restore = vi.spyOn(actions, 'restoreTrashEntry').mockResolvedValue(undefined as never)
    const { user } = await open()
    await user.click(within(byId(listTestIds.routineDone('daily'))).getByRole('button'))
    await user.click(byId(listTestIds.rowMore('routine', I.waterPlants)))
    await user.click(within(byId(listTestIds.rowMenu('routine'))).getByRole('menuitem', { name: '削除' }))
    await vi.waitFor(() => expect(rowOf(I.waterPlants)).toBeNull())
    expect(trash).toHaveBeenCalledWith(I.waterPlants)
    expect(screen.queryByRole('dialog')).toBeNull()
    const toast = useToasts.getState().toasts.at(-1)
    expect(toast?.message).toBe('『植物に水をやる』を削除しました')
    expect(toast?.action?.label).toBe('元に戻す')
    await act(async () => toast?.action?.run())
    expect(restore).toHaveBeenCalledWith('e1')
  })

  it('長い件名のお知らせは20字まで', async () => {
    vi.spyOn(actions, 'trashRoutine').mockResolvedValue('e2')
    const long = 'とても長い名前のルーチンで二十文字を超えてしまう物'
    const { user } = await open({ data: { routines: { r: mkRoutine({ id: 'r', title: long }) } } })
    await user.click(byId(listTestIds.rowMore('routine', 'r')))
    await user.click(within(byId(listTestIds.rowMenu('routine'))).getByRole('menuitem', { name: '削除' }))
    await vi.waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1))
    expect(useToasts.getState().toasts[0].message).toBe(`『${Array.from(long).slice(0, 20).join('')}…』を削除しました`)
  })
})

describe('S3 ［すべて開く／畳む］（14.2）', () => {
  it('畳んでいる空のかたまりは数えない（押しても画面が替わらないので「すべて開く」にしない）', async () => {
    usePrefs.setState((s) => ({
      collapsed: { ...s.collapsed, routineGroups: { ...s.collapsed.routineGroups, quarterly: true } },
    }))
    const { user } = await open()
    const toggle = byId(listTestIds.routineToggleAll)
    expect(toggle.textContent).toBe('すべて畳む')
    await user.click(toggle)
    expect(group('daily').getAttribute('data-collapsed')).toBe('true')
    expect(byId(listTestIds.routineToggleAll).textContent).toBe('すべて開く')
  })

  it('ルーチンが1つも無い間は出さない', async () => {
    await open({ data: {} })
    expect(screen.queryByTestId(listTestIds.routineToggleAll)).toBeNull()
  })
})

describe('S3 日が替わると、記録を書かずに戻る（14.3・6.4。S3-ROUTINE-063〜066・069・072・S3-FRAME-268）', () => {
  /** 端末の記録の書き込み（data が替わった回数） */
  function spyWrites() {
    const writes = vi.fn()
    const off = useApp.subscribe((s, p) => {
      if (s.data !== p.data) writes()
    })
    return { writes, off }
  }

  it('23:59:59 にチェックした毎日の物は 0時の後のタイマーで戻り、見出し・かたまり・「済み n件」・切り替えの列の数も替わる', async () => {
    await open({ width: 'S', now: new Date(2026, 10, 10, 23, 59, 59) })
    // ここからタイマーも偽物（画面の今日を計算し直すタイマーを、フォーカスが戻った時の計算し直しで偽物のタイマーに置き直す）
    vi.useFakeTimers({ now: Date.now(), toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    fireEvent.click(checkOf(I.stretch))
    expect(datesOf(I.stretch)).toEqual([LIST_TODAY])
    expect(countText('daily')).toBe('2/2')
    expect(headCount()).toBe('4')
    expect(byId('top-jump-routine').querySelector('[aria-hidden="true"]')?.textContent).toBe('4')
    const raw = getData().routineChecks
    const { writes, off } = spyWrites()
    // 0時（タイマーは 0時の 1秒後に今日を計算し直す）
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(countText('daily')).toBe('0/2')
    expect(titlesIn('daily')).toEqual(['植物に水をやる', 'ストレッチ'])
    expect(screen.queryByTestId(listTestIds.routineDone('daily'))).toBeNull()
    expect(headCount()).toBe('6')
    expect(byId('top-jump-routine').querySelector('[aria-hidden="true"]')?.textContent).toBe('6')
    // 何も書かない（チェックの記録はそのまま）・知らせない
    expect(writes).not.toHaveBeenCalled()
    expect(getData().routineChecks).toBe(raw)
    expect(useToasts.getState().toasts).toEqual([])
    off()
  })

  it('タイマーが遅れても（iPhone の裏）、画面が見えるようになった時（visibilitychange）に戻る。戻る日の字も今日から', async () => {
    const data = listData(LIST_TODAY)
    const check = mkCheck(I.garbage, '2026-11', ['2026-11-10'])
    const { user } = await open({ data: { ...data, routineChecks: { ...data.routineChecks, [check.id]: check } } })
    await user.click(within(byId(listTestIds.routineDone('weekly'))).getByRole('button'))
    expect(byId(listTestIds.routineReturn(I.garbage)).textContent).toBe('11/12（木）に戻ります')
    const { writes, off } = spyWrites()
    // 木曜 11/12 の朝（時計だけが進み、0時のタイマーはまだ来ていない）
    vi.setSystemTime(new Date(2026, 10, 12, 7, 0))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(rowOf(I.garbage)?.getAttribute('data-done')).toBeNull()
    expect(titlesIn('weekly')).toEqual(['ゴミ出し', '週の振り返り'])
    expect(writes).not.toHaveBeenCalled()
    off()
  })

  it('知らない種類の記録は毎日のかたまりに出す。件名を直す時は件名だけを渡す（種類は書き換えない。6.12）', async () => {
    const odd = {
      ...mkRoutine({ id: 'odd', title: '水やり', order: 9 }),
      cycle: 'biweekly',
    } as unknown as AppData['routines'][string]
    const update = vi.spyOn(actions, 'updateRoutine')
    const { user } = await open({ data: { routines: { odd } } })
    expect(titlesIn('daily')).toEqual(['水やり'])
    await user.click(byId(listTestIds.rowTitle('routine', 'odd')))
    await user.type(byId(listTestIds.rowEdit('routine', 'odd')), '！{Enter}')
    expect(update).toHaveBeenCalledWith('odd', { title: '水やり！' })
    expect(getData().routines.odd.title).toBe('水やり！')
  })
})
