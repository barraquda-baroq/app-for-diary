// デイリーの見た目の計算（docs/SPEC.md の 11.1〜11.3・7.5・7.8・7.9）。画面（DayView）は useCalendarData() の一覧からこれを
// useMemo で作って描くだけにする。React・ストアを読まない純粋な関数だけ（src/features/calendar/purity.test.ts）。
// - 日の見出し（11.1）: 「2026.11.10」・今日か・休みか・祝日名
// - 時間指定なしのリスト（11.2）: 上＝仕事・下＝プライベートの区切りごとの行（7.5 の並び・複数日の右の端の表記）と、まだ完了していない数
// - タイムスケジュール（11.3）: 時刻のある予定のその日の部分を、重なりの列（L・M は4列、S は3列。日をまたぐ予定の部分は左の列、
//   1日の予定は1日の予定どうしの重なりだけでまとめてその右に）に並べた枠の位置と高さ（px）、列に入らない分の「+n」の札（札の所を
//   空けて、予定に重ねない）、開いた時の位置、押した所の時刻
// 時刻の計算（その日の部分・重なり・開始のカードの高さ）は src/domain/dayLayout.ts、並びは src/domain/calendar.ts にあり、ここでは
// 1時間の高さ（L・M 48px、S 44px）で px に直し、枠の中の出し方（1行にまとめるか・件名を何行まで出すか・線と●／矢印）を決める。
// 枠の幅（px）で決める所（狭い枠では印を時刻の行へ下ろす・入らない時刻を短くする。fitBox）と、マンスリーの数字から来た時の位置
// （arrivalScrollPx）は、画面が測った幅・高さを渡して決める
import { dayList, dayTimed, dayUndone, type CalItem, type DayRow } from '../../../domain/calendar'
import { displayHm, dottedDate, mdLabel } from '../../../domain/dates'
import {
  DAY_MINUTES,
  EVENT_MIN_PX,
  HOUR_PX,
  initialScrollMinute,
  layoutPieces,
  minMinutesOf,
  piecesOn,
  startCardHeightPx,
  timedInputs,
  type Piece,
  type Placed,
} from '../../../domain/dayLayout'
import { holidayName } from '../../../domain/holidays'
import { hasDueMark } from '../../../domain/items'
import { listTail, timeLabel, type ListTail } from '../../../domain/itemText'
import { ITEM_KINDS, type ID, type Item, type ItemKind } from '../../../domain/types'
import { aiTagText, displayTitle, hasAiTag, kindOf } from '../common/parts/itemLook'
import type { WidthClass } from '../common/types'

// ---------- 大きさ（px。day.css と同じ値） ----------

/** 日の見出しの高さ（11.1） */
export const DAY_HEAD_PX = 40
/** 時刻の欄の幅（11.3） */
export const AXIS_PX = 48
/** 予定の枠の上下の余白（11.3） */
export const EVENT_PAD_Y = 4
/** 予定の枠の線（1px の --border。上と下で 2px） */
export const EVENT_BORDER_Y = 2
/** 予定の件名の1行の高さ（12px・500。1行にまとめた枠では 14px） */
export const EVENT_TITLE_LINE = 16
export const EVENT_COMPACT_LINE = 14
/** 予定の時刻の1行の高さ（等幅 11px） */
export const EVENT_TIME_LINE = 14
/**
 * 日をまたぐ予定で、開始のカードの下に線と終わりの印（● 10px・矢印 12px）を出すのに要る高さ。部分がカードよりこれだけ長くない時は、
 * 線を引かずに印をカードの右端の中に置く（AMB-ITEMS-11 の「部分がカードより短い時」を、印の分まで広げた物。カードのすぐ下に印を
 * 出すと、印の大半がカードに隠れる）
 */
export const END_MARK_ROOM_PX = 16

/** 1時間の高さ（L・M 48px、S 44px。11.3） */
export function hourPxOf(width: WidthClass): number {
  return width === 'S' ? HOUR_PX.S : HOUR_PX.LM
}

/** 重なった時に並べる列の数の上限（L・M は4つ、S は3つ。11.3） */
export function maxColsOf(width: WidthClass): 3 | 4 {
  return width === 'S' ? 3 : 4
}

/** 0:00 からの分 → タイムスケジュールの上からの px */
export function minuteToPx(minute: number, hourPx: number): number {
  return (minute * hourPx) / 60
}

