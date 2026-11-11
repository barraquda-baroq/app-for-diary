// カレンダーに出す項目の選び方と並び（docs/SPEC.md の 6.3・6.12・7.5・7.6・7.9・8.2・11.2・11.3・12.5）:
// Task List の4通り・表示用に直した記録・同じ日の中の並び・デイリーの行の役・数え方・イヤーの●・休み
import { describe, expect, it, vi } from 'vitest'
import {
  calendarItems,
  compareDayList,
  compareSingles,
  dayList,
  dayTimed,
  dayUndone,
  offDaySet,
  overlapping,
  weekSingles,
  yearDots,
  type CalItem,
} from './calendar'
import { countOn, formatCount, monthCounts } from './items'
import { repairData } from './repair'
import { T0, dataWith, mkItem, mkOffDay, mkRoutine, mkTask } from './testData'
import type { AppData, Item } from './types'

/** 項目の表（id → 項目） */
const rec = (...items: Item[]): Record<string, Item> => Object.fromEntries(items.map((it) => [it.id, it]))
/** 表示用に直した記録のカレンダーの項目 */
const cal = (...items: Item[]): CalItem[] => calendarItems(rec(...items))
const ids = (list: readonly CalItem[]) => list.map((c) => c.item.id)
/** 端末に保存した形のまま（修復の前）の記録から、表示用に直した項目の表を作る */
const repaired = (...raw: Record<string, unknown>[]): AppData['items'] =>
  repairData(dataWith({ items: raw as unknown as Item[] })).data.items

describe('カレンダーに出る条件と期間（6.3）', () => {
  it.each<[string, Partial<Item>, { from: string; to: string } | null]>([
    ['① list 生まれ・開始なし・締め切りなし → 出ない', { start: null, due: null }, null],
    [
      '② list 生まれ・開始なし・締め切りあり → 締め切り日の1日',
      { start: null, due: '2026-11-20' },
      { from: '2026-11-20', to: '2026-11-20' },
    ],
    [
      '③ list 生まれ・開始あり・締め切りあり → 開始日〜締め切り日',
      { start: '2026-11-10', due: '2026-11-20' },
      { from: '2026-11-10', to: '2026-11-20' },
    ],
    ['③ 開始日 = 締め切り日 → その日の1日', { start: '2026-11-20', due: '2026-11-20' }, { from: '2026-11-20', to: '2026-11-20' }],
    [
      '③ 開始日 > 締め切り日 → 締め切り日の1日',
      { start: '2026-11-25', due: '2026-11-20' },
      { from: '2026-11-20', to: '2026-11-20' },
    ],
    ['④ list 生まれ・開始あり・締め切りなし → 出ない（開始日だけでは出さない）', { start: '2026-11-10', due: null }, null],
  ])('%s', (_, p, expected) => {
    const list = cal(mkTask(p))
    if (!expected) expect(list).toEqual([])
    else {
      expect(list).toHaveLength(1)
      expect({ from: list[0].from, to: list[0].to }).toEqual(expected)
      expect(list[0].multi).toBe(expected.from < expected.to)
    }
  })

  it.each<[string, Partial<Item>, { from: string; to: string }]>([
    ['calendar 生まれ・締め切りなし → 開始日の1日', { start: '2026-11-10', due: null }, { from: '2026-11-10', to: '2026-11-10' }],
    [
      'calendar 生まれ・締め切りあり → 開始日〜締め切り日',
      { start: '2026-11-09', due: '2026-11-11' },
      { from: '2026-11-09', to: '2026-11-11' },
    ],
  ])('%s', (_, p, expected) => {
    const [c] = cal(mkItem(p))
    expect({ from: c.from, to: c.to }).toEqual(expected)
  })

  it('期間は両端を含み、複数日は from < to、時刻のある物は startTime がある物', () => {
    const [a, b, c] = cal(
      mkItem({ id: 'a', start: '2026-11-09', due: '2026-11-11' }),
      mkItem({ id: 'b', start: '2026-11-10', startTime: '10:00', order: T0 + 1 }),
      mkItem({ id: 'c', start: '2026-11-10', due: '2026-11-10', order: T0 + 2 }),
    )
    expect([a.item.id, a.multi, a.timed]).toEqual(['a', true, false])
    expect([b.item.id, b.multi, b.timed]).toEqual(['b', false, true])
    expect([c.item.id, c.multi, c.timed]).toEqual(['c', false, false])
    expect(ids(overlapping([a, b, c], '2026-11-11', '2026-11-11'))).toEqual(['a'])
    expect(ids(overlapping([a, b, c], '2026-11-08', '2026-11-09'))).toEqual(['a'])
    expect(ids(overlapping([a, b, c], '2026-11-12', '2026-11-14'))).toEqual([])
    expect(ids(overlapping([a, b, c], '2026-11-01', '2026-11-30'))).toEqual(['a', 'b', 'c'])
  })

  it('並びは期間の初めの日 → 作った順（order → id）', () => {
    const list = cal(
      mkItem({ id: 'z', start: '2026-11-12', order: 1 }),
      mkItem({ id: 'b', start: '2026-11-10', order: 5 }),
      mkItem({ id: 'a', start: '2026-11-10', order: 5 }),
      mkItem({ id: 'c', start: '2026-11-10', order: 2 }),
    )
    expect(ids(list)).toEqual(['c', 'a', 'b', 'z'])
  })

  it('ゴミ箱の物は data.items に無いので出ない・ルーチンは項目ではないので出ない（7.6）', () => {
    const data = dataWith({ items: [mkItem({ id: 'a' })], routines: [mkRoutine()] })
    expect(ids(calendarItems(data.items))).toEqual(['a'])
  })

  it('7日を過ぎて Task List に出なくなった完了したタスクも、カレンダーには完了した予定として残る（6.3）', () => {
    const old = mkTask({ due: '2026-10-01', done: true, doneAt: T0 - 30 * 86_400_000, doneOn: '2026-10-01' })
    const [c] = cal(old)
    expect(c.item.done).toBe(true)
    expect(c.from).toBe('2026-10-01')
  })
})

