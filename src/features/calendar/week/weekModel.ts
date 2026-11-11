// ウィークリーの見た目の計算（docs/SPEC.md の 7.5・7.7・7.8・10.1〜10.4）。画面（WeekView）は useCalendarData() の一覧からこれで
// その週の形を作り、そのまま描く。React・ストアを読まない純粋な関数だけ（src/features/calendar/purity.test.ts）。
// - 日の見出し（日付・休み・今日・祝日）、区分ごとの複数日の予定のレーン（src/domain/tracks.ts）と日ごとの部分、1日の予定（7.5 の順）
// - 7日を横（L・M）: 1日の列の中のレーンの行（高さ 40px。どの列も同じ高さ）と、その行の線の引き方（カード・●・＞との位置）
// - 7日を縦（S）: 日のかたまりのその半分の、上に並べる物（「● 件名」の行・始点のカード・受けた表示）とレールの縦の線の位置（px）
// - 見出しの行の数（列が 120px より狭いと2行）、始点のカードの期間が入るか（入らなければ日付だけ）、列が狭くて始点のカード・
//   受けた表示の件名が1行に4字も入らない時は件名を2行にするか
// 日付は 'YYYY-MM-DD' の文字のまま比べる（端末の時差で動かない。6.4）
import { weekSingles, type CalItem } from '../../../domain/calendar'
import { addDaysYmd, mdLabel, weekDates } from '../../../domain/dates'
import { holidayName } from '../../../domain/holidays'
import { hasDueMark } from '../../../domain/items'
import { timeLabel } from '../../../domain/itemText'
import { assignLanes, laneParts, RAIL_MAX, RAIL_PX, railX, weekLaneItems, type DayPart, type Lane } from '../../../domain/tracks'
import { ITEM_KINDS, type ID, type Item, type ItemKind } from '../../../domain/types'
import { displayTitle } from '../common/parts/itemLook'

/** ウィークリーの大きさ（px。docs/SPEC.md の 7.8・10.2・10.4。CSS の week.css と同じ値） */
export const WEEK_PX = {
  /** 7日を横の1列の最小の幅（領域がこれ × 7 = 504px より狭いと横にスクロール。10.1） */
  colMin: 72,
  /** 列の幅がこれより狭いと日の見出しを2行にする（10.2） */
  twoRowsBelow: 120,
  /** 日の見出しの高さ（1行 52px・2行 64px） */
  head: { 1: 52, 2: 64 },
  /** 段の名札の高さ */
  tag: 24,
  /** 1つのレーンの高さ（カード 36px＋すき間 4px） */
  lane: 40,
  /** 始点のカード・受けた表示の高さ */
  laneCard: 36,
  /** 線の中心の高さ（レーンのカードの高さの真ん中。D42） */
  lineY: 18,
  /** カードの左右のあき（カードの幅は列の幅 − 8px） */
  inset: 4,
  /** 土曜に始まって次の週へ続くカードを縮める幅（あいた所に＞。7.8） */
  shrink: 14,
  /** 「＋」の行の高さ */
  add: 28,
  /** 縦（S）: 日のかたまりの見出しの高さ */
  blockHead: 32,
  /** 縦（S）: かたまりの半分の上の余白（いちばん上の物の上） */
  halfTop: 4,
  /** 縦（S）: 4本目のレーンからの予定の「● 件名」の行の高さ */
  overflowRow: 20,
  /** 縦（S）: 並べる物どうしのすき間 */
  gap: 4,
  /** 縦（S）: 締め切り日のかたまりの半分の上の●の中心の高さ（「● 件名」の行の●と同じ高さ） */
  railDotY: 14,
  /** 縦（S）: 土曜の下の端の下向きの矢印の分（線はその上で止める） */
  railArrow: 12,
} as const

/** カードの中の字の幅に掛からない所（px。左の 12px・右の 8px の余白と、点線の丸 16px＋すき間 6px。10.2） */
const CARD_CHROME = 12 + 8 + 16 + 6

/** 日の見出しの行の数（列の幅。測れていない 0 の時は1行） */
export function weekHeadRows(columnPx: number): 1 | 2 {
  return columnPx > 0 && columnPx < WEEK_PX.twoRowsBelow ? 2 : 1
}

/** 7日を横の1列の幅（カレンダーの領域の幅から。最小 72px。測れていない時は 0） */
export function weekColumnPx(areaWidth: number): number {
  if (!(areaWidth > 0)) return 0
  return Math.max(WEEK_PX.colMin, areaWidth / 7)
}

