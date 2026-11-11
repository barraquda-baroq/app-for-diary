// @vitest-environment node
// 見本の作り物の予定（e2e/fixtures/demoData.ts）が、見本の画面（docs/SPEC.md の 21.・PLAN §6.3 の撮る画面）で見せたい物を
// すべて持っているか、決まりに合った形か、個人の情報を持っていないかを、画面を通さずに確かめる。
// 数え方・レーン・タイムスケジュールの並べ方は、画面と同じ src/domain の計算で確かめる
import { describe, expect, it } from 'vitest'
import {
  DEMO_IDS,
  DEMO_LABEL_NAMES,
  DEMO_NOW,
  DEMO_OFF_DAYS,
  DEMO_PAIR_KEYS,
  DEMO_TODAY,
  DEMO_WEEKS,
  demoData,
  pairId,
  paletteId,
} from '../e2e/fixtures/demoData.ts'
import { calendarItems, dayList, dayTimed, weekSingles } from '../src/domain/calendar.ts'
import { daysBetween, monthWeeks, weekdayOfYmd, weekStartOf } from '../src/domain/dates.ts'
import { layoutPieces, minMinutesOf, piecesOn, timedInputs, HOUR_PX } from '../src/domain/dayLayout.ts'
import { holidayName } from '../src/domain/holidays.ts'
import { countOn, hasDueMark, itemProblems } from '../src/domain/items.ts'
import { LABEL_DEFAULT_NAMES, LABEL_KEYS } from '../src/domain/labels.ts'
import { repairData } from '../src/domain/repair.ts'
import { assignLanes, laneParts, railSplit, weekLaneItems } from '../src/domain/tracks.ts'
import { emptyData } from '../src/domain/types.ts'

const data = demoData()
const items = Object.values(data.items)
const list = calendarItems(data.items)
const byId = (id) => {
  const it = data.items[id]
  if (!it) throw new Error(`見本に ${id} がありません`)
  return it
}
const lanesOf = (sunday, kind) => assignLanes(weekLaneItems(list, sunday, kind), sunday)
const laneOf = (sunday, kind, id) => lanesOf(sunday, kind).lanes.find((l) => l.id === id)

describe('見本のデータの形', () => {
  it('今日は 2026-11-10（火）9:00 日本時間で、E2E の「今」と同じ', () => {
    expect(DEMO_TODAY).toBe('2026-11-10')
    expect(weekdayOfYmd(DEMO_TODAY)).toBe(2)
    // e2e/helpers.ts の E2E_NOW と同じ（helpers.ts は Playwright を読み込むので、ここでは値で比べる）
    expect(Date.parse(DEMO_NOW)).toBe(Date.parse('2026-11-10T09:00:00+09:00'))
  })

  it('どの予定も決まり（6.2〜6.4・12.4）に合い、表示用の修復（6.12）で直す所が無い', () => {
    for (const it of items) expect(itemProblems(it), it.id).toEqual([])
    const { fixes } = repairData({ ...emptyData(), ...data })
    expect(fixes).toEqual([])
  })

  it('呼ぶたびに同じ物を新しく作る（id・作った時刻・並びが決まっている）', () => {
    const again = demoData()
    expect(again).toEqual(data)
    expect(again.items).not.toBe(data.items)
    const orders = items.map((it) => it.order)
    expect(new Set(orders).size).toBe(orders.length)
    // 作った時刻はどれも見本の今より前
    for (const it of items) expect(it.createdAt).toBeLessThan(Date.parse(DEMO_NOW))
  })

  it('直した時刻は作った時刻より後で、完了にした物は完了にした時刻（直した時刻が完了より前にならない）', () => {
    for (const it of items) {
      expect(it.updatedAt, it.id).toBeGreaterThanOrEqual(it.createdAt)
      expect(it.updatedAt, it.id).toBeLessThanOrEqual(Date.parse(DEMO_NOW))
      if (it.done) expect(it.updatedAt, it.id).toBe(it.doneAt)
    }
  })

  it('個人の情報を持たない（メールアドレス・人の名前の依頼者・本物の場所の URL が無い）', () => {
    const texts = [
      ...items.flatMap((it) => [it.title, it.memo, it.requester, it.via ?? '']),
      ...Object.values(data.labelNames).map((l) => l.name),
    ]
    for (const t of texts) expect(t, t).not.toMatch(/@/)
    expect(new Set(items.map((it) => it.requester).filter(Boolean))).toEqual(new Set(['総務', '営業部']))
    const urls = texts.join('\n').match(/https?:\/\/[^\s]+/g) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) expect(new URL(u).hostname).toBe('example.com')
  })
})

