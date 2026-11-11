// マンスリーのマス目の中身を決める純粋な関数（docs/SPEC.md の 7.1〜7.4・7.6・9.1・9.2・4.12。D06・D19・D29）。
// 画面（MonthView）は、ここが決めた物をそのまま描くだけにする。React・ストアを読まない（src/features/calendar/purity.test.ts）
// - 7列（日曜始まり）・その月に掛かる週の数の行（4〜6行）。前後の月の日も並べる
// - その月の日: 日付の色（日曜と祝日は sun、土曜は sat）、今日、休み、祝日名（L・M だけ。S は日付の色だけ）、件数
//   （片方が 0 なら飾りの「0」、両方 0 の日は何も書かない。100 以上は「99+」）、読み上げ（日付・件数・休み・祝日名をまとめる）
// - 前後の月の日: 日付だけ（--numeral の色。今日の丸・土日の色・件数・祝日名は出さない）。休みの日は休みの地と「休」（D06）
import type { CalItem } from '../../../domain/calendar'
import { jaDateLabel, monthWeeks, toYmd, weekdayOfYmd } from '../../../domain/dates'
import { holidayName } from '../../../domain/holidays'
import { formatCount, monthCounts } from '../../../domain/items'
import { monthCellLabel, monthCountLabel } from '../../../domain/itemText'
import { ITEM_KINDS, type ItemKind } from '../../../domain/types'
import type { WidthClass } from '../common/types'

/** 日付の色（7.1）: 日曜と祝日は --sun、土曜は --sat、ほかは色なし（前後の月の日と、今日の丸の中も色なし） */
export type MonthTone = 'sun' | 'sat' | null

/** 1つの区分の件数（9.2） */
export interface MonthCountVM {
  /** 出す字（「4」「99+」。片方が 0 の時の飾りの「0」も） */
  text: string
  /** 飾りの「0」（--numeral の色。押すとその区分を目立たせてデイリーへ。4.5 の例外・D29） */
  zero: boolean
  /** 数字のボタンの読み上げ（「仕事 4件をデイリーで見る」） */
  label: string
}

/** 1つのマス */
export interface MonthCellVM {
  /** 'YYYY-MM-DD' */
  date: string
  /** 日（1〜31） */
  day: number
  /** 前後の月の日（押すとその月のマンスリーへ。9.1） */
  outside: boolean
  /** 日付の色（今日は丸の字 --on-primary が勝つので null。前後の月の日は --numeral なので null） */
  tone: MonthTone
  /** 今日（直径 22px の丸。その月の日だけ。7.3） */
  isToday: boolean
  /** 休みの日（地 --off-fill と「休」。前後の月の日も。7.4・D06） */
  off: boolean
  /** 右上に出す祝日名（L・M のその月の日だけ。S・前後の月の日・祝日でない日は null。7.2・9.2） */
  holiday: string | null
  /** 件数（両方 0 の日と前後の月の日は null = 何も書かない。9.2） */
  counts: Record<ItemKind, MonthCountVM> | null
  /** マスの読み上げ（「11月10日（火）、仕事 4件、プライベート 3件、休み」。4.12・9.3） */
  label: string
}

/** マンスリーのマス目（行 × 7列）。list はカレンダーに出る項目（useCalendarData の list。表示用に直した記録から） */
export function buildMonth(
  { y, m }: { y: number; m: number },
  list: readonly CalItem[],
  off: ReadonlySet<string>,
  today: string,
  width: WidthClass,
): MonthCellVM[][] {
  const counts = monthCounts(
    list.map((c) => c.item),
    y,
    m,
  )
  return monthWeeks(y, m).map((week) =>
    week.map(({ date: v, outside }) => {
      const date = toYmd(v)
      const isOff = off.has(date)
      if (outside) {
        return {
          date,
          day: v.d,
          outside: true,
          tone: null,
          isToday: false,
          off: isOff,
          holiday: null,
          counts: null,
          label: outsideLabel(date, isOff),
        }
      }
      const name = holidayName(date)
      const n = counts[date] ?? { work: 0, private: 0 }
      const isToday = date === today
      return {
        date,
        day: v.d,
        outside: false,
        tone: isToday ? null : toneOf(date, name),
        isToday,
        off: isOff,
        holiday: width === 'S' ? null : name,
        counts: n.work === 0 && n.private === 0 ? null : countsOf(n),
        label: monthCellLabel(date, n, isOff, name),
      }
    }),
  )
}

/** 日付の色（日曜と祝日は sun。祝日の土曜も祝日の色。7.1） */
function toneOf(date: string, holiday: string | null): MonthTone {
  const w = weekdayOfYmd(date)
  if (w === 0 || holiday !== null) return 'sun'
  return w === 6 ? 'sat' : null
}

function countsOf(n: Record<ItemKind, number>): Record<ItemKind, MonthCountVM> {
  const out = {} as Record<ItemKind, MonthCountVM>
  for (const kind of ITEM_KINDS)
    out[kind] = { text: formatCount(n[kind]), zero: n[kind] === 0, label: monthCountLabel(kind, n[kind]) }
  return out
}

/** 前後の月の日の読み上げ（件数は数えないので出さない。「12月2日（水）、休み」。押すとその月のマンスリーへ） */
function outsideLabel(date: string, off: boolean): string {
  return off ? `${jaDateLabel(date)}、休み` : jaDateLabel(date)
}