/** 縦（S）の日のかたまりの半分の幅（領域の幅の半分。間の 1px の線を除く。測れていない時は 0） */
export function weekHalfPx(areaWidth: number): number {
  if (!(areaWidth > 0)) return 0
  return (areaWidth - 1) / 2
}

/** レーンの上の位置（0 から数えるレーンの番号。40px ずつ） */
export const laneTop = (lane: number): number => lane * WEEK_PX.lane

/** 縦（S）のレールの幅（その週・その区分のレールの本数 × 10px） */
export const railsPx = (rails: number): number => rails * RAIL_PX

/**
 * 等幅 10px の字の幅のおおよそ（px）。Roboto Mono の英数字は字の大きさの 0.6 倍、〜 などの全角の字（ゴシックで出る）は 1 倍。
 * 期間がカードに入るかを決めるのに使う（ずれても困らないよう、入れる所の幅は少し狭く見る）
 */
export function monoTextPx(text: string, fontPx = 10): number {
  let w = 0
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) < 0x2000 ? 0.6 * fontPx : fontPx
  return w
}

/** 期間がカードの幅に入るかを決める時に、入れる所から引いておく分（書体の違い・スクロールバーの分） */
const FIT_MARGIN = 4

/**
 * 始点のカードの期間を日付だけにするか（7.7・10.2）: ふつうは `11/9 10:00〜11/12 18:00`、期間の行の幅に入らない時は
 * 時刻を省いて日付だけ `11/9〜11/12`（時刻は詳細で見る）。textPx は点線の丸の横の字の幅で、期間の行はそこから右上の印の分
 * （marksPx）が狭い（印を件名の横に置く時も、期間の行の右に置く時（laneMarksBelow）も同じ）。幅が測れていない（0）時は
 * ふつうの表記。date はカードを出す日
 */
export function periodDatesOnly(c: CalItem, date: string, textPx: number): boolean {
  // 時刻の無い物は省く時刻が無い（〜12/2 のまま）
  if (!(textPx > 0) || !c.item.startTime) return false
  return monoTextPx(timeLabel(c, { on: date })) > textPx - marksPx(c.item) - FIT_MARGIN
}

/** 7日を横の始点のカードの字の幅（列の幅 − 左右のあき 8px − カードの余白と丸。土曜で縮む時はさらに 14px） */
export function horizontalCardTextPx(columnPx: number, shrink = false): number {
  if (!(columnPx > 0)) return 0
  return columnPx - 2 * WEEK_PX.inset - CARD_CHROME - (shrink ? WEEK_PX.shrink : 0)
}

/** 縦（S）の始点のカードの字の幅（半分の幅 − レールの幅とその右のあき − 右のあき − カードの余白と丸） */
export function verticalCardTextPx(halfPx: number, rails: number): number {
  if (!(halfPx > 0)) return 0
  return halfPx - (railsPx(rails) + WEEK_PX.inset) - WEEK_PX.inset - CARD_CHROME
}

/**
 * カードの右上の印の幅のおおよそ（px。7.7）: 〆 11px・ロック 12px・AI の札（「Claude」42px・「AI」22px）と、印どうし・件名との間 4px。
 * 印が無ければ 0
 */
export function marksPx(item: Pick<Item, 'origin' | 'start' | 'due' | 'locked' | 'by' | 'ai'>): number {
  const widths: number[] = []
  if (hasDueMark(item)) widths.push(11)
  if (item.locked) widths.push(12)
  if (item.by === 'connector') widths.push(item.ai === 'claude' ? 42 : 22)
  if (!widths.length) return 0
  return widths.reduce((a, b) => a + b, 0) + 4 * widths.length
}

/** 印のあるカードで、件名の横に残したい幅（px。13px の字で5字ほど） */
export const MIN_TITLE_PX = 64
/** 印の無いカードで、点線の丸の横に残したい幅（px。13px の字で3字ほど。これより狭い列は L の狭いウインドウだけ） */
export const MIN_TITLE_PX_PLAIN = 40

