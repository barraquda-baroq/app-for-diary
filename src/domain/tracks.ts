// 複数日の予定のレーン（docs/SPEC.md の 7.8・10.4）。ウィークリーの7日を横（L・M）と7日を縦（S）の両方が使う、向きに依らない計算。
// その週・その区分の複数日の予定を、週の中に切り詰めた期間でレーンに割り付け（7.8）、日ごとに何を描くか（始点のカード・受けた表示・
// 線・終点の●・端の＞）を決める。縦の並びのレール（10.4）の本数と、4本目のレーンからの物の分け方もここ。
// px（レーンの上の位置・線の高さ）は week/weekModel.ts が決める。日付は 'YYYY-MM-DD' の文字のまま比べる（端末の時差で動かない。6.4）
import type { CalItem } from './calendar'
import { addDaysYmd, compareYmd, eachDate } from './dates'
import type { ID, ItemKind } from './types'

/** レーンに割り付ける物: その週・1つの区分の複数日の予定（完了した物も含む。完了してもレーンの位置に残す。7.5） */
export interface LaneItem {
  id: ID
  from: string
  to: string
  /** 作った順（同じ期間の物の並び。7.8） */
  order: number
}

/** 割り付けたレーン（0 から数える）。from・to は週の中（日曜〜土曜）に切り詰めた期間 */
export interface Lane {
  id: ID
  lane: number
  from: string
  to: string
  /** 前の週から続いている（日曜に受けた表示を出す。7.8） */
  startsBefore: boolean
  /** 次の週へ続いている（土曜の端に＞を出す。7.8） */
  endsAfter: boolean
}

/** 作った順が同じ時は id の小さい順（どの端末でも同じ並び。6.1） */
const compareId = (a: ID, b: ID): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * その週・その区分の複数日の予定（完了した物も含む）を、レーンの割り付けに渡す形にする。週に掛からない物・1日の予定・
 * ほかの区分の物は入れない（レーンは週ごと・区分ごと。7.8）。list はカレンダーに出る項目（calendarItems の結果）
 */
export function weekLaneItems(list: readonly CalItem[], sunday: string, kind: ItemKind): LaneItem[] {
  const saturday = addDaysYmd(sunday, 6)
  const out: LaneItem[] = []
  for (const c of list) {
    if (!c.multi || c.item.kind !== kind || c.from > saturday || c.to < sunday) continue
    out.push({ id: c.item.id, from: c.from, to: c.to, order: c.item.order })
  }
  return out
}

/**
 * レーンの割り付け（7.8。CALENDAR-125・126）: 週の中に切り詰めた期間（max(from, 日曜)〜min(to, 土曜)）で、始まりの早い順 →
 * 終わりの遅い順 → 作った順（order → id）に並べ、前から順に「そのレーンの最後の予定の終わり < この予定の始まり」となる、
 * いちばん上のレーンに入れる（同じ日に終わって始まる物は同じレーンに入れない）。週に掛からない物は入れない。
 * sunday はその週の日曜（7日の初めの日）。区分ごとに呼ぶ（仕事とプライベートのレーンは別々）。lanes は並べた順、count はレーンの数
 */
export function assignLanes(items: readonly LaneItem[], sunday: string): { lanes: Lane[]; count: number } {
  const saturday = addDaysYmd(sunday, 6)
  const clipped = items
    .filter((it) => it.from <= it.to && it.from <= saturday && it.to >= sunday)
    .map((it) => ({ it, from: it.from < sunday ? sunday : it.from, to: it.to > saturday ? saturday : it.to }))
  clipped.sort(
    (a, b) => compareYmd(a.from, b.from) || compareYmd(b.to, a.to) || a.it.order - b.it.order || compareId(a.it.id, b.it.id),
  )
  // 各レーンの最後の予定の終わり（始まりの早い順に入れるので、そのレーンでいちばん遅い終わり）
  const ends: string[] = []
  const lanes: Lane[] = []
  for (const c of clipped) {
    let lane = ends.findIndex((end) => end < c.from)
    if (lane < 0) lane = ends.length
    ends[lane] = c.to
    lanes.push({ id: c.it.id, lane, from: c.from, to: c.to, startsBefore: c.it.from < sunday, endsAfter: c.it.to > saturday })
  }
  return { lanes, count: ends.length }
}

