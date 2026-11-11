// マンスリーのマス目の中身（docs/SPEC.md の 7.1〜7.4・7.6・9.1・9.2・4.12。D06・D29。CALENDAR-228・232・234〜243・FRAME-171・255）
import { describe, expect, it } from 'vitest'
import { calendarItems, offDaySet, type CalItem } from '../../../domain/calendar'
import { mkItem, mkOffDay, mkTask } from '../../../domain/testData'
import type { Item } from '../../../domain/types'
import { buildMonth, type MonthCellVM } from './monthModel'

const NOV = { y: 2026, m: 11 }
const TODAY = '2026-11-10'

/** 予定の一覧（カレンダーに出る物だけ。useCalendarData の list と同じ作り方） */
function listOf(...items: Item[]): CalItem[] {
  return calendarItems(Object.fromEntries(items.map((it) => [it.id, it])))
}

const offOf = (...dates: string[]) => offDaySet(Object.fromEntries(dates.map((d) => [d, mkOffDay(d)])))
const NONE = offOf()

/** 日付のマス */
function cellOf(weeks: MonthCellVM[][], date: string): MonthCellVM {
  const c = weeks.flat().find((x) => x.date === date)
  if (!c) throw new Error(`マスがありません: ${date}`)
  return c
}

describe('マス目（9.1）', () => {
  it.each([
    [2026, 2, 4, '2026-02-01', '2026-02-28'],
    [2026, 11, 5, '2026-11-01', '2026-12-05'],
    [2026, 8, 6, '2026-07-26', '2026-09-05'],
  ])('%i年%i月は %i行（日曜始まり。%s〜%s）', (y, m, rows, first, last) => {
    const weeks = buildMonth({ y, m }, [], NONE, TODAY, 'L')
    expect(weeks).toHaveLength(rows)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0][0].date).toBe(first)
    expect(weeks[rows - 1][6].date).toBe(last)
  })

  it('日付の色: 日曜と祝日は sun、土曜は sat、ほかは無し。祝日の土曜も祝日の色（7.1）', () => {
    const weeks = buildMonth(NOV, [], NONE, '2026-12-25', 'L')
    expect(cellOf(weeks, '2026-11-01').tone).toBe('sun')
    expect(cellOf(weeks, '2026-11-02').tone).toBeNull()
    expect(cellOf(weeks, '2026-11-03').tone).toBe('sun') // 文化の日（火）
    expect(cellOf(weeks, '2026-11-07').tone).toBe('sat')
    expect(cellOf(weeks, '2026-11-23').tone).toBe('sun') // 勤労感謝の日（月）
    const nov29 = buildMonth({ y: 2029, m: 11 }, [], NONE, TODAY, 'L')
    expect(cellOf(nov29, '2029-11-03').tone).toBe('sun') // 文化の日（土）
    expect(cellOf(nov29, '2029-11-10').tone).toBe('sat')
  })

  it('今日はその月の日だけ。今日の日付は丸の字が勝つので色を付けない（7.3）', () => {
    const weeks = buildMonth(NOV, [], NONE, '2026-11-08', 'L')
    expect(
      weeks
        .flat()
        .filter((c) => c.isToday)
        .map((c) => c.date),
    ).toEqual(['2026-11-08'])
    expect(cellOf(weeks, '2026-11-08').tone).toBeNull()
    // 隣の月の日が今日でも、丸は出さない（D06）
    const dec = buildMonth(NOV, [], NONE, '2026-12-02', 'L')
    expect(dec.flat().some((c) => c.isToday)).toBe(false)
  })
})

