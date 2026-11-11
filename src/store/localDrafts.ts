// 端末ごとのちょっとした書きかけ（localStorage。同期しない。docs/SPEC.md の 6.13）。NS の src/features/ideas/storage.ts の
// readLocal・writeLocal から。プライベートブラウズなどで localStorage が使えなくても、読めない（null）・書けないだけで動作は続ける。
// 段階2は「すばやく足す」の書きかけ（diary-studio:draft:quick:{日付}:{区分}。12.1・FRAME-264）に使う
import type { ItemKind } from '../domain/types'

/** 読む（無い・使えない時は null） */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** 書く。null・空の文字なら消す */
export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null || value === '') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

/** すばやく足すの書きかけのキーの頭 */
export const QUICK_DRAFT_PREFIX = 'diary-studio:draft:quick:'

/** すばやく足すの書きかけのキー（日付と区分ごと。同じ日・同じ区分で開き直すと戻る。AMB-ITEMS-21・D44） */
export function quickDraftKey(date: string, kind: ItemKind): string {
  return `${QUICK_DRAFT_PREFIX}${date}:${kind}`
}
