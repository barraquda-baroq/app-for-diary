// Task List の決まり（docs/SPEC.md の 13.・6.3・6.4）: 4通りとカレンダー生まれ、出る物（listed・168時間・ゴミ箱）、並び（13.4。同じ日・
// 同じ作った時刻）、済みの並び、数、期限切れと今日（0時の前後）、日付の列の字（よその年の読み上げ）、M・S の上の行、入力欄から足す物
// （チップのそろえ方・断る時）、日付を直す時（Task List に戻す・開始日を消せない・6.4 で断る）、日付の列のメニュー（2.10: Task List の並び）
import { describe, expect, it } from 'vitest'
import { todayStr } from './dates'
import { DATE_REFUSED } from './itemInput'
import { REQUESTER_LIMIT_TEXT, TITLE_RANGE_TEXT } from './itemText'
import { countOn, isInTaskList, isOnCalendar, itemProblems, periodOf } from './items'
import { addItem, moveItemDates, updateItem } from './ops'
import { UNTITLED, repairData } from './repair'
import {
  compareDoneTasks,
  compareOpenTasks,
  taskCaseOf,
  taskChipOptions,
  taskDateEdit,
  taskDateMenu,
  taskDateText,
  taskEntryWithDates,
  taskInputOf,
  taskListView,
  taskRowView,
  taskStackedLine,
  taskStackedParts,
  type TaskEntry,
  type TaskRowView,
} from './taskList'
import { DAY, HOUR, T0, dataWith, mkItem, mkTask } from './testData'
import { trashRecord } from './trash'
import { emptyData, type Item } from './types'
import { TASK_DONE_VISIBLE_MS } from './items'

/** テストの今日（2026-11-10（火）） */
const TODAY = '2026-11-10'
const NOW = T0

const view = (items: Item[], today = TODAY, nowMs = NOW) => taskListView(items, today, nowMs)
const ids = (rows: TaskRowView[]) => rows.map((r) => r.id)
const entry = (p: Partial<TaskEntry> = {}): TaskEntry => ({ text: '見積書を出す', start: null, due: null, requester: '', ...p })

// 4通り（list 生まれ）とカレンダー生まれ
const none = mkTask({ id: 'none' }) // ①
const due = mkTask({ id: 'due', due: '2026-11-20' }) // ②
const span = mkTask({ id: 'span', start: '2026-11-10', due: '2026-11-20' }) // ③
const sameDay = mkTask({ id: 'same', start: '2026-11-20', due: '2026-11-20' }) // ③ で開始日 = 締め切り日（1日）
const startOnly = mkTask({ id: 'start', start: '2026-11-10' }) // ④
const cal = mkItem({ id: 'cal', start: '2026-11-12', listed: true }) // カレンダー生まれ・1日
const calSpan = mkItem({ id: 'cal-span', start: '2026-11-10', due: '2026-11-12', listed: true }) // カレンダー生まれ・複数日

describe('4通りとカレンダー生まれ（6.3 の表）', () => {
  it.each([
    ['① 開始日なし・締め切り日なし', none, 'none', false],
    ['② 締め切り日だけ', due, 'due', true],
    ['③ 開始日と締め切り日', span, 'span', true],
    ['③ 開始日 = 締め切り日', sameDay, 'span', true],
    ['④ 開始日だけ', startOnly, 'start', false],
    ['カレンダー生まれ（締め切り日なし）', cal, 'calendar', true],
    ['カレンダー生まれ（締め切り日あり）', calSpan, 'calendar', true],
  ] as const)('%s（S3-FRAME-132..135・S3-TASK-008..011・S3-FRAME-130・S3-TASK-006）', (_name, item, want, onCalendar) => {
    expect(taskCaseOf(item)).toBe(want)
    const row = taskRowView(item, TODAY)
    expect(row.case).toBe(want)
    expect(row.onCalendar).toBe(onCalendar)
    expect(isOnCalendar(item)).toBe(onCalendar)
    // どれも Task List に出る（S3-FRAME-128・S3-TASK-014）
    expect(ids(view([item]).open)).toEqual([item.id])
  })

  it('形の正しくない日付は無いものとみなす（6.12 と同じ）', () => {
    expect(taskCaseOf({ origin: 'list', start: '2026-02-30', due: null })).toBe('none')
    expect(taskCaseOf({ origin: 'list', start: null, due: 'x' })).toBe('none')
    expect(taskCaseOf({ origin: 'list', start: '2026-11-10', due: '2026-13-01' })).toBe('start')
  })

  it('期間（to）: list 生まれは締め切り日、カレンダー生まれは締め切り日か開始日、①④は null（S3-TASK-007・S3-FRAME-131）', () => {
    expect(taskRowView(none, TODAY).to).toBeNull()
    expect(taskRowView(startOnly, TODAY).to).toBeNull()
    expect(taskRowView(due, TODAY).to).toBe('2026-11-20')
    expect(taskRowView(span, TODAY).to).toBe('2026-11-20')
    expect(periodOf(span)).toEqual({ from: '2026-11-10', to: '2026-11-20' })
    expect(periodOf(due)).toEqual({ from: '2026-11-20', to: '2026-11-20' })
    expect(taskRowView(cal, TODAY).to).toBe('2026-11-12')
    expect(taskRowView(calSpan, TODAY).to).toBe('2026-11-12')
  })

  it('④はカレンダーのどこにも出ない（マンスリーの数にも入らない。S3-TASK-011）', () => {
    expect(countOn([startOnly], '2026-11-10', 'work')).toBe(0)
    expect(countOn([due], '2026-11-20', 'work')).toBe(1)
  })

  it('［日付を決める］は①④だけ、［Task List から外す］はカレンダーに出ている時だけ（S3-FRAME-138・S3-TASK-021）', () => {
    for (const it of [none, startOnly]) {
      expect(taskRowView(it, TODAY)).toMatchObject({ canDecideDate: true, canUnlist: false })
    }
    for (const it of [due, span, sameDay, cal, calSpan]) {
      expect(taskRowView(it, TODAY)).toMatchObject({ canDecideDate: false, canUnlist: true })
    }
  })
})