describe('表示用に直した記録で出す（6.12）', () => {
  it('calendar 生まれで start が無い → due の日、それも無ければ createdAt の暦の日付', () => {
    const items = repaired(
      { ...mkItem({ id: 'a', start: null, due: '2026-11-12' }) },
      { ...mkItem({ id: 'b', start: null, due: null, createdAt: new Date(2026, 10, 3, 23, 30).getTime() }) },
    )
    const list = calendarItems(items)
    expect(list.map((c) => [c.item.id, c.from, c.to])).toEqual([
      ['b', '2026-11-03', '2026-11-03'],
      ['a', '2026-11-12', '2026-11-12'],
    ])
  })

  it('start > due は calendar 生まれで due = start、list 生まれで start を無いものとみなす', () => {
    const list = calendarItems(
      repaired(
        { ...mkItem({ id: 'a', start: '2026-11-12', due: '2026-11-10' }) },
        { ...mkTask({ id: 'b', start: '2026-11-12', due: '2026-11-10', order: T0 + 1 }) },
      ),
    )
    expect(list.map((c) => [c.item.id, c.from, c.to, c.multi])).toEqual([
      ['b', '2026-11-10', '2026-11-10', false],
      ['a', '2026-11-12', '2026-11-12', false],
    ])
  })

  it('形の正しくない日付・時刻は null とみなす。startTime の無い endTime と、1日の予定で endTime ≤ startTime の endTime は無視', () => {
    const items = repaired(
      { ...mkTask({ id: 'a' }), due: '2026-11-31' },
      { ...mkItem({ id: 'b', startTime: null }), endTime: '11:00' },
      { ...mkItem({ id: 'c', startTime: '10:00', endTime: '09:00' }) },
      { ...mkItem({ id: 'd' }), startTime: '9:00' },
    )
    const list = calendarItems(items)
    expect(ids(list)).toEqual(['b', 'c', 'd'])
    const by = Object.fromEntries(list.map((c) => [c.item.id, c]))
    expect([by.b.item.startTime, by.b.item.endTime, by.b.timed]).toEqual([null, null, false])
    expect([by.c.item.startTime, by.c.item.endTime, by.c.timed]).toEqual(['10:00', null, true])
    expect([by.d.item.startTime, by.d.timed]).toEqual([null, false])
  })

  it('知らない kind は仕事、知らない label はラベルなし、空の title は「（件名なし）」', () => {
    const [c] = calendarItems(repaired({ ...mkItem({ id: 'a', title: '  ' }), kind: 'meeting', label: 'neon' }))
    expect(c.item.kind).toBe('work')
    expect(c.item.label).toBeNull()
    expect(c.item.title).toBe('（件名なし）')
  })
})

