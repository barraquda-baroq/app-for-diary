// デイリーのタイムスケジュールの並べ方（docs/SPEC.md の 11.3・6.4・2.10）: その日の部分（開始時刻だけは +30分・24:00 まで、日をまたぐ
// 物は初日・間の日・最終日）・重なりの列（見えている高さでまとめる・始まりの早い順 → 長い順・いちばん左の空いた列・L・M は4列、
// S は3列で「+n」）・空いた所を押した時の時刻・開いた時の位置・開始のカードの高さ
import { describe, expect, it } from 'vitest'
import { calendarItems, dayTimed } from './calendar'
import { hmToMinutes } from './dates'
import {
  DAY_MINUTES,
  EVENT_MIN_PX,
  HOUR_PX,
  START_CARD_PX,
  initialScrollMinute,
  layoutPieces,
  minMinutesOf,
  piecesOn,
  startCardHeightPx,
  tapToTimes,
  timedInputs,
  type Piece,
  type TimedInput,
} from './dayLayout'
import { T0, mkItem } from './testData'
import type { Item } from './types'

const DAY = '2026-11-10'
const m = hmToMinutes
/** 1日の予定 */
const one = (id: string, startTime: string, endTime: string | null = null, date = DAY): TimedInput => ({
  id,
  from: date,
  to: date,
  startTime,
  endTime,
})
/** 部分（分は 'HH:MM' で書く） */
const pc = (id: string, start: string, end: string, part: Piece['part'] = 'single'): Piece => ({
  id,
  start: m(start),
  end: m(end),
  part,
})
/** L・M の並べ方（4列・最小 24px = 30分） */
const LM = { maxCols: 4, minMinutes: minMinutesOf(HOUR_PX.LM) } as const
/** S の並べ方（3列・最小 24px ≒ 32.7分） */
const S = { maxCols: 3, minMinutes: minMinutesOf(HOUR_PX.S) } as const
/** id → [列, 列の数] */
const cols = (r: { placed: { id: string; col: number; cols: number }[] }) =>
  Object.fromEntries(r.placed.map((p) => [p.id, [p.col, p.cols]]))