/**
 * 1日のカードの並べ方（開発）:
 * - 'side': 左上の点線の丸の右に件名・その下に時刻、右上に印（10.2 のとおり）
 * - 'stacked': 丸の行と件名の行に分ける（印は丸の行の右の端、件名と時刻はその下にカードの左の余白から全部の幅で）。印を件名の横に
 *   置くと件名が MIN_TITLE_PX より細くなる時（列の狭い M・AI の札の付いたカード）と、印が無くても丸の横が MIN_TITLE_PX_PLAIN
 *   より狭い時（L の狭いウインドウの 72〜89px の列）。件名が1〜2字ずつ折り返さないように
 * - 'marks-below': 'stacked' でも印が丸の行に入らない時（AI の札の付いたカードで、列が 93px ほどより狭い時）は、印をカードの
 *   いちばん下の右に
 * textPx は丸の横の字の幅（horizontalCardTextPx・verticalCardTextPx。測れていない 0 の時は 'side'）
 */
export type CardLayout = 'side' | 'stacked' | 'marks-below'

export function cardLayout(textPx: number, item: Pick<Item, 'origin' | 'start' | 'due' | 'locked' | 'by' | 'ai'>): CardLayout {
  if (!(textPx > 0)) return 'side'
  const m = marksPx(item)
  if (m > 0 ? textPx - m >= MIN_TITLE_PX : textPx >= MIN_TITLE_PX_PLAIN) return 'side'
  // 丸の行の右に印を置ける幅（最後の印の後のすき間 4px は要らない）
  return m - 4 > textPx ? 'marks-below' : 'stacked'
}

/**
 * 始点のカード・受けた表示（高さ 36px・件名 1行）の右上の印を、件名の横ではなく下の行の右の端に置くか（開発）: 件名の横に置くと
 * 件名が MIN_TITLE_PX より細くなる時（列の狭い M・L の狭いウインドウの、ロック・〆・AI の札の付いた複数日の予定。AI の札は
 * 100px の列で件名の幅を 0 にする）。件名は横の幅を全部使い、印は期間の行（受けた表示は件名の下の行）の右の端に置く。
 * textPx は件名の横の字の幅（始点のカードは horizontalCardTextPx・verticalCardTextPx、受けた表示は receivedTextPx。
 * 測れていない 0 の時と印の無い時は横のまま）
 */
export function laneMarksBelow(textPx: number, item: Pick<Item, 'origin' | 'start' | 'due' | 'locked' | 'by' | 'ai'>): boolean {
  const m = marksPx(item)
  return textPx > 0 && m > 0 && textPx - m < MIN_TITLE_PX
}

/**
 * 受けた表示の字の幅（px）。大きさは同じ位置の始点のカードと同じなので、その字の幅（cardTextPx）から: 点線の丸が無い代わりに
 * 1px の点線の枠と左右の余白 8px（中に●を置く時は右の余白 22px）。測れていない 0 の時は 0
 */
export function receivedTextPx(cardTextPx: number, dotIn = false): number {
  if (!(cardTextPx > 0)) return 0
  return cardTextPx + CARD_CHROME - 2 * 1 - 2 * 8 - (dotIn ? 22 - 8 : 0)
}

// ---------- 列が狭い時の始点のカード・受けた表示（件名を2行に。開発） ----------

/**
 * 始点のカード・受けた表示（高さ 36px）の件名（12px）を1行に置く時に、残したい幅（px。4字と「…」）。これより狭い時（L の
 * 900〜1200px ほどのウインドウ・M の、列が 110px ほどより狭い時）は件名を2行にする（開発。1行では1〜2字しか見えないため）
 */
export const MIN_LANE_TITLE_PX = 60
/** 件名を2行にした時の2行目に残したい幅（px。2字）。2行目の右の端に印を置くと、これだけ残らない時は件名を1行目だけにする */
export const MIN_SECOND_LINE_PX = 24
/** 受けた表示の頭の「‹ 」の幅のおおよそ（px） */
const RECEIVED_PREFIX_PX = 8
/**
 * 件名を2行にした始点のカードの余白と、1行目の頭の下げ（px。week.css と同じ値）: 点線の丸はカードの左の端から 8px（ラベルの
 * 一辺 4px の右に 4px あけて）、右の余白 6px。1行目は丸（16px）とすき間 4px の分だけ下げ、2行目は丸の下へ回り込んで左の余白から
 */
export const TWO_LINES = { padLeft: 8, padRight: 6, indent: 16 + 4 } as const

/** 件名を2行にした始点のカードの、件名の幅（2行目の幅。1行目は TWO_LINES.indent だけ狭い。textPx は丸の横の字の幅） */
export function twoLineTitlePx(textPx: number): number {
  return textPx + CARD_CHROME - TWO_LINES.padLeft - TWO_LINES.padRight
}