describe('同じ日の中の並び（7.5）', () => {
  const s = (p: Partial<Item>) => mkItem({ start: '2026-11-10', ...p })

  it('ウィークリーの1日の予定: 時刻のある物（開始 → 終了）→ 時刻の無い物（作った順）→ 完了した物（同じ決まりで）', () => {
    const list = cal(
      s({ id: 'u2', order: 2 }),
      s({ id: 'u1', order: 1 }),
      s({ id: 't3', startTime: '13:00' }),
      s({ id: 't1', startTime: '09:00', endTime: '10:00' }),
      s({ id: 't2', startTime: '09:00', endTime: '11:00' }),
      s({ id: 'd2', order: 1, done: true }),
      s({ id: 'd1', startTime: '08:00', done: true }),
    )
    expect(ids([...list].sort(compareSingles))).toEqual(['t1', 't2', 't3', 'u1', 'u2', 'd1', 'd2'])
  })

  it('① 複数日 → ② 時刻のある1日 → ③ 時刻の無い1日 → ④ 完了した物（中も ①〜③ の順。7.5）', () => {
    const list = cal(
      s({ id: '3-untimed', order: 0 }),
      s({ id: '2-timed', startTime: '23:00', order: 9 }),
      mkItem({ id: '1-multi', start: '2026-11-10', due: '2026-11-12', order: 99 }),
      s({ id: '4c-done-untimed', done: true, order: 0 }),
      s({ id: '4b-done-timed', startTime: '07:00', done: true }),
      mkItem({ id: '4a-done-multi', start: '2026-11-09', due: '2026-11-10', done: true }),
    )
    const expected = ['1-multi', '2-timed', '3-untimed', '4a-done-multi', '4b-done-timed', '4c-done-untimed']
    expect(ids([...list].sort(compareSingles))).toEqual(expected)
    expect(ids([...list].reverse().sort(compareDayList))).toEqual(expected)
  })

  it('終了の無い物は「開始 + 30分」として比べ、同じなら作った順（order → id。7.5・開発）', () => {
    const list = cal(
      s({ id: 'b', startTime: '09:00', endTime: '09:45', order: 1 }),
      s({ id: 'a', startTime: '09:00', order: 9 }),
      s({ id: 'c', startTime: '09:00', endTime: '09:20', order: 5 }),
      s({ id: 'e', startTime: '09:00', endTime: '09:30', order: 3 }),
      s({ id: 'd', startTime: '09:00', endTime: '09:30', order: 3 }),
    )
    // 09:20 → 09:30（d・e は order が同じなので id の順）→ 09:30 の a（開始だけ。order 9）→ 09:45
    expect(ids([...list].sort(compareSingles))).toEqual(['c', 'd', 'e', 'a', 'b'])
  })

  it('23:50 に始まる開始だけの予定は 24:00 まで（24:00 に終わる物と同じ扱い）', () => {
    const list = cal(s({ id: 'a', startTime: '23:50', order: 2 }), s({ id: 'b', startTime: '23:50', endTime: '24:00', order: 1 }))
    expect(ids([...list].sort(compareSingles))).toEqual(['b', 'a'])
  })

  it('作った順は order の小さい順。同じ値は id の小さい順（どの端末でも同じ並び。6.1）', () => {
    const list = cal(s({ id: 'b', order: 1 }), s({ id: 'c', order: 1 }), s({ id: 'a', order: 1 }), s({ id: 'z', order: 0 }))
    expect(ids([...list].sort(compareSingles))).toEqual(['z', 'a', 'b', 'c'])
    expect(ids([...list].reverse().sort(compareSingles))).toEqual(['z', 'a', 'b', 'c'])
  })

  it('デイリーのリスト: 複数日（開始日の早い順 → 締め切り日の遅い順 → 作った順）→ 1日の予定 → 完了した物（完了した複数日が先頭）', () => {
    const list = cal(
      s({ id: 'single', order: 1 }),
      mkItem({ id: 'm-late', start: '2026-11-09', due: '2026-11-11' }),
      mkItem({ id: 'm-long', start: '2026-11-09', due: '2026-11-14' }),
      mkItem({ id: 'm-early', start: '2026-11-08', due: '2026-11-10' }),
      mkItem({ id: 'm-tie-b', start: '2026-11-10', due: '2026-11-12', order: 4 }),
      mkItem({ id: 'm-tie-a', start: '2026-11-10', due: '2026-11-12', order: 4 }),
      s({ id: 'done-single', order: 0, done: true }),
      mkItem({ id: 'done-multi', start: '2026-11-10', due: '2026-11-11', done: true }),
    )
    expect(ids([...list].sort(compareDayList))).toEqual([
      'm-early',
      'm-long',
      'm-late',
      'm-tie-a',
      'm-tie-b',
      'single',
      'done-multi',
      'done-single',
    ])
  })
})