describe('Task List に出る物（6.3・13.1・13.4）', () => {
  it('listed が false の物は出ない（カレンダー生まれは「Task List にも出す」をオンにした物だけ。S3-FRAME-127・S3-FRAME-128・S3-TASK-013・S3-TASK-014）', () => {
    const off = mkItem({ id: 'off', listed: false })
    expect(ids(view([off, cal]).open)).toEqual(['cal'])
  })

  it('ゴミ箱へ移した物は出ない（data.items に無い。S3-TASK-006・S3-TASK-013）', () => {
    const data = dataWith({ items: [due, none] })
    const trashed = trashRecord(data, 'items', 'due', { at: NOW }).data
    expect(ids(view(Object.values(trashed.items)).open)).toEqual(['none'])
    expect(isOnCalendar(due)).toBe(true)
  })

  it('済んでからちょうど 168時間はまだ出し、168時間と 1ミリ秒で隠す（済みの所からも。S3-FRAME-179・S3-TASK-015）', () => {
    const doneAt = T0
    const done = mkTask({ id: 'done', done: true, doneAt, doneOn: TODAY, due: '2026-11-10' })
    expect(TASK_DONE_VISIBLE_MS).toBe(168 * HOUR)
    expect(ids(view([done], TODAY, doneAt + 167 * HOUR).done)).toEqual(['done'])
    expect(ids(view([done], TODAY, doneAt + 168 * HOUR).done)).toEqual(['done'])
    expect(ids(view([done], TODAY, doneAt + 168 * HOUR + 1).done)).toEqual([])
    // データ・カレンダーには残る（完了した予定として）
    expect(isOnCalendar(done)).toBe(true)
    expect(isInTaskList(done, doneAt + 168 * HOUR + 1)).toBe(false)
  })

  it('隠すかは nowMs だけで決める（today を変えても同じ）', () => {
    const done = mkTask({ id: 'done', done: true, doneAt: T0 })
    expect(ids(view([done], '2026-11-30', T0 + DAY).done)).toEqual(['done'])
    expect(ids(view([done], TODAY, T0 + 8 * DAY).done)).toEqual([])
  })

  it('doneAt の無い済みの物は隠さない', () => {
    const done = mkTask({ id: 'done', done: true, doneAt: null })
    expect(ids(view([done], TODAY, T0 + 365 * DAY).done)).toEqual(['done'])
  })

  it('list 生まれで締め切り日が無く listed が false の物は、表示用に直した記録では Task List に出る（書き戻さない。S3-TASK-017）', () => {
    const stray = mkTask({ id: 'stray', listed: false })
    expect(view([stray]).open).toEqual([])
    const shown = repairData(dataWith({ items: [stray] })).data
    expect(shown.items.stray.listed).toBe(true)
    expect(ids(view(Object.values(shown.items)).open)).toEqual(['stray'])
    expect(stray.listed).toBe(false)
  })

  it('表示用の直し: 知らない区分は仕事、知らないラベルはなし、空の件名は「（件名なし）」で出す（S3-TASK-018）', () => {
    const odd = { ...mkTask({ id: 'odd', title: '  ', label: 'no-such' }), kind: 'other' } as unknown as Item
    const shown = repairData(dataWith({ items: [odd] })).data
    const row = view(Object.values(shown.items)).open[0]
    expect(row.item.kind).toBe('work')
    expect(row.item.label).toBeNull()
    expect(row.item.title).toBe(UNTITLED)
  })
})