/**
 * 始点のカードを2行の並べ方にするか（開発）: 点線の丸の横の1行に4字と「…」が入らない時（textPx < MIN_LANE_TITLE_PX）。
 * textPx は horizontalCardTextPx・verticalCardTextPx（測れていない 0 の時は 10.2 のとおり）
 */
export function startTwoLines(textPx: number): boolean {
  return textPx > 0 && textPx < MIN_LANE_TITLE_PX
}

/**
 * 件名の字の幅のおおよそ（px）。かな・漢字・全角の字は字の大きさの 1 倍（日本語の書体はどれもちょうど 1em）、それ以外（英数字・
 * 記号）は多めに見て 0.7 倍。2行にした始点のカードで、件名が1行目に入るかを決めるのに使う（入れる所は TITLE_FIT_MARGIN だけ狭く
 * 見る。多めに見て外れても、件名を2行にするだけで切れない）
 */
export function titleTextPx(text: string, fontPx = 12): number {
  let w = 0
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? fontPx : 0.7 * fontPx
  return w
}

/** 件名が1行目に入るかを決める時に、入れる所から引いておく分（2列目からの列は、帯の 1px の線の分だけ狭い） */
const TITLE_FIT_MARGIN = 1

/**
 * 始点のカードの並べ方（7.8・10.2。CSS のクラス is-two-lines・has-period・has-marks・is-marks-low）:
 * - layout 'side': 10.2 のとおり（丸の右に件名 1行、下の行に期間。期間が入らない時は日付だけ。印が件名を細くしすぎる時は、印を
 *   期間の行の右の端へ。その時に期間の行に2字も残らない時は期間を出さない）
 * - layout 'wrap': 列が狭い時（startTwoLines。開発）。点線の丸はカードの左上、件名の1行目は丸の右から、2行目は丸の下へ回り込んで
 *   左の余白から。印は2行目の右の端（2行目はその分だけ短い）。期間は出さない（線と●で見え、時刻は詳細で見る。読み上げには残す）が、
 *   件名が1行目に入り、期間（日付だけでも）が2行目にそのまま入る時（短い件名）は2行目に期間。印が広くて2行目に2字も残らない時
 *   （AI の札「Claude」の付いた物の、とても狭い列）は、件名を1行目だけにして2行目は印だけ
 */
export interface StartCardLook {
  layout: 'side' | 'wrap'
  /** 件名の行の数 */
  titleLines: 1 | 2
  /** 期間: そのまま・日付だけ・出さない（読み上げだけ） */
  period: 'full' | 'dates' | 'hidden'
  /** 印を期間の行（2行目）の右の端に置く */
  marksLow: boolean
}

/** 始点のカードの並べ方（c はその予定、date はカードを出す日、textPx は丸の横の字の幅。測れていない 0 の時は 10.2 のとおり） */
export function startCardLook(c: CalItem, date: string, textPx: number): StartCardLook {
  const item = c.item
  const marks = marksPx(item)
  if (!startTwoLines(textPx)) {
    const marksLow = laneMarksBelow(textPx, item)
    const room = marksLow ? textPx - marks : textPx
    const period = marksLow && room < MIN_SECOND_LINE_PX ? 'hidden' : periodDatesOnly(c, date, textPx) ? 'dates' : 'full'
    return { layout: 'side', titleLines: 1, period, marksLow }
  }
  const full = twoLineTitlePx(textPx)
  const line2 = full - marks
  const wrap = (titleLines: 1 | 2, period: StartCardLook['period']): StartCardLook => ({
    layout: 'wrap',
    titleLines,
    period,
    marksLow: marks > 0,
  })
  if (line2 < MIN_SECOND_LINE_PX) return wrap(1, 'hidden')
  if (titleTextPx(displayTitle(item)) <= full - TWO_LINES.indent - TITLE_FIT_MARGIN) {
    const fits = (datesOnly: boolean) => monoTextPx(timeLabel(c, { on: date, datesOnly })) <= line2 - FIT_MARGIN
    if (fits(false)) return wrap(1, 'full')
    if (item.startTime && fits(true)) return wrap(1, 'dates')
  }
  return wrap(2, 'hidden')
}

/**
 * 受けた表示の「‹ 件名」を2行にするか（開発）: 「‹ 」の後に4字と「…」が入らない時。印は2行目の右の端（2行目はその分だけ短い。
 * 2字も残らない時は2行にせず、印を件名の下の行に置く laneMarksBelow のまま）。textPx は receivedTextPx（測れていない 0 の時は1行）
 */
