// デイリーの見た目の計算（docs/SPEC.md の 11.1〜11.3・7.5・7.8・7.9）。画面（DayView）は useCalendarData() の一覧からこれを
// useMemo で作って描くだけにする。React・ストアを読まない純粋な関数だけ（src/features/calendar/purity.test.ts）。
// - 日の見出し（11.1）: 「2026.11.10」・今日か・休みか・祝日名
// - 時間指定なしのリスト（11.2）: 上＝仕事・下＝プライベートの区切りごとの行（7.5 の並び・複数日の右の端の表記）と、まだ完了していない数
// - タイムスケジュール（11.3）: 時刻のある予定のその日の部分を、重なりの列（L・M は4列、S は3列）に並べた枠の位置と高さ（px）、
//   列に入らない分の「+n」の札、開いた時の位置、押した所の時刻
// 時刻の計算（その日の部分・重なり・開始のカードの高さ）は src/domain/dayLayout.ts、並びは src/domain/calendar.ts にあり、ここでは
// 1時間の高さ（L・M 48px、S 44px）で px に直し、枠の中の出し方（1行にまとめるか・件名を何行まで出すか・線と●／矢印）を決める
import { dayList, dayTimed, dayUndone, type CalItem, type DayRow } from '../../../domain/calendar'
import { dottedDate } from '../../../domain/dates'
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
} from '../../../domain/dayLayout'
import { holidayName } from '../../../domain/holidays'
import { listTail, type ListTail } from '../../../domain/itemText'
import { ITEM_KINDS, type ID, type ItemKind } from '../../../domain/types'
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
 * 横は列（col）と列の数（cols）で、幅は列の数で等分する
 */
export interface TimedBoxVM {
  c: CalItem
  part: Piece['part']
  /** その日の部分（0:00 からの分） */
  start: number
  end: number
  col: number
  cols: number
  /** 上の端（px） */
  top: number
  /**
   * 高さ（px）。1日の予定は枠の高さ（最小 24px）。日をまたぐ予定は部分の高さ（開始のカードが貼り付いて動ける範囲。
   * カードより短い時はカードの高さ）
   */
  height: number
  /** 日をまたぐ予定の開始のカードの高さ（max(24, min(40, 部分の高さ))。D39）。1日の予定は枠の高さと同じ */
  card: number
  /** 日をまたぐ予定: カードの下から部分の終わりまで線を引くか（部分がカードより長い時だけ。AMB-ITEMS-11） */
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

/** 列に入らなかった予定の「+n」の札（最後の列の右端に、隠れた予定のいちばん早い時刻の高さで。AMB-ITEMS-13） */
export interface MoreChipVM {
  /** 隠れた予定のいちばん早い始まり（分） */
  at: number
  /** 上の端（px） */
  top: number
  ids: ID[]
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
function boxOf(c: CalItem, p: Piece & { col: number; cols: number }, hourPx: number): TimedBoxVM {
  const top = minuteToPx(p.start, hourPx)
  const piecePx = minuteToPx(p.end - p.start, hourPx)
  if (p.part === 'single') {
    const height = Math.max(EVENT_MIN_PX, piecePx)
    const compact = height < TWO_ROWS_PX
    return {
      c,
      part: p.part,
      start: p.start,
      end: p.end,
      col: p.col,
      cols: p.cols,
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
    col: p.col,
    cols: p.cols,
    top,
    height: Math.max(card, piecePx),
    card,
    line: piecePx > card,
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
    more: overflow.map((o) => ({ at: o.at, top: minuteToPx(o.at, hourPx), ids: o.ids })),
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