describe('マンスリー（9.）で見せる物', () => {
  it('11月は5行。祝日は 11/3・11/23、休みは 11/11・11/14・11/23 と隣の月の 12/2', () => {
    expect(monthWeeks(2026, 11)).toHaveLength(5)
    expect(holidayName('2026-11-03')).toBe('文化の日')
    expect(holidayName('2026-11-23')).toBe('勤労感謝の日')
    expect(Object.keys(data.offDays).sort()).toEqual([...DEMO_OFF_DAYS].sort())
    for (const d of Object.values(data.offDays)) expect(d.off).toBe(true)
    // 12/2 は 11月のマンスリーの最後の行（隣の月の日）
    expect(
      monthWeeks(2026, 11)
        .flat()
        .some((c) => c.outside && c.date.m === 12 && c.date.d === 2),
    ).toBe(true)
  })

  it('S の「12/10」（2桁の数）・片方が 0 の日・全部完了した日（何も書かない）・祝日と休みの日の数がある', () => {
    const count = (date) => [countOn(items, date, 'work'), countOn(items, date, 'private')]
    expect(count('2026-11-19')).toEqual([12, 10])
    // 研修だけの日（プライベートが 0）
    expect(count('2026-11-06')).toEqual([1, 0])
    // 予定はあるが全部完了
    expect(items.some((it) => it.start === '2026-11-02')).toBe(true)
    expect(count('2026-11-02')).toEqual([0, 0])
    expect(count('2026-11-03')[0]).toBeGreaterThan(0)
    expect(count('2026-11-23')[1]).toBeGreaterThan(0)
  })
})

