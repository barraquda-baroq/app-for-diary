// ウィークリーの見た目の計算（docs/SPEC.md の 7.5・7.7・7.8・10.1〜10.4）: 日の見出し・区分ごとのレーン（どの列も同じ数の行）・
// 1日の予定の並び・見出しの行の数（119/120px）・線の引き方（6つの場合）・縦の並びのレールの線と「● 件名」の行・期間の表記の縮め方・
// カードの並べ方（狭い列）
import { describe, expect, it } from 'vitest'
import { calendarItems, type CalItem } from '../../../domain/calendar'
import { T0, mkItem, mkTask } from '../../../domain/testData'
import type { DayPart } from '../../../domain/tracks'
import type { Item } from '../../../domain/types'
import {
  buildWeek,
  cardLayout,
  horizontalCardTextPx,
  horizontalLine,
  laneMarksBelow,
  laneTop,
  marksPx,
  MIN_TITLE_PX,
  monoTextPx,
  periodDatesOnly,
  railSegment,
  railsPx,
  receivedTextPx,
  verticalCardTextPx,
  verticalCardTop,
  WEEK_PX,
  weekColumnPx,
  weekHalfPx,
  weekHeadRows,
  type WeekLane,
} from './weekModel'

/** 2026-11-08（日）〜11-14（土）の週 */
const SUN = '2026-11-08'
const DATES = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const cal = (...items: Item[]): CalItem[] => calendarItems(Object.fromEntries(items.map((it) => [it.id, it])))
const NO_OFF: ReadonlySet<string> = new Set()
/** 複数日の予定（仕事） */
const span = (id: string, start: string, due: string, p: Partial<Item> = {}) => mkItem({ id, title: id, start, due, ...p })
const ids = (list: readonly CalItem[]) => list.map((c) => c.item.id)