describe('ウィークリーの1日の予定（weekSingles）', () => {
  it('その週の7日（日曜始まり）に、その区分の1日の予定だけを 7.5 の順で（複数日・ほかの区分・週の外は入れない）', () => {
    const list = cal(
      mkItem({ id: 'a', start: '2026-11-10', order: 2 }),
      mkItem({ id: 'b', start: '2026-11-10', startTime: '10:00', order: 3 }),
      mkItem({ id: 'p', start: '2026-11-10', kind: 'private' }),
      mkItem({ id: 'm', start: '2026-11-09', due: '2026-11-11' }),
      mkItem({ id: 'out', start: '2026-11-15' }),
      mkItem({ id: 'sat', start: '2026-11-14' }),
      mkTask({ id: 'task', due: '2026-11-08' }),
    )
    const week = weekSingles(list, '2026-11-08', 'work')
    expect(Object.keys(week)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ])
    expect(ids(week['2026-11-10'])).toEqual(['b', 'a'])
    expect(ids(week['2026-11-08'])).toEqual(['task'])
    expect(ids(week['2026-11-14'])).toEqual(['sat'])
    expect(week['2026-11-09']).toEqual([])
    expect(ids(weekSingles(list, '2026-11-08', 'private')['2026-11-10'])).toEqual(['p'])
  })

  it('年をまたぐ週（2026-12-27〜2027-01-02）', () => {
    const week = weekSingles(cal(mkItem({ id: 'ny', start: '2027-01-01' })), '2026-12-27', 'work')
    expect(ids(week['2027-01-01'])).toEqual(['ny'])
  })
})

