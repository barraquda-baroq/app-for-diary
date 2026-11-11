// デイリーのタイムスケジュールの並べ方（docs/SPEC.md の 11.3・6.4）: 時刻のある予定のその日の部分（日をまたぐ物は初日・間の日・
// 最終日）、重なった予定の列（日をまたぐ予定の部分は左の列、1日の予定はその右に。「+n」の札の所）、空いた所を押した時の時刻、
// 開いた時の位置、日をまたぐ予定の開始のカードの高さ。
// 時刻は 0:00 からの分（0〜1440）で計算し、px には day/dayModel.ts が HOUR_PX で直す
import type { CalItem } from './calendar'
import { hmToMinutes, isHm, minutesToHm } from './dates'
import type { ID } from './types'

/** 1日の分（24:00） */
export const DAY_MINUTES = 1440
/** 開始時刻だけの予定の枠の長さ（min(開始 + 30分, 24:00) まで。6.4・11.3。7.5 の並びでも同じ長さとして比べる） */
export const START_ONLY_MINUTES = 30
/** 1時間の高さ（px）。L・M は 48px、S は 44px（11.3） */
export const HOUR_PX = { LM: 48, S: 44 } as const
/** 予定の枠の最小の高さ（px。11.3。ITEMS-133） */
export const EVENT_MIN_PX = 24

/** タイムスケジュールに並べる物: 時刻のある予定（期間 from〜to と開始・終了の時刻。終了の無い物は開始時刻だけの予定） */
export interface TimedInput {
  id: ID
  from: string
  to: string
  startTime: string
  endTime: string | null
}

/** その日の部分（分。0〜1440）。part は 1日の予定・日をまたぐ予定の初日・間の日・最終日 */
export interface Piece {
  id: ID
  start: number
  end: number
  part: 'single' | 'first' | 'middle' | 'last'
}

/** カレンダーに出る項目のうち、時刻のある物を TimedInput にする（並びはそのまま。dayTimed の結果を渡せば 7.5 の順） */
export function timedInputs(list: readonly CalItem[]): TimedInput[] {
  const out: TimedInput[] = []
  for (const c of list) {
    const { id, startTime, endTime } = c.item
    if (startTime !== null) out.push({ id, from: c.from, to: c.to, startTime, endTime })
  }
  return out
}

/**
 * その日の部分（6.4・11.3。CALENDAR-032・ITEMS-133・142）: 1日の予定は開始〜終了（終了の無い物は min(開始 + 30分, 24:00)）、
 * 日をまたぐ予定は初日が開始〜24:00、間の日が 0:00〜24:00、最終日が 0:00〜終了（終了の無い物は 24:00）。期間にこの日が入らない物と、
 * 開始時刻の形が違う物は出さない。修復の前の形（1日で終了 ≤ 開始）は開始時刻だけの予定として出す。並びは渡した順のまま
 */
export function piecesOn(items: readonly TimedInput[], date: string): Piece[] {
  const out: Piece[] = []
  for (const it of items) {
    if (!(it.from <= date && date <= it.to) || !isHm(it.startTime)) continue
    const end = it.endTime !== null && isHm(it.endTime, true) ? hmToMinutes(it.endTime) : null
    if (it.from === it.to) {
      const start = hmToMinutes(it.startTime)
      const e = end !== null && end > start ? end : Math.min(start + START_ONLY_MINUTES, DAY_MINUTES)
      out.push({ id: it.id, start, end: e, part: 'single' })
    } else if (date === it.from) out.push({ id: it.id, start: hmToMinutes(it.startTime), end: DAY_MINUTES, part: 'first' })
    else if (date === it.to) out.push({ id: it.id, start: 0, end: end ?? DAY_MINUTES, part: 'last' })
    else out.push({ id: it.id, start: 0, end: DAY_MINUTES, part: 'middle' })
  }
  return out
}

/** 予定の枠の最小の高さ（24px）を、その1時間の高さの分にした物（L・M は 30分、S は約 32.7分）。layoutPieces の minMinutes */
export function minMinutesOf(hourPx: number): number {
  return (EVENT_MIN_PX * 60) / hourPx
}

/**
 * 横の位置・幅の式（タイムスケジュールの予定を置ける幅 U に掛ける割合 f から、「+n」の札の所（1つ分の幅は画面の CSS が決める）を
 * room 個分引いた物: f × U − room × 札の所）。札の所を空けない時は room = 0
 */
export interface Span {
  f: number
  room: number
}

/**
 * 並べた部分。col は 0 から数えた列、cols は列の数（1日の予定はまとまりの中の列と列の数。日をまたぐ予定は左から何本目の列かと、
 * その日の列の数）。x・w は左の端と幅（Span）
 */
