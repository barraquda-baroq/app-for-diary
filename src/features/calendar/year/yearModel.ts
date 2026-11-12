// イヤーの中身と並べ方を決める純粋な関数（docs/SPEC.md の 8.・7.1〜7.4・7.9・4.7・4.12。D07・D28・D53）。
// 画面（YearView）は、ここが決めた物をそのまま描くだけにする。React・ストアを読まない（src/features/calendar/purity.test.ts）
// - 並べ方: カレンダーの領域の幅が 870px 以上なら「月を行・日を列」（rows。8.2）、それより狭いと「小さな月を並べる」（mini。8.3）。
//   幅は CSS の幅の区分ではなく、CalendarView が測った領域の幅で決める（D53）
// - 日のマス: 日付・英字3文字の曜日・色（日曜と祝日は sun、土曜は sat。今日も同じ色のまま。D07）・今日・休み・●（仕事・プライベートの
//   決まった2つの場所。予定のある日は完了した物も含め、全部完了なら薄く。7.9）・読み上げ（祝日名もここで伝える。画面には出さない。7.2）
// - 月: 「NOV」・今月か・1日（見出しを押した時の行き先）・1日の曜日（小さな月の 7×6 のマスの初めの空き）
// - キーボード（PC）で日のマスの間を動く時の行き先（yearMove。マンスリーの rovingIndex と同じ考え方で、並べ方ごとの向き）
import { yearDots, type CalItem, type DotState } from '../../../domain/calendar'
import { addDaysYmd, daysInMonth, jaDateLabel, MONTHS_EN, pad2, weekdayOfYmd, WEEKDAYS_EN } from '../../../domain/dates'
import { holidaysOfYear } from '../../../domain/holidays'
import { ITEM_KINDS, type ItemKind } from '../../../domain/types'
import type { WidthClass } from '../common/types'

// ---------- 並べ方（8.1・8.2・8.3） ----------

/**
 * 「月を行・日を列」にする領域の幅の下限（px）。64 + 31 × 24 + 31 × 2 ＝ 870（1日のマスの幅が 24px を切ると日付が読めない。8.1）。
 * M の領域は最大 867px なので、M・S はいつも小さな月
 */
export const YEAR_ROWS_MIN_PX = 870
/** 月の見出しの帯の幅（8.2） */
export const YEAR_BAND_PX = 64
/** 日のマスの間のすき間（帯と1日の間も。8.2） */
export const YEAR_GAP_PX = 2
/** 小さな月の列の数を決める幅（floor(領域の幅 ÷ 170px)。8.3） */
export const MINI_COLUMN_PX = 170
/** 小さな月のマスの1辺の下限（8.3）。7列 × 22 = 154px が小さな月の幅の下限 */
export const MINI_CELL_MIN_PX = 22

export type YearLayout = 'rows' | 'mini'

/** 領域の幅（px）から並べ方を決める（870px 以上は rows。8.1） */
export function yearLayout(areaPx: number): YearLayout {
  return areaPx >= YEAR_ROWS_MIN_PX ? 'rows' : 'mini'
}

/**
 * 小さな月の列の数（floor(領域の幅 ÷ 170px) を 2〜4 に収めた数。S はいつも2列。8.3・CALENDAR-220）。
 * S の領域は 599px の窓で 550px ほどあり、170px で割ると3列になるので、S は幅の区分で2列に決める
 */
export function miniColumns(areaPx: number, width: WidthClass): 2 | 3 | 4 {
  if (width === 'S') return 2
  const n = Math.floor(Math.max(0, areaPx) / MINI_COLUMN_PX)
  return n <= 2 ? 2 : n >= 4 ? 4 : 3
}

/** 「月を行・日を列」の日のマスの幅（px）: （領域の幅 − 64px − 31 × 2px）÷ 31（8.2） */
export function rowsCellPx(areaPx: number): number {
  return (areaPx - YEAR_BAND_PX - 31 * YEAR_GAP_PX) / 31
}