/** タイムスケジュールの上からの px → 0:00 からの分（0〜1440 に収める。空いた所を押した時の時刻。11.3） */
export function pxToMinute(px: number, hourPx: number): number {
  const m = (px * 60) / hourPx
  return Math.min(DAY_MINUTES, Math.max(0, Number.isFinite(m) ? m : 0))
}

/** その時刻（ミリ秒）の、端末の暦での 0:00 からの分（今の時刻の線・開いた時の位置） */
export function minuteOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** 開いた時の位置（上の端の px。今日は今の時刻の 60分前、ほかの日は 7:00。11.3・AMB-ITEMS-31） */
export function initialScrollPx(isToday: boolean, nowMinute: number, hourPx: number): number {
  return minuteToPx(initialScrollMinute(isToday, nowMinute), hourPx)
}

// ---------- 日の見出し（11.1） ----------

export interface DayHeadVM {
  date: string
  /** 等幅の「2026.11.10」 */
  dotted: string
  isToday: boolean
  /** 休みの日（見出しの行だけを --off-fill にして「休」を出す。ここでは付け外しできない。D40） */
  off: boolean
  /** 画面に出す祝日名（無ければ null。見出しの行の中に出す。D21） */
  holiday: string | null
}

// ---------- 時間指定なしのリスト（11.2） ----------

export interface DayListRowVM {
  c: CalItem
  /** 1日の予定・複数日の初日・間の日・最終日 */
  role: DayRow['role']
  /** 複数日の予定の右の端（「━＞ 〜11/11」「━●」と受けた表示。1日の予定は null） */
  tail: ListTail | null
}

export interface DaySectionVM {
  kind: ItemKind
  /** 7.5 の並び（完了した物も含む） */
  rows: DayListRowVM[]
  /** 見出しの数: その日・その区分の、まだ完了していない予定の全部（時刻のある物も含む。マンスリーのその日の数と同じ） */
  undone: number
}

// ---------- タイムスケジュール（11.3） ----------

/**
 * タイムスケジュールの1つの枠（1日の予定の枠、または日をまたぐ予定のその日の部分）。位置は px（タイムスケジュールの上から）、
 * 横は予定を置ける幅に掛ける割合と、そこから引く「+n」の札の所の数（day.css が left・width にする。src/domain/dayLayout.ts の Span）
 */
export interface TimedBoxVM {
  c: CalItem
  part: Piece['part']
  /** その日の部分（0:00 からの分） */
  start: number
  end: number
  /** 列（1日の予定はまとまりの中、日をまたぐ予定は左から何本目か）と列の数 */
  col: number
  cols: number
  /** 左の端（予定を置ける幅の x 倍 − 札の所 xRoom 個） */
  x: number
  xRoom: number
  /** 幅（予定を置ける幅の w 倍 − 札の所 wRoom 個） */
  w: number
  wRoom: number
  /** 上の端（px） */
  top: number
  /**
   * 高さ（px）。1日の予定は枠の高さ（最小 24px）。日をまたぐ予定は部分の高さ（開始のカードが貼り付いて動ける範囲。
   * カードより短い時はカードの高さ）
   */
  height: number
  /** 日をまたぐ予定の開始のカードの高さ（max(24, min(40, 部分の高さ))。D39）。1日の予定は枠の高さと同じ */
  card: number
  /**
   * 日をまたぐ予定: カードの下から部分の終わりまで線を引くか（部分がカードより END_MARK_ROOM_PX 以上長い時だけ。そうでない時は
   * ●・矢印をカードの中に置く。AMB-ITEMS-11）
   */
  line: boolean
  /** 日をまたぐ予定の部分の終わりの印（最終日は●、ほかは下向きの矢印。1日の予定は null） */
  endMark: 'dot' | 'arrow' | null
  /** 完了の点線の丸を置くか（1日の予定と、日をまたぐ予定の初日のカード。2日目からの「‹ 」のカードには置かない。D39） */
  ring: boolean
  /** 受けた表示（件名の頭に「‹ 」。日をまたぐ予定の2日目から） */
  received: boolean
  /** 件名と時刻を1行にまとめる（枠・カードの高さに2行が入らない時） */
  compact: boolean
  /** 件名を出す行の数（入るだけ。1行にまとめた時は 1） */
  lines: number
}

/**
 * 列に入らなかった予定の「+n」の札（まとまりの右の端に空けた札の所に、隠れた予定のいちばん早い時刻の高さで。予定の上に重ねない。
 * AMB-ITEMS-13）。押すと隠れた予定の一覧（11.3）
 */
