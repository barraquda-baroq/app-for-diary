// 祝日（docs/SPEC.md の 7.2）。@holiday-jp/holiday_jp 2.5.2（振替休日・国民の休日・2019〜2021年の1回だけの祝日を含む。1970〜2050年）で
// 判定し、ネットにも外部のカレンダーにもつながない。
// 表は部品の holidays（'YYYY-MM-DD' の文字のキー）から作る。between() は UTC の 0時の Date を返すので、時差がマイナスの端末で
// getDate() を使うと1日前にずれる（America/Los_Angeles で 2026-11-03 の文化の日が 11/2 になる）。Date は使わず、文字のキーだけを見る。
// 年ごとに1回だけ作って覚える。1970年より前と 2051年以降は「祝日なし」（空の表）。
import holidayJp from '@holiday-jp/holiday_jp'

/** 祝日の表がある年（外の年は祝日なし） */
export const HOLIDAY_YEARS = { from: 1970, to: 2050 } as const

/** 部品の表（日付 → 祝日。名前だけを使う） */
const TABLE: Readonly<Record<string, { readonly name: string }>> = holidayJp.holidays

const NONE: ReadonlyMap<string, string> = new Map()
const byYear = new Map<number, ReadonlyMap<string, string>>()

/**
 * 画面に出す祝日名（マスの幅の 60% に収め、意味も分かるように縮める）: ライブラリの「休日」は「国民の休日」、
 * 「こどもの日 振替休日」のような「… 振替休日」は「振替休日」。ほかはそのまま
 */
export function displayHolidayName(raw: string): string {
  if (raw === '休日') return '国民の休日'
  if (raw.endsWith(' 振替休日') || raw === '振替休日') return '振替休日'
  return raw
}

/** その年の祝日（'YYYY-MM-DD' → 画面に出す祝日名。日付の順）。同じ年は作り直さない */
export function holidaysOfYear(y: number): ReadonlyMap<string, string> {
  if (!Number.isInteger(y) || y < HOLIDAY_YEARS.from || y > HOLIDAY_YEARS.to) return NONE
  const cached = byYear.get(y)
  if (cached) return cached
  const prefix = `${y}-`
  const dates = Object.keys(TABLE)
    .filter((d) => d.startsWith(prefix))
    .sort()
  const map = new Map(dates.map((d): [string, string] => [d, displayHolidayName(TABLE[d].name)]))
  byYear.set(y, map)
  return map
}

/** その日の祝日名（画面に出す名前）。祝日でない日・形の違う日付・表の無い年は null */
export function holidayName(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return holidaysOfYear(Number(date.slice(0, 4))).get(date) ?? null
}