describe('日の見出し（10.2・10.4・7.2・7.4）', () => {
  it('日曜から土曜の7日、等幅の「11/8」（0 で埋めない）・休み・今日・祝日名', () => {
    const m = buildWeek('2026-11-22', [], new Set(['2026-11-23', '2026-11-25']), '2026-11-24')
    expect(m.sunday).toBe('2026-11-22')
    expect(m.saturday).toBe('2026-11-28')
    expect(m.days.map((d) => d.md)).toEqual(['11/22', '11/23', '11/24', '11/25', '11/26', '11/27', '11/28'])
    expect(m.days.filter((d) => d.off).map((d) => d.date)).toEqual(['2026-11-23', '2026-11-25'])
    expect(m.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-11-24'])
    expect(m.days[1].holiday).toBe('勤労感謝の日')
    expect(m.days.filter((d) => d.holiday)).toHaveLength(1)
  })

  it('年をまたぐ週も7日続く（12/27〜1/2）', () => {
    const m = buildWeek('2026-12-27', [], NO_OFF, '2026-11-10')
    expect(m.days.map((d) => d.md)).toEqual(['12/27', '12/28', '12/29', '12/30', '12/31', '1/1', '1/2'])
    expect(m.days[5].holiday).toBe('元日')
  })

  it.each([
    [0, 1],
    [72, 2],
    [100, 2],
    [119, 2],
    [119.9, 2],
    [120, 1],
    [142, 1],
  ] as const)('列の幅 %spx → 見出しは %s 行（120px より狭いと2行・64px。測れていない 0 は1行）', (px, rows) => {
    expect(weekHeadRows(px)).toBe(rows)
  })

  it('見出しの高さは 52px（1行）・64px（2行）、縦のかたまりの見出しは 32px', () => {
    expect(WEEK_PX.head).toEqual({ 1: 52, 2: 64 })
    expect(WEEK_PX.blockHead).toBe(32)
  })

  it('列の幅は領域の幅の 1/7（最小 72px。領域が 504px より狭いと横にスクロール）。縦の半分は (領域 − 1px) / 2', () => {
    expect(weekColumnPx(994)).toBeCloseTo(142)
    expect(weekColumnPx(504)).toBe(72)
    expect(weekColumnPx(400)).toBe(72)
    expect(weekColumnPx(0)).toBe(0)
    expect(weekHalfPx(341)).toBe(170)
    expect(weekHalfPx(0)).toBe(0)
  })
})

describe('区分ごとのレーン（7.8・CALENDAR-125〜129）', () => {
  const list = cal(
    span('a', '2026-11-05', '2026-11-10'), // 前の週から
    span('b', '2026-11-09', '2026-11-12', { startTime: '10:00', endTime: '18:00' }),
    span('c', '2026-11-10', '2026-11-13'),
    span('p', '2026-11-11', '2026-11-12', { kind: 'private' }),
    mkItem({ id: 's1', start: '2026-11-10' }),
  )
  const m = buildWeek(SUN, list, NO_OFF, '2026-11-10')

  it('レーンは区分ごと（仕事とプライベートは別々）', () => {
    expect(m.kinds.work.laneCount).toBe(3)
    expect(m.kinds.private.laneCount).toBe(1)
    expect(m.kinds.work.lanes.map((l) => [l.id, l.lane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
  })

  it('どの列にもレーンの数だけの行（40px ずつ）を取り、1日のカードの上の端がそろう（ITEMS-067）', () => {
    for (const d of DATES) expect(m.kinds.work.slots[d]).toHaveLength(3)
    expect(m.kinds.work.slots['2026-11-08'].map((s) => s?.lane.id ?? null)).toEqual(['a', null, null])
    expect(m.kinds.work.slots['2026-11-10'].map((s) => s?.lane.id ?? null)).toEqual(['a', 'b', 'c'])
    expect(m.kinds.work.slots['2026-11-14'].map((s) => s?.lane.id ?? null)).toEqual([null, null, null])
    expect(laneTop(0)).toBe(0)
    expect(laneTop(3)).toBe(120)
    expect(WEEK_PX.lane).toBe(40)
    expect(WEEK_PX.laneCard).toBe(36)
    expect(WEEK_PX.lineY).toBe(18)
  })

  it('1日の予定はレーンに入れず、その日の1日の予定に並べる（CALENDAR-128）', () => {
    expect(ids(m.kinds.work.singles['2026-11-10'])).toEqual(['s1'])
    expect(m.kinds.work.lanes.find((l) => l.id === 's1')).toBeUndefined()
    expect(Object.keys(m.kinds.work.singles)).toEqual(DATES)
  })

  it('レーンは予定（CalItem）をそのまま持つ（記録ごとの memo の部品にそのまま渡せる）', () => {
    expect(m.kinds.work.lanes[1].c).toBe(list.find((c) => c.item.id === 'b'))
  })

  it('完了した複数日の予定もレーンの位置に残す（7.5）', () => {
    const done = buildWeek(
      SUN,
      cal(span('a', '2026-11-09', '2026-11-11', { done: true }), span('b', '2026-11-10', '2026-11-12')),
      NO_OFF,
      '2026-11-10',
    )
    expect(done.kinds.work.lanes.map((l) => [l.id, l.lane])).toEqual([
      ['a', 0],
      ['b', 1],
    ])
  })

  it('週の中で月が変わっても線は切らない（11/29〜12/5 の週の 11/30 → 12/1。CALENDAR-123）', () => {
    const w = buildWeek('2026-11-29', cal(span('m', '2026-11-30', '2026-12-02')), NO_OFF, '2026-11-10')
    const parts = w.kinds.work.lanes[0].parts
    expect(parts.map((p) => p.date)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02'])
    expect(parts.map(horizontalLine)).toEqual(['from-card', 'through', 'to-dot'])
  })
})

describe('1日の予定の並び（7.5）', () => {
  it('時刻のある物（開始 → 終了。終了の無い物は開始 + 30分）→ 時刻の無い物（作った順）→ 完了した物', () => {
    const list = cal(
      mkItem({ id: 'untimed2', order: T0 + 2 }),
      mkItem({ id: 'done', order: T0, done: true, startTime: '08:00' }),
      mkItem({ id: 'untimed1', order: T0 + 1 }),
      mkItem({ id: 't10-11', startTime: '10:00', endTime: '11:00' }),
      mkItem({ id: 't10', startTime: '10:00' }),
      mkItem({ id: 't9', startTime: '09:00', endTime: '12:00' }),
    )
    const m = buildWeek(SUN, list, NO_OFF, '2026-11-10')
    expect(ids(m.kinds.work.singles['2026-11-10'])).toEqual(['t9', 't10', 't10-11', 'untimed1', 'untimed2', 'done'])
  })

  it('list 生まれの〆は締め切り日の1日の予定（6.3）', () => {
    const m = buildWeek(SUN, cal(mkTask({ id: 'q', due: '2026-11-11' })), NO_OFF, '2026-11-10')
    expect(ids(m.kinds.work.singles['2026-11-11'])).toEqual(['q'])
  })
})

describe('7日を横の線の引き方（7.8・D42）', () => {
  const p = (x: Partial<DayPart>): DayPart => ({ date: '2026-11-10', ...x })
  it.each<[string, Partial<DayPart>, ReturnType<typeof horizontalLine>]>([
    ['始点のカードから次の日へ', { card: 'start', lineOut: true }, 'from-card'],
    ['受けた表示から次の日へ', { card: 'received', lineOut: true }, 'from-card'],
    ['週の中で終わる始点のカード（1日分しか無い時は線なし）', { card: 'start' }, null],
    ['間の日', { lineIn: true, lineOut: true }, 'through'],
    ['締め切り日（真ん中の●まで）', { lineIn: true, dot: 'center' }, 'to-dot'],
    ['次の週へ続く土曜（右の端の > まで）', { lineIn: true, lineOut: true, arrow: true }, 'to-arrow'],
    ['土曜に始まって縮むカード（線は引かない）', { card: 'start', shrink: true, lineOut: true, arrow: true }, null],
    ['受けた表示の中に●（線は引かない）', { card: 'received', dot: 'inCard' }, null],
  ])('%s', (_, part, expected) => {
    expect(horizontalLine(p(part))).toBe(expected)
  })

  it('土曜に始まって次の週へ続く物は、その週では縮めたカードと＞だけ（CALENDAR-121）', () => {
    const m = buildWeek(SUN, cal(span('s', '2026-11-14', '2026-11-16')), NO_OFF, '2026-11-10')
    const part = m.kinds.work.slots['2026-11-14'][0]?.part
    expect(part).toMatchObject({ card: 'start', shrink: true, arrow: true })
    expect(WEEK_PX.shrink).toBe(14)
  })

  it('前の週から続いて日曜に終わる物は、受けた表示の右の端の中に●（CALENDAR-122）', () => {
    const m = buildWeek(SUN, cal(span('e', '2026-11-04', '2026-11-08')), NO_OFF, '2026-11-10')
    expect(m.kinds.work.slots['2026-11-08'][0]?.part).toMatchObject({ card: 'received', dot: 'inCard' })
  })
})

describe('7日を縦のレール（10.4・D41）', () => {
  /** 5本のレーンになる仕事の予定（企画書・見積もり・契約の確認・納品の準備・請求の形） */
  const dense = cal(
    span('l0', '2026-11-08', '2026-11-11'),
    span('l1', '2026-11-08', '2026-11-10'),
    span('l2', '2026-11-09', '2026-11-13'),
    span('l3', '2026-11-09', '2026-11-12'),
    span('l4', '2026-11-10', '2026-11-13'),
    span('next', '2026-11-10', '2026-11-18', { order: T0 + 9 }),
  )
  const m = buildWeek(SUN, dense, NO_OFF, '2026-11-10')
  const w = m.kinds.work

  it('レールは最大3本（10px ずつ・左から 4・14・24px）、4本目のレーンからはレールに載せない', () => {
    expect(w.laneCount).toBe(6)
    expect(w.rails).toBe(3)
    expect(railsPx(w.rails)).toBe(30)
    expect(w.lanes.filter((l) => l.rail).map((l) => l.id)).toEqual(['l0', 'l1', 'l2'])
    expect(w.lanes.filter((l) => !l.rail).map((l) => l.id)).toEqual(['l3', 'next', 'l4'])
    expect(w.vertical['2026-11-08'].rails.map((r) => r.x)).toEqual([4, 14])
  })

  it('4本目のレーンからの予定は、締め切り日の半分のいちばん上に「● 件名」の行（次の週へ続く物は出さない。AMB-ITEMS-17）', () => {
    expect(w.vertical['2026-11-12'].overflowRows.map((l) => l.id)).toEqual(['l3'])
    expect(w.vertical['2026-11-13'].overflowRows.map((l) => l.id)).toEqual(['l4'])
    for (const d of DATES) expect(w.vertical[d].overflowRows.map((l) => l.id)).not.toContain('next')
  })

  it('始点のカード・受けた表示は、その日の半分の「● 件名」の行の下にレーンの順で並べる（上の位置 px）', () => {
    expect(w.vertical['2026-11-09'].cards.map((x) => [x.lane.id, x.top])).toEqual([
      ['l2', 4],
      ['l3', 44],
    ])
    expect(verticalCardTop(0, 0)).toBe(WEEK_PX.halfTop)
    expect(verticalCardTop(1, 1)).toBe(4 + 24 + 40)
  })

  it('線は始点のカードの高さの真ん中から下の端まで → 間の日は上から下まで → 締め切り日は上から●まで', () => {
    const at = (d: string, id: string) => w.vertical[d].rails.find((r) => r.lane.id === id)
    expect(at('2026-11-09', 'l2')).toMatchObject({ x: 24, top: 4 + 18, bottom: 'end' })
    expect(at('2026-11-10', 'l2')).toMatchObject({ top: 0, bottom: 'end' })
    expect(at('2026-11-13', 'l2')).toMatchObject({ top: 0, bottom: WEEK_PX.railDotY, dotY: WEEK_PX.railDotY })
    // 4本目のレーンからの物は線を引かない
    expect(Object.values(w.vertical).flatMap((h) => h.rails.map((r) => r.lane.id))).not.toContain('l3')
  })

  const lane = (over: Partial<WeekLane> = {}): WeekLane =>
    ({
      id: 'x',
      lane: 1,
      from: SUN,
      to: SUN,
      startsBefore: false,
      endsAfter: false,
      c: dense[0],
      parts: [],
      rail: true,
      ...over,
    }) as WeekLane

  it.each<[string, Partial<DayPart>, number | null, object | null]>([
    ['始点のカードから下へ', { card: 'start', lineOut: true }, 44, { x: 14, top: 62, bottom: 'end' }],
    [
      '土曜に始まって次の週へ（縮めずに下の端の矢印まで）',
      { card: 'start', shrink: true, lineOut: true, arrow: true },
      4,
      { top: 22, bottom: 'end', arrow: true },
    ],
    ['受けた表示から下へ', { card: 'received', lineOut: true }, 4, { top: 22, bottom: 'end' }],
    ['受けた表示の中に●（線なし）', { card: 'received', dot: 'inCard' }, 4, null],
    ['間の日', { lineIn: true, lineOut: true }, null, { top: 0, bottom: 'end' }],
    [
      '次の週へ続く土曜（下の端の矢印）',
      { lineIn: true, lineOut: true, arrow: true },
      null,
      { top: 0, bottom: 'end', arrow: true },
    ],
    ['締め切り日（上から●まで）', { lineIn: true, dot: 'center' }, null, { top: 0, bottom: 14, dotY: 14 }],
  ])('%s', (_, part, cardTop, expected) => {
    const seg = railSegment(lane(), { date: SUN, ...part }, cardTop)
    if (expected === null) expect(seg).toBeNull()
    else expect(seg).toMatchObject(expected)
  })
})

describe('始点のカードの期間（7.7・10.2・CALENDAR-130）', () => {
  const timed = cal(span('t', '2026-11-28', '2026-12-02', { startTime: '10:00', endTime: '15:00' }))[0]
  const untimed = cal(span('u', '2026-11-28', '2026-12-02'))[0]

  it('等幅の字の幅: 英数字は 0.6 字、〜 などの全角は 1 字', () => {
    expect(monoTextPx('11/28')).toBe(30)
    expect(monoTextPx('〜12/2')).toBe(10 + 24)
  })

  it('カードに入る時はそのまま、入らない時は時刻を省いて日付だけ（11/28〜12/2）', () => {
    // 「11/28 10:00〜12/2 15:00」は 22 字 ≒ 136px
    expect(periodDatesOnly(timed, '2026-11-28', 200)).toBe(false)
    expect(periodDatesOnly(timed, '2026-11-28', 120)).toBe(true)
    // 時刻の無い物は省く時刻が無い（〜12/2 のまま）
    expect(periodDatesOnly(untimed, '2026-11-28', 20)).toBe(false)
    // 幅が測れていない時はそのまま
    expect(periodDatesOnly(timed, '2026-11-28', 0)).toBe(false)
  })

  it('期間の行は右上の印の分だけ狭い（印の付いた予定は、印の無い物なら入る幅でも日付だけ）', () => {
    const locked = cal(span('t', '2026-11-28', '2026-12-02', { startTime: '10:00', endTime: '15:00', locked: true }))[0]
    // 136px の期間: 145px なら入る（余裕 4px）が、ロックの印 16px の分を引くと入らない
    expect(periodDatesOnly(timed, '2026-11-28', 145)).toBe(false)
    expect(periodDatesOnly(locked, '2026-11-28', 145)).toBe(true)
  })

  it('カードの字の幅: 7日を横は列 − 8px − 余白と丸 42px（土曜で縮む時はさらに 14px）、縦は半分 − レールと余白', () => {
    expect(horizontalCardTextPx(142)).toBe(92)
    expect(horizontalCardTextPx(142, true)).toBe(78)
    expect(horizontalCardTextPx(0)).toBe(0)
    expect(verticalCardTextPx(170, 3)).toBe(170 - 34 - 4 - 42)
    expect(verticalCardTextPx(170, 0)).toBe(170 - 4 - 4 - 42)
  })

  it('受けた表示の字の幅: 同じ大きさの始点のカードから、丸の代わりに枠 1px と左右の余白 8px（中に●の時は右 22px）', () => {
    // 列 142px: カードの幅 134px − 枠 2px − 余白 16px
    expect(receivedTextPx(horizontalCardTextPx(142))).toBe(116)
    expect(receivedTextPx(horizontalCardTextPx(142), true)).toBe(102)
    expect(receivedTextPx(0)).toBe(0)
  })
})

describe('カードの並べ方（狭い列。開発）', () => {
  const plain = mkItem()
  const ai = mkItem({ by: 'connector', ai: 'claude', via: 'メール' })
  const due = mkTask({ due: '2026-11-11' })
  const locked = mkItem({ locked: true })

  it('印の幅: 〆 11・ロック 12・AI の札 42（「AI」は 22）と、それぞれ 4px のすき間', () => {
    expect(marksPx(plain)).toBe(0)
    expect(marksPx(due)).toBe(15)
    expect(marksPx(locked)).toBe(16)
    expect(marksPx(ai)).toBe(46)
    expect(marksPx(mkItem({ by: 'connector', ai: null }))).toBe(26)
    expect(marksPx({ ...due, locked: true, by: 'connector', ai: 'claude' })).toBe(15 + 16 + 46)
  })

  it.each<[string, Item, number, ReturnType<typeof cardLayout>]>([
    ['L の列（142px）・印なし', plain, 92, 'side'],
    ['L の列・ロック（件名に 76px 残る）', locked, 92, 'side'],
    ['L の列・AI の札（件名に 46px しか残らない）', ai, 92, 'stacked'],
    ['M の列（100px）・印なし', plain, 50, 'side'],
    ['M の列・〆', due, 50, 'stacked'],
    ['狭いウインドウの列（79px）・印なし', plain, 29, 'stacked'],
    ['狭いウインドウの列・AI の札（丸の行にも入らない）', ai, 29, 'marks-below'],
    ['幅が測れていない', ai, 0, 'side'],
  ])('%s → %s', (_, item, textPx, expected) => {
    expect(cardLayout(textPx, item)).toBe(expected)
  })

  it('印のあるカードは件名に MIN_TITLE_PX を残す', () => {
    expect(cardLayout(MIN_TITLE_PX + 16, locked)).toBe('side')
    expect(cardLayout(MIN_TITLE_PX + 15, locked)).toBe('stacked')
  })

  it.each<[string, number, boolean, Item]>([
    ['L の列（142px）・ロック', 92, false, locked],
    ['L の列・AI の札（件名に 46px しか残らない）', 92, true, ai],
    ['M の列（100px）・〆', 50, true, due],
    ['M の列・印なし（下へ移す印が無い）', 50, false, plain],
    ['幅が測れていない・AI の札', 0, false, ai],
  ])('始点のカード・受けた表示の印を下の行に置くか: %s（字の幅 %spx）→ %s', (_, textPx, expected, item) => {
    expect(laneMarksBelow(textPx, item)).toBe(expected)
  })
})
