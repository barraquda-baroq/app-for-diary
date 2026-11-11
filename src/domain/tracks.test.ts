// 複数日の予定のレーン（docs/SPEC.md の 7.8・10.4・2.10）: レーンの割り付け（週の中に切り詰めた期間・3つの並び・前から順にいちばん上の
// レーン）・週ごと・区分ごと・完了した物もレーンに残る・週の中で月や年が変わっても線は切らない・日ごとに描く物（6つの場合）・
// 縦の並びのレール（0 から数えて 4・14・24px、最大3本、4本目のレーンからの物）
import { describe, expect, it } from 'vitest'
import { calendarItems } from './calendar'
import { T0, mkItem } from './testData'
import {
  assignLanes,
  laneParts,
  railSplit,
  railX,
  RAIL_MAX,
  RAIL_PX,
  weekLaneItems,
  type DayPart,
  type Lane,
  type LaneItem,
} from './tracks'
import type { Item } from './types'

/** 2026-11-08（日）〜11-14（土）の週 */
const SUN = '2026-11-08'
const li = (id: string, from: string, to: string, order = 0): LaneItem => ({ id, from, to, order })
/** id → レーンの番号 */
const laneOf = (r: { lanes: Lane[] }) => Object.fromEntries(r.lanes.map((l) => [l.id, l.lane]))
const cal = (...items: Item[]) => calendarItems(Object.fromEntries(items.map((it) => [it.id, it])))
/** その日の部分を短い文字にする（読みやすく比べるため） */
const brief = (p: DayPart) =>
  [
    p.date.slice(5),
    p.card,
    p.shrink && 'shrink',
    p.lineIn && 'in',
    p.lineOut && 'out',
    p.dot && `dot:${p.dot}`,
    p.arrow && 'arrow',
  ]
    .filter(Boolean)
    .join(' ')
/** 1つの予定だけのレーンの日ごとの部分 */
const partsOf = (from: string, to: string, sunday = SUN) => {
  const { lanes } = assignLanes([li('a', from, to)], sunday)
  return laneParts(lanes[0], sunday).map(brief)
}

describe('レーンの割り付け（7.8。CALENDAR-125）', () => {
  it('前から順に「そのレーンの最後の予定の終わり < この予定の始まり」となる、いちばん上のレーンに入れる', () => {
    const r = assignLanes(
      [
        li('a', '2026-11-08', '2026-11-10'),
        li('b', '2026-11-09', '2026-11-12'),
        li('c', '2026-11-11', '2026-11-13'),
        li('d', '2026-11-13', '2026-11-14'),
        li('e', '2026-11-12', '2026-11-13'),
      ],
      SUN,
    )
    // a(8〜10) → 0、b(9〜12) → 1、c(11〜13) → 0（a は 10 に終わる）、e(12〜13) → 2（0 は 13、1 は 12 まで）、d(13〜14) → 1
    expect(laneOf(r)).toEqual({ a: 0, b: 1, c: 0, e: 2, d: 1 })
    expect(r.count).toBe(3)
    expect(r.lanes.map((l) => l.id)).toEqual(['a', 'b', 'c', 'e', 'd'])
  })

  it('同じ日に終わって始まる物は同じレーンに入れない（終わり < 始まり。同じ日は重なる）', () => {
    const r = assignLanes([li('a', '2026-11-08', '2026-11-10'), li('b', '2026-11-10', '2026-11-12')], SUN)
    expect(laneOf(r)).toEqual({ a: 0, b: 1 })
    expect(r.count).toBe(2)
  })

  it('週の中に切り詰める: max(from, 日曜)〜min(to, 土曜)。前の週から・次の週へ続く印', () => {
    const r = assignLanes(
      [li('before', '2026-11-04', '2026-11-10'), li('after', '2026-11-12', '2026-11-18'), li('both', '2026-11-01', '2026-11-30')],
      SUN,
    )
    const by = Object.fromEntries(r.lanes.map((l) => [l.id, l]))
    expect(by.before).toMatchObject({ from: '2026-11-08', to: '2026-11-10', startsBefore: true, endsAfter: false })
    expect(by.after).toMatchObject({ from: '2026-11-12', to: '2026-11-14', startsBefore: false, endsAfter: true })
    expect(by.both).toMatchObject({ from: '2026-11-08', to: '2026-11-14', startsBefore: true, endsAfter: true })
  })

  it('週に掛からない物は入れない（前の土曜に終わる・次の日曜に始まる物）。週の端の日に掛かる物は入れる', () => {
    const r = assignLanes(
      [
        li('prev', '2026-11-01', '2026-11-07'),
        li('next', '2026-11-15', '2026-11-16'),
        li('sun', '2026-11-05', '2026-11-08'),
        li('sat', '2026-11-14', '2026-11-20'),
      ],
      SUN,
    )
    expect(r.lanes.map((l) => l.id).sort()).toEqual(['sat', 'sun'])
    expect(r.count).toBe(1)
  })

  it('並びは切り詰めた期間で: 始まりの早い順 → 終わりの遅い順 → 作った順（order → id）', () => {
    // x は 11/4〜11/10（切り詰めて 11/8〜11/10）、y は 11/8〜11/12: 切り詰めた始まりが同じなので、終わりの遅い y が先
    expect(laneOf(assignLanes([li('x', '2026-11-04', '2026-11-10'), li('y', '2026-11-08', '2026-11-12')], SUN))).toEqual({
      y: 0,
      x: 1,
    })
    // 11/9〜11/20 と 11/9〜11/30 は切り詰めると同じ 11/9〜11/14: 作った順
    expect(
      laneOf(assignLanes([li('late', '2026-11-09', '2026-11-30', 5), li('early', '2026-11-09', '2026-11-20', 2)], SUN)),
    ).toEqual({ early: 0, late: 1 })
    // 期間も order も同じなら id の順
    expect(laneOf(assignLanes([li('b', '2026-11-09', '2026-11-11', 1), li('a', '2026-11-09', '2026-11-11', 1)], SUN))).toEqual({
      a: 0,
      b: 1,
    })
  })

  it('渡す順で変わらない', () => {
    const items = [
      li('a', '2026-11-01', '2026-11-10', 3),
      li('b', '2026-11-09', '2026-11-12', 1),
      li('c', '2026-11-11', '2026-11-20', 2),
      li('d', '2026-11-09', '2026-11-12', 1),
    ]
    const expected = laneOf(assignLanes(items, SUN))
    expect(laneOf(assignLanes([...items].reverse(), SUN))).toEqual(expected)
    expect(laneOf(assignLanes([items[2], items[0], items[3], items[1]], SUN))).toEqual(expected)
  })

  it('予定の無い週はレーン 0 本。from > to の物（修復の前の形）は入れない', () => {
    expect(assignLanes([], SUN)).toEqual({ lanes: [], count: 0 })
    expect(assignLanes([li('bad', '2026-11-12', '2026-11-10')], SUN)).toEqual({ lanes: [], count: 0 })
  })
})