export interface MoreChipVM {
  /** 隠れた予定のいちばん早い始まり（分） */
  at: number
  /** 上の端（px） */
  top: number
  ids: ID[]
  /** 隠れた予定（一覧に出す物。並べ方の順） */
  items: CalItem[]
}

export interface TimelineVM {
  boxes: TimedBoxVM[]
  more: MoreChipVM[]
  /** 1時間の高さ（px） */
  hourPx: number
  /** 0:00〜24:00 の高さ（px） */
  dayPx: number
  /**
   * 24:00 より下に出る分（px）。最小の高さ（24px）の枠は始まりの時刻から描くので（重なりの計算 layoutPieces と同じ）、
   * 23:30 より後に始まる短い予定は 24:00 の下へ少し出る。その分だけ下に余白を足し、枠が切れないようにする
   */
  tailPx: number
}

export interface DayVM {
  head: DayHeadVM
  /** 仕事 → プライベートの順（上＝仕事・下＝プライベート。11.2） */
  sections: DaySectionVM[]
  timeline: TimelineVM
}

/** 件名と時刻を2行に分けて出せる枠の最小の高さ（これより低い枠は1行にまとめる） */
const TWO_ROWS_PX = EVENT_BORDER_Y + EVENT_PAD_Y * 2 + EVENT_TITLE_LINE + EVENT_TIME_LINE

/** 枠の高さから、件名を出す行の数（下に時刻の1行を残して、入るだけ） */
function titleLines(heightPx: number): number {
  const inner = heightPx - EVENT_BORDER_Y - EVENT_PAD_Y * 2 - EVENT_TIME_LINE
  return Math.max(1, Math.floor(inner / EVENT_TITLE_LINE))
}

/** その日の部分を、枠の位置と出し方にする */
function boxOf(c: CalItem, p: Placed, hourPx: number): TimedBoxVM {
  const top = minuteToPx(p.start, hourPx)
  const piecePx = minuteToPx(p.end - p.start, hourPx)
  const across = { col: p.col, cols: p.cols, x: p.x.f, xRoom: p.x.room, w: p.w.f, wRoom: p.w.room }
  if (p.part === 'single') {
    const height = Math.max(EVENT_MIN_PX, piecePx)
    const compact = height < TWO_ROWS_PX
    return {
      c,
      part: p.part,
      start: p.start,
      end: p.end,
      ...across,
      top,
      height,
      card: height,
      line: false,
      endMark: null,
      ring: true,
      received: false,
      compact,
      lines: compact ? 1 : titleLines(height),
    }
  }
  const card = startCardHeightPx(piecePx)
  return {
    c,
    part: p.part,
    start: p.start,
    end: p.end,
    ...across,
    top,
    height: Math.max(card, piecePx),
    card,
    line: piecePx - card >= END_MARK_ROOM_PX,
    endMark: p.part === 'last' ? 'dot' : 'arrow',
    ring: p.part === 'first',
    received: p.part !== 'first',
    compact: card < TWO_ROWS_PX,
    lines: 1,
  }
}

/**
 * タイムスケジュール（11.3）: その日の時刻のある予定（区分は混ぜる。日をまたぐ物はその日の部分）を、重なりの列に並べる。
 * 並べ方は 7.5 の順（dayTimed）で渡すので、始まりと長さが同じ物は 7.5 の順に左から入る
 */
export function buildTimeline(list: readonly CalItem[], date: string, width: WidthClass): TimelineVM {
  const hourPx = hourPxOf(width)
  const timed = dayTimed(list, date)
  const byId = new Map(timed.map((c) => [c.item.id, c]))
  const { placed, overflow } = layoutPieces(piecesOn(timedInputs(timed), date), {
    maxCols: maxColsOf(width),
    minMinutes: minMinutesOf(hourPx),
  })
  const boxes: TimedBoxVM[] = []
  for (const p of placed) {
    const c = byId.get(p.id)
    if (c) boxes.push(boxOf(c, p, hourPx))
  }
  const dayPx = minuteToPx(DAY_MINUTES, hourPx)
  const bottom = boxes.reduce((max, b) => Math.max(max, b.top + b.height), dayPx)
  return {
    boxes,
    more: overflow.map((o) => ({
      at: o.at,
      top: minuteToPx(o.at, hourPx),
      ids: o.ids,
      items: o.ids.flatMap((id) => byId.get(id) ?? []),
    })),
    hourPx,
    dayPx,
    tailPx: Math.ceil(bottom - dayPx),
  }
}