describe('デイリーのリストとタイムスケジュール（11.2・11.3）', () => {
  const list = cal(
    mkItem({ id: 'multi', start: '2026-11-09', due: '2026-11-11', order: 1 }),
    mkItem({ id: 'multi-timed', start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '15:00', order: 2 }),
    mkItem({ id: 'single', start: '2026-11-10', order: 3 }),
    mkItem({ id: 'timed', start: '2026-11-10', startTime: '09:00', order: 4 }),
    mkItem({ id: 'private', start: '2026-11-10', kind: 'private', order: 5 }),
    mkItem({ id: 'private-timed', start: '2026-11-10', kind: 'private', startTime: '08:00', order: 6 }),
  )

  it('リストは時刻の無い物だけ（時刻の無い複数日の予定を含む。11.2）。行の役は初日・間の日・最終日・1日', () => {
    const roles = (date: string) => dayList(list, date, 'work').map((r) => [r.c.item.id, r.role])
    expect(roles('2026-11-09')).toEqual([['multi', 'first']])
    expect(roles('2026-11-10')).toEqual([
      ['multi', 'middle'],
      ['single', 'single'],
    ])
    expect(roles('2026-11-11')).toEqual([['multi', 'last']])
    expect(roles('2026-11-12')).toEqual([])
    expect(dayList(list, '2026-11-10', 'private').map((r) => r.c.item.id)).toEqual(['private'])
  })

  it('タイムスケジュールは時刻のある物（区分を混ぜる・日をまたぐ物を含む）', () => {
    expect(ids(dayTimed(list, '2026-11-10'))).toEqual(['multi-timed', 'private-timed', 'timed'])
    expect(ids(dayTimed(list, '2026-11-11'))).toEqual(['multi-timed'])
  })

  it('見出しの数は、時刻のある物も含めた、まだ完了していない予定の全部（マンスリーのその日の数と同じ。11.2）', () => {
    expect(dayUndone(list, '2026-11-10', 'work')).toBe(4)
    expect(dayUndone(list, '2026-11-10', 'private')).toBe(2)
    const items = list.map((c) => c.item)
    for (const date of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) {
      for (const kind of ['work', 'private'] as const) expect(dayUndone(list, date, kind)).toBe(countOn(items, date, kind))
    }
  })

  it('完了は予定全体で1回: どの日の行も完了の見え方になり、見出しの数は期間の毎日 −1（12.5）', () => {
    const done = cal(
      mkItem({ id: 'multi', start: '2026-11-09', due: '2026-11-11', done: true, doneAt: T0, doneOn: '2026-11-10' }),
      mkItem({ id: 'single', start: '2026-11-10', order: T0 + 1 }),
    )
    for (const date of ['2026-11-09', '2026-11-10', '2026-11-11']) {
      const row = dayList(done, date, 'work').find((r) => r.c.item.id === 'multi')
      expect(row?.c.item.done).toBe(true)
    }
    // 完了した複数日の予定は、完了した物の先頭（ここでは最後の組）へ
    expect(dayList(done, '2026-11-10', 'work').map((r) => [r.c.item.id, r.role])).toEqual([
      ['single', 'single'],
      ['multi', 'middle'],
    ])
    expect(dayUndone(done, '2026-11-09', 'work')).toBe(0)
    expect(dayUndone(done, '2026-11-10', 'work')).toBe(1)
    expect(dayUndone(done, '2026-11-11', 'work')).toBe(0)
  })
})

