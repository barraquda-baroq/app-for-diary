// 予定の表記と文（docs/SPEC.md の 3.9・4.11・4.12・7.7・7.11・11.2・12.3・12.5・12.7・12.8）: 時刻・期間の表記、デイリーのリストの右の端、
// list 生まれの「今どう出るか」の1行、お知らせ（トースト）の文、読み上げ（aria-label）の文。カレンダーと詳細の画面はここから取る
// （同じ文を何か所にも書かない）。時刻は画面では時の頭の 0 を落とす（9:00。保存は 'HH:MM' のまま。開発）。月日は 0 で埋めない（11/9）
import type { CalItem } from './calendar'
import { displayHm, isYmd, jaDateLabel, mdLabel, shortDateLabel } from './dates'
import { formatCount, type DayCounts } from './items'
import { UNTITLED } from './repair'
import { ITEM_KIND_LABELS } from './trash'
import type { ItemKind } from './types'

// ---------- 時刻・期間の表記（7.7） ----------

/**
 * 時刻・期間の表記（等幅 11px の欄。7.7）:
 * - 1日・時刻なし: 出さない（''）
 * - 1日・開始だけ: `10:00`。開始〜終了: `10:00–11:30`（en dash）
 * - 複数日・時刻なし: `〜11/11`。最終日（on が締め切り日）には `11/9〜`
 * - 複数日・時刻あり: `11/9 10:00〜11/11 15:00`。終了時刻の無い物は `11/9 10:00〜11/11`（最終日は 24:00 まで。開発）
 * - datesOnly（ウィークリーの始点のカードに期間が入らない時。10.2）: 時刻のある複数日は時刻を省いて日付だけ `11/28〜12/2`。
 *   時刻の無い複数日は省く時刻が無いので上の表記のまま（`〜12/2` の方が短い）
 */
export function timeLabel(c: CalItem, opts: { on?: string; datesOnly?: boolean } = {}): string {
  const { startTime, endTime } = c.item
  if (!c.multi) {
    if (!startTime) return ''
    return endTime ? `${displayHm(startTime)}–${displayHm(endTime)}` : displayHm(startTime)
  }
  if (!startTime) return opts.on === c.to ? `${mdLabel(c.from)}〜` : `〜${mdLabel(c.to)}`
  if (opts.datesOnly) return `${mdLabel(c.from)}〜${mdLabel(c.to)}`
  const head = `${mdLabel(c.from)} ${displayHm(startTime)}〜${mdLabel(c.to)}`
  return endTime ? `${head} ${displayHm(endTime)}` : head
}

/** デイリーのリストの行の右の端（複数日の予定だけ。1日の予定は null） */
export interface ListTail {
  /** 線の色で出す印（初日・間の日「━＞」、最終日「━●」） */
  mark: '━＞' | '━●'
  /** `--text-muted` で出す期間（「〜11/11」。最終日は無し） */
  range: string | null
  /** 件名を受けた表示（頭に「‹ 」）にするか（間の日・最終日） */
  received: boolean
}

/**
 * デイリーのリストの複数日の予定の右の端（11.2）: 初日「━＞ 〜11/11」、間の日は受けた表示にして「━＞ 〜11/11」、
 * 最終日は受けた表示にして「━●」。1日の予定と、期間の外の日は null
 */
export function listTail(c: CalItem, date: string): ListTail | null {
  if (!c.multi || date < c.from || date > c.to) return null
  if (date === c.to) return { mark: '━●', range: null, received: true }
  return { mark: '━＞', range: `〜${mdLabel(c.to)}`, received: date !== c.from }
}

// ---------- list 生まれの「今どう出るか」（12.3） ----------

/**
 * 詳細の日付の欄の下に出す、list 生まれのタスクが今カレンダーにどう出るかの1行（12.3・6.3 の4通り）。
 * 開始日が締め切り日より後・同じ日の時は締め切り日の1日（6.3）。形の正しくない日付は無いものとみなす
 */
export function listStatusLine(d: { start: string | null; due: string | null }): string {
  const start = isYmd(d.start) ? d.start : null
  const due = isYmd(d.due) ? d.due : null
  if (!due) {
    return start
      ? '開始日だけではカレンダーに出ません。締め切り日を入れるとカレンダーに出ます'
      : 'カレンダーには出ません（Task List だけ）'
  }
  if (!start || start >= due) return `${shortDateLabel(due)}の1日の予定としてカレンダーに出ます`
  return `${shortDateLabel(start)}〜${shortDateLabel(due)}の予定としてカレンダーに出ます`
}

// ---------- お知らせ（3.9） ----------