/** 時間指定なしのリストの1つの区切り（11.2） */
export function buildSection(list: readonly CalItem[], date: string, kind: ItemKind): DaySectionVM {
  return {
    kind,
    rows: dayList(list, date, kind).map(({ c, role }) => ({ c, role, tail: listTail(c, date) })),
    undone: dayUndone(list, date, kind),
  }
}

/**
 * デイリーの1日（11.）: 日の見出し・時間指定なしのリスト（仕事 → プライベート）・タイムスケジュール。
 * list は useCalendarData() の一覧（表示用に直した記録。6.12）、off は休みの日、today は今日（'YYYY-MM-DD'）
 */
export function buildDay(
  date: string,
  list: readonly CalItem[],
  off: ReadonlySet<string>,
  today: string,
  width: WidthClass,
): DayVM {
  return {
    head: { date, dotted: dottedDate(date), isToday: date === today, off: off.has(date), holiday: holidayName(date) },
    sections: ITEM_KINDS.map((kind) => buildSection(list, date, kind)),
    timeline: buildTimeline(list, date, width),
  }
}

// ---------- 予定の枠の中の出し方（枠の幅で決める。11.3・D39） ----------

/** 予定を置ける幅の右の空き（px。空いた時間を押せるように残す。day.css の「100% − 8px」） */
export const EVENTS_RIGHT_PX = 8
/** 「+n」の札の所（px。day.css の --more-room） */
export const MORE_ROOM_PX = 24
/** 列の間（px。day.css の left の +2px・width の −2px） */
export const COLUMN_GAP_PX = 2
/** 枠の左右の線（1px ずつ）・左の余白（点線の丸のある枠は丸の分を足して 30px、無い枠は 10px）・右の余白 */
const BOX_BORDER_X = 2
const BOX_PAD_LEFT_RING = 30
const BOX_PAD_LEFT = 10
const BOX_PAD_RIGHT = 6
/** 件名・時刻と印の間、印どうしの間（day.css・parts.css の gap） */
const MARK_GAP = 4
/** 1行にまとめた枠の、件名と時刻の間 */
const COMPACT_TIME_GAP = 6
/** 印の幅（px。区分のアイコン 12・〆 11・ロック 12・AI の札「Claude」44・「AI」20・終わりの● 10・矢印 12） */
const MARK_PX = { kind: 12, due: 11, lock: 12, aiClaude: 44, ai: 20, dot: 10, arrow: 12 } as const
/**
 * 2行の枠で件名に残したい幅（px。12px の字で5字）。印を件名の横に置くとこれより狭くなり、件名が入らない枠は、印を時刻の行の右へ
 * 下ろす（これより広くても、下ろせば件名が入りきる時は下ろす）
 */
export const MIN_TITLE_PX = 60
/**
 * 1行にまとめた枠で件名に残したい幅（px。12px の字で3字）。〆・ロック・AI の札まで出すとこれより狭くなり、件名が入らない枠は、
 * 印を区分のアイコンだけにする（下ろす行が無いので）
 */
export const MIN_COMPACT_TITLE_PX = 36
/** 時刻が入るかを見る時に、入れる所から引いておく分（書体の違い） */
const FIT_MARGIN = 2

/** 予定の枠の幅（px）。eventsPx は予定を置ける所（時刻の欄の右）の幅。day.css の width と同じ式 */
export function boxPx(b: Pick<TimedBoxVM, 'w' | 'wRoom'>, eventsPx: number): number {
  return (eventsPx - EVENTS_RIGHT_PX) * b.w - MORE_ROOM_PX * b.wRoom - COLUMN_GAP_PX
}

/** 枠の中の字の所の幅（px。枠の幅 − 左右の線 − 左右の余白） */
export function boxTextPx(b: Pick<TimedBoxVM, 'w' | 'wRoom' | 'ring'>, eventsPx: number): number {
  return boxPx(b, eventsPx) - BOX_BORDER_X - (b.ring ? BOX_PAD_LEFT_RING : BOX_PAD_LEFT) - BOX_PAD_RIGHT
}

/**
 * 枠の右上の印の幅（px）: 区分のアイコン → 〆 → ロック → AI の札、日をまたぐ予定の線を引かないカードは右端の●・矢印（間 4px）。
 * thin は区分のアイコンと●・矢印だけにした時
 */
