// Favorite List（docs/SPEC.md の 15.・6.8）の決まり: 並び（新しい物が上）・済み、行に出す物（1行目を太く・足した日）、
// Task List へ移す時の件名とメモ、［予定にする］で開く登録の画面の初めの値（12.2）。
// 契約の形だけ（S3-STUB）: 名前と形はこれで決まり、中身は段階3の WP1 が入れる。今の関数は空の結果を返すだけで、決まりはまだ無い
// （どの画面もまだ呼ばない）。使わない引数は void で読む（名前を契約のまま残すため）。
// today は端末の暦の今日（useToday()。足した日の年を出すかに使う）
import type { RegisterInit } from './itemInput'
import type { TaskEntry } from './taskList'
import type { Favorite, ID } from './types'

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
  void favorites
  void today
  return { open: [], done: [], undone: 0 }
}

/** ［Task List へ移す］で足すタスク（最初の空でない行を 200字までの件名に、あふれた分と残りをメモに。済みにはしない。D25） */
export function favoriteToTask(text: string): TaskEntry {
  return { text, start: null, due: null, requester: '' }
}

/** ［予定にする］で開く登録の画面の初めの値（開始日は今日・仕事・件名 200字まで・残りはメモ。12.2・D4） */
export function favoriteToRegister(text: string, today: string): RegisterInit {
  void text
  return { start: today }
}