describe('週ごと・区分ごと・完了した物（7.8・7.5。CALENDAR-126）', () => {
  const m = (p: Partial<Item>) => mkItem({ start: '2026-11-09', due: '2026-11-11', ...p })

  it('仕事とプライベートのレーンは別々（同じ期間でも、それぞれレーン 0）', () => {
    const list = cal(m({ id: 'w1' }), m({ id: 'w2', order: T0 + 1 }), m({ id: 'p1', kind: 'private' }))
    const work = assignLanes(weekLaneItems(list, SUN, 'work'), SUN)
    const priv = assignLanes(weekLaneItems(list, SUN, 'private'), SUN)
    expect(laneOf(work)).toEqual({ w1: 0, w2: 1 })
    expect(laneOf(priv)).toEqual({ p1: 0 })
    expect([work.count, priv.count]).toEqual([2, 1])
  })

  it('レーンに入れるのは複数日の予定だけ（1日の予定はすべてのレーンの下に並べる。週に掛からない物も入れない）', () => {
    const list = cal(
      m({ id: 'multi' }),
      mkItem({ id: 'single', start: '2026-11-10' }),
      mkItem({ id: 'timed', start: '2026-11-10', startTime: '10:00', endTime: '11:00' }),
      m({ id: 'nextWeek', start: '2026-11-15', due: '2026-11-17' }),
    )
    expect(weekLaneItems(list, SUN, 'work')).toEqual([{ id: 'multi', from: '2026-11-09', to: '2026-11-11', order: T0 }])
  })

  it('時刻のある複数日の予定もレーンに入れる（期間の表記に時刻を出す。7.8）', () => {
    const list = cal(m({ id: 'timed', startTime: '10:00', endTime: '18:00' }))
    expect(weekLaneItems(list, SUN, 'work').map((l) => l.id)).toEqual(['timed'])
  })

  it('完了した複数日の予定もレーンの位置に残る（線をつなぐため。完了しても割り付けは変わらない）', () => {
    const items = [
      m({ id: 'a', start: '2026-11-08', due: '2026-11-10', order: 1 }),
      m({ id: 'b', start: '2026-11-09', due: '2026-11-12', order: 2 }),
      m({ id: 'c', start: '2026-11-11', due: '2026-11-13', order: 3 }),
    ]
    const open = laneOf(assignLanes(weekLaneItems(cal(...items), SUN, 'work'), SUN))
    const done = cal(...items.map((it) => (it.id === 'a' ? { ...it, done: true } : it)))
    expect(laneOf(assignLanes(weekLaneItems(done, SUN, 'work'), SUN))).toEqual(open)
    expect(open).toEqual({ a: 0, b: 1, c: 0 })
  })

  it('割り付けは週ごと: 次の週では前の週から続く物も、その週の中で割り付け直す', () => {
    const list = cal(
      m({ id: 'long', start: '2026-11-10', due: '2026-11-17', order: 1 }),
      m({ id: 'short', start: '2026-11-09', due: '2026-11-11', order: 2 }),
    )
    expect(laneOf(assignLanes(weekLaneItems(list, SUN, 'work'), SUN))).toEqual({ short: 0, long: 1 })
    const next = '2026-11-15'
    expect(laneOf(assignLanes(weekLaneItems(list, next, 'work'), next))).toEqual({ long: 0 })
  })
})

