// Routine List の決まり（docs/SPEC.md の 14.・6.7）: 5つのかたまり（決まった順・空のかたまりも）、知らない種類は毎日、数、並び、指定の字、
// 戻る日の字（年をまたぐ時）、14.3 の表と例の全部を日を進めて（2.10 の単体: ルーチンの戻る日と次の戻る日）、0時の前後、種類を替えると
// チェックの記録はそのままで済みを計算し直す、月をまたいでチェックを外す、［指定］で選ぶ物。戻る日の決まりそのものは routines.ts
// （routines.test.ts が 14.3 の表を確かめる）で、ここはそれを Routine List の中身として見る
import { describe, expect, it } from 'vitest'
import { addDaysYmd, todayStr } from './dates'
import { TITLE_RANGE_TEXT } from './itemText'
import { addRoutine, checkRoutine, uncheckRoutine, updateRoutine } from './ops'
import { returnText, routineListView, routineSpecLabel, specButtonLabel, specForCycle, type SpecDraft } from './routineList'
import { checkDatesOf, latestResetDay, nextResetDay, routineProblems } from './routines'
import { T0, dataWith, mkCheck, mkRoutine } from './testData'
import { DomainError, ROUTINE_CYCLES, emptyData, type AppData, type Routine, type RoutineCheck } from './types'

const TODAY = '2026-11-10'

type Spec = Partial<Pick<Routine, 'cycle' | 'weekdays' | 'monthDay' | 'yearMonth' | 'yearDay'>>

/** そのルーチンを checks の日にチェックした記録（月ごとに分ける） */
function checksFor(id: string, dates: string[]): RoutineCheck[] {
  const byMonth = new Map<string, string[]>()
  for (const d of dates) byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d])
  return [...byMonth].map(([m, ds]) => mkCheck(id, m, ds.sort()))
}

/** ルーチン1つを dates にチェックした時、today に見た行 */
function rowAt(spec: Spec, dates: string[], today: string) {
  const r = mkRoutine({ id: 'r', ...spec })
  const v = routineListView(dataWith({ routines: [r], routineChecks: checksFor('r', dates) }), today)
  return v.groups.flatMap((g) => [...g.open, ...g.done]).find((x) => x.id === 'r')!
}

const SPEC_NONE: SpecDraft = { weekdays: [], monthDay: null, yearMonth: null, yearDay: null }

