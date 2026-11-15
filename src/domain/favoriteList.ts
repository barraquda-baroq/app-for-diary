// Favorite List（docs/SPEC.md の 15.・6.8）の決まり: 並び（新しい物が上）・済み、行に出す物（1行目を太く・足した日）、
// Task List へ移す時の件名とメモ、［予定にする］で開く登録の画面の初めの値（12.2）。中身の中のリンク（http・https だけ）は、詳細の
// メモと同じ src/features/item/itemForm.ts の memoParts で分ける（ここには置かない）。
// today は端末の暦の今日（useToday()。足した日の年を出すかに使う）
import { mdLabel, parseYmd, ymdOfMs } from './dates'
import type { RegisterInit } from './itemInput'
import { fitTitle, name20, splitEntry, toLf } from './listText'
import type { TaskEntry } from './taskList'
import type { Favorite, ID } from './types'
import { byOrder, compareStr } from './util'

/** Favorite List の1行に出す物 */
export interface FavoriteRowView {
  id: ID
  favorite: Favorite
  /** 1行目（2行以上の時は太さ 600） */
  firstLine: string
  /** 2行目から */
  rest: string
  /** 改行で分けた行が2行以上（折り返しでなく。D41） */
  multiLine: boolean
  /** 足した日（'11/10'。年が今日と違う時は年も。D32） */
  added: string
  /** お知らせ・読み上げに出す名前（listText.name20） */
  name: string
}

/** Favorite List の中身: まだの行（order の小さい順・id。新しい物が上: ops.addFavorite が topOrder で足す）・済みの行（doneAt の新しい順・id。D10） */
export interface FavoriteListView {
  open: FavoriteRowView[]
  done: FavoriteRowView[]
  undone: number
}

/** Favorite List の中身（FavoriteListView） */
export function favoriteListView(favorites: Iterable<Favorite>, today: string): FavoriteListView {
  const open: Favorite[] = []
  const done: Favorite[] = []
  for (const f of favorites) (f.done === true ? done : open).push(f)
  open.sort(byOrder)
  done.sort((a, b) => ms(b.doneAt) - ms(a.doneAt) || compareStr(a.id, b.id))
  return {
    open: open.map((f) => favoriteRowView(f, today)),
    done: done.map((f) => favoriteRowView(f, today)),
    undone: open.length,
  }
}

/** 日時の数（数でない・有限でない値は 0。doneAt の無い済みの物はいちばん古い扱い） */
const ms = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * 1行に出す物: 中身の前後の空白（空の行も）を除き、改行（CRLF も）で分けた1行目と2行目から（D41: 折り返しでなく改行で数える）。
 * 足した日は createdAt の端末の暦の日付（'11/10'。年が今日と違う時は '2025/11/10'。D32）
 */
export function favoriteRowView(favorite: Favorite, today: string): FavoriteRowView {
  const text = toLf(typeof favorite.text === 'string' ? favorite.text : '').trim()
  const cut = text.indexOf('\n')
  return {
    id: favorite.id,
    favorite,
    firstLine: cut < 0 ? text : text.slice(0, cut),
    rest: cut < 0 ? '' : text.slice(cut + 1),
    multiLine: cut >= 0,
    added: addedLabel(favorite.createdAt, today),
    name: name20(text),
  }
}

/** 足した日の字（'11/10'。年が今日と違う時は '2025/11/10'。D32） */
export function addedLabel(createdAt: number, today: string): string {
  const day = ymdOfMs(ms(createdAt))
  const v = parseYmd(day)!
  const t = parseYmd(today)
  return `${t && t.y !== v.y ? `${v.y}/` : ''}${mdLabel(day)}`
}

/**
 * 件名とメモに分ける（［Task List へ移す］・［予定にする］。D25・D29）: 最初の空でない行を 200字までの件名に、あふれた分をメモの頭に、
 * その後ろに2行目から（あふれた分と2行目からの間は改行）。200字の切れ目が空白の時は、件名の終わりの空白を落とす（メモにも入れない）。
 * どの行も空なら件名もメモも ''
 */
function titleAndMemo(text: string): { title: string; memo: string } {
  const parts = splitEntry(text)
  if (!parts) return { title: '', memo: '' }
  const fit = fitTitle(parts.title)
  const title = fit.title.trimEnd()
  const memo = [fit.overflow, parts.memo].filter((x) => x !== '').join('\n')
  return { title, memo }
}

/**
 * ［Task List へ移す］で足すタスク（最初の空でない行を 200字までの件名に、あふれた分と残りをメモに。日付・依頼者なし。済みにはしない。
 * D25）。taskInputOf に渡すと、件名がこの件名・メモがこのメモのタスク（list 生まれ・仕事・Task List に出す）になる
 */
export function favoriteToTask(text: string): TaskEntry {
  const { title, memo } = titleAndMemo(text)
  return { text: memo ? `${title}\n${memo}` : title, start: null, due: null, requester: '' }
}

/** ［予定にする］で開く登録の画面の初めの値（開始日は今日・仕事・件名 200字まで・あふれた分と残りはメモ。12.2・D4・D29） */
export function favoriteToRegister(text: string, today: string): RegisterInit {
  const { title, memo } = titleAndMemo(text)
  return { start: today, kind: 'work', title, memo }
}
