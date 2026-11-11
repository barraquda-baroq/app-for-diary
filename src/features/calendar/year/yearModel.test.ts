// イヤーの並べ方と中身（docs/SPEC.md の 8.1〜8.3・7.1〜7.4・7.9・4.12。D07・D28。CALENDAR-140・205・207・212〜216・220・222）
import { describe, expect, it } from 'vitest'
import { calendarItems, offDaySet, type CalItem } from '../../../domain/calendar'
import { mkItem, mkOffDay } from '../../../domain/testData'
import type { Item } from '../../../domain/types'
import {
  buildYear,
  DOTS_TOP_MIN_PX,
  dotsRow,
  miniColumns,
  rowsCellPx,
  yearCellLabel,
  yearLayout,
  yearMove,
  YEAR_ROWS_MIN_PX,
  type YearDayVM,
  type YearMonthVM,
} from './yearModel'

const TODAY = '2026-11-10'

/** 予定の一覧（カレンダーに出る物だけ。useCalendarData の list と同じ作り方） */
function listOf(...items: Item[]): CalItem[] {
  return calendarItems(Object.fromEntries(items.map((it) => [it.id, it])))
}

const offOf = (...dates: string[]) => offDaySet(Object.fromEntries(dates.map((d) => [d, mkOffDay(d)])))
const NONE = offOf()

const done = (p: Partial<Item>) => mkItem({ done: true, doneAt: 1, doneOn: p.start ?? null, ...p })

/** その日のマス */
function dayOf(months: YearMonthVM[], date: string): YearDayVM {
  const d = months[Number(date.slice(5, 7)) - 1].days.find((x) => x.date === date)
  if (!d) throw new Error(`マスがありません: ${date}`)
  return d
}

describe('並べ方（8.1）', () => {
  it('領域の幅 870px 以上は「月を行・日を列」、869px までは小さな月（64 + 31 × 24 + 31 × 2 ＝ 870）', () => {
    expect(YEAR_ROWS_MIN_PX).toBe(64 + 31 * 24 + 31 * 2)
    expect(yearLayout(870)).toBe('rows')
    expect(yearLayout(869)).toBe('mini')
    expect(yearLayout(869.9)).toBe('mini')
    expect(yearLayout(1514)).toBe('rows')
    // 測る前（0×0）は小さな月
    expect(yearLayout(0)).toBe('mini')
  })

  it.each([
    // [領域の幅, 幅の区分, 列の数]
    [0, 'L', 2],
    [339, 'M', 2],
    [509, 'M', 2],
    [510, 'M', 3],
    [679, 'M', 3],
    [680, 'M', 4],
    [794, 'L', 4],
    // floor(860 / 170) = 5 → 4 に収める
    [860, 'L', 4],
    [867, 'M', 4],
    // S はいつも2列（599px の窓の領域 549px は 170px で割ると3列になる）
    [310, 'S', 2],
    [549, 'S', 2],
  ] as const)(
    '小さな月の列の数: 領域 %ipx・%s → %i 列（floor(幅 ÷ 170) を 2〜4 に。S は2列。CALENDAR-220）',
    (area, width, cols) => {
      expect(miniColumns(area, width)).toBe(cols)
    },
  )

  it('「月を行・日を列」の日のマスの幅 =（領域の幅 − 64px − 31 × 2px）÷ 31（CALENDAR-210）', () => {
    expect(rowsCellPx(870)).toBe(24)
    // 1400×900 の窓の領域（994px）でちょうど 28px
    expect(rowsCellPx(994)).toBe(28)
    expect(rowsCellPx(1211)).toBe(35)
  })

  it('●の段: 日付と●の2つの場所が横に並ぶ幅（35px）からは右上、それより狭いと曜日の下の段（D28・AMB-CAL-18）', () => {
    // 左右の余白 3px ずつ ＋ 2桁の日付 14.4px（12px の等幅の字は 0.6em）＋ 間 2px ＋ ●の場所 5 + 2 + 5 → 34.4px
    expect(DOTS_TOP_MIN_PX).toBeGreaterThanOrEqual(3 + 2 * 12 * 0.6 + 2 + 12 + 3)
    expect(dotsRow(rowsCellPx(870))).toBe('below')
    // D28 の 28px では日付と●が重なるので、28px のマスも下の段
    expect(dotsRow(28)).toBe('below')
    expect(dotsRow(34.9)).toBe('below')
    expect(dotsRow(35)).toBe('top')
    expect(dotsRow(rowsCellPx(1514))).toBe('top')
  })
})