export function boxMarksPx(
  item: Pick<Item, 'origin' | 'start' | 'due' | 'locked' | 'by' | 'ai'>,
  inlineEnd: 'dot' | 'arrow' | null,
  thin = false,
): number {
  const widths: number[] = [MARK_PX.kind]
  if (!thin) {
    if (hasDueMark(item)) widths.push(MARK_PX.due)
    if (item.locked) widths.push(MARK_PX.lock)
    if (hasAiTag(item)) widths.push(aiTagText(item) === 'Claude' ? MARK_PX.aiClaude : MARK_PX.ai)
  }
  if (inlineEnd) widths.push(MARK_PX[inlineEnd])
  return widths.reduce((a, b) => a + b, 0) + MARK_GAP * (widths.length - 1)
}

/** 全角の字か（ひらがな・カタカナ・漢字・〜 など。英数字と記号の – ‹ は半分の幅） */
const isWide = (ch: string): boolean => (ch.codePointAt(0) ?? 0) >= 0x2e80

/** 等幅（Roboto Mono）の字の幅のおおよそ（px）: 英数字は字の大きさの 0.6 倍、〜 などの全角の字（ゴシックで出る）は 1 倍 */
export function monoPx(text: string, fontPx = 11): number {
  let w = 0
  for (const ch of text) w += isWide(ch) ? fontPx : 0.6 * fontPx
  return w
}

/** 件名（ui の書体）の1字の幅のおおよそ（px。全角は 1.02 倍、英数字は 0.6 倍で、少し多めに見る） */
const titleCharPx = (ch: string, fontPx: number): number => (isWide(ch) ? 1.02 * fontPx : 0.6 * fontPx)

/** 件名（ui の書体）の字の幅のおおよそ（px） */
export function titlePx(text: string, fontPx = 12): number {
  let w = 0
  for (const ch of text) w += titleCharPx(ch, fontPx)
  return w
}

/** 件名を roomPx の幅で折り返した時の行の数のおおよそ（どこでも折り返せるとして、1字ずつ詰める。幅が無い時は Infinity） */
export function titleLineCount(text: string, roomPx: number, fontPx = 12): number {
  if (!text) return 1
  let lines = 1
  let used = 0
  for (const ch of text) {
    const w = titleCharPx(ch, fontPx)
    if (w > roomPx) return Infinity
    if (used + w > roomPx) {
      lines++
      used = 0
    }
    used += w
  }
  return lines
}

/**
 * 枠に出す時刻・期間の候補（長い順。7.7）: 1日の予定は「10:00–11:30」→「10:00」（開始だけ）。日をまたぐ予定は
 * 「11/9 10:00〜11/12 18:00」→「11/9〜11/12」（日付だけ）→「〜11/12」（最終日は「11/9〜」）
 */
export function timeChoices(c: CalItem, date: string): string[] {
  const full = timeLabel(c, { on: date })
  if (!full) return []
  const out = [full]
  if (!c.multi) {
    if (c.item.startTime) out.push(displayHm(c.item.startTime))
  } else {
    out.push(timeLabel(c, { on: date, datesOnly: true }))
    out.push(date === c.to ? `${mdLabel(c.from)}〜` : `〜${mdLabel(c.to)}`)
  }
  return out.filter((t, i) => t && out.indexOf(t) === i)
}

/** 枠の幅に合わせた中の出し方 */
export interface BoxFit {
  /**
   * 印を時刻の行の右へ下ろし、件名に字の所の幅いっぱいを使う（2行が入る枠で、印を件名の横に置くと件名が入りきらず、下ろせば
   * 入りきる時か、件名に MIN_TITLE_PX も残らない時。1行にまとめた枠は下ろす行が無いので false）
   */
  narrow: boolean
  /** 印を区分のアイコン（と●・矢印）だけにする（〆・ロック・AI の札まで出すと、件名・字の所に入らない、とても狭い枠） */
  thinMarks: boolean
  /** 出す時刻・期間（候補のうち入るいちばん長い物。どれも入らない時は ''。途中で切らない） */
  time: string
  /** 読み上げる時刻・期間（いつも長い表記。時刻の無い物は ''） */
  timeFull: string
}