export function receivedTwoLines(textPx: number, item: Pick<Item, 'origin' | 'start' | 'due' | 'locked' | 'by' | 'ai'>): boolean {
  if (!(textPx > 0) || textPx - RECEIVED_PREFIX_PX >= MIN_LANE_TITLE_PX) return false
  return textPx - marksPx(item) >= MIN_SECOND_LINE_PX
}

// ---------- 週の形 ----------

/** 日の見出し（10.2・10.4） */
export interface WeekDay {
  date: string
  /** 等幅の「11/8」（月日は 0 で埋めない） */
  md: string
  off: boolean
  isToday: boolean
  /** 画面に出す祝日名（無ければ null） */
  holiday: string | null
}

/** その週・その区分の1つのレーン（7.8）と、その予定・日ごとの部分 */
export interface WeekLane extends Lane {
  c: CalItem
  parts: DayPart[]
  /** 縦（S）でレールに載せる（4本目のレーンからは載せない。10.4） */
  rail: boolean
}

/** 7日を横のレーンの行の1日分（その日にそのレーンで描く物） */
export interface LaneSlot {
  lane: WeekLane
  part: DayPart
}

/**
 * 7日を横の、レーンの行の中の線の引き方（2px・高さ 18px の所。7.8・D42。CSS のクラス is-{値}）:
 * - from-card: 始点のカード・受けた表示の右の端から列の右の端まで（次の日へ続く）
 * - through: 列の左の端から右の端まで（間の日）
 * - to-dot: 列の左の端から真ん中の●まで（締め切り日）
 * - to-arrow: 列の左の端から右の端の＞まで（次の週へ続く土曜）
 * 土曜に始まって縮むカード（shrink）と、受けた表示の中に●を置く日曜（inCard）は線を引かない
 */
export type HorizontalLine = 'from-card' | 'through' | 'to-dot' | 'to-arrow'

export function horizontalLine(p: DayPart): HorizontalLine | null {
  if (p.card) return p.lineOut && !p.shrink && !p.arrow ? 'from-card' : null
  if (!p.lineIn) return null
  if (p.dot === 'center') return 'to-dot'
  if (p.arrow) return 'to-arrow'
  return p.lineOut ? 'through' : null
}

/** 縦（S）の、日のかたまりの半分のいちばん上に並べる始点のカード・受けた表示（top は半分の上の端からの px） */
export interface VerticalCard {
  lane: WeekLane
  part: DayPart
  top: number
}

/**
 * 縦（S）のレールの縦の線（2px）の1日分。x は半分の左の端からの線の左の位置（4・14・24px）、top は上の端（px）、
 * bottom は 'end'（半分の下の端まで。arrow の時は矢印の上で止める）か、止める高さ（px。締め切り日の●の中心）
 */
export interface RailSegment {
  lane: WeekLane
  x: number
  top: number
  bottom: 'end' | number
  /** 締め切り日の●（中心の高さ px） */
  dotY?: number
  /** 土曜の下の端の下向きの矢印（次の週へ続く） */
  arrow?: boolean
}

/** 縦（S）の日のかたまりの、その半分に描く物 */
export interface VerticalHalf {
  /** 4本目のレーンからの予定で、この日が締め切り日の物の「● 件名」の行（いちばん上。レーンの順） */
  overflowRows: WeekLane[]
  /** 始点のカード・受けた表示（行の下。レーンの順） */
  cards: VerticalCard[]
  /** レールの線（レールに載せるレーンだけ） */
  rails: RailSegment[]
}

/** その週の1つの区分 */
export interface WeekKind {
  kind: ItemKind
  /** その週・その区分のレーンの数（7日を横では、どの列にもこの数 × 40px の行を取る） */
  laneCount: number
  lanes: WeekLane[]
  /** 7日を横: 日付 → レーンの番号ごとの描く物（無いレーンは null） */
  slots: Record<string, (LaneSlot | null)[]>
  /** 1日の予定（日付 → 7.5 の順。完了した物は後ろ） */
  singles: Record<string, CalItem[]>
  /** 縦（S）: レールの本数（レーンの数。最大3本） */
  rails: number
  /** 縦（S）: 日付 → その半分に描く物 */
  vertical: Record<string, VerticalHalf>
}

export interface WeekModel {
  sunday: string
  saturday: string
  days: WeekDay[]
  kinds: Record<ItemKind, WeekKind>
}

/** 縦（S）の、半分のいちばん上に並べる物の上の位置（「● 件名」の行の後に、始点のカード・受けた表示） */
export function verticalCardTop(rows: number, index: number): number {
  return WEEK_PX.halfTop + rows * (WEEK_PX.overflowRow + WEEK_PX.gap) + index * (WEEK_PX.laneCard + WEEK_PX.gap)
}