export interface Placed extends Piece {
  col: number
  cols: number
  x: Span
  w: Span
}

/** 列が足りず隠した予定（まとまりごと）。at は隠した予定のいちばん早い始まり（分）。「+n」の札の高さ（AMB-ITEMS-13） */
export interface Overflow {
  at: number
  ids: ID[]
}

/** 始まりの早い順（同じなら長い順。それも同じなら渡した順）に、重なる物をまとめて空いているいちばん左の列に入れた物 */
interface Cluster {
  members: { p: Piece; col: number }[]
  /** まとまりの見えている高さの始まりと終わり（分） */
  start: number
  end: number
}

function clusterColumns(sorted: readonly Piece[], visualEnd: (p: Piece) => number): Cluster[] {
  const clusters: Cluster[] = []
  let cur: Cluster | null = null
  // 各列の最後の部分の見えている終わり
  let colEnds: number[] = []
  for (const p of sorted) {
    if (!cur || p.start >= cur.end) {
      cur = { members: [], start: p.start, end: -Infinity }
      clusters.push(cur)
      colEnds = []
    }
    let col = colEnds.findIndex((end) => end <= p.start)
    if (col < 0) col = colEnds.length
    colEnds[col] = visualEnd(p)
    cur.members.push({ p, col })
    cur.end = Math.max(cur.end, visualEnd(p))
  }
  return clusters
}

const span = (f: number, room: number): Span => ({ f, room })
const plus = (a: Span, b: Span): Span => span(a.f + b.f, a.room + b.room)
const minus = (a: Span, b: Span): Span => span(a.f - b.f, a.room - b.room)
const times = (a: Span, k: number): Span => span(a.f * k, a.room * k)

/**
 * 重なりの並べ方（11.3。ITEMS-146・147。D39 と、日をまたぐ予定の列の決め（開発。仕様書へは WP14 が書く））:
 * - 日をまたぐ予定の部分（初日・間の日・最終日）は、1日の予定とは別に左の列に置く（間の日の 0:00〜24:00 が、その日のすべての予定を
 *   1つのまとまりにして、どの予定も細くしないように）。部分どうしが重なる時だけ横に並べる
 * - 1日の予定は、1日の予定どうしで重なる物だけをまとめ、その時間に出ている日をまたぐ予定の列より右の残りの幅を、まとまりの中の列の
 *   数で等分する
 * - どちらも、始まりの早い順（同じなら長い順。それも同じなら渡した順）に、空いているいちばん左の列に入れる。重なりは見えている高さで
 *   見る（短い予定も最小の高さ minMinutes 分の場所を取るので、終わり = max(終了, 開始 + minMinutes)。D39）。ちょうど終わった時刻に
 *   始まる物は重ならない
 * - 日をまたぐ予定の列の幅は、その日の列の数 g（日をまたぐ予定の列の数と、その横に並ぶまとまりの「日をまたぐ予定の列＋1日の予定の
 *   列」の数の、いちばん多い物）で等分した幅
 * - 列は日をまたぐ予定の列と合わせて maxCols（L・M は 4、S は 3）まで。それより右の列が要る部分は placed に入れず、まとまりごとに
 *   overflow へ。札を出すまとまりは右の端に札の所を空け（予定の上に札を重ねない）、札はそこに、隠れた予定のいちばん早い時刻の高さで
 *   出す（AMB-ITEMS-13）。日をまたぐ予定を隠した日は、どのまとまりも右の端に札の所を空ける
 */