/**
 * 枠の幅（eventsPx は予定を置ける所の幅。測れていない時は 0）に合わせて、枠の中の出し方を決める（11.3・D39）。
 * - 2行の枠: 印を件名の横に置くと件名が出せる行（lines。横が 5字（MIN_TITLE_PX）より狭い時は1行）に入りきらない時は、下ろせば
 *   入りきるか、件名に 5字も残らない時に、印を時刻の行の右へ下ろし、件名は字の所の幅いっぱい（narrow）。時刻はその行の印の左
 *   （下ろさない時は字の所の幅いっぱい）に入る候補。横に入りきる件名（「電話」）は印を横に置いたままにして、時刻に幅いっぱいを残す
 * - 1行の枠: 件名を先に出し、時刻は件名の後ろに入る候補。印まで出すと件名に 3字が残らず件名が入らない時は、印を区分のアイコンだけに
 * - 下ろしても印が字の所に入らない時も、印を区分のアイコンだけに
 * 測れていない時は、印を件名の横・時刻は長い表記のまま。件名の幅は字の数からのおおよそ（titlePx）
 */
export function fitBox(b: TimedBoxVM, eventsPx: number, date: string): BoxFit {
  const choices = timeChoices(b.c, date)
  const timeFull = choices[0] ?? ''
  if (!(eventsPx > 0)) return { narrow: false, thinMarks: false, time: timeFull, timeFull }
  const text = boxTextPx(b, eventsPx)
  const inlineEnd = b.part === 'single' || b.line ? null : (b.endMark ?? 'arrow')
  const marks = boxMarksPx(b.c.item, inlineEnd)
  const thin = boxMarksPx(b.c.item, inlineEnd, true)
  const titleText = `${b.received ? '‹ ' : ''}${displayTitle(b.c.item)}`
  const title = titlePx(titleText)
  const beside = text - marks - MARK_GAP
  const pick = (room: number) => choices.find((t) => monoPx(t) <= room - FIT_MARGIN) ?? ''
  if (b.compact) {
    const thinMarks = marks > thin && beside < MIN_COMPACT_TITLE_PX && title > beside
    const room = text - (thinMarks ? thin : marks) - MARK_GAP - title - COMPACT_TIME_GAP
    return { narrow: false, thinMarks, time: pick(room), timeFull }
  }
  // 横の幅が狭い（MIN_TITLE_PX より狭い）時は、1行に入る時だけ横に置く（「電／話」のように1字ずつ折り返さない）
  const fitsBeside = titleLineCount(titleText, beside) <= (beside >= MIN_TITLE_PX ? b.lines : 1)
  const fitsBelow = titleLineCount(titleText, text) <= b.lines
  if (fitsBeside || (!fitsBelow && beside >= MIN_TITLE_PX)) {
    return { narrow: false, thinMarks: false, time: pick(text), timeFull }
  }
  const thinMarks = marks > thin && marks > text
  return { narrow: true, thinMarks, time: pick(text - (thinMarks ? thin : marks) - MARK_GAP), timeFull }
}

// ---------- マンスリーの数字から来た時の位置（11.2・4.9） ----------

/** 予定が見えているとみなす、見えている部分の高さ（px。件名の行の分。枠がこれより低い時は枠の高さ） */
const SEEN_PX = 24

/**
 * マンスリーの数字から来て、タイムスケジュールのその区分の予定を目立たせる時の位置（上の端の px。動かさない時は null）。
 * view は今の位置（top）・見えている高さ（height）・いちばん下まで動かした時の位置（max）。
 * 目立たせる予定の枠（その区分の1日の予定と、日をまたぐ予定のその日の部分。部分は見えている間カードが上に貼り付く）が今の位置で
 * みな見えていれば動かさない。見えない物がある時は、各予定の始まりの 30分前を上の端にした位置のうち、見える予定がいちばん多い
 * 位置（同じ数なら早い方）へ動かす（今の位置より多く見える時だけ）
 */
export function arrivalScrollPx(
  boxes: readonly TimedBoxVM[],
  kind: ItemKind,
  view: { top: number; height: number; max: number },
  hourPx: number,
): number | null {
  const mine = boxes.filter((b) => kindOf(b.c.item) === kind)
  if (!mine.length || !(view.height > 0)) return null
  const seenAt = (top: number) =>
    mine.filter((b) => Math.min(b.top + b.height, top + view.height) - Math.max(b.top, top) >= Math.min(b.height, SEEN_PX)).length
  let best = view.top
  let most = seenAt(view.top)
  if (most === mine.length) return null
  const starts = mine.map((b) => Math.min(Math.max(0, view.max), Math.max(0, b.top - hourPx / 2))).sort((a, b) => a - b)
  for (const top of starts) {
    const n = seenAt(top)
    if (n > most) {
      best = top
      most = n
    }
  }
  return best === view.top ? null : best
}