describe('ウィークリー（10.）で見せる物', () => {
  const main = DEMO_WEEKS.main

  it('見本の週はどれも日曜', () => {
    for (const w of Object.values(DEMO_WEEKS)) expect(weekStartOf(w)).toBe(w)
    expect(weekStartOf(DEMO_TODAY)).toBe(main)
  })

  it('いつもの週の仕事: 受けた表示（日曜に終わる●を含む）・3本目のレーン・土曜の「＞」・土曜に始まる物の縮み', () => {
    const intake = laneOf(main, 'work', DEMO_IDS.intake)
    expect(intake.startsBefore).toBe(true)
    expect(laneParts(intake, main)).toEqual([{ date: main, card: 'received', dot: 'inCard' }])
    expect(byId(DEMO_IDS.intake).done).toBe(true)
    expect(laneOf(main, 'work', DEMO_IDS.training).startsBefore).toBe(true)
    expect(byId(DEMO_IDS.training).label).toBeNull()
    expect(laneOf(main, 'work', DEMO_IDS.expo).lane).toBe(2)
    expect(lanesOf(main, 'work').count).toBe(3)
    const tripPrep = laneOf(main, 'work', DEMO_IDS.tripPrep)
    expect(tripPrep.endsAfter).toBe(true)
    expect(laneParts(tripPrep, main).at(-1)).toMatchObject({ arrow: true })
    const stock = laneParts(laneOf(main, 'work', DEMO_IDS.stock), main)
    expect(stock).toEqual([{ date: '2026-11-14', card: 'start', lineOut: true, arrow: true, shrink: true }])
  })

  it('いつもの週のプライベート: 受けた表示・休みをまたぐ旅行・次の日にまたぐ夜の予定', () => {
    expect(laneOf(main, 'private', DEMO_IDS.tidy).startsBefore).toBe(true)
    const trip = laneOf(main, 'private', DEMO_IDS.trip)
    expect(trip.endsAfter).toBe(true)
    expect(DEMO_OFF_DAYS).toContain('2026-11-14')
    const bus = byId(DEMO_IDS.nightBus)
    expect([bus.start, bus.due, bus.startTime, bus.endTime]).toEqual(['2026-11-11', '2026-11-12', '22:00', '02:00'])
  })

  it('完了・ロック・〆（Task List 生まれ）・Claude が足した物・長い件名が、仕事とプライベートの両方にある', () => {
    for (const kind of ['work', 'private']) {
      const mine = items.filter((it) => it.kind === kind)
      expect(
        mine.some((it) => it.done),
        kind,
      ).toBe(true)
      expect(
        mine.some((it) => it.locked),
        kind,
      ).toBe(true)
      expect(
        mine.some((it) => hasDueMark(it)),
        kind,
      ).toBe(true)
      expect(
        mine.some((it) => [...it.title].length >= 30),
        kind,
      ).toBe(true)
    }
    const claude = byId(DEMO_IDS.claude)
    expect([claude.by, claude.ai, claude.via]).toEqual(['connector', 'claude', 'メール: 打ち合わせの候補日について'])
    expect(byId(DEMO_IDS.quote).requester).toBe('営業部')
  })

  it('色の見本の週: 区分ごとに24色を1件ずつ（件名は既定の呼び名）と、ラベルなしを1件。各日の上が淡・下が濃', () => {
    const [from, to] = [DEMO_WEEKS.palette, '2026-11-21']
    for (const kind of ['work', 'private']) {
      const cards = items.filter((it) => it.id.startsWith(`demo-${kind === 'work' ? 'w' : 'p'}-pal-`))
      expect(cards).toHaveLength(25)
      expect(new Set(cards.map((c) => c.label))).toEqual(new Set([...LABEL_KEYS, null]))
      for (const c of cards) {
        expect(c.start >= from && c.start <= to, c.id).toBe(true)
        expect(c.due).toBeNull()
      }
      for (const date of new Set(cards.map((c) => c.start))) {
        const day = cards.filter((c) => c.start === date).sort((a, b) => a.order - b.order)
        const shades = day.map((c) => (c.label ? c.label.slice(-1) : 'none'))
        // 淡（l）が先、濃（d）が後
        expect(shades.join(''), date).toMatch(/^l*d*$|^none$/)
      }
    }
    expect(byId(paletteId('work', 'rose-l')).title).toBe('桜・淡')
    expect(byId(paletteId('private', 'peony-d')).title).toBe('牡丹・濃')
  })

  it('色合いの間がいちばん狭い桜と牡丹を、同じ日の続いたカードに並べる（淡どうし・濃どうし。FRAME-190）', () => {
    expect([...DEMO_PAIR_KEYS]).toEqual(['rose-l', 'peony-l', 'rose-d', 'peony-d'])
    for (const kind of ['work', 'private']) {
      // 色の見本の週のウィークリーの1日のカードの並び（7.5。画面と同じ src/domain の計算）で、桜のすぐ次（下）が牡丹
      const days = Object.values(weekSingles(list, DEMO_WEEKS.palette, kind))
      for (const shade of ['l', 'd']) {
        const next = days.some((day) => {
          const labels = day.map((c) => c.item.label)
          return labels.some((l, i) => l === `rose-${shade}` && labels[i + 1] === `peony-${shade}`)
        })
        expect(next, `${kind} ${shade}`).toBe(true)
      }
      for (const key of DEMO_PAIR_KEYS) {
        const card = byId(pairId(kind, key))
        expect([card.start, card.label, card.title]).toEqual(['2026-11-21', key, LABEL_DEFAULT_NAMES[key]])
      }
    }
  })

  it('どのラベルも、どこかの予定で使っている（仕事・プライベートの両方）', () => {
    for (const kind of ['work', 'private']) {
      const used = new Set(items.filter((it) => it.kind === kind).map((it) => it.label))
      for (const key of LABEL_KEYS) expect(used.has(key), `${kind} ${key}`).toBe(true)
    }
    expect(Object.keys(DEMO_LABEL_NAMES).sort()).toEqual(Object.keys(data.labelNames).sort())
  })

  it('混んだ週: 仕事のレーンが5本（S のレールは3本、4本目からの2件は週の中で終わるので「● 件名」の行を出す）', () => {
    const dense = DEMO_WEEKS.dense
    const r = lanesOf(dense, 'work')
    expect(r.count).toBe(5)
    const split = railSplit(r)
    expect(split.rails).toBe(3)
    expect(split.overflow.map((l) => l.id).sort()).toEqual([DEMO_IDS.dense[3], DEMO_IDS.dense[4]].sort())
    for (const l of split.overflow)
      expect(
        laneParts(l, dense).some((p) => p.dot === 'center'),
        l.id,
      ).toBe(true)
    // 月末の締めは週と月をまたぐ
    const monthEnd = byId(DEMO_IDS.monthEnd)
    expect(monthEnd.due?.slice(0, 7)).toBe('2026-12')
    expect(laneOf(dense, 'work', DEMO_IDS.monthEnd).endsAfter).toBe(true)
  })

  it('週をまたぐ複数日の予定がいくつもある', () => {
    const crossing = list.filter((c) => c.multi && weekStartOf(c.from) !== weekStartOf(c.to))
    expect(crossing.length).toBeGreaterThanOrEqual(5)
    expect(crossing.some((c) => daysBetween(c.from, c.to) >= 5)).toBe(true)
  })
})