describe('日ごとに描く物（7.8・10.4。6つの場合）', () => {
  it('週の中で始まって終わる: 開始日に始点のカード、間の日は線、締め切り日に●', () => {
    expect(partsOf('2026-11-09', '2026-11-12')).toEqual([
      '11-09 start out',
      '11-10 in out',
      '11-11 in out',
      '11-12 in dot:center',
    ])
    expect(partsOf('2026-11-09', '2026-11-10')).toEqual(['11-09 start out', '11-10 in dot:center'])
  })

  it('前の週から続く: 日曜に受けた表示を出し、そこから線を引く（CALENDAR-119）', () => {
    expect(partsOf('2026-11-05', '2026-11-10')).toEqual(['11-08 received out', '11-09 in out', '11-10 in dot:center'])
  })

  it('次の週へ続く: 線を土曜の端まで延ばし、端に＞（CALENDAR-120）', () => {
    expect(partsOf('2026-11-12', '2026-11-17')).toEqual(['11-12 start out', '11-13 in out', '11-14 in out arrow'])
  })

  it('前の週から続いて次の週へ続く: 日曜の受けた表示から土曜の端の＞まで', () => {
    expect(partsOf('2026-11-01', '2026-11-30')).toEqual([
      '11-08 received out',
      '11-09 in out',
      '11-10 in out',
      '11-11 in out',
      '11-12 in out',
      '11-13 in out',
      '11-14 in out arrow',
    ])
  })

  it('土曜に始まって次の週へ続く: カードを縮めて＞（横は線の長さ 0。CALENDAR-121）', () => {
    expect(partsOf('2026-11-14', '2026-11-16')).toEqual(['11-14 start shrink out arrow'])
  })

  it('前の週から続いて日曜に終わる: 受けた表示の右端の中に●（線は引かない。CALENDAR-122）', () => {
    expect(partsOf('2026-11-05', '2026-11-08')).toEqual(['11-08 received dot:inCard'])
    expect(partsOf('2026-11-07', '2026-11-08')).toEqual(['11-08 received dot:inCard'])
  })

  it('週の端の日でも、続かない物はふつうに描く（日曜に始まる・土曜に終わる・前の週から土曜まで）', () => {
    expect(partsOf('2026-11-08', '2026-11-09')).toEqual(['11-08 start out', '11-09 in dot:center'])
    expect(partsOf('2026-11-13', '2026-11-14')).toEqual(['11-13 start out', '11-14 in dot:center'])
    expect(partsOf('2026-11-01', '2026-11-14')).toEqual([
      '11-08 received out',
      '11-09 in out',
      '11-10 in out',
      '11-11 in out',
      '11-12 in out',
      '11-13 in out',
      '11-14 in dot:center',
    ])
    // 土曜に始まって次の日曜に終わる物は、次の週では受けた表示の中の●
    expect(partsOf('2026-11-14', '2026-11-15', '2026-11-15')).toEqual(['11-15 received dot:inCard'])
  })

  it('週の中で月が変わっても線は切らない（11/29〜12/5 の週の 11/30 → 12/1。CALENDAR-123）', () => {
    const sun = '2026-11-29'
    expect(partsOf('2026-11-30', '2026-12-01', sun)).toEqual(['11-30 start out', '12-01 in dot:center'])
    expect(partsOf('2026-11-20', '2026-12-03', sun)).toEqual([
      '11-29 received out',
      '11-30 in out',
      '12-01 in out',
      '12-02 in out',
      '12-03 in dot:center',
    ])
  })

  it('年をまたぐ週（2026-12-27〜2027-01-02）も同じ', () => {
    const sun = '2026-12-27'
    const { lanes } = assignLanes([li('a', '2026-12-30', '2027-01-05')], sun)
    expect(lanes[0]).toMatchObject({ from: '2026-12-30', to: '2027-01-02', endsAfter: true })
    expect(laneParts(lanes[0], sun).map((p) => p.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(laneParts(lanes[0], sun).map(brief)).toEqual(['12-30 start out', '12-31 in out', '01-01 in out', '01-02 in out arrow'])
  })

  it('週の外の日は出さない（切り詰めていないレーンを渡しても、日曜〜土曜の分だけ）', () => {
    const lane: Lane = { id: 'a', lane: 0, from: '2026-11-01', to: '2026-11-30', startsBefore: true, endsAfter: true }
    expect(laneParts(lane, SUN).map((p) => p.date)).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ])
  })

  it('期間の毎日に1つずつ（その日の部分の数 = 切り詰めた期間の日数）', () => {
    const { lanes } = assignLanes([li('a', '2026-11-02', '2026-11-11'), li('b', '2026-11-10', '2026-11-25')], SUN)
    expect(lanes.map((l) => laneParts(l, SUN).length)).toEqual([4, 5])
  })
})

