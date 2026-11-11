// デイリーの見た目の計算（dayModel.ts。docs/SPEC.md の 11.1〜11.3・7.5・7.8・D39・AMB-ITEMS-11〜13・20・31）
import { describe, expect, it } from 'vitest'
import { calendarItems } from '../../../domain/calendar'
import { mkItem, mkTask } from '../../../domain/testData'
import type { Item } from '../../../domain/types'
import {
  buildDay,
  buildSection,
  buildTimeline,
  hourPxOf,
  initialScrollPx,
  maxColsOf,
  minuteOfDay,
  minuteToPx,
  pxToMinute,
} from './dayModel'

const D = '2026-11-10'

/** 予定の一覧（useCalendarData と同じ calendarItems を通した物） */
const listOf = (...items: Item[]) => calendarItems(Object.fromEntries(items.map((it) => [it.id, it])))

const timed = (id: string, startTime: string, endTime: string | null, p: Partial<Item> = {}) =>
  mkItem({ id, title: id, start: D, startTime, endTime, ...p })

describe('大きさと px（11.3）', () => {
  it('1時間の高さは L・M 48px、S 44px。列は L・M 4つ、S 3つまで', () => {
    expect([hourPxOf('L'), hourPxOf('M'), hourPxOf('S')]).toEqual([48, 48, 44])
    expect([maxColsOf('L'), maxColsOf('M'), maxColsOf('S')]).toEqual([4, 4, 3])
  })

  it.each([
    [0, 48, 0],
    [60, 48, 48],
    [13 * 60 + 10, 48, 632],
    [1440, 48, 1152],
    [90, 44, 66],
    [1440, 44, 1056],
  ])('%i 分 → 1時間 %ipx で %ipx', (minute, hourPx, px) => {
    expect(minuteToPx(minute, hourPx)).toBe(px)
  })

  it('押した所の px → 分（0〜1440 に収める。空いた所を押した時の時刻）', () => {
    expect(pxToMinute(632, 48)).toBe(790) // 13:10
    expect(pxToMinute(-10, 48)).toBe(0)
    expect(pxToMinute(5000, 44)).toBe(1440)
    expect(pxToMinute(Number.NaN, 48)).toBe(0)
  })

  it('今の時刻の 0:00 からの分（端末の暦）', () => {
    expect(minuteOfDay(new Date(2026, 10, 10, 9, 0).getTime())).toBe(540)
    expect(minuteOfDay(new Date(2026, 10, 10, 23, 59, 59).getTime())).toBe(1439)
  })

  it('開いた時の位置: 今日は今の 60分前、1:00 より前なら 0:00、ほかの日は 7:00（ITEMS-132）', () => {
    expect(initialScrollPx(true, 9 * 60, 48)).toBe(8 * 48)
    expect(initialScrollPx(true, 30, 48)).toBe(0)
    expect(initialScrollPx(false, 9 * 60, 48)).toBe(7 * 48)
    expect(initialScrollPx(false, 9 * 60, 44)).toBe(7 * 44)
  })
})

describe('日の見出し（11.1・D21・D40）', () => {
  it('「2026.11.10」・今日・休み・祝日名', () => {
    const vm = buildDay('2026-11-03', [], new Set(['2026-11-03']), D, 'L')
    expect(vm.head).toEqual({ date: '2026-11-03', dotted: '2026.11.03', isToday: false, off: true, holiday: '文化の日' })
    expect(buildDay(D, [], new Set(), D, 'L').head).toMatchObject({ isToday: true, off: false, holiday: null })
  })

  it('振替休日・国民の休日は短い名前（D21）', () => {
    expect(buildDay('2026-05-06', [], new Set(), D, 'L').head.holiday).toBe('振替休日')
    expect(buildDay('2026-09-22', [], new Set(), D, 'L').head.holiday).toBe('国民の休日')
  })
})