describe('その日の部分（6.4・11.3。CALENDAR-032・ITEMS-133・142）', () => {
  it('1日の予定は開始〜終了の枠', () => {
    expect(piecesOn([one('a', '10:00', '11:30')], DAY)).toEqual([{ id: 'a', start: 600, end: 690, part: 'single' }])
  })

  it.each<[string, string, number]>([
    ['10:00 → 10:30', '10:00', 630],
    ['00:00 → 00:30', '00:00', 30],
    ['23:30 → 24:00', '23:30', DAY_MINUTES],
    ['23:50 → 24:00（+30分でも 24:00 まで）', '23:50', DAY_MINUTES],
    ['23:59 → 24:00', '23:59', DAY_MINUTES],
  ])('開始時刻だけの予定は min(開始 + 30分, 24:00) までの枠: %s', (_, start, end) => {
    expect(piecesOn([one('a', start)], DAY)).toEqual([{ id: 'a', start: m(start), end, part: 'single' }])
  })

  it('終了 24:00 の1日の予定はその日の終わりまで', () => {
    expect(piecesOn([one('a', '22:00', '24:00')], DAY)[0]).toMatchObject({ start: 1320, end: 1440 })
  })

  it('日をまたぐ予定: 初日は開始〜24:00、間の日は 0:00〜24:00、最終日は 0:00〜終了', () => {
    const t: TimedInput = { id: 'a', from: '2026-11-09', to: '2026-11-11', startTime: '10:00', endTime: '15:00' }
    expect(piecesOn([t], '2026-11-08')).toEqual([])
    expect(piecesOn([t], '2026-11-09')).toEqual([{ id: 'a', start: 600, end: 1440, part: 'first' }])
    expect(piecesOn([t], '2026-11-10')).toEqual([{ id: 'a', start: 0, end: 1440, part: 'middle' }])
    expect(piecesOn([t], '2026-11-11')).toEqual([{ id: 'a', start: 0, end: 900, part: 'last' }])
    expect(piecesOn([t], '2026-11-12')).toEqual([])
  })

  it('日をまたぐ予定で終了時刻が無ければ、最終日は 24:00 まで', () => {
    const t: TimedInput = { id: 'a', from: '2026-11-09', to: '2026-11-10', startTime: '10:00', endTime: null }
    expect(piecesOn([t], '2026-11-09')).toEqual([{ id: 'a', start: 600, end: 1440, part: 'first' }])
    expect(piecesOn([t], '2026-11-10')).toEqual([{ id: 'a', start: 0, end: 1440, part: 'last' }])
  })

  it('2日にまたがる夜の予定（11/11 22:00 〜 11/12 02:00）', () => {
    const t: TimedInput = { id: 'bus', from: '2026-11-11', to: '2026-11-12', startTime: '22:00', endTime: '02:00' }
    expect(piecesOn([t], '2026-11-11')).toEqual([{ id: 'bus', start: 1320, end: 1440, part: 'first' }])
    expect(piecesOn([t], '2026-11-12')).toEqual([{ id: 'bus', start: 0, end: 120, part: 'last' }])
  })

  it('月をまたぐ予定も暦の日付で（11/30 〜 12/1）', () => {
    const t: TimedInput = { id: 'a', from: '2026-11-30', to: '2026-12-01', startTime: '20:00', endTime: '09:00' }
    expect(piecesOn([t], '2026-11-30')[0].part).toBe('first')
    expect(piecesOn([t], '2026-12-01')[0]).toMatchObject({ start: 0, end: 540, part: 'last' })
  })

  it('期間にこの日が入らない物は出さず、渡した順のまま', () => {
    const list = [one('b', '13:00'), one('x', '09:00', null, '2026-11-11'), one('a', '09:00', '10:00')]
    expect(piecesOn(list, DAY).map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('修復の前の形も落ちない: 1日で終了 ≤ 開始は開始時刻だけの予定、形の違う時刻は終了なし・開始の形が違えば出さない', () => {
    expect(piecesOn([one('a', '10:00', '09:00')], DAY)[0]).toMatchObject({ start: 600, end: 630 })
    expect(piecesOn([one('a', '10:00', '10:00')], DAY)[0]).toMatchObject({ start: 600, end: 630 })
    expect(piecesOn([one('a', '10:00', '25:00')], DAY)[0]).toMatchObject({ start: 600, end: 630 })
    expect(piecesOn([one('a', '9:00')], DAY)).toEqual([])
    expect(piecesOn([one('a', '24:00')], DAY)).toEqual([])
  })

  it('カレンダーに出る項目からは、時刻のある物だけを渡す（dayTimed の 7.5 の順のまま）', () => {
    const items: Item[] = [
      mkItem({ id: 'untimed', start: DAY }),
      mkItem({ id: 'late', start: DAY, startTime: '15:00' }),
      mkItem({ id: 'multi', start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '15:00', order: T0 + 1 }),
      mkItem({ id: 'early', start: DAY, startTime: '09:00', endTime: '10:00', kind: 'private' }),
    ]
    const list = calendarItems(Object.fromEntries(items.map((it) => [it.id, it])))
    const inputs = timedInputs(dayTimed(list, DAY))
    expect(inputs).toEqual([
      { id: 'multi', from: '2026-11-09', to: '2026-11-11', startTime: '10:00', endTime: '15:00' },
      { id: 'early', from: DAY, to: DAY, startTime: '09:00', endTime: '10:00' },
      { id: 'late', from: DAY, to: DAY, startTime: '15:00', endTime: null },
    ])
    expect(timedInputs(list).map((t) => t.id)).not.toContain('untimed')
    expect(piecesOn(inputs, DAY).map((p) => [p.id, p.part])).toEqual([
      ['multi', 'middle'],
      ['early', 'single'],
      ['late', 'single'],
    ])
  })
})

describe('重なりの並べ方（11.3。ITEMS-146・147）', () => {
  it('重ならない予定はそれぞれ1列（幅いっぱい）', () => {
    const r = layoutPieces([pc('a', '09:00', '10:00'), pc('b', '13:00', '14:00')], LM)
    expect(cols(r)).toEqual({ a: [0, 1], b: [0, 1] })
    expect(r.overflow).toEqual([])
  })

  it('ちょうど終わった時刻に始まる物は重ならない（10:00〜11:00 と 11:00〜12:00）', () => {
    expect(cols(layoutPieces([pc('a', '10:00', '11:00'), pc('b', '11:00', '12:00')], LM))).toEqual({ a: [0, 1], b: [0, 1] })
  })

  it('始まりの早い順、同じなら長い順に、いちばん左の列へ', () => {
    const r = layoutPieces([pc('short', '10:00', '10:30'), pc('long', '10:00', '11:30'), pc('mid', '10:00', '11:00')], LM)
    expect(cols(r)).toEqual({ long: [0, 3], mid: [1, 3], short: [2, 3] })
    expect(r.placed.map((p) => p.id)).toEqual(['long', 'mid', 'short'])
  })

  it('始まりも長さも同じなら渡した順（dayTimed の 7.5 の順）', () => {
    expect(cols(layoutPieces([pc('b', '10:00', '11:00'), pc('a', '10:00', '11:00')], LM))).toEqual({ b: [0, 2], a: [1, 2] })
  })

  it('空いた列があれば、いちばん左の空いた列に入れる。列の幅はまとまりの中の列の数で等分', () => {
    // a 9:00〜12:00 が列 0、b 9:30〜10:30 が列 1、c 11:00〜11:30 は b が終わった列 1
    const r = layoutPieces([pc('a', '09:00', '12:00'), pc('b', '09:30', '10:30'), pc('c', '11:00', '11:30')], LM)
    expect(cols(r)).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] })
  })

  it('重なりがつながる物は1つのまとまり（a と c は重ならないが、b を通してつながる）', () => {
    const r = layoutPieces(
      [pc('a', '09:00', '10:00'), pc('b', '09:30', '11:00'), pc('c', '10:30', '12:00'), pc('d', '13:00', '14:00')],
      LM,
    )
    expect(cols(r)).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] })
  })

  it('重なりは見えている高さで見る: 短い予定も最小の高さ 24px の場所を取る（D39）', () => {
    const p = [pc('a', '10:00', '10:10'), pc('b', '10:20', '11:00')]
    // 時刻だけなら重ならない
    expect(cols(layoutPieces(p, { maxCols: 4, minMinutes: 0 }))).toEqual({ a: [0, 1], b: [0, 1] })
    // 10:00〜10:10 は 24px（L・M で 30分）の高さで出るので、10:20 の b と重なる
    expect(cols(layoutPieces(p, LM))).toEqual({ a: [0, 2], b: [1, 2] })
  })

  it('最小の高さは1時間の高さで違う: S（44px）は L・M（48px）より長い分の場所を取る', () => {
    expect(minMinutesOf(HOUR_PX.LM)).toBe(30)
    expect(minMinutesOf(HOUR_PX.S)).toBeCloseTo(32.73, 2)
    // 開始時刻だけの 10:00（10:30 まで）と 10:31 の予定: L・M では重ならず、S では 24px の枠が 10:32 過ぎまで届くので重なる
    const p = [pc('a', '10:00', '10:30'), pc('b', '10:31', '11:00')]
    expect(cols(layoutPieces(p, LM))).toEqual({ a: [0, 1], b: [0, 1] })
    expect(cols(layoutPieces(p, S))).toEqual({ a: [0, 2], b: [1, 2] })
  })

  it('5つ重なる時、L・M は4列と「+1」、S は3列と「+2」（隠れた予定のいちばん早い時刻の所）', () => {
    const p = ['a', 'b', 'c', 'd', 'e'].map((id) => pc(id, '14:00', '15:30'))
    const lm = layoutPieces(p, LM)
    expect(cols(lm)).toEqual({ a: [0, 4], b: [1, 4], c: [2, 4], d: [3, 4] })
    expect(lm.overflow).toEqual([{ at: m('14:00'), ids: ['e'] }])
    const s = layoutPieces(p, S)
    expect(cols(s)).toEqual({ a: [0, 3], b: [1, 3], c: [2, 3] })
    expect(s.overflow).toEqual([{ at: m('14:00'), ids: ['d', 'e'] }])
  })

  it('札の時刻は隠れた予定のいちばん早い始まり（上限より右の列が要る予定を隠す。AMB-ITEMS-13）', () => {
    const p = [
      pc('a', '14:00', '16:00'),
      pc('b', '14:00', '16:00'),
      pc('c', '14:00', '16:00'),
      pc('d', '14:30', '16:00'),
      pc('e', '15:00', '15:30'),
      pc('f', '15:10', '16:00'),
    ]
    const lm = layoutPieces(p, LM)
    expect(lm.placed.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(lm.overflow).toEqual([{ at: m('15:00'), ids: ['e', 'f'] }])
    const s = layoutPieces(p, S)
    expect(s.overflow).toEqual([{ at: m('14:30'), ids: ['d', 'e', 'f'] }])
  })

  it('隠した予定の後でも、空いた列があればふつうに出す', () => {
    // a〜e が 14:00〜15:00 で重なり e を隠す。f 14:30〜16:00 も列 4 で隠す。g 15:00〜15:30 は a の空いた列 0 に出る（同じまとまり）
    const p = [
      ...['a', 'b', 'c', 'd', 'e'].map((id) => pc(id, '14:00', '15:00')),
      pc('f', '14:30', '16:00'),
      pc('g', '15:00', '15:30'),
    ]
    const r = layoutPieces(p, LM)
    expect(cols(r)).toEqual({ a: [0, 4], b: [1, 4], c: [2, 4], d: [3, 4], g: [0, 4] })
    expect(r.overflow).toEqual([{ at: m('14:00'), ids: ['e', 'f'] }])
  })

  it('札はまとまりごと', () => {
    const p = [
      ...['a', 'b', 'c', 'd'].map((id) => pc(id, '09:00', '10:00')),
      ...['e', 'f', 'g', 'h', 'i'].map((id) => pc(id, '16:00', '17:00')),
    ]
    const s = layoutPieces(p, S)
    expect(s.overflow).toEqual([
      { at: m('09:00'), ids: ['d'] },
      { at: m('16:00'), ids: ['h', 'i'] },
    ])
  })

  it('日をまたぐ予定の部分も重なりに入る（間の日の 0:00〜24:00 はその日のすべての予定と重なる）', () => {
    const p = [
      pc('a', '09:00', '10:00'),
      { id: 'trip', start: 0, end: DAY_MINUTES, part: 'middle' as const },
      pc('b', '15:00', '16:00'),
    ]
    const r = layoutPieces(p, LM)
    expect(cols(r)).toEqual({ trip: [0, 2], a: [1, 2], b: [1, 2] })
    expect(r.placed.find((x) => x.id === 'trip')?.part).toBe('middle')
  })

  it('予定の無い日は何も並べない', () => {
    expect(layoutPieces([], LM)).toEqual({ placed: [], overflow: [] })
  })
})