describe('数え方（7.6・7.9・12.5。items.ts の monthCounts・countOn を表示用に直した記録で使う）', () => {
  it('完了していない、区分ごとの、期間に入る項目を数える。複数日は毎日・休みの日も数える（7.4・7.6）', () => {
    const items = [
      mkItem({ id: 'a', start: '2026-11-09', due: '2026-11-11' }),
      mkItem({ id: 'b', start: '2026-11-10', kind: 'private' }),
      mkItem({ id: 'c', start: '2026-11-10', done: true, doneAt: T0, doneOn: '2026-11-10' }),
      mkTask({ id: 'd', due: '2026-11-10' }),
      mkTask({ id: 'e', start: '2026-11-10', due: null }),
    ]
    const off = offDaySet(dataWith({ offDays: [mkOffDay('2026-11-10')] }).offDays)
    expect(off.has('2026-11-10')).toBe(true)
    const m = monthCounts(items, 2026, 11)
    expect(m['2026-11-09']).toEqual({ work: 1, private: 0 })
    expect(m['2026-11-10']).toEqual({ work: 2, private: 1 })
    expect(m['2026-11-11']).toEqual({ work: 1, private: 0 })
    expect(m['2026-11-12']).toEqual({ work: 0, private: 0 })
  })

  it('完了すると期間の毎日 −1、完了を外すと戻る（7.6・7.9・12.5）', () => {
    const open = mkItem({ id: 'a', start: '2026-11-29', due: '2026-12-02' })
    const done: Item = { ...open, done: true, doneAt: T0, doneOn: '2026-11-30' }
    const undone: Item = { ...done, done: false, doneAt: null, doneOn: null }
    expect(monthCounts([open], 2026, 11)['2026-11-30'].work).toBe(1)
    expect(monthCounts([open], 2026, 12)['2026-12-02'].work).toBe(1)
    expect(monthCounts([done], 2026, 11)['2026-11-29'].work).toBe(0)
    expect(monthCounts([done], 2026, 12)['2026-12-01'].work).toBe(0)
    expect(monthCounts([undone], 2026, 12)['2026-12-01'].work).toBe(1)
  })

  it('知らない kind は表示用に直した記録で仕事として数える（修復の前の記録では数えない。7.6・6.12）', () => {
    const raw = { ...mkItem({ id: 'a', start: '2026-11-10' }), kind: 'meeting' }
    expect(monthCounts([raw as unknown as Item], 2026, 11)['2026-11-10']).toEqual({ work: 0, private: 0 })
    const items = Object.values(repaired(raw))
    expect(monthCounts(items, 2026, 11)['2026-11-10']).toEqual({ work: 1, private: 0 })
    const list = calendarItems(repaired(raw))
    expect(dayUndone(list, '2026-11-10', 'work')).toBe(1)
    expect(dayList(list, '2026-11-10', 'work')).toHaveLength(1)
  })

  it('start の無い calendar 生まれは due の日、それも無ければ createdAt の日に数える（7.6・6.12）', () => {
    const items = Object.values(
      repaired(
        { ...mkItem({ id: 'a', start: null, due: '2026-11-12' }) },
        { ...mkItem({ id: 'b', start: null, due: null, createdAt: new Date(2026, 10, 3, 9).getTime() }) },
      ),
    )
    const m = monthCounts(items, 2026, 11)
    expect(m['2026-11-12'].work).toBe(1)
    expect(m['2026-11-03'].work).toBe(1)
  })

  it('100 以上は「99+」（7.6）', () => {
    expect(formatCount(99)).toBe('99')
    expect(formatCount(100)).toBe('99+')
  })
})