describe('時間指定なしのリスト（11.2・7.5）', () => {
  it('上＝仕事・下＝プライベート。時刻のある物は入れない（タイムスケジュールへ）', () => {
    const list = listOf(mkItem({ id: 'w1', kind: 'work' }), mkItem({ id: 'p1', kind: 'private' }), timed('t1', '10:00', '11:00'))
    const vm = buildDay(D, list, new Set(), D, 'L')
    expect(vm.sections.map((s) => s.kind)).toEqual(['work', 'private'])
    expect(vm.sections[0].rows.map((r) => r.c.item.id)).toEqual(['w1'])
    expect(vm.sections[1].rows.map((r) => r.c.item.id)).toEqual(['p1'])
  })

  it('見出しの数は、まだ完了していない予定の全部（時刻のある物も含む。ITEMS-112）', () => {
    const list = listOf(
      mkItem({ id: 'a' }),
      mkItem({ id: 'b', done: true }),
      timed('c', '10:00', null),
      mkItem({ id: 'd', kind: 'private' }),
    )
    const [work, priv] = buildDay(D, list, new Set(), D, 'L').sections
    expect(work.undone).toBe(2)
    expect(priv.undone).toBe(1)
  })

  it('並び: 複数日（開始の早い順 → 締め切りの遅い順）→ 1日（作った順）→ 完了した物（完了した複数日が先頭）', () => {
    const list = listOf(
      mkItem({ id: 'single-late', order: 20 }),
      mkItem({ id: 'single-early', order: 10 }),
      mkItem({ id: 'multi-short', start: '2026-11-09', due: '2026-11-11' }),
      mkItem({ id: 'multi-long', start: '2026-11-09', due: '2026-11-14' }),
      mkItem({ id: 'multi-late', start: D, due: '2026-11-12' }),
      mkItem({ id: 'done-single', order: 1, done: true }),
      mkItem({ id: 'done-multi', start: '2026-11-08', due: '2026-11-11', done: true }),
    )
    expect(buildSection(list, D, 'work').rows.map((r) => r.c.item.id)).toEqual([
      'multi-long',
      'multi-short',
      'multi-late',
      'single-early',
      'single-late',
      'done-multi',
      'done-single',
    ])
  })

  it('複数日の右の端: 初日「━＞ 〜11/12」、間の日は受けた表示で「━＞」、最終日は受けた表示で「━●」（ITEMS-120）', () => {
    const list = listOf(
      mkItem({ id: 'first', start: D, due: '2026-11-12' }),
      mkItem({ id: 'middle', start: '2026-11-09', due: '2026-11-11' }),
      mkItem({ id: 'last', start: '2026-11-08', due: D }),
      mkItem({ id: 'single' }),
    )
    const rows = Object.fromEntries(buildSection(list, D, 'work').rows.map((r) => [r.c.item.id, r]))
    expect(rows.first).toMatchObject({ role: 'first', tail: { mark: '━＞', range: '〜11/12', received: false } })
    expect(rows.middle).toMatchObject({ role: 'middle', tail: { mark: '━＞', range: '〜11/11', received: true } })
    expect(rows.last).toMatchObject({ role: 'last', tail: { mark: '━●', range: null, received: true } })
    expect(rows.single).toMatchObject({ role: 'single', tail: null })
  })

  it('〆の list 生まれ（締め切りの日の1日の予定）も出る。日付の無い Task List だけの物は出ない', () => {
    const list = listOf(mkTask({ id: 'due', due: D }), mkTask({ id: 'none' }))
    expect(buildSection(list, D, 'work').rows.map((r) => r.c.item.id)).toEqual(['due'])
  })
})