/**
 * マスの左上の日付と右上の●の場所が横に並べられる、日のマスの幅の下限（px）。
 * 左右の余白 3px ずつ ＋ 2桁の日付（等幅 12px の Roboto Mono は 1字 0.6em ＝ 7.2px なので 14.4px）＋ 間 2px ＋ ●の2つの場所
 * （5 ＋ 2 ＋ 5 ＝ 12px）＝ 34.4px。測った領域の幅は、イヤーの中のスクロールバーの分（31 で割ると 0.5px ほど）だけ実際より
 * 広いことがあるので、35px にする
 */
export const DOTS_TOP_MIN_PX = 35

/** ●の2つの場所の段: top = 右上（8.2）、below = 曜日の下の段（マスが狭くて日付と●の間が取れない時。D28） */
export type DotsRow = 'top' | 'below'

/**
 * 「月を行・日を列」の●の段（D28・AMB-CAL-18: 日付と●の間が取れない幅では●の2つの場所を下ろす）。
 * D28 は 28px で分けるとしていたが、28px のマスでは 2桁の日付（14.4px）と●の2つの場所（12px）が重なる（幅 1400px の窓の
 * 領域 994px でマスはちょうど 28px）ので、実際に並べられる幅（DOTS_TOP_MIN_PX）で分ける。下ろす先は曜日の下の段（曜日の横は
 * 「SUN」の 16px と●の 12px が 24〜34px のマスに入らない）。どちらの段でも、仕事が左・プライベートが右の決まった場所
 */
export function dotsRow(cellPx: number): DotsRow {
  return cellPx >= DOTS_TOP_MIN_PX ? 'top' : 'below'
}

// ---------- 中身（8.2・8.3・7.1〜7.4・7.9） ----------

/** 日付・曜日の色（7.1）: 日曜と祝日は --sun、土曜は --sat、ほかは色なし。今日も同じ（今日は枠と太さだけ。D07） */
export type YearTone = 'sun' | 'sat' | null

/** 1日のマス */
export interface YearDayVM {
  /** 'YYYY-MM-DD' */
  date: string
  /** 日（1〜31） */
  day: number
  /** 英字3文字の曜日（SUN〜SAT） */
  weekday: string
  tone: YearTone
  /** 今日（マスの内側に 2px の --accent の枠と日付の太さ 600。7.3・D07） */
  isToday: boolean
  /** 休み（マスの地を --off-fill。8.2） */
  off: boolean
  /** ●（区分ごと。none = 予定なし（場所は空けたまま）、open = 予定あり、allDone = 全部完了（不透明度 0.35）。8.2・7.9） */
  dots: Record<ItemKind, DotState>
  /** 読み上げ（「11月3日（火）、仕事の予定あり、プライベートの予定（すべて完了）、休み、文化の日」。4.12） */
  label: string
}

/** 1つの月 */
export interface YearMonthVM {
  /** 月（1〜12） */
  m: number
  /** 英字3文字の月（JAN〜DEC） */
  name: string
  /** 今月（帯は今日の印、小さな月の名前は --accent。8.2・8.3・7.3） */
  isThisMonth: boolean
  /** その月の1日（月の見出しを押した時に見る日。8.4） */
  first: string
  /** 1日の曜日（0 = 日曜。小さな月の 7×6 のマスで、1日の前に空ける数） */
  lead: number
  /** その月の日（1日〜月末。その月に無い日（2月30日など）は無い。8.2） */
  days: YearDayVM[]
  /** 月の見出しのボタンの読み上げ（「2026年11月をマンスリーで見る」） */
  label: string
}

const NO_DOTS: Readonly<Record<ItemKind, DotState>> = Object.freeze({ work: 'none', private: 'none' })

/**
 * その年の 12か月（1月〜12月）。list はカレンダーに出る項目（useCalendarData の list。表示用に直した記録から）、
 * off は休みの日、today は今日（'YYYY-MM-DD'）
 */