describe('空いた所を押した時の時刻（11.3。ITEMS-149）', () => {
  it.each<[string, number, string, string]>([
    ['13:10 → 13:00〜14:00', m('13:10'), '13:00', '14:00'],
    ['13:30 → 13:30〜14:30', m('13:30'), '13:30', '14:30'],
    ['22:59 → 22:30〜23:30', m('22:59'), '22:30', '23:30'],
    ['23:00 → 23:00〜24:00', m('23:00'), '23:00', '24:00'],
    ['23:40 → 23:30〜24:00', m('23:40'), '23:30', '24:00'],
    ['0:00 → 0:00〜1:00', 0, '00:00', '01:00'],
    ['端数（10:00 と少し）→ 10:00〜11:00', 600.7, '10:00', '11:00'],
    ['いちばん下の端（24:00）→ 23:30〜24:00', DAY_MINUTES, '23:30', '24:00'],
    ['上の外 → 0:00〜1:00', -5, '00:00', '01:00'],
    ['数でない時 → 0:00〜1:00', Number.NaN, '00:00', '01:00'],
  ])('%s', (_, minute, startTime, endTime) => {
    expect(tapToTimes(minute)).toEqual({ startTime, endTime })
  })
})

describe('開いた時の位置（11.3。ITEMS-132）', () => {
  it('今日は今の時刻の 60分前を上の端に（9:00 → 8:00）', () => {
    expect(initialScrollMinute(true, m('09:00'))).toBe(m('08:00'))
    expect(initialScrollMinute(true, m('23:59'))).toBe(m('22:59'))
  })

  it('今日で 1:00 より前なら 0:00 が上', () => {
    expect(initialScrollMinute(true, m('00:30'))).toBe(0)
    expect(initialScrollMinute(true, m('01:00'))).toBe(0)
    expect(initialScrollMinute(true, m('01:01'))).toBe(1)
  })

  it('ほかの日は 7:00 を上の端に（今の時刻に依らない）', () => {
    expect(initialScrollMinute(false, m('09:00'))).toBe(m('07:00'))
    expect(initialScrollMinute(false, 0)).toBe(m('07:00'))
  })

  it('今の時刻が数でない時は 0:00 が上', () => {
    expect(initialScrollMinute(true, Number.NaN)).toBe(0)
  })
})

describe('日をまたぐ予定の開始のカードの高さ（AMB-ITEMS-11・D39）', () => {
  it.each<[number, number]>([
    [120, START_CARD_PX],
    [41, 40],
    [40, 40],
    [30, 30],
    [24, 24],
    [16, 24],
    [0, 24],
    [Number.NaN, 24],
  ])('部分の高さ %ipx → カード %ipx（max(24, min(40, 部分))）', (piece, card) => {
    expect(startCardHeightPx(piece)).toBe(card)
  })

  it('1時間の高さ・最小の高さ・カードの高さの値（11.3）', () => {
    expect(HOUR_PX).toEqual({ LM: 48, S: 44 })
    expect(EVENT_MIN_PX).toBe(24)
    expect(START_CARD_PX).toBe(40)
  })
})
