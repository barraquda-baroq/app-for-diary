// 3つのリスト（docs/SPEC.md の 13.〜15.）の字の決まり: 入れた字の1行目と残り（件名とメモ）、件名の 200字の上限で切った残り、
// 「今週金曜」の日、お知らせ・読み上げに出す 20字の名前、Task List の入力欄の下の［開始日］［締め切り日］の字。
// 日付は 'YYYY-MM-DD' の文字のまま比べる。字数はコードポイントで数える（Array.from。絵文字1つは1字。6.1）
import { addDaysYmd, mdLabel, weekdayOfYmd } from './dates'
import { UNTITLED } from './repair'
import { LIMITS } from './types'

/** 改行を LF にそろえる（CRLF も CR だけも LF に） */
export function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * 入れた字を件名とメモに分ける（13.2・15.4）: 改行は CRLF を LF にそろえ、頭の空の行（空白だけの行も）を飛ばし、最初の空でない行の
 * 前後の空白を除いた物が件名、その後ろ（終わりの空白を除く）がメモ。どの行も空なら null（足さない）。件名の字数はここでは見ない
 * （上限を超えた時に足さないか切るかは呼ぶ側が決める。D29）
 */
export function splitEntry(text: string): { title: string; memo: string } | null {
  const lines = toLf(text).split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first < 0) return null
  return {
    title: lines[first].trim(),
    memo: lines
      .slice(first + 1)
      .join('\n')
      .trimEnd(),
  }
}

/**
 * 件名を上限（既定 200字）で切る。あふれた分は overflow で返す（Favorite から Task List へ移す・［予定にする］で、メモの頭へ回す。
 * D25・D29）。上限に収まる時は overflow が ''
 */
export function fitTitle(title: string, max: number = LIMITS.title): { title: string; overflow: string } {
  const chars = Array.from(title)
  if (chars.length <= max) return { title, overflow: '' }
  return { title: chars.slice(0, max).join(''), overflow: chars.slice(max).join('') }
}

/**
 * ［締め切り日］の「今週金曜」の日（13.2・13.5）: 今日を含む日曜〜土曜の週の金曜（金曜は今日）。土曜は次の金曜で、字は「来週金曜」
 */
export function fridayOf(today: string): { date: string; label: '今週金曜' | '来週金曜' } {
  const w = weekdayOfYmd(today)
  if (w === 6) return { date: addDaysYmd(today, 6), label: '来週金曜' }
  return { date: addDaysYmd(today, 5 - w), label: '今週金曜' }
}

/** お知らせ・読み上げに出す名前の長さ（これより長い名前は切って「…」） */
export const NAME_MAX = 20

/**
 * お知らせ・読み上げに出す名前: 最初の空でない行（前後の空白を除く）を 20字で切り、切った時は「…」を付ける（「『…』を削除しました」
 * など）。どの行も空なら「（件名なし）」
 */
export function name20(text: string): string {
  const line = splitEntry(text)?.title ?? ''
  if (!line) return UNTITLED
  const chars = Array.from(line)
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX).join('')}…` : line
}

/** Task List の入力欄の下の［開始日］［締め切り日］に日を選んだ時の字（'開始 11/10'・'〆 11/20'。月日は 0 で埋めない。13.2） */
export function chipLabel(kind: 'start' | 'due', date: string): string {
  return `${kind === 'start' ? '開始' : '〆'} ${mdLabel(date)}`
}