describe('件数（7.6・9.2）', () => {
  const items = [
    mkItem({ id: 'w1', start: '2026-11-10' }),
    mkItem({ id: 'w2', start: '2026-11-09', due: '2026-11-11' }),
    mkItem({ id: 'w3', start: '2026-11-10', done: true, doneAt: 1, doneOn: '2026-11-10' }),
    mkItem({ id: 'p1', kind: 'private', start: '2026-11-10' }),
    mkItem({ id: 'p2', kind: 'private', start: '2026-11-12' }),
    mkTask({ id: 't1', due: '2026-11-12' }),
    mkTask({ id: 't2', start: '2026-11-13' }), // 開始日だけの list 生まれはカレンダーに出ない（6.3）
    mkItem({ id: 'x1', start: '2026-11-14', done: true, doneAt: 1, doneOn: '2026-11-14' }),
  ]
  const weeks = buildMonth(NOV, listOf(...items), NONE, TODAY, 'L')

  it('完了していない物を区分ごとに数え、複数日の予定は期間中の毎日に数える', () => {
    expect(cellOf(weeks, '2026-11-10').counts).toEqual({
      work: { text: '2', zero: false, label: '仕事 2件をデイリーで見る' },
      private: { text: '1', zero: false, label: 'プライベート 1件をデイリーで見る' },
    })
    expect(cellOf(weeks, '2026-11-09').counts?.work.text).toBe('1')
    expect(cellOf(weeks, '2026-11-11').counts?.work.text).toBe('1')
  })

  it('片方が 0 なら飾りの「0」（zero。D29）、両方 0 の日（何も無い日・全部完了した日）は null（CALENDAR-240・241）', () => {
    expect(cellOf(weeks, '2026-11-09').counts?.private).toEqual({
      text: '0',
      zero: true,
      label: 'プライベート 0件をデイリーで見る',
    })
    expect(cellOf(weeks, '2026-11-12').counts).toMatchObject({ work: { text: '1' }, private: { text: '1' } })
    expect(cellOf(weeks, '2026-11-13').counts).toBeNull()
    expect(cellOf(weeks, '2026-11-14').counts).toBeNull()
  })

  it('100 以上は「99+」', () => {
    const many = Array.from({ length: 100 }, (_, i) => mkItem({ id: `m${i}`, kind: 'private', start: '2026-11-20' }))
    const c = cellOf(buildMonth(NOV, listOf(...many), NONE, TODAY, 'L'), '2026-11-20')
    expect(c.counts?.private.text).toBe('99+')
    expect(c.counts?.work.text).toBe('0')
    expect(c.label).toBe('11月20日（金）、仕事 0件、プライベート 99+件')
  })

  it('月をまたぐ予定は、その月の日だけに数え、前後の月の日には件数を出さない（9.1）', () => {
    const cross = buildMonth(NOV, listOf(mkItem({ id: 'c', start: '2026-10-30', due: '2026-12-02' })), NONE, TODAY, 'L')
    expect(cellOf(cross, '2026-11-01').counts?.work.text).toBe('1')
    expect(cellOf(cross, '2026-11-30').counts?.work.text).toBe('1')
    expect(cellOf(cross, '2026-12-01').counts).toBeNull()
    expect(cellOf(cross, '2026-12-02').counts).toBeNull()
  })

  it('休みの日にも数える（7.4）', () => {
    const c = cellOf(
      buildMonth(NOV, listOf(mkItem({ id: 'o', start: '2026-11-11' })), offOf('2026-11-11'), TODAY, 'L'),
      '2026-11-11',
    )
    expect(c.off).toBe(true)
    expect(c.counts?.work.text).toBe('1')
  })
})

describe('休み・祝日名・前後の月の日（7.2・7.4・9.1・9.2。D06）', () => {
  it('休みの日は off（自動では付けない: 土日・祝日も off でない。CALENDAR-047）', () => {
    const weeks = buildMonth(NOV, [], offOf('2026-11-11', '2026-11-23'), TODAY, 'L')
    expect(
      weeks
        .flat()
        .filter((c) => c.off)
        .map((c) => c.date),
    ).toEqual(['2026-11-11', '2026-11-23'])
  })

  it('祝日名は L・M のその月の日だけに出し、S は出さない（日付の色だけ。CALENDAR-067・237）', () => {
    for (const width of ['L', 'M'] as const) {
      const weeks = buildMonth(NOV, [], NONE, TODAY, width)
      expect(cellOf(weeks, '2026-11-03').holiday).toBe('文化の日')
      expect(cellOf(weeks, '2026-11-23').holiday).toBe('勤労感謝の日')
      expect(cellOf(weeks, '2026-11-04').holiday).toBeNull()
    }
    const s = buildMonth(NOV, [], NONE, TODAY, 'S')
    expect(cellOf(s, '2026-11-03').holiday).toBeNull()
    expect(cellOf(s, '2026-11-03').tone).toBe('sun')
    // 前後の月の日の祝日名は出さない（2027年1月の元日のマスは 12月のマス目に無いので、2026年12月で確かめる: 1/1 は隣の月）
    const dec = buildMonth({ y: 2026, m: 12 }, [], NONE, TODAY, 'L')
    expect(cellOf(dec, '2027-01-01')).toMatchObject({ outside: true, holiday: null, tone: null })
  })

  it('前後の月の日: 日付だけ（色・今日・件数・祝日名なし）。休みの日は off と「休み」の読み上げ（D06・CALENDAR-232）', () => {
    const items = [mkItem({ id: 'd', start: '2026-12-02' })]
    const weeks = buildMonth(NOV, listOf(...items), offOf('2026-12-02'), '2026-12-02', 'L')
    expect(cellOf(weeks, '2026-12-02')).toEqual({
      date: '2026-12-02',
      day: 2,
      outside: true,
      tone: null,
      isToday: false,
      off: true,
      holiday: null,
      counts: null,
      label: '12月2日（水）、休み',
    })
    expect(cellOf(weeks, '2026-12-05')).toMatchObject({ outside: true, tone: null, off: false, label: '12月5日（土）' })
  })
})

describe('読み上げ（4.12・9.3。FRAME-255・CALENDAR-243）', () => {
  it('日付・件数・休み・祝日名をまとめる（S も祝日名を読む）。どちらも 0件の日は「予定なし」', () => {
    const items = [
      mkItem({ id: 'w', start: '2026-11-23' }),
      mkItem({ id: 'p', kind: 'private', start: '2026-11-23' }),
      mkItem({ id: 'p2', kind: 'private', start: '2026-11-23' }),
    ]
    for (const width of ['L', 'S'] as const) {
      const weeks = buildMonth(NOV, listOf(...items), offOf('2026-11-23'), TODAY, width)
      expect(cellOf(weeks, '2026-11-23').label).toBe('11月23日（月）、仕事 1件、プライベート 2件、休み、勤労感謝の日')
      expect(cellOf(weeks, '2026-11-24').label).toBe('11月24日（火）、予定なし')
    }
  })
})