describe('縦の並び（S）のレール（10.4。CALENDAR-131・ITEMS-090・097）', () => {
  it('縦の線の位置はレーンの番号を 0 から数えて 4・14・24px、レールは 10px で最大3本', () => {
    expect([railX(0), railX(1), railX(2)]).toEqual([4, 14, 24])
    expect(RAIL_PX).toBe(10)
    expect(RAIL_MAX).toBe(3)
    expect(RAIL_MAX * RAIL_PX).toBe(30)
  })

  it('レーンが 5本の週: レールは3本、4本目と5本目のレーンの物はレールに載せない', () => {
    const r = assignLanes(
      [
        li('a', '2026-11-09', '2026-11-13', 1),
        li('b', '2026-11-09', '2026-11-13', 2),
        li('c', '2026-11-09', '2026-11-13', 3),
        li('d', '2026-11-09', '2026-11-13', 4),
        li('e', '2026-11-05', '2026-11-11', 5),
      ],
      SUN,
    )
    // e は切り詰めると 11/8 に始まるので先頭（レーン 0）
    expect(laneOf(r)).toEqual({ e: 0, a: 1, b: 2, c: 3, d: 4 })
    const s = railSplit(r)
    expect(s.rails).toBe(3)
    expect(s.railLanes.map((l) => [l.id, l.lane])).toEqual([
      ['e', 0],
      ['a', 1],
      ['b', 2],
    ])
    expect(s.overflow.map((l) => [l.id, l.lane])).toEqual([
      ['c', 3],
      ['d', 4],
    ])
  })

  it('レーンが3本以下ならすべてレールに載せ、レールの本数はレーンの数', () => {
    const two = assignLanes([li('a', '2026-11-09', '2026-11-10'), li('b', '2026-11-09', '2026-11-12')], SUN)
    expect(railSplit(two)).toEqual({ rails: 2, railLanes: two.lanes, overflow: [] })
    expect(railSplit(assignLanes([], SUN))).toEqual({ rails: 0, railLanes: [], overflow: [] })
  })

  it('4本目のレーンからの物は、カードの日と「● 件名」の行の日を laneParts で決める（AMB-ITEMS-17・D41）', () => {
    const fill = [1, 2, 3].map((n) => li(`f${n}`, '2026-11-01', '2026-11-30', n))
    const r = assignLanes(
      [
        ...fill,
        li('inWeek', '2026-11-09', '2026-11-11', 10),
        li('fromPrev', '2026-11-05', '2026-11-12', 11),
        li('toNext', '2026-11-13', '2026-11-20', 12),
        li('sundayEnd', '2026-11-06', '2026-11-08', 13),
      ],
      SUN,
    )
    const over = Object.fromEntries(railSplit(r).overflow.map((l) => [l.id, laneParts(l, SUN)]))
    const cardDay = (id: string) => over[id].find((p) => p.card)
    const rowDay = (id: string) => over[id].find((p) => p.dot === 'center')?.date ?? null
    expect(Object.keys(over).sort()).toEqual(['fromPrev', 'inWeek', 'sundayEnd', 'toNext'])
    // 週の中: 開始日にカード、締め切り日に「● 件名」の行
    expect([cardDay('inWeek')?.date, cardDay('inWeek')?.card, rowDay('inWeek')]).toEqual(['2026-11-09', 'start', '2026-11-11'])
    // 前の週から: 日曜に受けた表示（線なし・期間付き）、締め切り日がその週にあれば「● 件名」の行
    expect([cardDay('fromPrev')?.date, cardDay('fromPrev')?.card, rowDay('fromPrev')]).toEqual([
      '2026-11-08',
      'received',
      '2026-11-12',
    ])
    // 次の週へ: 締め切り日がその週に無いので「● 件名」の行は出さない（期間の表記で分かる）
    expect([cardDay('toNext')?.date, rowDay('toNext')]).toEqual(['2026-11-13', null])
    // 日曜に終わる: 受けた表示の中の●
    expect(over.sundayEnd.map(brief)).toEqual(['11-08 received dot:inCard'])
  })
})