describe('デイリー（11.）で見せる物', () => {
  const layout = (date, maxCols, hourPx) =>
    layoutPieces(piecesOn(timedInputs(dayTimed(list, date)), date), { maxCols, minMinutes: minMinutesOf(hourPx) })

  it('今日: 時刻のある予定・開始時刻だけ・重なり・ロック・時刻のある複数日の間の日、時刻の無いリストの両方の区分', () => {
    const pieces = piecesOn(timedInputs(dayTimed(list, DEMO_TODAY)), DEMO_TODAY)
    const ids = pieces.map((p) => p.id)
    for (const id of [DEMO_IDS.weekly, DEMO_IDS.meeting, DEMO_IDS.review, DEMO_IDS.interview, DEMO_IDS.dinner])
      expect(ids).toContain(id)
    expect(pieces.find((p) => p.id === DEMO_IDS.materials)?.part).toBe('middle')
    expect(byId(DEMO_IDS.meeting).endTime).toBeNull()
    expect(dayList(list, DEMO_TODAY, 'work').length).toBeGreaterThan(2)
    expect(dayList(list, DEMO_TODAY, 'private').length).toBeGreaterThan(1)
    expect(byId(DEMO_IDS.book).memo).toMatch(/https:\/\//)
  })

  it('11/13: 重なる5件で、L・M は4列と「+1」、S は3列と「+2」（旅行は時刻の無いリストに）', () => {
    const busy = '2026-11-13'
    const l = layout(busy, 4, HOUR_PX.LM)
    expect(l.overflow).toHaveLength(1)
    expect(l.overflow[0].ids).toHaveLength(1)
    expect(Math.max(...l.placed.filter((p) => DEMO_IDS.busy.includes(p.id)).map((p) => p.cols))).toBe(4)
    const s = layout(busy, 3, HOUR_PX.S)
    expect(s.overflow[0].ids).toHaveLength(2)
    expect(dayList(list, busy, 'private').map((r) => r.c.item.id)).toContain(DEMO_IDS.trip)
    expect(byId(DEMO_IDS.trip).startTime).toBeNull()
  })
})