describe('イヤーの●（8.2・7.9: 完了した物も含めて見る）', () => {
  it('予定のある日だけを持ち、まだ完了していない物があれば open、全部完了なら allDone', () => {
    const list = cal(
      mkItem({ id: 'a', start: '2026-11-10' }),
      mkItem({ id: 'b', start: '2026-11-10', done: true }),
      mkItem({ id: 'c', start: '2026-11-11', done: true }),
      mkItem({ id: 'd', start: '2026-11-11', kind: 'private' }),
      mkItem({ id: 'e', start: '2026-11-12', done: true }),
      mkItem({ id: 'f', start: '2026-11-12', done: true, order: T0 + 1 }),
    )
    const dots = yearDots(list, 2026)
    expect(dots.get('2026-11-10')).toEqual({ work: 'open', private: 'none' })
    expect(dots.get('2026-11-11')).toEqual({ work: 'allDone', private: 'open' })
    expect(dots.get('2026-11-12')).toEqual({ work: 'allDone', private: 'none' })
    expect(dots.has('2026-11-13')).toBe(false)
    expect(dots.size).toBe(3)
  })

  it('完了した物が先に来ても、あとのまだ完了していない物で open になる（並びに左右されない）', () => {
    const items = [
      mkItem({ id: 'a', start: '2026-11-10', done: true, order: 1 }),
      mkItem({ id: 'b', start: '2026-11-09', due: '2026-11-10', order: 2 }),
      mkItem({ id: 'c', start: '2026-11-10', done: true, order: 3 }),
    ]
    for (const list of [cal(...items), cal(...items).reverse()]) {
      expect(yearDots(list, 2026).get('2026-11-10')).toEqual({ work: 'open', private: 'none' })
    }
    expect(yearDots(cal(items[0], items[2]), 2026).get('2026-11-10')).toEqual({ work: 'allDone', private: 'none' })
  })

  it('複数日の予定は期間中の毎日（月の境をまたいでも）。その年の中の日だけ', () => {
    const list = cal(
      mkItem({ id: 'a', start: '2026-11-29', due: '2026-12-02' }),
      mkItem({ id: 'b', start: '2026-12-30', due: '2027-01-02', kind: 'private', done: true }),
    )
    const dots = yearDots(list, 2026)
    expect([...dots.keys()]).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-30', '2026-12-31'])
    expect(dots.get('2026-12-01')).toEqual({ work: 'open', private: 'none' })
    expect(dots.get('2026-12-31')).toEqual({ work: 'none', private: 'allDone' })
    const next = yearDots(list, 2027)
    expect([...next.keys()]).toEqual(['2027-01-01', '2027-01-02'])
    expect(yearDots(list, 2025).size).toBe(0)
  })

  it('① ④ のタスクは●に出ない（6.3）', () => {
    const list = cal(mkTask({ id: 'a' }), mkTask({ id: 'b', start: '2026-11-10' }))
    expect(yearDots(list, 2026).size).toBe(0)
  })
})

describe('休み（6.5）', () => {
  it('off が true の日だけ（外した日の記録は休みではない）', () => {
    const data = dataWith({ offDays: [mkOffDay('2026-11-10'), mkOffDay('2026-11-11', false), mkOffDay('2026-11-12')] })
    expect([...offDaySet(data.offDays)].sort()).toEqual(['2026-11-10', '2026-11-12'])
    expect(offDaySet({}).size).toBe(0)
  })
})

describe('時差を変えても予定の日はずれない（6.4）', () => {
  const items = rec(
    mkItem({ id: 'a', start: '2026-11-10', startTime: '10:00' }),
    mkItem({ id: 'b', start: '2026-11-03', due: '2026-11-04', order: T0 + 1 }),
  )
  /** その時差の端末で見た、カレンダーに出る日と時刻 */
  const seenIn = (tz: string, offset: number) => {
    vi.stubEnv('TZ', tz)
    try {
      expect(new Date(2026, 10, 10).getTimezoneOffset()).toBe(offset)
      const list = calendarItems(items)
      return {
        periods: list.map((c) => [c.item.id, c.from, c.to]),
        timed: dayTimed(list, '2026-11-10').map((c) => [c.item.id, c.item.startTime]),
        dots: [...yearDots(list, 2026).keys()],
        week: Object.keys(weekSingles(list, '2026-11-08', 'work')),
      }
    } finally {
      vi.unstubAllEnvs()
    }
  }

  it('Asia/Tokyo で入れた 11/10 10:00 の予定は、America/Los_Angeles・Pacific/Kiritimati でも 11/10 10:00 に出る', () => {
    const inTokyo = seenIn('Asia/Tokyo', -540)
    expect(inTokyo.timed).toEqual([['a', '10:00']])
    expect(inTokyo.dots).toEqual(['2026-11-03', '2026-11-04', '2026-11-10'])
    expect(inTokyo.week[0]).toBe('2026-11-08')
    expect(seenIn('America/Los_Angeles', 480)).toEqual(inTokyo)
    expect(seenIn('Pacific/Kiritimati', -840)).toEqual(inTokyo)
  })
})