describe('タイムスケジュール（11.3・ITEMS-133・142〜147）', () => {
  it('1日の予定の枠: 上の端と高さは時刻から。開始だけは +30分、どれも最小 24px', () => {
    const tl = buildTimeline(
      listOf(timed('a', '10:00', '11:30'), timed('b', '13:00', null), timed('c', '15:00', '15:10')),
      D,
      'L',
    )
    const box = Object.fromEntries(tl.boxes.map((b) => [b.c.item.id, b]))
    expect(box.a).toMatchObject({ top: 480, height: 72, part: 'single', ring: true, received: false, endMark: null })
    expect(box.b).toMatchObject({ top: 624, height: 24, compact: true, lines: 1 })
    expect(box.c).toMatchObject({ top: 720, height: 24 })
    expect(tl).toMatchObject({ hourPx: 48, dayPx: 1152, tailPx: 0, more: [] })
  })

  it('S は 1時間 44px', () => {
    const tl = buildTimeline(listOf(timed('a', '10:00', '11:00')), D, 'S')
    expect(tl.boxes[0]).toMatchObject({ top: 440, height: 44 })
    expect(tl.dayPx).toBe(1056)
  })

  it.each([
    // [長さ（分）, 高さ px, 1行にまとめるか, 件名の行の数]
    [10, 24, true, 1],
    [48, 38.4, true, 1],
    [50, 40, false, 1],
    [70, 56, false, 2],
    [90, 72, false, 3],
    [120, 96, false, 4],
  ])('%i 分の枠（%spx）: 1行にまとめる %s・件名 %i 行（入るだけ）', (minutes, px, compact, lines) => {
    const end = 600 + minutes
    const hm = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
    const [b] = buildTimeline(listOf(timed('a', '10:00', hm)), D, 'L').boxes
    expect(b.height).toBeCloseTo(px, 6)
    expect([b.compact, b.lines]).toEqual([compact, lines])
  })

  it('重なる5件: L は4列＋「+1」、S は3列＋「+2」（札は隠れた予定のいちばん早い時刻。ITEMS-147）', () => {
    const list = listOf(
      timed('a', '14:00', '15:30'),
      timed('b', '14:00', '15:30'),
      timed('c', '14:15', '15:30'),
      timed('d', '14:30', '15:30'),
      timed('e', '14:45', '15:30'),
    )
    const l = buildTimeline(list, D, 'L')
    expect(l.boxes.map((b) => [b.c.item.id, b.col, b.cols])).toEqual([
      ['a', 0, 4],
      ['b', 1, 4],
      ['c', 2, 4],
      ['d', 3, 4],
    ])
    expect(l.more).toMatchObject([{ at: 14 * 60 + 45, top: 708, ids: ['e'] }])
    // 一覧に出す隠れた予定
    expect(l.more[0].items.map((c) => c.item.id)).toEqual(['e'])
    // 札を出すまとまりは右の端に札の所を1つ空けて等分する（札を予定に重ねない）
    expect(l.boxes.map((b) => [b.x, b.xRoom, b.w, b.wRoom])).toEqual([
      [0, 0, 0.25, 0.25],
      [0.25, 0.25, 0.25, 0.25],
      [0.5, 0.5, 0.25, 0.25],
      [0.75, 0.75, 0.25, 0.25],
    ])
    const s = buildTimeline(list, D, 'S')
    expect(s.boxes.map((b) => b.c.item.id)).toEqual(['a', 'b', 'c'])
    expect(s.more).toMatchObject([{ at: 14 * 60 + 30, top: minuteToPx(14 * 60 + 30, 44), ids: ['d', 'e'] }])
    expect(s.more[0].items.map((c) => c.item.id)).toEqual(['d', 'e'])
  })

  it('区分は混ぜて並べる（仕事とプライベートが同じまとまりに入る）', () => {
    const tl = buildTimeline(listOf(timed('w', '10:00', '11:00'), timed('p', '10:30', '11:30', { kind: 'private' })), D, 'L')
    expect(tl.boxes.map((b) => [b.c.item.id, b.col, b.cols, b.x, b.w])).toEqual([
      ['w', 0, 2, 0, 0.5],
      ['p', 1, 2, 0.5, 0.5],
    ])
  })

  it('日をまたぐ予定: 初日は開始〜24:00（丸あり・矢印）、間の日は 0〜24（「‹ 」・矢印）、最終日は 0〜終了（「‹ 」・●）', () => {
    const item = mkItem({ id: 'm', start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '15:00' })
    const on = (date: string) => buildTimeline(listOf(item), date, 'L').boxes[0]
    expect(on('2026-11-09')).toMatchObject({
      part: 'first',
      top: 480,
      height: 672,
      card: 40,
      line: true,
      endMark: 'arrow',
      ring: true,
      received: false,
      compact: false,
      lines: 1,
    })
    expect(on(D)).toMatchObject({
      part: 'middle',
      top: 0,
      height: 1152,
      card: 40,
      line: true,
      endMark: 'arrow',
      ring: false,
      received: true,
    })
    expect(on('2026-11-11')).toMatchObject({ part: 'last', top: 0, height: 720, endMark: 'dot', ring: false, received: true })
  })

  it('開始のカードの高さは max(24, min(40, 部分の高さ))。部分がカードより短い時は線を引かない（AMB-ITEMS-11）', () => {
    // 最終日が 0:20 に終わる（16px → カード 24px・線なし・●はカードの中）
    const short = mkItem({ id: 's', start: '2026-11-09', due: D, startTime: '22:00', endTime: '00:20' })
    expect(buildTimeline(listOf(short), D, 'L').boxes[0]).toMatchObject({
      part: 'last',
      height: 24,
      card: 24,
      line: false,
      endMark: 'dot',
      compact: true,
    })
    // 最終日が 0:45 に終わる（36px → カード 36px・線なし）
    const mid = mkItem({ id: 'm', start: '2026-11-09', due: D, startTime: '22:00', endTime: '00:45' })
    expect(buildTimeline(listOf(mid), D, 'L').boxes[0]).toMatchObject({ height: 36, card: 36, line: false })
    // 最終日が 2:00 に終わる（96px → カード 40px・線あり）
    const long = mkItem({ id: 'l', start: '2026-11-09', due: D, startTime: '22:00', endTime: '02:00' })
    expect(buildTimeline(listOf(long), D, 'L').boxes[0]).toMatchObject({ height: 96, card: 40, line: true })
  })

  it.each([
    // [その日, 開始, 終了, 部分の px, 線を引くか]
    ['最終日 0:55 まで', '2026-11-09', D, '22:00', '00:55', 44, false],
    ['最終日 1:00 まで', '2026-11-09', D, '22:00', '01:00', 48, false],
    ['最終日 1:10 まで', '2026-11-09', D, '22:00', '01:10', 56, true],
    ['初日 23:05 から', D, '2026-11-11', '23:05', '01:00', 44, false],
    ['初日 22:50 から', D, '2026-11-11', '22:50', '01:00', 56, true],
  ])(
    '部分がカードより少しだけ長い時（%s）も、カードの下に●・矢印を出す所が無ければ線を引かず、印をカードの中に（AMB-ITEMS-11）',
    (_, start, due, startTime, endTime, piecePx, line) => {
      const item = mkItem({ id: 'x', start, due, startTime, endTime })
      const [b] = buildTimeline(listOf(item), D, 'L').boxes
      expect(b).toMatchObject({ height: piecePx, card: 40, line })
    },
  )

  it('24:00 の近くの短い予定は、24:00 の下へ出る分だけ下に余白を足す（枠を動かさない。layoutPieces と同じ見え方）', () => {
    const tl = buildTimeline(listOf(timed('late', '23:50', null)), D, 'L')
    expect(tl.boxes[0]).toMatchObject({ top: 1144, height: 24 })
    expect(tl.tailPx).toBe(16)
    // 初日が 23:40 に始まる日をまたぐ予定（部分 16px → カード 24px）も同じ
    const night = mkItem({ id: 'n', start: D, due: '2026-11-11', startTime: '23:40', endTime: '01:00' })
    expect(buildTimeline(listOf(night), D, 'L').tailPx).toBe(8)
  })

  it.each(['S', 'M', 'L'] as const)(
    '%s: 日をまたぐ予定の間の日（0〜24）は左の列（1/3）。ほかの予定は、本当に重なる物（レビューと面談）だけが細くなる（見本の 11/10）',
    (width) => {
      const middle = mkItem({ id: 'm', start: '2026-11-09', due: '2026-11-12', startTime: '10:00', endTime: '18:00' })
      const tl = buildTimeline(
        listOf(
          middle,
          timed('weekly', '10:00', '11:30'),
          timed('meeting', '13:00', null),
          timed('review', '15:00', '16:00'),
          timed('interview', '15:30', '17:00'),
          timed('dinner', '19:00', '21:00', { kind: 'private' }),
        ),
        D,
        width,
      )
      const w = Object.fromEntries(tl.boxes.map((b) => [b.c.item.id, b.w]))
      expect(w.m).toBeCloseTo(1 / 3, 9)
      // 前はどれも 1/3 だった（間の日がその日のすべての予定を1つのまとまりにしていた）
      for (const id of ['weekly', 'meeting', 'dinner']) expect(w[id], id).toBeCloseTo(2 / 3, 9)
      for (const id of ['review', 'interview']) expect(w[id], id).toBeCloseTo(1 / 3, 9)
      expect(tl.boxes.find((b) => b.c.item.id === 'weekly')).toMatchObject({ xRoom: 0, wRoom: 0 })
      expect(tl.boxes.find((b) => b.c.item.id === 'weekly')?.x).toBeCloseTo(1 / 3, 9)
      expect(tl.more).toEqual([])
    },
  )

  it('完了した予定・ゴミ箱の物・時刻の無い物', () => {
    const tl = buildTimeline(listOf(timed('done', '10:00', '11:00', { done: true }), mkItem({ id: 'untimed' })), D, 'L')
    expect(tl.boxes.map((b) => b.c.item.id)).toEqual(['done'])
  })
})