describe('並び（13.4・開発。2.10 の単体: Task List の並び。S3-FRAME-342）', () => {
  it('カレンダーに出ている物を to の早い順（期限切れが上）、その下に①④を作った新しい順。仕事とプライベートは混ぜる（S3-FRAME-174・S3-TASK-110）', () => {
    const items = [
      mkTask({ id: 'n-old', createdAt: T0 - 5 * DAY }), // ① 古い
      mkTask({ id: 'p-due', kind: 'private', due: '2026-11-12' }),
      mkTask({ id: 's-new', start: '2026-11-20', createdAt: T0 + 1 }), // ④ 新しい
      mkTask({ id: 'over', due: '2026-11-08' }), // 期限切れ
      mkItem({ id: 'c-today', start: TODAY, listed: true, kind: 'private' }),
      mkTask({ id: 'w-span', start: '2026-11-01', due: '2026-11-15' }),
    ]
    const v = view(items)
    expect(ids(v.open)).toEqual(['over', 'c-today', 'p-due', 'w-span', 's-new', 'n-old'])
  })

  it('カレンダー生まれで締め切り日の無い物は to = 開始日で上の並びに入る（S3-TASK-111）', () => {
    const items = [mkTask({ id: 'd13', due: '2026-11-13' }), mkItem({ id: 'c11', start: '2026-11-11', listed: true })]
    expect(ids(view(items).open)).toEqual(['c11', 'd13'])
  })

  it('同じ to は入れた順（作った時刻の早い順）、それも同じなら id の小さい順（S3-FRAME-175・S3-TASK-028）', () => {
    const items = [
      mkTask({ id: 'b', due: '2026-11-12', createdAt: T0 }),
      mkTask({ id: 'late', due: '2026-11-12', createdAt: T0 + 1000 }),
      mkTask({ id: 'a', due: '2026-11-12', createdAt: T0 }),
      mkItem({ id: 'first', start: '2026-11-12', listed: true, createdAt: T0 - 1000 }),
    ]
    expect(ids(view(items).open)).toEqual(['first', 'a', 'b', 'late'])
  })

  it('①④の同じ作った時刻は id の小さい順', () => {
    const items = [mkTask({ id: 'y' }), mkTask({ id: 'x', start: '2026-11-11' })]
    expect(ids(view(items).open)).toEqual(['x', 'y'])
  })

  it('済みの行は済んだ新しい順、同じなら id の小さい順（doneAt の無い物は下。S3-TASK-119・開発）', () => {
    const items = [
      mkTask({ id: 'd1', done: true, doneAt: T0 - 3 * HOUR }),
      mkTask({ id: 'd3', done: true, doneAt: T0 - HOUR }),
      mkTask({ id: 'd2b', done: true, doneAt: T0 - 2 * HOUR }),
      mkTask({ id: 'd2a', done: true, doneAt: T0 - 2 * HOUR }),
      mkTask({ id: 'd0', done: true, doneAt: null }),
    ]
    expect(ids(view(items).done)).toEqual(['d3', 'd2a', 'd2b', 'd1', 'd0'])
  })

  it('並べ方の関数だけでも同じ（負なら a が上）', () => {
    const r = (it: Item) => taskRowView(it, TODAY)
    expect(compareOpenTasks(r(due), r(none))).toBeLessThan(0)
    expect(compareOpenTasks(r(none), r(due))).toBeGreaterThan(0)
    expect(compareOpenTasks(r(due), r(due))).toBe(0)
    const a = r(mkTask({ id: 'a', done: true, doneAt: 2 }))
    const b = r(mkTask({ id: 'b', done: true, doneAt: 1 }))
    expect(compareDoneTasks(a, b)).toBeLessThan(0)
    expect(compareDoneTasks(b, a)).toBeGreaterThan(0)
  })

  it('作った時刻が数でない記録も並びを壊さない（0 として扱う）', () => {
    const bad = { ...mkTask({ id: 'bad' }), createdAt: Number.NaN }
    expect(ids(view([bad, mkTask({ id: 'ok' })]).open)).toEqual(['ok', 'bad'])
  })

  it('済みは済んでいない物の数（見出し・切り替えの列の数）に入れない。隠した物も数えない（S3-FRAME-180・S3-TASK-118）', () => {
    const items = [
      none,
      due,
      mkTask({ id: 'd', done: true, doneAt: T0 }),
      mkTask({ id: 'old', done: true, doneAt: T0 - 8 * DAY }),
      mkItem({ id: 'hidden', listed: false }),
    ]
    const v = view(items)
    expect(v.undone).toBe(2)
    expect(v.open).toHaveLength(2)
    expect(ids(v.done)).toEqual(['d'])
  })
})