/**
 * レーンの1日分に描く物（7.8・10.4）。横の並び（L・M）は列、縦の並び（S）は日のかたまりのその半分が、自分の日の分だけを描く
 * （線は日ごとに切れた部分の集まりなので、ほかの日の場所を測らなくてよい）。「手前の端」は横では左・縦では上、「向こうの端」は
 * 横では右・縦では下
 */
export interface DayPart {
  date: string
  /**
   * 'start' = 始点のカード（開始日。左上に完了の丸）。'received' = 受けた表示（前の週から続く物を日曜に。「‹ 件名」・点線の枠・
   * 完了の丸なし。7.8）
   */
  card?: 'start' | 'received'
  /**
   * 土曜に始まって次の週へ続く（7.8。CALENDAR-121）。横の並びではカードを 14px 縮め、あいた所に＞を出す（カードの端から＞まで
   * なので、線の長さは 0）。縦の並びは縮めず、ほかの土曜と同じく線を下の端の矢印まで引く（10.4）
   */
  shrink?: boolean
  /** 線が手前の端から入ってくる（前の日から続く） */
  lineIn?: boolean
  /** 線が向こうの端へ出ていく（次の日へ続く。土曜では週の端まで延ばして arrow を出す） */
  lineOut?: boolean
  /**
   * 終点の●。'center' = 締め切り日の所（横は列の横の真ん中。AMB-ITEMS-18。縦はかたまりのその半分の上の所。10.4）。
   * 'inCard' = 前の週から続いて日曜に終わる時、受けた表示の右端の中（線は引かない。CALENDAR-122）
   */
  dot?: 'center' | 'inCard'
  /** 次の週へ続く時、土曜の向こうの端の＞（縦の並びは90度回した下向きの矢印。CALENDAR-120・10.4） */
  arrow?: boolean
}

/**
 * レーンの日ごとの部分（l.from〜l.to の毎日。週の中で月・年が変わっても線は切らない。CALENDAR-123）。6つの場合:
 * 週の中で始まって終わる・前の週から続く・次の週へ続く・その両方・土曜に始まって続く（shrink）・前の週から続いて日曜に終わる（inCard）
 */
export function laneParts(l: Lane, sunday: string): DayPart[] {
  const saturday = addDaysYmd(sunday, 6)
  const dates = eachDate(l.from < sunday ? sunday : l.from, l.to > saturday ? saturday : l.to)
  const last = dates.length - 1
  return dates.map((date, i) => {
    const part: DayPart = { date }
    if (i === 0) part.card = l.startsBefore ? 'received' : 'start'
    if (i > 0) part.lineIn = true
    if (i < last) part.lineOut = true
    if (i === last && l.endsAfter) {
      part.lineOut = true
      part.arrow = true
      if (i === 0 && !l.startsBefore) part.shrink = true
    }
    if (i === last && !l.endsAfter) {
      if (i > 0) part.dot = 'center'
      else if (l.startsBefore) part.dot = 'inCard'
    }
    return part
  })
}

// ---------- 縦の並び（S）のレール（10.4） ----------

/** レールの本数の上限（各半分の左。10px × 3本 = 30px。4本目のレーンからはレールを使わない） */
export const RAIL_MAX = 3
/** レール1本の幅（px） */
export const RAIL_PX = 10
/** レーンの縦の線（2px）の左の位置（px。レーンの番号は 0 から: 4・14・24px。AMB-ITEMS-17・D41） */
export const railX = (lane: number): number => 4 + RAIL_PX * lane

/**
 * レールに載せるレーンと、載せないレーン（4本目のレーンから。CALENDAR-131・ITEMS-097）。rails はその週・その区分のレールの本数
 * （レーンの数。最大3本。幅は rails × RAIL_PX）。overflow の物は線と矢印を引かず、laneParts の card の日に期間（〜11/11）付きの
 * カード（前の週から続く物は日曜の受けた表示）を、dot: 'center' の日（締め切り日がその週にある時）のその半分のいちばん上に
 * 「● 件名」の行を出す（終点の●と同じく、押すと詳細・長押しで締め切り日を動かす。AMB-ITEMS-17）。dot: 'inCard' は受けた表示の中の●
 */
export function railSplit(r: { lanes: readonly Lane[]; count: number }): { rails: number; railLanes: Lane[]; overflow: Lane[] } {
  return {
    rails: Math.min(r.count, RAIL_MAX),
    railLanes: r.lanes.filter((l) => l.lane < RAIL_MAX),
    overflow: r.lanes.filter((l) => l.lane >= RAIL_MAX),
  }
}