/** お知らせの文（ボタンの［元に戻す］［開く］は画面が付ける。日付は「11/12（木）」） */
export const toastText = {
  /** 1日の予定を別の日へ動かした（7.11） */
  moved: (d: string): string => `${shortDateLabel(d)}へ移しました`,
  /** 複数日の始点を動かした（7.11） */
  startSet: (d: string): string => `開始日を ${shortDateLabel(d)}にしました`,
  /** 複数日の終点・list 生まれの〆のカードを動かした（7.11・13.6） */
  dueSet: (d: string): string => `締め切り日を ${shortDateLabel(d)}にしました`,
  /** すばやく足すで、入力欄の外を押した・キーボードを閉じた時に足した（12.1） */
  added: (title: string): string => `『${title}』を足しました`,
  /** カレンダーの丸・●で完了にした（12.5） */
  done: (title: string): string => `『${title}』を完了にしました`,
  /** 複製した（12.7）。日付は期間の初めの日。日付の無い list 生まれは Task List へ（開発） */
  duplicated: (d: string | null): string => (d ? `${shortDateLabel(d)}に複製しました` : 'Task List に複製しました'),
  /** カレンダーに出ていないタスクを確かめずに消した（12.8） */
  deleted: (title: string): string => `『${title}』を削除しました`,
  /** list 生まれの締め切り日を消して Task List に戻した（6.3） */
  relisted: 'カレンダーから外れたので Task List に戻しました',
} as const

// ---------- 元に戻す・やり直す（7.13） ----------

/** 操作の名前に入れる件名の長さ（これより長い件名は切って「…」） */
export const UNDO_TITLE_MAX = 20

/** 操作の名前に入れる件名（空なら「（件名なし）」、長ければ切る） */
function undoTitle(title: string): string {
  const t = title.trim() || UNTITLED
  const chars = Array.from(t)
  return chars.length > UNDO_TITLE_MAX ? `${chars.slice(0, UNDO_TITLE_MAX).join('')}…` : t
}

/** 元に戻す・やり直すの操作の名前（ボタンの読み上げ・ヒントの括弧の中。「元に戻す（『会議』を移した）」） */
export const undoText = {
  /** ドラッグで日を動かした（7.11） */
  moved: (title: string): string => `『${undoTitle(title)}』を移した`,
  /** 完了にした・外した（12.5） */
  done: (title: string, done: boolean): string =>
    done ? `『${undoTitle(title)}』を完了にした` : `『${undoTitle(title)}』の完了を外した`,
  /** すばやく足すで足した（12.1） */
  added: (title: string): string => `『${undoTitle(title)}』を足した`,
  /** 登録の画面で登録した（12.2） */
  registered: (title: string): string => `『${undoTitle(title)}』を登録した`,
  /** 複製した（12.7） */
  duplicated: (title: string): string => `『${undoTitle(title)}』を複製した`,
  /** 削除した（ゴミ箱へ。12.8） */
  deleted: (title: string): string => `『${undoTitle(title)}』を削除した`,
  /** 詳細の画面で直した（開いてから閉じるまで。12.3） */
  edited: (title: string): string => `『${undoTitle(title)}』を直した`,
  /** 休みを付けた・外した（7.4） */
  off: (date: string, off: boolean): string =>
    off ? `${shortDateLabel(date)}を休みにした` : `${shortDateLabel(date)}の休みを外した`,
} as const

/** 元に戻す・やり直すのボタンの読み上げとヒント（何も無い時は「元に戻す」「やり直す」だけ） */
export function undoButtonLabel(dir: 'undo' | 'redo', label: string | null | undefined): string {
  const verb = dir === 'undo' ? '元に戻す' : 'やり直す'
  return label ? `${verb}（${label}）` : verb
}

// ---------- 読み上げ（4.11・4.12） ----------

/** 区分の件数（「仕事 4件」） */
const countText = (kind: ItemKind, n: number): string => `${ITEM_KIND_LABELS[kind]} ${formatCount(n)}件`

/**
 * マンスリーのマスの読み上げ（4.12・9.3）: 「11月10日（火）、仕事 4件、プライベート 3件、休み、文化の日」のように、
 * 日付・件数・休み・祝日名をまとめる。どちらも 0件の日は「予定なし」（開発）。holiday は画面に出す祝日名（無ければ null）
 */
export function monthCellLabel(date: string, counts: DayCounts, off: boolean, holiday: string | null): string {
  const parts = [jaDateLabel(date)]
  if (counts.work === 0 && counts.private === 0) parts.push('予定なし')
  else parts.push(countText('work', counts.work), countText('private', counts.private))
  if (off) parts.push('休み')
  if (holiday) parts.push(holiday)
  return parts.join('、')
}

/** マンスリーの数字のボタンの読み上げ（「仕事 4件をデイリーで見る」。9.3・開発） */
export function monthCountLabel(kind: ItemKind, n: number): string {
  return `${countText(kind, n)}をデイリーで見る`
}

/** 完了の丸・●の読み上げ（4.11）: 「『件名』を完了にする」、完了している時は「『件名』の完了を外す」 */
export function doneLabel(title: string, done: boolean): string {
  return done ? `『${title}』の完了を外す` : `『${title}』を完了にする`
}