describe('期限切れと今日（to で決める。13.3・開発）', () => {
  it('to が今日より前で済んでいない物は期限切れ、今日の物は今日（S3-FRAME-161・S3-TASK-078）', () => {
    const v = view([
      mkTask({ id: 'past', due: '2026-11-09' }),
      mkTask({ id: 'today', due: TODAY }),
      mkTask({ id: 'future', due: '2026-11-11' }),
      mkTask({ id: 'span-over', start: '2026-11-01', due: '2026-11-09' }),
      mkItem({ id: 'cal-past', start: '2026-11-09', listed: true }),
      mkItem({ id: 'cal-span', start: '2026-11-08', due: TODAY, listed: true }),
    ])
    const by = Object.fromEntries(v.open.map((r) => [r.id, [r.overdue, r.today]]))
    expect(by).toEqual({
      past: [true, false],
      today: [false, true],
      future: [false, false],
      'span-over': [true, false],
      'cal-past': [true, false],
      'cal-span': [false, true],
    })
  })

  it('①④（to が無い）は期限切れにも今日にもならない（開始日が過ぎても）', () => {
    const v = view([none, mkTask({ id: 'start-past', start: '2026-11-01' })])
    for (const r of v.open) expect([r.overdue, r.today]).toEqual([false, false])
  })

  it('済んだ行は期限切れにならない（S3-TASK-078）', () => {
    const v = view([mkTask({ id: 'done', due: '2026-11-01', done: true, doneAt: T0 })])
    expect(v.done[0].overdue).toBe(false)
  })

  it('端末の時計の 0時の前後: 23:59:59.999 はまだ今日、0:00 で期限切れになる（S3-FRAME-161）', () => {
    const item = mkTask({ id: 'x', due: TODAY })
    const before = new Date(2026, 10, 10, 23, 59, 59, 999).getTime()
    const after = new Date(2026, 10, 11, 0, 0, 0, 0).getTime()
    expect(todayStr(before)).toBe(TODAY)
    expect(view([item], todayStr(before), before).open[0]).toMatchObject({ overdue: false, today: true })
    expect(view([item], todayStr(after), after).open[0]).toMatchObject({ overdue: true, today: false })
  })
})

describe('L の日付の列の字（13.3・開発）', () => {
  it.each([
    ['② 1日', due, { sub: null, main: '11/20', faint: false, aria: '2026年11月20日（金）' }],
    ['③ 開始日 = 締め切り日は1日', sameDay, { sub: null, main: '11/20', faint: false, aria: '2026年11月20日（金）' }],
    ['③ 複数日', span, { sub: '11/10〜', main: '11/20', faint: false, aria: '2026年11月10日（火）〜2026年11月20日（金）' }],
    ['④ 開始日だけ', startOnly, { sub: null, main: '11/10〜', faint: false, aria: '2026年11月10日（火）から' }],
    ['① 日付なし', none, { sub: null, main: '—', faint: true, aria: '日付なし' }],
    ['カレンダー生まれの1日', cal, { sub: null, main: '11/12', faint: false, aria: '2026年11月12日（木）' }],
    [
      'カレンダー生まれの複数日',
      calSpan,
      { sub: '11/10〜', main: '11/12', faint: false, aria: '2026年11月10日（火）〜2026年11月12日（木）' },
    ],
  ] as const)('%s（S3-FRAME-159・S3-FRAME-160・S3-TASK-076・S3-TASK-077）', (_name, item, want) => {
    expect(taskDateText(item)).toEqual(want)
    expect(taskRowView(item, TODAY).date).toEqual(want)
  })

  it('よその年の日付も列には月日だけ、読み上げに年まで（開発）', () => {
    expect(taskDateText(mkTask({ due: '2027-01-05' }))).toEqual({
      sub: null,
      main: '1/5',
      faint: false,
      aria: '2027年1月5日（火）',
    })
    expect(taskDateText(mkTask({ start: '2026-12-28', due: '2027-01-05' }))).toMatchObject({
      sub: '12/28〜',
      main: '1/5',
      aria: '2026年12月28日（月）〜2027年1月5日（火）',
    })
  })
})

describe('M・S の上の行（13.3・開発）', () => {
  it.each([
    ['② 1日（〆を付ける）', due, '〆11/20', '〆11/20・営業部'],
    ['③ 開始日 = 締め切り日（1日なので〆）', sameDay, '〆11/20', '〆11/20・営業部'],
    ['③ 複数日', span, '11/10〜11/20', '11/10〜11/20・営業部'],
    ['④ 開始日だけ', startOnly, '11/10〜', '11/10〜・営業部'],
    ['① 日付なし（依頼者だけか空）', none, '', '営業部'],
    ['カレンダー生まれの1日（〆を付けない）', cal, '11/12', '11/12・営業部'],
    ['カレンダー生まれの複数日', calSpan, '11/10〜11/12', '11/10〜11/12・営業部'],
  ] as const)('%s（S3-TASK-092・S3-TASK-090 の字）', (_name, item, without, withRequester) => {
    expect(taskStackedLine(item)).toBe(without)
    expect(taskStackedLine({ ...item, requester: '営業部' })).toBe(withRequester)
    expect(taskRowView({ ...item, requester: '営業部' }, TODAY).stackedLine).toBe(withRequester)
  })

  it('日付の所と依頼者を分けて返す（期限切れの色・太字は日付の所だけに付ける。開発）', () => {
    expect(taskStackedParts({ ...due, requester: '  総務 ' })).toEqual({ date: '〆11/20', requester: '総務' })
    expect(taskStackedParts(none)).toEqual({ date: '', requester: '' })
    expect(taskStackedParts({ ...none, requester: 7 } as unknown as Item)).toEqual({ date: '', requester: '' })
  })
})