describe('5つのかたまり（14.2）', () => {
  it('いつも 毎日 → 毎週 → 毎月 → 四半期 → 毎年 の順で5つ（空のかたまりも。S3-ROUTINE-100・S3-FRAME-240・S3-ROUTINE-010）', () => {
    const v = routineListView(dataWith({ routines: [mkRoutine({ id: 'y', cycle: 'yearly' })] }), TODAY)
    expect(v.groups.map((g) => g.cycle)).toEqual([...ROUTINE_CYCLES])
    expect(v.groups.map((g) => g.name)).toEqual(['毎日', '毎週', '毎月', '四半期', '毎年'])
    expect(v.groups.map((g) => g.empty)).toEqual([true, true, true, true, false])
    expect(routineListView(emptyData(), TODAY).groups.every((g) => g.empty && g.total === 0)).toBe(true)
  })

  it('知らない種類は毎日として計算し、毎日のかたまりに出す。合わない指定・範囲の外の指定は指定なし（S3-ROUTINE-061）', () => {
    const odd = mkRoutine({ id: 'odd', cycle: 'hourly' as never, weekdays: [1] })
    const bad = mkRoutine({ id: 'bad', cycle: 'monthly', monthDay: 40 })
    const v = routineListView(dataWith({ routines: [odd, bad] }), TODAY)
    expect(v.groups[0].open.map((r) => [r.id, r.cycle, r.specLabel])).toEqual([['odd', 'daily', '']])
    expect(v.groups[2].open.map((r) => [r.id, r.specLabel, r.nextReset])).toEqual([['bad', '', '2026-12-01']])
  })

  it('済んだ数・全部・まだ済んでいない数（見出しの数。S3-FRAME-241・S3-ROUTINE-081）', () => {
    const routines = [
      mkRoutine({ id: 'd1', cycle: 'daily', order: 0 }),
      mkRoutine({ id: 'd2', cycle: 'daily', order: 1 }),
      mkRoutine({ id: 'w1', cycle: 'weekly', order: 0 }),
      mkRoutine({ id: 'w2', cycle: 'weekly', order: 1 }),
      mkRoutine({ id: 'w3', cycle: 'weekly', order: 2 }),
    ]
    const routineChecks = [
      mkCheck('d1', '2026-11', [TODAY]),
      mkCheck('w1', '2026-11', ['2026-11-08']),
      mkCheck('w3', '2026-11', ['2026-11-09']),
    ]
    const v = routineListView(dataWith({ routines, routineChecks }), TODAY)
    expect(v.groups.slice(0, 2).map((g) => [g.doneCount, g.total, g.empty])).toEqual([
      [1, 2, false],
      [2, 3, false],
    ])
    expect(v.undone).toBe(2)
    expect(v.groups[1].open.map((r) => r.id)).toEqual(['w2'])
    expect(v.groups[1].done.map((r) => r.id)).toEqual(['w1', 'w3'])
  })

  it('かたまりの中は order の小さい順、同じなら id の小さい順。済みの行も手で並べた順のまま（S3-ROUTINE-024・S3-ROUTINE-031・D10）', () => {
    const routines = [
      mkRoutine({ id: 'c', order: 2 }),
      mkRoutine({ id: 'b', order: 1 }),
      mkRoutine({ id: 'a', order: 1 }),
      mkRoutine({ id: 'z', order: -1 }),
      mkRoutine({ id: 'y', order: 5 }),
      mkRoutine({ id: 'x', order: 3 }),
    ]
    const routineChecks = [mkCheck('y', '2026-11', [TODAY]), mkCheck('x', '2026-11', [TODAY]), mkCheck('z', '2026-11', [TODAY])]
    const g = routineListView(dataWith({ routines, routineChecks }), TODAY).groups[0]
    expect(g.open.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(g.done.map((r) => r.id)).toEqual(['z', 'x', 'y'])
  })

  it('いつも全部を出す（毎週（月）は水曜にも出る。S3-ROUTINE-003・S3-FRAME-233）', () => {
    const v = routineListView(dataWith({ routines: [mkRoutine({ id: 'mon', cycle: 'weekly', weekdays: [1] })] }), '2026-11-11')
    expect(v.groups[1].open.map((r) => r.id)).toEqual(['mon'])
  })

  it('ほかのルーチンのチェックは数えない。日付でない値は捨てて計算する', () => {
    const routines = [mkRoutine({ id: 'a' }), mkRoutine({ id: 'b', order: 1 })]
    const routineChecks = [mkCheck('a', '2026-11', [TODAY]), mkCheck('b', '2026-11', ['x', '2026-11-09'] as string[])]
    const g = routineListView(dataWith({ routines, routineChecks }), TODAY).groups[0]
    expect(g.done.map((r) => r.id)).toEqual(['a'])
    expect(g.open.map((r) => r.id)).toEqual(['b'])
  })

  it('行は記録そのもの・指定の字・次に戻る日・戻る日の字を持つ（まだの行も）', () => {
    const r = mkRoutine({ id: 'g', cycle: 'weekly', weekdays: [1, 4], title: 'ゴミ出し' })
    const row = routineListView(dataWith({ routines: [r] }), TODAY).groups[1].open[0]
    expect(row).toEqual({
      id: 'g',
      routine: r,
      cycle: 'weekly',
      specLabel: '月・木',
      done: false,
      nextReset: '2026-11-12',
      returnText: '11/12（木）に戻ります',
    })
  })
})

describe('指定の字（14.1）', () => {
  it.each([
    ['毎日は出さない', { cycle: 'daily' }, ''],
    ['毎週（月）', { cycle: 'weekly', weekdays: [1] }, '月'],
    ['毎週（月・木）', { cycle: 'weekly', weekdays: [1, 4] }, '月・木'],
    ['毎週（日・月）は日曜から', { cycle: 'weekly', weekdays: [1, 0] }, '日・月'],
    ['毎週（指定なし）', { cycle: 'weekly', weekdays: [] }, ''],
    ['毎月（25日）', { cycle: 'monthly', monthDay: 25 }, '25日'],
    ['毎月（指定なし）', { cycle: 'monthly' }, ''],
    ['四半期は出さない', { cycle: 'quarterly' }, ''],
    ['毎年（3/15）は 0 で埋めない', { cycle: 'yearly', yearMonth: 3, yearDay: 15 }, '3/15'],
    ['毎年（2/29）', { cycle: 'yearly', yearMonth: 2, yearDay: 29 }, '2/29'],
    ['毎年（指定なし）', { cycle: 'yearly' }, ''],
    ['毎年の片方だけは指定なし', { cycle: 'yearly', yearMonth: 3 }, ''],
    ['毎週でない種類の曜日は出さない', { cycle: 'daily', weekdays: [1] }, ''],
  ] as const)('%s → 「%s」（S3-ROUTINE-011..015・S3-FRAME-232）', (_name, spec, want) => {
    expect(routineSpecLabel(mkRoutine(spec as Spec))).toBe(want)
  })
})

describe('戻る日の字（returnText。14.2・D32）', () => {
  it('「11/16（月）に戻ります」', () => {
    expect(returnText('2026-11-16', TODAY)).toBe('11/16（月）に戻ります')
  })

  it('年が今日と違う時は年も（S3-ROUTINE-111 の字）', () => {
    expect(returnText('2027-01-01', '2026-12-31')).toBe('2027/1/1（金）に戻ります')
    expect(returnText('2027-03-15', TODAY)).toBe('2027/3/15（月）に戻ります')
    // 同じ年の別の月は年を出さず、別の年の同じ月は年を出す
    expect(returnText('2026-12-01', TODAY)).toBe('12/1（火）に戻ります')
    expect(returnText('2027-11-10', TODAY)).toBe('2027/11/10（水）に戻ります')
  })

  it('形の正しくない日付はそのまま', () => {
    expect(returnText('x', TODAY)).toBe('xに戻ります')
    expect(returnText('2026-11-16', 'x')).toBe('11/16（月）に戻ります')
  })
})

describe('14.3 の表（いちばん新しい戻る日・次の戻る日）を Routine List の済みで確かめる（S3-FRAME-342・S3-ROUTINE-270）', () => {
  // 今日 2026-11-11（水）
  const today = '2026-11-11'
  it.each([
    // [名前と決まりの id, 指定, いちばん新しい戻る日, 次の戻る日]
    ['毎日（S3-ROUTINE-044・S3-FRAME-258・S3-ROUTINE-052）', { cycle: 'daily' }, '2026-11-11', '2026-11-12'],
    [
      '毎週（指定なし）: 今日以前の日曜（S3-ROUTINE-045・S3-FRAME-259・S3-ROUTINE-052）',
      { cycle: 'weekly' },
      '2026-11-08',
      '2026-11-15',
    ],
    [
      '毎週（月・木）（S3-ROUTINE-046・S3-FRAME-260・S3-ROUTINE-052）',
      { cycle: 'weekly', weekdays: [1, 4] },
      '2026-11-09',
      '2026-11-12',
    ],
    ['毎週（水）は今日（S3-ROUTINE-046・S3-ROUTINE-052）', { cycle: 'weekly', weekdays: [3] }, '2026-11-11', '2026-11-18'],
    [
      '毎月（指定なし）: 今月の1日（S3-ROUTINE-047・S3-FRAME-261・S3-ROUTINE-053）',
      { cycle: 'monthly' },
      '2026-11-01',
      '2026-12-01',
    ],
    [
      '毎月（25日）: まだなので先月の25日（S3-ROUTINE-048・S3-ROUTINE-053）',
      { cycle: 'monthly', monthDay: 25 },
      '2026-10-25',
      '2026-11-25',
    ],
    [
      '毎月（5日）: 過ぎたので今月の5日（S3-FRAME-262・S3-ROUTINE-048・S3-ROUTINE-053）',
      { cycle: 'monthly', monthDay: 5 },
      '2026-11-05',
      '2026-12-05',
    ],
    [
      '四半期: 今の四半期の1日（S3-ROUTINE-049・S3-FRAME-263・S3-ROUTINE-054）',
      { cycle: 'quarterly' },
      '2026-10-01',
      '2027-01-01',
    ],
    [
      '毎年（指定なし）: 今年の1月1日（S3-ROUTINE-050・S3-FRAME-264・S3-ROUTINE-054）',
      { cycle: 'yearly' },
      '2026-01-01',
      '2027-01-01',
    ],
    [
      '毎年（3/15）: 過ぎたので今年（S3-ROUTINE-051・S3-FRAME-265・S3-ROUTINE-054）',
      { cycle: 'yearly', yearMonth: 3, yearDay: 15 },
      '2026-03-15',
      '2027-03-15',
    ],
    [
      '毎年（12/1）: まだなので去年（S3-FRAME-265・S3-ROUTINE-051・S3-ROUTINE-054）',
      { cycle: 'yearly', yearMonth: 12, yearDay: 1 },
      '2025-12-01',
      '2026-12-01',
    ],
  ] as const)('%s。済みと次の戻る日（S3-ROUTINE-042・S3-FRAME-257・S3-FRAME-266）', (_name, spec, latest, next) => {
    expect(latestResetDay(mkRoutine(spec as Spec), today)).toBe(latest)
    // いちばん新しいチェックが戻る日以後なら済み、前の日なら済んでいない（S3-ROUTINE-042・S3-FRAME-257）
    expect(rowAt(spec as Spec, [latest], today)).toMatchObject({ done: true, nextReset: next })
    expect(rowAt(spec as Spec, [addDaysYmd(latest, -1)], today).done).toBe(false)
    expect(rowAt(spec as Spec, [addDaysYmd(latest, -40), addDaysYmd(latest, -1)], today).done).toBe(false)
    expect(rowAt(spec as Spec, [], today).done).toBe(false)
    // 次の戻る日（S3-FRAME-266・S3-ROUTINE-052..054）
    expect(nextResetDay(mkRoutine(spec as Spec), today)).toBe(next)
    expect(rowAt(spec as Spec, [latest], today).returnText).toMatch(/に戻ります$/)
  })

  it('指定はどれも任意（毎週・毎月・毎年の指定なしは日曜・1日・1月1日に戻る。S3-ROUTINE-017）', () => {
    expect(routineProblems(mkRoutine({ cycle: 'weekly' }))).toEqual([])
    expect(routineProblems(mkRoutine({ cycle: 'monthly' }))).toEqual([])
    expect(routineProblems(mkRoutine({ cycle: 'yearly' }))).toEqual([])
    expect(rowAt({ cycle: 'weekly' }, ['2026-11-08'], '2026-11-14').done).toBe(true)
    expect(rowAt({ cycle: 'weekly' }, ['2026-11-08'], '2026-11-15').done).toBe(false)
    expect(rowAt({ cycle: 'monthly' }, ['2026-11-01'], '2026-11-30').done).toBe(true)
    expect(rowAt({ cycle: 'monthly' }, ['2026-11-30'], '2026-12-01').done).toBe(false)
    expect(rowAt({ cycle: 'yearly' }, ['2026-01-01'], '2026-12-31').done).toBe(true)
    expect(rowAt({ cycle: 'yearly' }, ['2026-12-31'], '2027-01-01').done).toBe(false)
  })
})

describe('14.3 の例を日を進めて（チェックした日から戻る日の前の日までは済み、戻る日の 0時に外れる）', () => {
  /** checked にチェックして、checked から resetDay までの毎日に見る */
  function walk(spec: Spec, checked: string, resetDay: string) {
    expect(rowAt(spec, [checked], checked)).toMatchObject({ done: true, nextReset: resetDay })
    for (let d = checked; d < resetDay; d = addDaysYmd(d, 1)) expect(rowAt(spec, [checked], d).done, d).toBe(true)
    expect(rowAt(spec, [checked], resetDay).done).toBe(false)
  }

  it('毎週（月）を水曜 11/11 にチェック → 月曜 11/16 の 0時に外れる（S3-ROUTINE-055・S3-FRAME-267）', () => {
    walk({ cycle: 'weekly', weekdays: [1] }, '2026-11-11', '2026-11-16')
    expect(rowAt({ cycle: 'weekly', weekdays: [1] }, ['2026-11-11'], '2026-11-11').returnText).toBe('11/16（月）に戻ります')
  })

  it('毎月（25日）を 11/26 にチェック → 12/25 の 0時に外れる（S3-ROUTINE-056）', () => {
    walk({ cycle: 'monthly', monthDay: 25 }, '2026-11-26', '2026-12-25')
  })

  it('毎月（31日）は 11月は 11/30 に戻る（S3-ROUTINE-057）', () => {
    expect(rowAt({ cycle: 'monthly', monthDay: 31 }, [], TODAY).nextReset).toBe('2026-11-30')
    walk({ cycle: 'monthly', monthDay: 31 }, '2026-11-29', '2026-11-30')
  })

  it('毎月（31日）を 2027/1/31 にチェック → 2/28 の 0時に外れる（2028年は 2/29。S3-ROUTINE-058）', () => {
    walk({ cycle: 'monthly', monthDay: 31 }, '2027-01-31', '2027-02-28')
    walk({ cycle: 'monthly', monthDay: 31 }, '2028-01-31', '2028-02-29')
  })

  it('毎月（31日）を 2/28 にチェック → 3/31、1/30 にチェック → 1/31（S3-ROUTINE-059）', () => {
    walk({ cycle: 'monthly', monthDay: 31 }, '2027-02-28', '2027-03-31')
    walk({ cycle: 'monthly', monthDay: 31 }, '2027-01-30', '2027-01-31')
  })

  it('四半期は 1・4・7・10月の1日に戻る（年をまたぐ時は字に年も）', () => {
    walk({ cycle: 'quarterly' }, '2026-11-10', '2027-01-01')
    expect(rowAt({ cycle: 'quarterly' }, ['2026-11-10'], TODAY).returnText).toBe('2027/1/1（金）に戻ります')
    walk({ cycle: 'quarterly' }, '2027-03-31', '2027-04-01')
  })

  it('毎年（2/29）は平年 2/28 に戻る', () => {
    walk({ cycle: 'yearly', yearMonth: 2, yearDay: 29 }, '2027-03-01', '2028-02-29')
    walk({ cycle: 'yearly', yearMonth: 2, yearDay: 29 }, '2028-03-01', '2029-02-28')
  })
})

describe('日の変わり目（14.3・6.4）', () => {
  it('毎日: 23:59:59 のチェックはその日のうち済み、次の日の 0:00:00 と 0:00:01 に戻る。チェックの記録は書き換えない（S3-ROUTINE-042）', () => {
    const r = mkRoutine({ id: 'r' })
    const data = dataWith({ routines: [r] })
    const checkedAt = new Date(2026, 10, 10, 23, 59, 59).getTime()
    const checked = checkRoutine(data, 'r', todayStr(checkedAt), checkedAt)
    const before = JSON.stringify(checked.routineChecks)
    const at = (ms: number) => routineListView(checked, todayStr(ms)).groups[0]
    expect(at(new Date(2026, 10, 10, 23, 59, 59, 999).getTime()).done.map((x) => x.id)).toEqual(['r'])
    expect(at(new Date(2026, 10, 11, 0, 0, 0).getTime()).open.map((x) => x.id)).toEqual(['r'])
    expect(at(new Date(2026, 10, 11, 0, 0, 1).getTime()).open.map((x) => x.id)).toEqual(['r'])
    expect(JSON.stringify(checked.routineChecks)).toBe(before)
    expect(checkDatesOf(checked, 'r')).toEqual(['2026-11-10'])
  })

  it('種類・指定を替えると、チェックの記録はそのままで済みを新しい決まりで計算し直す', () => {
    const r = mkRoutine({ id: 'r', cycle: 'daily' })
    let data = dataWith({ routines: [r], routineChecks: [mkCheck('r', '2026-11', ['2026-11-09'])] })
    const checks = data.routineChecks
    expect(routineListView(data, TODAY).groups[0].open.map((x) => x.id)).toEqual(['r'])
    data = updateRoutine(data, 'r', { cycle: 'weekly' }, T0)
    expect(routineListView(data, TODAY).groups[1].done.map((x) => x.id)).toEqual(['r'])
    data = updateRoutine(data, 'r', { weekdays: [2] }, T0)
    expect(routineListView(data, TODAY).groups[1].open.map((x) => x.id)).toEqual(['r'])
    expect(data.routineChecks).toEqual(checks)
  })
})

describe('チェックの記録（6.7・14.3。ops を Routine List から使う時）', () => {
  const base = (): AppData => dataWith({ routines: [mkRoutine({ id: 'r', cycle: 'monthly', monthDay: 25 })] })

  it('チェックするとその月の記録 {id}:{YYYY-MM} に今日を足す（id・updatedAt・出どころを持ち、v・createdAt は持たない。S3-ROUTINE-026・S3-ROUTINE-027）', () => {
    const data = checkRoutine(base(), 'r', TODAY, T0)
    const rec = data.routineChecks['r:2026-11']
    expect(rec).toEqual({
      id: 'r:2026-11',
      routineId: 'r',
      month: '2026-11',
      dates: [TODAY],
      updatedAt: T0,
      by: 'user',
      ai: null,
      via: null,
    })
    expect('v' in rec || 'createdAt' in rec).toBe(false)
    const again = checkRoutine(checkRoutine(data, 'r', '2026-11-27', T0), 'r', '2026-11-26', T0)
    expect(again.routineChecks['r:2026-11'].dates).toEqual(['2026-11-10', '2026-11-26', '2026-11-27'])
  })

  it('今日もうチェックしている時は何も書かない（同じデータを返す。S3-ROUTINE-043）', () => {
    const data = checkRoutine(base(), 'r', TODAY, T0)
    expect(checkRoutine(data, 'r', TODAY, T0 + 1)).toBe(data)
  })

  it('チェックを外すと、いちばん新しい戻る日以後の記録を月をまたいで消す（毎月25日の 10/30 のチェックを 11/3 に外す。S3-ROUTINE-041）', () => {
    let data = dataWith({
      routines: [mkRoutine({ id: 'r', cycle: 'monthly', monthDay: 25 })],
      routineChecks: [mkCheck('r', '2026-10', ['2026-10-20', '2026-10-30'])],
    })
    expect(routineListView(data, '2026-11-03').groups[2].done.map((x) => x.id)).toEqual(['r'])
    data = uncheckRoutine(data, 'r', '2026-11-03', T0)
    expect(data.routineChecks['r:2026-10'].dates).toEqual(['2026-10-20'])
    expect(routineListView(data, '2026-11-03').groups[2].open.map((x) => x.id)).toEqual(['r'])
  })

  it('作った時の by はチェック・外す・直すで変わらない（S3-ROUTINE-030）', () => {
    let data = dataWith({
      routines: [mkRoutine({ id: 'r', by: 'connector', ai: 'claude' })],
      routineChecks: [mkCheck('r', '2026-11', ['2026-11-09'], { by: 'connector', ai: 'claude' })],
    })
    data = checkRoutine(data, 'r', TODAY, T0)
    data = uncheckRoutine(data, 'r', TODAY, T0)
    data = updateRoutine(data, 'r', { title: '朝の体操（直した）' }, T0)
    expect(data.routines.r).toMatchObject({ by: 'connector', ai: 'claude' })
    expect(data.routineChecks['r:2026-11']).toMatchObject({ by: 'connector', ai: 'claude', dates: ['2026-11-09'] })
  })

  it('手で足したルーチンは id・v 1・作った時刻 = 直した時刻・手で作った出どころ。その種類のいちばん下に足す（S3-ROUTINE-029）', () => {
    const data = dataWith({ routines: [mkRoutine({ id: 'w', cycle: 'weekly', order: 4 })] })
    const { data: next, result } = addRoutine(data, { title: ' ゴミ出し ', cycle: 'weekly', weekdays: [1, 4] }, T0)
    expect(next.routines[result]).toMatchObject({
      v: 1,
      title: 'ゴミ出し',
      order: 5,
      createdAt: T0,
      updatedAt: T0,
      by: 'user',
      ai: null,
      via: null,
    })
    expect(routineListView(next, TODAY).groups[1].open.map((x) => x.id)).toEqual(['w', result])
  })

  it('件名は前後の空白を除いて 1〜200字。空・空白だけ・201字は足さず「件名は1〜200字で入れてください」（S3-ROUTINE-020・S3-ROUTINE-093・S3-FRAME-271・S3-FRAME-093）', () => {
    for (const title of ['', '   ', 'あ'.repeat(201), '😀'.repeat(201)]) {
      expect(() => addRoutine(emptyData(), { title, cycle: 'daily' }, T0)).toThrow(new DomainError(TITLE_RANGE_TEXT))
    }
    expect(() => addRoutine(emptyData(), { title: '😀'.repeat(200), cycle: 'daily' }, T0)).not.toThrow()
    const data = dataWith({ routines: [mkRoutine({ id: 'r' })] })
    expect(() => updateRoutine(data, 'r', { title: '  ' }, T0)).toThrow(TITLE_RANGE_TEXT)
  })
})

describe('［指定］で選ぶ物（specForCycle・specButtonLabel。14.2・6.7）', () => {
  it('毎週: 0〜6 の曜日を小さい順・重なりなしに（ほかの値は捨てる。S3-ROUTINE-021・S3-FRAME-234）', () => {
    expect(
      specForCycle('weekly', { ...SPEC_NONE, weekdays: [4, 1, 1, 9, -1, 2.5, 0], monthDay: 3, yearMonth: 1, yearDay: 1 }),
    ).toEqual({
      weekdays: [0, 1, 4],
      monthDay: null,
      yearMonth: null,
      yearDay: null,
    })
  })

  it('毎月: 1〜31 の日だけ（S3-ROUTINE-022）', () => {
    expect(specForCycle('monthly', { ...SPEC_NONE, weekdays: [1], monthDay: 31 })).toEqual({ ...SPEC_NONE, monthDay: 31 })
    expect(specForCycle('monthly', { ...SPEC_NONE, monthDay: 0 })).toEqual(SPEC_NONE)
    expect(specForCycle('monthly', { ...SPEC_NONE, monthDay: 32 })).toEqual(SPEC_NONE)
  })

  it('毎年: 月とその月にある日（2/29 は選べる・2/30 は日を空に。月を選んだ途中の片方も残す。S3-ROUTINE-023）', () => {
    expect(specForCycle('yearly', { ...SPEC_NONE, yearMonth: 2, yearDay: 29 })).toEqual({
      ...SPEC_NONE,
      yearMonth: 2,
      yearDay: 29,
    })
    expect(specForCycle('yearly', { ...SPEC_NONE, yearMonth: 2, yearDay: 30 })).toEqual({
      ...SPEC_NONE,
      yearMonth: 2,
      yearDay: null,
    })
    expect(specForCycle('yearly', { ...SPEC_NONE, yearMonth: 13, yearDay: 31 })).toEqual({
      ...SPEC_NONE,
      yearMonth: null,
      yearDay: 31,
    })
    expect(specForCycle('yearly', { ...SPEC_NONE, yearMonth: 4, yearDay: 0 })).toEqual({
      ...SPEC_NONE,
      yearMonth: 4,
      yearDay: null,
    })
    // 片方だけは決まりに合わない（足す時に断る。6.7）
    expect(routineProblems(mkRoutine({ cycle: 'yearly', yearMonth: 4, yearDay: null })).map((p) => p.message)).toEqual([
      '毎年の指定は月と日の両方を入れてください',
    ])
  })

  it('毎日・四半期は指定を持たない（S3-ROUTINE-025）', () => {
    const full: SpecDraft = { weekdays: [1], monthDay: 3, yearMonth: 3, yearDay: 15 }
    expect(specForCycle('daily', full)).toEqual(SPEC_NONE)
    expect(specForCycle('quarterly', full)).toEqual(SPEC_NONE)
  })

  it('種類ごとに返す物はそのまま足せて、決まり（6.7）に合う', () => {
    const draft: SpecDraft = { weekdays: [5, 2], monthDay: 15, yearMonth: 7, yearDay: 7 }
    for (const cycle of ROUTINE_CYCLES) {
      const spec = specForCycle(cycle, draft)
      expect(routineProblems({ title: '整理', cycle, ...spec }), cycle).toEqual([])
      const { data, result } = addRoutine(emptyData(), { title: '整理', cycle, ...spec }, T0)
      expect(data.routines[result]).toMatchObject({ cycle, ...spec })
    }
  })

  it('［指定］のボタンの字: 選んでいなければ「指定」、選んでいればその指定の字', () => {
    expect(specButtonLabel('weekly', SPEC_NONE)).toBe('指定')
    expect(specButtonLabel('weekly', { ...SPEC_NONE, weekdays: [4, 1] })).toBe('月・木')
    expect(specButtonLabel('monthly', { ...SPEC_NONE, monthDay: 25 })).toBe('25日')
    expect(specButtonLabel('yearly', { ...SPEC_NONE, yearMonth: 3, yearDay: 15 })).toBe('3/15')
    expect(specButtonLabel('yearly', { ...SPEC_NONE, yearMonth: 3 })).toBe('指定')
    expect(specButtonLabel('daily', { ...SPEC_NONE, weekdays: [1] })).toBe('指定')
  })
})