/** 縦（S）の1日分のレールの線（レールに載せるレーンの、その日の部分から。cardTop はその日の始点のカード・受けた表示の上の位置） */
export function railSegment(lane: WeekLane, part: DayPart, cardTop: number | null): RailSegment | null {
  const x = railX(lane.lane)
  if (part.card) {
    // 受けた表示の中に●を置く日曜・続かない物は線を引かない
    if (part.dot === 'inCard' || !part.lineOut || cardTop === null) return null
    const seg: RailSegment = { lane, x, top: cardTop + WEEK_PX.lineY, bottom: 'end' }
    if (part.arrow) seg.arrow = true
    return seg
  }
  if (!part.lineIn) return null
  if (part.dot === 'center') return { lane, x, top: 0, bottom: WEEK_PX.railDotY, dotY: WEEK_PX.railDotY }
  if (!part.lineOut) return null
  const seg: RailSegment = { lane, x, top: 0, bottom: 'end' }
  if (part.arrow) seg.arrow = true
  return seg
}

function buildKind(list: readonly CalItem[], sunday: string, kind: ItemKind, dates: readonly string[]): WeekKind {
  const byId = new Map<ID, CalItem>()
  for (const c of list) byId.set(c.item.id, c)
  const { lanes: raw, count } = assignLanes(weekLaneItems(list, sunday, kind), sunday)
  const lanes: WeekLane[] = []
  for (const l of raw) {
    const c = byId.get(l.id)
    if (c) lanes.push({ ...l, c, parts: laneParts(l, sunday), rail: l.lane < RAIL_MAX })
  }
  // レーンの番号の順（同じ番号の物は期間が重ならないので、日ごとに1つだけ）
  lanes.sort((a, b) => a.lane - b.lane)

  const slots: Record<string, (LaneSlot | null)[]> = {}
  const vertical: Record<string, VerticalHalf> = {}
  for (const d of dates) {
    slots[d] = Array.from({ length: count }, () => null)
    vertical[d] = { overflowRows: [], cards: [], rails: [] }
  }
  for (const lane of lanes) {
    for (const part of lane.parts) {
      const row = slots[part.date]
      if (row) row[lane.lane] = { lane, part }
      const half = vertical[part.date]
      if (!half) continue
      // 4本目のレーンからの予定は、締め切り日（その週の中で終わる日）に「● 件名」の行（次の週へ続く物には出さない。AMB-ITEMS-17）
      if (!lane.rail && part.dot === 'center') half.overflowRows.push(lane)
    }
  }
  // 始点のカード・受けた表示の位置（行の数が決まってから）と、レールの線
  for (const d of dates) {
    const half = vertical[d]
    const cards = lanes.flatMap((lane) => lane.parts.filter((p) => p.date === d && p.card).map((part) => ({ lane, part })))
    half.cards = cards.map((x, i) => ({ ...x, top: verticalCardTop(half.overflowRows.length, i) }))
    for (const lane of lanes) {
      if (!lane.rail) continue
      const part = lane.parts.find((p) => p.date === d)
      if (!part) continue
      const card = half.cards.find((x) => x.lane === lane)
      const seg = railSegment(lane, part, card ? card.top : null)
      if (seg) half.rails.push(seg)
    }
  }
  return {
    kind,
    laneCount: count,
    lanes,
    slots,
    singles: weekSingles(list, sunday, kind),
    rails: Math.min(count, RAIL_MAX),
    vertical,
  }
}

/**
 * その週（sunday はその週の日曜）の形。list はカレンダーに出る項目（useCalendarData の list）、off は休みの日、today は今日。
 * 区分ごとに、複数日の予定のレーン（完了した物もレーンの位置に残す。7.5）と、1日の予定（7.5 の順）
 */
export function buildWeek(sunday: string, list: readonly CalItem[], off: ReadonlySet<string>, today: string): WeekModel {
  const dates = weekDates(sunday)
  const days = dates.map(
    (date): WeekDay => ({ date, md: mdLabel(date), off: off.has(date), isToday: date === today, holiday: holidayName(date) }),
  )
  const kinds = Object.fromEntries(ITEM_KINDS.map((k) => [k, buildKind(list, sunday, k, dates)])) as Record<ItemKind, WeekKind>
  return { sunday, saturday: addDaysYmd(sunday, 6), days, kinds }
}