describe('入力欄から足す物（taskInputOf。13.2・12.4・開発）', () => {
  it('Task List 生まれ・仕事・Task List に出す・ラベルなし・時刻なし・ロックなし（S3-TASK-001・S3-FRAME-151）', () => {
    expect(taskInputOf(entry())).toEqual({
      ok: true,
      input: {
        origin: 'list',
        title: '見積書を出す',
        kind: 'work',
        start: null,
        due: null,
        startTime: null,
        endTime: null,
        listed: true,
        locked: false,
        label: null,
        requester: '',
        memo: '',
      },
    })
  })

  it('2行以上は1行目を件名、2行目からをメモに（頭の空の行は飛ばす。S3-FRAME-150・S3-TASK-036）', () => {
    const r = taskInputOf(entry({ text: '\n  会議の資料 \r\n表紙を直す\n\n図を足す\n\n' }))
    expect(r).toMatchObject({ ok: true, input: { title: '会議の資料', memo: '表紙を直す\n\n図を足す' } })
  })

  it('開始日・締め切り日・依頼者は選んだ値（依頼者は前後の空白を除く。S3-FRAME-151）', () => {
    const r = taskInputOf(entry({ start: '2026-11-10', due: '2026-11-20', requester: ' 営業部 ' }))
    expect(r).toMatchObject({ ok: true, input: { start: '2026-11-10', due: '2026-11-20', requester: '営業部' } })
  })

  it('チップの開始日が締め切り日より後なら、締め切り日を開始日にそろえる（editDates と同じ。S3-TASK-063・S3-TASK-023）', () => {
    const r = taskInputOf(entry({ start: '2026-11-15', due: '2026-11-12' }))
    expect(r).toMatchObject({ ok: true, input: { start: '2026-11-15', due: '2026-11-15' } })
  })

  it('件名が空・空白だけ・201字は足さず理由を返す（書きかけはそのまま。S3-TASK-044・S3-FRAME-093）', () => {
    for (const text of ['', '  \n\t\n', 'あ'.repeat(201), `\n${'😀'.repeat(201)}\nメモ`]) {
      const e = entry({ text })
      expect(taskInputOf(e)).toEqual({ ok: false, message: TITLE_RANGE_TEXT })
      expect(e.text).toBe(text)
    }
    expect(TITLE_RANGE_TEXT).toBe('件名は1〜200字で入れてください')
  })

  it('200字（絵文字 200字も）と前後の空白を除いて 200字は足せる（コードポイントで数える。S3-FRAME-092・S3-TASK-004）', () => {
    expect(taskInputOf(entry({ text: 'あ'.repeat(200) })).ok).toBe(true)
    expect(taskInputOf(entry({ text: '😀'.repeat(200) })).ok).toBe(true)
    expect(taskInputOf(entry({ text: `  ${'あ'.repeat(200)}  ` })).ok).toBe(true)
  })

  it('依頼者は 0〜60字（61字は断る。S3-FRAME-147・S3-TASK-004）', () => {
    expect(taskInputOf(entry({ requester: 'あ'.repeat(60) })).ok).toBe(true)
    expect(taskInputOf(entry({ requester: `  ${'あ'.repeat(60)}  ` })).ok).toBe(true)
    expect(taskInputOf(entry({ requester: 'あ'.repeat(61) }))).toEqual({ ok: false, message: REQUESTER_LIMIT_TEXT })
  })

  it('形の正しくない日付は断る', () => {
    expect(taskInputOf(entry({ due: '2026-02-30' }))).toEqual({ ok: false, message: '日付の形が正しくありません' })
  })

  it('addItem に渡すと決まりに合う記録になる（id・v・作った時刻 = 直した時刻 = order・手で作った出どころ。S3-TASK-001・S3-TASK-002）', () => {
    const r = taskInputOf(entry({ text: '請求書の確認\n先月の分', due: '2026-11-12', requester: '総務' }))
    if (!r.ok) throw new Error(r.message)
    const at = T0 + 123
    const { data, result } = addItem(emptyData(), r.input, at)
    const rec = data.items[result]
    expect(result).toMatch(/^[0-9a-f-]{36}$|^id-/)
    expect(rec).toMatchObject({
      v: 1,
      origin: 'list',
      kind: 'work',
      title: '請求書の確認',
      memo: '先月の分',
      start: null,
      due: '2026-11-12',
      startTime: null,
      endTime: null,
      listed: true,
      done: false,
      doneAt: null,
      doneOn: null,
      locked: false,
      label: null,
      requester: '総務',
      order: at,
      createdAt: at,
      updatedAt: at,
      by: 'user',
      ai: null,
      via: null,
    })
    expect(itemProblems(rec)).toEqual([])
  })

  it('チップを選ぶ・外す途中の書きかけも同じくそろえる（taskEntryWithDates。S3-TASK-063）', () => {
    const e = entry({ start: '2026-11-12', due: '2026-11-14' })
    expect(taskEntryWithDates(e, { due: '2026-11-10' })).toMatchObject({ start: '2026-11-10', due: '2026-11-10' })
    expect(taskEntryWithDates(e, { start: '2026-11-16' })).toMatchObject({ start: '2026-11-16', due: '2026-11-16' })
    expect(taskEntryWithDates(e, { start: null })).toMatchObject({ start: null, due: '2026-11-14' })
    expect(taskEntryWithDates(e, { due: null })).toMatchObject({ start: '2026-11-12', due: null })
    expect(taskEntryWithDates(e, { due: 'x' })).toBe(e)
    expect(taskEntryWithDates(entry({ text: '字' }), { due: '2026-11-20' })).toEqual(entry({ text: '字', due: '2026-11-20' }))
  })
})