export function layoutPieces(
  pieces: readonly Piece[],
  o: { maxCols: 3 | 4; minMinutes: number },
): { placed: Placed[]; overflow: Overflow[] } {
  const visualEnd = (p: Piece) => Math.max(p.end, p.start + o.minMinutes)
  const sorted = pieces
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.start - b.p.start || b.p.end - a.p.end || a.i - b.i)
    .map((e) => e.p)
  const overflow: Overflow[] = []
  const hide = (hidden: Piece[]) => {
    if (hidden.length) overflow.push({ at: hidden[0].start, ids: hidden.map((p) => p.id) })
  }

  // 日をまたぐ予定の列（部分どうしの重なりだけで決める）
  const lanes: { p: Piece; lane: number }[] = []
  let laneHidden = false
  for (const c of clusterColumns(
    sorted.filter((p) => p.part !== 'single'),
    visualEnd,
  )) {
    const hidden: Piece[] = []
    for (const { p, col } of c.members) {
      if (col < o.maxCols) lanes.push({ p, lane: col })
      else hidden.push(p)
    }
    if (hidden.length) laneHidden = true
    hide(hidden)
  }
  const laneCount = lanes.reduce((n, l) => Math.max(n, l.lane + 1), 0)

  // 1日の予定のまとまり（その時間に出ている日をまたぐ予定の列の右に並べる）
  const groups = clusterColumns(
    sorted.filter((p) => p.part === 'single'),
    visualEnd,
  ).map((c) => {
    const left = lanes.reduce((n, l) => (l.p.start < c.end && c.start < visualEnd(l.p) ? Math.max(n, l.lane + 1) : n), 0)
    const cap = o.maxCols - left
    const shown = c.members.filter((m) => m.col < cap)
    const hidden = c.members.filter((m) => m.col >= cap).map((m) => m.p)
    hide(hidden)
    const cols = shown.reduce((n, m) => Math.max(n, m.col + 1), 0)
    return { shown, left, cols, room: hidden.length > 0 }
  })

  // その日の列の数（日をまたぐ予定の列の幅 = 1 / g）
  const g = Math.min(
    o.maxCols,
    groups.reduce((n, gr) => (gr.left > 0 && gr.cols > 0 ? Math.max(n, gr.left + gr.cols) : n), Math.max(1, laneCount)),
  )
  // 日をまたぐ予定を隠した日は、札の所を除いた幅に列を並べる
  const laneUnit = span(1 / g, laneHidden ? 1 / g : 0)

  const placedOf = new Map<Piece, Placed>()
  for (const { p, lane } of lanes) {
    placedOf.set(p, { ...p, col: lane, cols: g, x: times(laneUnit, lane), w: laneUnit })
  }
  for (const gr of groups) {
    const x0 = times(laneUnit, gr.left)
    const right = span(1, gr.room || laneHidden ? 1 : 0)
    const unit = times(minus(right, x0), 1 / gr.cols)
    for (const { p, col } of gr.shown) placedOf.set(p, { ...p, col, cols: gr.cols, x: plus(x0, times(unit, col)), w: unit })
  }
  const placed = sorted.flatMap((p) => placedOf.get(p) ?? [])

  // 札が重なる時（日をまたぐ予定と1日の予定の両方を隠した時など）は1つにまとめる（札の高さは最小の高さより低い）
  overflow.sort((a, b) => a.at - b.at)
  const merged: Overflow[] = []
  for (const ov of overflow) {
    const last = merged[merged.length - 1]
    if (last && ov.at - last.at < o.minMinutes) {
      const ids = new Set([...last.ids, ...ov.ids])
      last.ids = sorted.filter((p) => ids.has(p.id)).map((p) => p.id)
    } else merged.push({ at: ov.at, ids: [...ov.ids] })
  }
  return { placed, overflow: merged }
}

/** 押せる開始時刻の最後（23:30。開始に 24:00 は使えない。6.4） */
const LAST_SLOT = DAY_MINUTES - 30

/**
 * 空いた所を押した時の登録の画面の時刻（11.3。ITEMS-149）: 開始は押した所を 30分単位に切り捨てた時刻、終了は min(開始 + 60分, 24:00)
 * （23:40 → 23:30〜24:00）。minute は押した所の 0:00 からの分（端数があってもよい。外は端にそろえる）
 */
export function tapToTimes(minute: number): { startTime: string; endTime: string } {
  const m = Number.isFinite(minute) ? minute : 0
  const start = Math.min(LAST_SLOT, Math.max(0, Math.floor(m / 30) * 30))
  return { startTime: minutesToHm(start), endTime: minutesToHm(Math.min(start + 60, DAY_MINUTES)) }
}

/** ほかの日を開いた時に上の端に出す時刻（7:00） */
const OTHER_DAY_TOP = 7 * 60

/**
 * 開いた時の位置（上の端の時刻。分。11.3。ITEMS-132）: 今日は今の時刻の 60分前（1:00 より前なら 0:00）、ほかの日は 7:00。
 * 画面を開いた時と見ている日が替わった時だけ当てる（小さな画面を閉じた時は今の位置のまま。AMB-ITEMS-31）
 */
export function initialScrollMinute(isToday: boolean, nowMinute: number): number {
  if (!isToday) return OTHER_DAY_TOP
  return Math.max(0, (Number.isFinite(nowMinute) ? nowMinute : 0) - 60)
}

/** 日をまたぐ予定の開始のカードの高さ（px。11.3 の 40px） */
export const START_CARD_PX = 40

/**
 * 日をまたぐ予定の開始のカードの高さ（px。AMB-ITEMS-11・D39）: max(24, min(40, その日の部分の高さ))。部分の高さがカードの高さより
 * 大きい時だけ、カードの下から部分の終わりまで線を引く（そうでない時は線を引かず、最終日の●はカードの右端の中に置く）
 */
export function startCardHeightPx(piecePx: number): number {
  return Math.max(EVENT_MIN_PX, Math.min(START_CARD_PX, Number.isFinite(piecePx) ? piecePx : 0))
}
