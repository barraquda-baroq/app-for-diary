// ウィークリーの中の操作（docs/SPEC.md の 10.2・10.4・7.4・7.12・12.1）を、画面の部品へ渡す形。WeekView が1つだけ作って渡す。
// 予定を押すと詳細（12.3）は、カード・始点のカード・受けた表示・●・＞が useItemSheets().openDetail を自分で呼ぶので、ここには無い。
// ここの3つ（日付の見出し → その日のデイリー・休みのチェック・「＋」→ すばやく足す）は、まだ渡していない（段階2の後半 WP7B で
// つなぐ。渡していない間は押しても何も変わらない）
import type { ItemKind } from '../../../domain/types'

export interface WeekActions {
  /** 日付の見出し（曜日の丸いラベル＋「11/8」）を押した: その日のデイリーへ（7.12・D23） */
  openDay?: (date: string) => void
  /** 休みのチェックを押した: その日の休みを付ける・外す（off は押した後の値。7.4・Q19） */
  setOff?: (date: string, off: boolean) => void
  /** 「＋」の行を押した: その日・その段のすばやく足す（12.1・D31） */
  quickAdd?: (date: string, kind: ItemKind) => void
}