describe('日付を直す時（taskDateEdit。6.3・6.4・13.5）', () => {
  it('list 生まれの締め切り日を「なし」にするとカレンダーから外れ、Task List に残る（S3-TASK-129・S3-FRAME-189）', () => {
    const r = taskDateEdit(span, { due: null })
    expect(r).toEqual({ ok: true, patch: { start: '2026-11-10', due: null, endTime: null, listed: true }, relisted: false })
    const next = { ...span, ...(r.ok ? r.patch : {}) }
    expect(isOnCalendar(next)).toBe(false)
    expect(taskCaseOf(next)).toBe('start')
  })

  it('外していた物（listed false）の締め切り日を消すと listed を true に戻し、relisted（お知らせ。S3-FRAME-137・S3-TASK-020）', () => {
    const unlisted = { ...due, listed: false }
    const r = taskDateEdit(unlisted, { due: null })
    expect(r).toEqual({ ok: true, patch: { start: null, due: null, endTime: null, listed: true }, relisted: true })
    // ops.updateItem に渡しても同じ（どこにも出ない項目を作らない）
    const data = updateItem(dataWith({ items: [unlisted] }), 'due', r.ok ? r.patch : {}, T0).data
    expect(data.items.due).toMatchObject({ listed: true, due: null })
    expect(isInTaskList(data.items.due, NOW)).toBe(true)
  })

  it('締め切り日がもともと無いのに listed false の物（直す前の古い記録）は、開始日を直すと listed を true にするだけで、お知らせは出さない（カレンダーから外れていないため）', () => {
    const raw = mkTask({ id: 'raw', start: '2026-11-10', listed: false })
    const r = taskDateEdit(raw, { start: '2026-11-12' })
    expect(r).toEqual({ ok: true, patch: { start: '2026-11-12', due: null, endTime: null, listed: true }, relisted: false })
    const data = updateItem(dataWith({ items: [raw] }), 'raw', r.ok ? r.patch : {}, T0)
    expect(data.result.relisted).toBe(false)
    expect(data.data.items.raw).toMatchObject({ listed: true, start: '2026-11-12' })
  })

  it('開始日を締め切り日より後にすると締め切り日を、締め切り日を開始日より前にすると開始日をそろえる（S3-FRAME-139・S3-TASK-023）', () => {
    expect(taskDateEdit(span, { start: '2026-11-25' })).toMatchObject({
      ok: true,
      patch: { start: '2026-11-25', due: '2026-11-25' },
    })
    expect(taskDateEdit(span, { due: '2026-11-05' })).toMatchObject({
      ok: true,
      patch: { start: '2026-11-05', due: '2026-11-05' },
    })
    expect(taskDateEdit(cal, { due: '2026-11-01' })).toMatchObject({
      ok: true,
      patch: { start: '2026-11-01', due: '2026-11-01' },
    })
  })

  it('［日付を決める］: ①はその日の1日の予定に、④は開始日が前なら期間、後なら開始日もその日に（S3-TASK-121）', () => {
    expect(taskDateEdit(none, { due: '2026-11-13' })).toMatchObject({ ok: true, patch: { start: null, due: '2026-11-13' } })
    expect(taskDateEdit(startOnly, { due: '2026-11-13' })).toMatchObject({
      ok: true,
      patch: { start: '2026-11-10', due: '2026-11-13' },
    })
    expect(taskDateEdit(startOnly, { due: '2026-11-09' })).toMatchObject({
      ok: true,
      patch: { start: '2026-11-09', due: '2026-11-09' },
    })
  })

  it('カレンダー生まれは開始日を消せない。締め切り日を消すと開始日の1日の予定（S3-TASK-022）', () => {
    expect(taskDateEdit(cal, { start: null })).toEqual({ ok: false, message: 'カレンダーの予定には開始日が要ります' })
    expect(taskDateEdit(calSpan, { due: null })).toMatchObject({ ok: true, patch: { start: '2026-11-10', due: null } })
    // 外してもカレンダーに残る（開始日が要るので、どこにも出ない状態にはならない）
    const data = updateItem(dataWith({ items: [calSpan] }), 'cal-span', { listed: false }, T0).data
    expect(isOnCalendar(data.items['cal-span'])).toBe(true)
  })

  it('1日の予定で終了 < 開始になる日付は断る（23:00〜翌 01:00 を1日にする。S3-FRAME-140・S3-TASK-025）', () => {
    const night = mkTask({ id: 'night', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    expect(taskDateEdit(night, { due: '2026-11-10' })).toEqual({ ok: false, message: DATE_REFUSED })
    expect(taskDateEdit(night, { start: '2026-11-11' })).toEqual({ ok: false, message: DATE_REFUSED })
    const calNight = mkItem({ id: 'cn', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    expect(taskDateEdit(calNight, { due: null })).toEqual({ ok: false, message: DATE_REFUSED })
    expect(DATE_REFUSED).toBe('終わりの時刻が始まりより早いので、この日付にはできません（先に時刻を直してください）')
  })

  it('1日の予定で終了 = 開始になる時は終了時刻を消す（複数日ではそのまま。S3-TASK-026）', () => {
    const same = mkTask({ id: 's', start: '2026-11-10', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })
    expect(taskDateEdit(same, { due: '2026-11-10' })).toMatchObject({ ok: true, patch: { endTime: null } })
    expect(taskDateEdit(same, { due: '2026-11-12' })).toMatchObject({ ok: true, patch: { endTime: '10:00' } })
  })

  it('締め切り日を消した①④は時刻を残すが使わず、締め切り日を入れるとまた効く（S3-TASK-027）', () => {
    const night = mkTask({ id: 'night', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    const cleared = taskDateEdit(night, { due: null })
    expect(cleared).toMatchObject({ ok: true, patch: { start: '2026-11-10', due: null, endTime: '01:00' } })
    const off = { ...night, ...(cleared.ok ? cleared.patch : {}) }
    expect(off.startTime).toBe('23:00')
    expect(taskDateEdit(off, { due: '2026-11-10' })).toEqual({ ok: false, message: DATE_REFUSED })
    expect(taskDateEdit(off, { due: '2026-11-11' }).ok).toBe(true)
  })

  it('生まれは日付を直しても・日を動かしても・区分を替えても変わらない（S3-TASK-003）', () => {
    const r = taskDateEdit(none, { due: '2026-11-12' })
    let data = updateItem(dataWith({ items: [none] }), 'none', r.ok ? r.patch : {}, T0).data
    data = moveItemDates(data, 'none', { start: null, due: '2026-11-13', clearEnd: false }, T0).data
    data = updateItem(data, 'none', { kind: 'private', origin: 'calendar' } as never, T0).data
    expect(data.items.none.origin).toBe('list')
    expect(data.items.none.kind).toBe('private')
  })

  it('カレンダーに出ていない物は Task List から外せない（ops も断る。S3-FRAME-138・S3-TASK-021）', () => {
    expect(() => updateItem(dataWith({ items: [none] }), 'none', { listed: false }, T0)).toThrow(
      'カレンダーに出ていないタスクは、Task List から外せません。',
    )
  })
})

describe('日付の列のメニュー（taskDateMenu。13.5・開発）', () => {
  const labels = (opts: { label: string }[]) => opts.map((o) => o.label)

  it('list 生まれ（②）: 締め切り日は 今日・明日・今週金曜・日付を選ぶ・なし、開始日は 日付を選ぶ、［カレンダーで見る］は to の日（S3-TASK-129・開発）', () => {
    const m = taskDateMenu(due, TODAY)
    expect(m.due).toEqual([
      { label: '今日', action: { type: 'set', field: 'due', date: '2026-11-10' }, refused: false },
      { label: '明日', action: { type: 'set', field: 'due', date: '2026-11-11' }, refused: false },
      { label: '今週金曜', action: { type: 'set', field: 'due', date: '2026-11-13' }, refused: false },
      { label: '日付を選ぶ', action: { type: 'pick', field: 'due' }, refused: false },
      { label: 'なし', action: { type: 'clear', field: 'due' }, refused: false },
    ])
    expect(m.start).toEqual([{ label: '日付を選ぶ', action: { type: 'pick', field: 'start' }, refused: false }])
    expect(m.show).toEqual({ label: 'カレンダーで見る', action: { type: 'show', date: '2026-11-20' }, refused: false })
  })

  it('list 生まれ（③・④）は開始日の「なし」も出す。①④は［カレンダーで見る］を出さない', () => {
    expect(labels(taskDateMenu(span, TODAY).start)).toEqual(['日付を選ぶ', 'なし'])
    expect(taskDateMenu(span, TODAY).start[1].action).toEqual({ type: 'clear', field: 'start' })
    expect(labels(taskDateMenu(startOnly, TODAY).start)).toEqual(['日付を選ぶ', 'なし'])
    expect(taskDateMenu(startOnly, TODAY).show).toBeNull()
    const m = taskDateMenu(none, TODAY)
    expect(labels(m.due)).toEqual(['今日', '明日', '今週金曜', '日付を選ぶ'])
    expect(labels(m.start)).toEqual(['日付を選ぶ'])
    expect(m.show).toBeNull()
  })

  it('カレンダー生まれ: 開始日の「なし」は出さず、締め切り日の「なし」は「1日の予定にする（締め切り日を消す）」（S3-TASK-130・S3-FRAME-190）', () => {
    const m = taskDateMenu(calSpan, TODAY)
    expect(labels(m.due)).toEqual(['今日', '明日', '今週金曜', '日付を選ぶ', '1日の予定にする（締め切り日を消す）'])
    expect(m.due[4].action).toEqual({ type: 'clear', field: 'due' })
    expect(labels(m.start)).toEqual(['日付を選ぶ'])
    expect(m.show?.action).toEqual({ type: 'show', date: '2026-11-12' })
    // 締め切り日の無いカレンダー生まれ・締め切り日が開始日と同じカレンダー生まれは、もう1日の予定なので「1日の予定にする」を出さない
    expect(labels(taskDateMenu(cal, TODAY).due)).toEqual(['今日', '明日', '今週金曜', '日付を選ぶ'])
    const calSame = mkItem({ id: 'cs', start: '2026-11-10', due: '2026-11-10', listed: true })
    expect(labels(taskDateMenu(calSame, TODAY).due)).toEqual(['今日', '明日', '今週金曜', '日付を選ぶ'])
    expect(taskDateMenu(cal, TODAY).show?.action).toEqual({ type: 'show', date: '2026-11-12' })
  })

  it('土曜は「来週金曜」で次の金曜（S3-TASK-058）', () => {
    const fri = taskDateMenu(due, '2026-11-14').due[2]
    expect(fri).toEqual({ label: '来週金曜', action: { type: 'set', field: 'due', date: '2026-11-20' }, refused: false })
  })

  it('6.4 で断られる速い選び・なしに印を付ける（押しても値は変えない。開発・S3-TASK-025）', () => {
    // ④ 11/10 23:00〜01:00（時刻は残っているがカレンダーに出ていない）: 今日にすると1日で終了 < 開始
    const night = mkTask({ id: 'n', start: TODAY, startTime: '23:00', endTime: '01:00' })
    const m = taskDateMenu(night, TODAY)
    expect(m.due.map((o) => o.refused)).toEqual([true, false, false, false])
    expect(m.start.map((o) => o.refused)).toEqual([false, false])
    // カレンダー生まれ 11/10 23:00〜11/11 01:00: 今日と「1日の予定にする」は断られる
    const calNight = mkItem({ id: 'cn', start: TODAY, due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    const c = taskDateMenu(calNight, TODAY)
    expect(c.due.map((o) => [o.label, o.refused])).toEqual([
      ['今日', true],
      ['明日', false],
      ['今週金曜', false],
      ['日付を選ぶ', false],
      ['1日の予定にする（締め切り日を消す）', true],
    ])
    // list 生まれ ③ の開始日の「なし」も1日になって断られる
    const spanNight = mkTask({ id: 'sn', start: TODAY, due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    expect(taskDateMenu(spanNight, TODAY).start.map((o) => o.refused)).toEqual([false, true])
  })

  it('入力欄の下のチップの選び: 開始日は 今日・明日・日付を選ぶ、締め切り日は 今日・明日・今週金曜・日付を選ぶ（S3-TASK-058）', () => {
    expect(taskChipOptions('start', TODAY)).toEqual([
      { label: '今日', action: { type: 'set', field: 'start', date: '2026-11-10' }, refused: false },
      { label: '明日', action: { type: 'set', field: 'start', date: '2026-11-11' }, refused: false },
      { label: '日付を選ぶ', action: { type: 'pick', field: 'start' }, refused: false },
    ])
    expect(labels(taskChipOptions('due', TODAY))).toEqual(['今日', '明日', '今週金曜', '日付を選ぶ'])
    expect(taskChipOptions('due', '2026-11-14')[2]).toMatchObject({ label: '来週金曜', action: { date: '2026-11-20' } })
  })
})

describe('見本のデータ（e2e/fixtures/listData.ts と同じ形）の並び', () => {
  it('期限切れ → 今日 → 明日 → 今日〜3日後 → カレンダー生まれ → ④ → ①、済みは2日前の1件だけ', () => {
    const created = (i: number) => T0 - 30 * DAY + i * 60_000
    const items = [
      mkTask({ id: 'quote', due: '2026-11-11', requester: '営業部', createdAt: created(0) }),
      mkTask({ id: 'room', start: TODAY, due: '2026-11-13', requester: '総務', createdAt: created(1) }),
      mkTask({ id: 'print', createdAt: created(2) }),
      mkTask({ id: 'library', kind: 'private', start: '2026-11-12', createdAt: created(3) }),
      mkTask({ id: 'invoice', due: '2026-11-09', createdAt: created(4) }),
      mkTask({ id: 'toner', due: TODAY, createdAt: created(5) }),
      mkTask({ id: 'shelf', done: true, doneAt: T0 - 2 * DAY, createdAt: created(6) }),
      mkTask({ id: 'papers', done: true, doneAt: T0 - 8 * DAY, createdAt: created(7) }),
      mkItem({ id: 'dentist', kind: 'private', start: '2026-11-12', listed: true, createdAt: created(8) }),
    ]
    const v = view(items)
    expect(ids(v.open)).toEqual(['invoice', 'toner', 'quote', 'dentist', 'room', 'library', 'print'])
    expect(ids(v.done)).toEqual(['shelf'])
    expect(v.undone).toBe(7)
    expect(v.open.map((r) => r.stackedLine)).toEqual([
      '〆11/9',
      '〆11/10',
      '〆11/11・営業部',
      '11/12',
      '11/10〜11/13・総務',
      '11/12〜',
      '',
    ])
  })
})