export function buildYear(y: number, list: readonly CalItem[], off: ReadonlySet<string>, today: string): YearMonthVM[] {
  const dots = yearDots(list, y)
  const holidays = holidaysOfYear(y)
  const yyyy = String(y).padStart(4, '0')
  const thisMonth = today.slice(0, 7)
  const months: YearMonthVM[] = []
  for (let m = 1; m <= 12; m++) {
    const ym = `${yyyy}-${pad2(m)}`
    const days: YearDayVM[] = []
    for (let d = 1; d <= daysInMonth(y, m); d++) {
      const date = `${ym}-${pad2(d)}`
      const w = weekdayOfYmd(date)
      const holiday = holidays.get(date) ?? null
      const isOff = off.has(date)
      const dayDots = dots.get(date) ?? NO_DOTS
      days.push({
        date,
        day: d,
        weekday: WEEKDAYS_EN[w],
        tone: w === 0 || holiday !== null ? 'sun' : w === 6 ? 'sat' : null,
        isToday: date === today,
        off: isOff,
        dots: dayDots,
        label: yearCellLabel(date, dayDots, isOff, holiday),
      })
    }
    const first = `${ym}-01`
    months.push({
      m,
      name: MONTHS_EN[m - 1],
      isThisMonth: ym === thisMonth,
      first,
      lead: weekdayOfYmd(first),
      days,
      label: `${y}年${m}月をマンスリーで見る`,
    })
  }
  return months
}

const KIND_NAMES: Record<ItemKind, string> = { work: '仕事', private: 'プライベート' }

/** 日のマスの読み上げ（日付・区分ごとの予定・休み・祝日名をまとめる。祝日名は画面には出さないが読み上げでは伝える。4.12・7.2） */
export function yearCellLabel(
  date: string,
  dots: Readonly<Record<ItemKind, DotState>>,
  off: boolean,
  holiday: string | null,
): string {
  const parts = [jaDateLabel(date)]
  const kinds = ITEM_KINDS.filter((k) => dots[k] !== 'none')
  if (kinds.length === 0) parts.push('予定なし')
  for (const k of kinds) parts.push(dots[k] === 'allDone' ? `${KIND_NAMES[k]}の予定（すべて完了）` : `${KIND_NAMES[k]}の予定あり`)
  if (off) parts.push('休み')
  if (holiday) parts.push(holiday)
  return parts.join('、')
}

// ---------- キーボード（PC。4.12・開発） ----------

/**
 * キーボードで日のマスの間を動く時の行き先（'YYYY-MM-DD'。受け持たないキーは null）。
 * マス目の中は1つのマスだけが Tab で入れる所になり（マンスリーと同じ。ほかのマスは Tab で止まらない）、矢印キーで動かす。
 * - rows（月を行・日を列）: ← → は前・次の日（月の端では前・次の月へ続く）、↑ ↓ は前・次の月の同じ日（その月に無い日なら
 *   その月の最終日）、Home・End はその月の1日・最終日（行の端）
 * - mini（小さな月）: ← → は前・次の日、↑ ↓ は前・次の週の同じ曜日（月をまたぐと隣の小さな月へ）、Home・End はその週の日曜・
 *   土曜（その月の中に収める。小さな月の行の端）
 * 年の外へは出ない（端では動かずにそのままの日を返す。ほかの年へ移るのは ‹ › だけ）
 */
export function yearMove(date: string, key: string, layout: YearLayout): string | null {
  const y = date.slice(0, 4)
  const m = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  const last = daysInMonth(Number(y), m)
  const inYear = (s: string) => (s.slice(0, 4) === y ? s : date)
  const dayOf = (mm: number, dd: number) => `${y}-${pad2(mm)}-${pad2(dd)}`
  switch (key) {
    case 'ArrowLeft':
      return inYear(addDaysYmd(date, -1))
    case 'ArrowRight':
      return inYear(addDaysYmd(date, 1))
    case 'ArrowUp':
    case 'ArrowDown': {
      if (layout === 'mini') return inYear(addDaysYmd(date, key === 'ArrowUp' ? -7 : 7))
      const mm = m + (key === 'ArrowUp' ? -1 : 1)
      if (mm < 1 || mm > 12) return date
      return dayOf(mm, Math.min(d, daysInMonth(Number(y), mm)))
    }
    case 'Home':
      return layout === 'rows' ? dayOf(m, 1) : dayOf(m, Math.max(1, d - weekdayOfYmd(date)))
    case 'End':
      return layout === 'rows' ? dayOf(m, last) : dayOf(m, Math.min(last, d + 6 - weekdayOfYmd(date)))
    default:
      return null
  }
}