describe('12か月と日のマス（8.2・8.3）', () => {
  const year = buildYear(2026, [], NONE, TODAY)

  it('1月〜12月の 12行。月の名前は英字3文字、見出しを押した時に見る日は1日（CALENDAR-207・224）', () => {
    expect(year.map((m) => m.m)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(year.map((m) => m.name)).toEqual(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'])
    expect(year[10].first).toBe('2026-11-01')
    expect(year[10].label).toBe('2026年11月をマンスリーで見る')
  })

  it('その月に無い日は作らない（2026年2月は 28日まで、4月は 30日まで、2028年2月は 29日まで。CALENDAR-212）', () => {
    expect(year[1].days).toHaveLength(28)
    expect(year[1].days.map((d) => d.date)).not.toContain('2026-02-29')
    expect(year[1].days.at(-1)?.date).toBe('2026-02-28')
    expect(year[3].days).toHaveLength(30)
    expect(year.reduce((n, m) => n + m.days.length, 0)).toBe(365)
    const leap = buildYear(2028, [], NONE, TODAY)
    expect(leap[1].days.at(-1)?.date).toBe('2028-02-29')
    expect(leap[1].days.map((d) => d.date)).not.toContain('2028-02-30')
  })

  it('日付・英字3文字の曜日と、小さな月の初めの空き（1日の曜日。2026年11月1日は日曜、1月1日は木曜）', () => {
    expect(dayOf(year, '2026-11-10')).toMatchObject({ day: 10, weekday: 'TUE' })
    expect(year[10].lead).toBe(0)
    expect(year[0].lead).toBe(4)
    expect(dayOf(year, '2026-01-01').weekday).toBe('THU')
  })

  it('日付と曜日の色: 日曜と祝日は sun、土曜は sat（祝日名は出さない。7.1・CALENDAR-216）', () => {
    expect(dayOf(year, '2026-11-01').tone).toBe('sun')
    // 文化の日（火）・勤労感謝の日（月）・振替休日（2026-05-06 水）
    expect(dayOf(year, '2026-11-03').tone).toBe('sun')
    expect(dayOf(year, '2026-11-23').tone).toBe('sun')
    expect(dayOf(year, '2026-05-06').tone).toBe('sun')
    expect(dayOf(year, '2026-11-07').tone).toBe('sat')
    expect(dayOf(year, '2026-11-04').tone).toBeNull()
  })

  it('今日は今日のマスだけ（色はそのまま。D07）。今月は今日の月だけ（帯・名前。CALENDAR-209）', () => {
    const today = year.flatMap((m) => m.days).filter((d) => d.isToday)
    expect(today.map((d) => d.date)).toEqual(['2026-11-10'])
    expect(dayOf(year, '2026-11-10').tone).toBeNull()
    expect(
      buildYear(2026, [], NONE, '2026-11-08')
        .flatMap((m) => m.days)
        .find((d) => d.isToday)?.tone,
    ).toBe('sun')
    expect(year.filter((m) => m.isThisMonth).map((m) => m.m)).toEqual([11])
    // 今日が別の年なら、今日のマスも今月も無い
    const other = buildYear(2027, [], NONE, TODAY)
    expect(other.some((m) => m.isThisMonth || m.days.some((d) => d.isToday))).toBe(false)
  })

  it('休みの日（off が true の日だけ。CALENDAR-216）', () => {
    const y = buildYear(2026, [], offOf('2026-11-11', '2026-11-23'), TODAY)
    expect(dayOf(y, '2026-11-11').off).toBe(true)
    expect(dayOf(y, '2026-11-23').off).toBe(true)
    expect(dayOf(y, '2026-11-12').off).toBe(false)
  })

  it('祝日の土曜は祝日の色。1970〜2050年の外は祝日なし（D04）', () => {
    // 2050-01-01 は土曜の元日、2051-01-02 は月曜（祝日の表の外）
    expect(dayOf(buildYear(2050, [], NONE, TODAY), '2050-01-01').tone).toBe('sun')
    const y = buildYear(2051, [], NONE, TODAY)
    expect(dayOf(y, '2051-01-02').tone).toBeNull()
    expect(dayOf(y, '2051-01-01').tone).toBe('sun')
  })
})

describe('●（8.2・7.9。CALENDAR-140・213〜215）', () => {
  it('期間の毎日に区分の●（月をまたいでも。完了した物も入れる）。全部完了なら allDone、ひとつでも済んでいなければ open', () => {
    const list = listOf(
      mkItem({ id: 'w', start: '2026-11-28', due: '2026-12-02' }),
      done({ id: 'd', start: '2026-11-05' }),
      done({ id: 'p1', kind: 'private', start: '2026-11-06' }),
      mkItem({ id: 'p2', kind: 'private', start: '2026-11-06' }),
    )
    const y = buildYear(2026, list, NONE, TODAY)
    for (const d of ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
      expect(dayOf(y, d).dots, d).toEqual({ work: 'open', private: 'none' })
    expect(dayOf(y, '2026-12-03').dots).toEqual({ work: 'none', private: 'none' })
    expect(dayOf(y, '2026-11-05').dots).toEqual({ work: 'allDone', private: 'none' })
    expect(dayOf(y, '2026-11-06').dots).toEqual({ work: 'none', private: 'open' })
  })

  it('年をまたぐ予定は、その年の中の日だけ', () => {
    const list = listOf(mkItem({ id: 'w', start: '2026-12-30', due: '2027-01-02' }))
    expect(dayOf(buildYear(2026, list, NONE, TODAY), '2026-12-31').dots.work).toBe('open')
    const next = buildYear(2027, list, NONE, TODAY)
    expect(dayOf(next, '2027-01-02').dots.work).toBe('open')
    expect(dayOf(next, '2027-01-03').dots.work).toBe('none')
  })
})

describe('読み上げ（4.12）', () => {
  it('日付・区分ごとの予定・休み・祝日名をまとめる（祝日名は画面に出さないが読み上げでは伝える）', () => {
    const list = listOf(mkItem({ id: 'w', start: '2026-11-03' }), done({ id: 'p', kind: 'private', start: '2026-11-03' }))
    const y = buildYear(2026, list, offOf('2026-11-03'), TODAY)
    expect(dayOf(y, '2026-11-03').label).toBe('11月3日（火）、仕事の予定あり、プライベートの予定（すべて完了）、休み、文化の日')
    expect(dayOf(y, '2026-11-04').label).toBe('11月4日（水）、予定なし')
    expect(yearCellLabel('2026-11-23', { work: 'none', private: 'open' }, false, '勤労感謝の日')).toBe(
      '11月23日（月）、プライベートの予定あり、勤労感謝の日',
    )
  })
})

describe('キーボードで日のマスの間を動く（yearMove）', () => {
  it.each([
    // 月を行・日を列: ← → は前・次の日（月の端は前・次の月へ）、↑ ↓ は前・次の月の同じ日（無ければ最終日）、Home・End は1日・最終日
    ['2026-01-31', 'ArrowRight', 'rows', '2026-02-01'],
    ['2026-03-01', 'ArrowLeft', 'rows', '2026-02-28'],
    ['2026-03-31', 'ArrowUp', 'rows', '2026-02-28'],
    ['2026-11-10', 'ArrowDown', 'rows', '2026-12-10'],
    ['2026-11-10', 'Home', 'rows', '2026-11-01'],
    ['2026-11-10', 'End', 'rows', '2026-11-30'],
    // 年の端では動かない（同じ日）
    ['2026-01-01', 'ArrowLeft', 'rows', '2026-01-01'],
    ['2026-12-31', 'ArrowRight', 'rows', '2026-12-31'],
    ['2026-01-15', 'ArrowUp', 'rows', '2026-01-15'],
    ['2026-12-15', 'ArrowDown', 'rows', '2026-12-15'],
    // 小さな月: ↑ ↓ は前・次の週（月をまたぐと隣の小さな月へ）、Home・End はその週の日曜・土曜（その月の中）
    ['2026-01-30', 'ArrowDown', 'mini', '2026-02-06'],
    ['2026-11-10', 'ArrowUp', 'mini', '2026-11-03'],
    ['2026-01-03', 'ArrowUp', 'mini', '2026-01-03'],
    ['2026-12-29', 'ArrowDown', 'mini', '2026-12-29'],
    ['2026-11-11', 'Home', 'mini', '2026-11-08'],
    ['2026-11-11', 'End', 'mini', '2026-11-14'],
    ['2026-12-02', 'Home', 'mini', '2026-12-01'],
    ['2026-11-30', 'End', 'mini', '2026-11-30'],
    ['2026-11-10', 'ArrowRight', 'mini', '2026-11-11'],
  ] as const)('%s で %s（%s）→ %s', (from, key, layout, to) => {
    expect(yearMove(from, key, layout)).toBe(to)
  })

  it('受け持たないキーは null（Enter・Space はボタンが受ける）', () => {
    expect(yearMove('2026-11-10', 'Enter', 'rows')).toBeNull()
    expect(yearMove('2026-11-10', ' ', 'mini')).toBeNull()
    expect(yearMove('2026-11-10', 'PageDown', 'rows')).toBeNull()
  })
})
