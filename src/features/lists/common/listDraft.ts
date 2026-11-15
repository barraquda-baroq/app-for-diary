// 3つのリストの入力欄の書きかけ（docs/SPEC.md の 3.6・6.13・13.2・14.2・15.1。D16・D23・FRAME-095・096）と、■34 で打ちかけを捨てること。
// - 書きかけは diary-studio:draft:{routine,task,favorite} に控える（common/listInputModel.ts の draftKey・形は parseDraft・serializeDraft）。
//   閉じる・読み込み直す・畳む・端からのフリックでモードが替わる・幅が替わって作り直されても消えない（すばやく足すと違う。D16）。
//   足したら消す。localStorage が使えない時も、入力・足すは動く（src/store/localDrafts.ts の readLocal・writeLocal）
// - 打つたびの書き込みは少し待ってまとめ（DRAFT_WRITE_MS）、待っている間は src/store/draftRegistry に「まだ控えていない」と届ける
//   （画面を閉じる・裏に回る時（pagehide・visibilitychange）と［更新する］の前に、まとめて控える。src/store/lifecycle.ts）
// - 今の書きかけは、このファイルの中にも持つ（幅が替わって入力欄が作り直された時、前の欄が控え終える前に新しい欄が読んでも同じ字）
// - discardListDraft（■34 の作者の答え「打ちかけの文字は残さなくて良いです」）: S・M で開いているリストを端からのフリック（iPhone・
//   iPad）・OS の［戻る］（Android・PC）で畳む時に使う口（呼ぶ所は src/features/top/listBack.ts の closeShownList。closeShownList は
//   今はまだどこからも呼ばれない）。そのリストの入力欄の打ちかけだけを捨てる: Task List は件名の字と［開始日］［締め切り日］
//   ［依頼者］、Routine List は件名の字と［指定］、Favorite List は本文の字。画面の欄を空にし（変換の途中なら決めずに捨てる。欄に
//   フォーカスがあれば、先にそのリストの見出しの畳む・開くボタンへ移してから空にする。common/useListInput.ts）、端末の書きかけを
//   消し、まだ控えていない書きかけも控えずに捨てる（後で pagehide に書き戻さない）。聞かない・足さない。行の中で直している途中の
//   件名・本文（その場の直し）は捨てない（保存する物は保存する）。
//   見出しの［▾］で畳む・切り替えの列で別のリストへ移る・幅が L になる時は呼ばない（打ちかけは残す。3.6・6.13・D16）
import { markDraftClean, markDraftDirty } from '../../../store/draftRegistry'
import { readLocal, writeLocal } from '../../../store/localDrafts'
import type { ListKey } from '../../../store/uiStore'
import { draftKey, EMPTY_DRAFT, parseDraft, serializeDraft, type ListDraft } from './listInputModel'

/** 打つたびの書き込みをまとめる長さ（ms） */
export const DRAFT_WRITE_MS = 300

interface Pending {
  timer: ReturnType<typeof setTimeout>
  key: symbol
}

/** 今の書きかけ（読んだ・打った物。無い時は端末から読む） */
const live = new Map<ListKey, ListDraft>()
/** まだ控えていない書きかけ（待ち） */
const pending = new Map<ListKey, Pending>()
/** 出している入力欄の、欄を空にする関数（registerDraftClear） */
const clearers = new Map<ListKey, Set<() => void>>()

/** 今の書きかけ（初めて読む時は端末から。壊れた値・読めない時は空） */
export function readListDraft(list: ListKey): ListDraft {
  const known = live.get(list)
  if (known) return known
  const d = parseDraft(list, readLocal(draftKey(list)))
  live.set(list, d)
  return d
}

/** 端末へ控える（待っていた分も今すぐ） */
export function flushListDraft(list: ListKey): void {
  const p = pending.get(list)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(list)
  markDraftClean(p.key)
  writeLocal(draftKey(list), serializeDraft(list, live.get(list) ?? EMPTY_DRAFT))
}

/**
 * 書きかけを替える（打った・チップを選んだ）。端末へは少し待ってから控える（待っている間は draftRegistry に届け、閉じる・裏に回る
 * 時にまとめて控える）。now は待たずに控える（足した後の空・空にした時）
 */
export function writeListDraft(list: ListKey, d: ListDraft, { now = false }: { now?: boolean } = {}): void {
  live.set(list, d)
  const p = pending.get(list)
  if (p) clearTimeout(p.timer)
  if (now) {
    if (p) {
      pending.delete(list)
      markDraftClean(p.key)
    }
    writeLocal(draftKey(list), serializeDraft(list, d))
    return
  }
  const key = p?.key ?? Symbol(`list-draft:${list}`)
  pending.set(list, { key, timer: setTimeout(() => flushListDraft(list), DRAFT_WRITE_MS) })
  if (!p) markDraftDirty(key, () => flushListDraft(list))
}

/** そのリストの入力欄の打ちかけを捨てる（上の決まり。■34） */
export function discardListDraft(list: ListKey): void {
  const p = pending.get(list)
  if (p) {
    clearTimeout(p.timer)
    pending.delete(list)
    markDraftClean(p.key)
  }
  live.set(list, EMPTY_DRAFT)
  writeLocal(draftKey(list), null)
  for (const clear of [...(clearers.get(list) ?? [])]) clear()
}

/**
 * 入力欄を出している間、その欄を空にする関数（字・［開始日］［締め切り日］［依頼者］・［指定］・変換の途中の字を捨てる）を届ける。
 * 戻り値で外す（入力欄の部品が外れる時）
 */
export function registerDraftClear(list: ListKey, clear: () => void): () => void {
  const set = clearers.get(list) ?? new Set<() => void>()
  set.add(clear)
  clearers.set(list, set)
  return () => {
    set.delete(clear)
  }
}

/** テスト用: 持っている書きかけ・待ち・届いた関数を忘れる（端末の書きかけは消さない） */
export function resetListDraftsForTests(): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    markDraftClean(p.key)
  }
  pending.clear()
  live.clear()
  clearers.clear()
}
