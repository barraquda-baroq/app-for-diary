// 入力欄の打ちかけを捨てる（docs/SPEC.md の 3.1・■34 の作者の答え「打ちかけの文字は残さなくて良いです」）。S・M で開いているリストを
// 端からのフリック（iPhone・iPad）・OS の［戻る］（Android・PC）で畳む時に、src/features/top/listBack.ts の closeShownList が呼ぶ。
// - 捨てるのは入力欄の打ちかけだけ: Task List は件名の字と［開始日］［締め切り日］［依頼者］、Routine List は件名の字と［指定］、
//   Favorite List は本文の字。画面の欄を空にし（変換の途中なら決めずに捨てる）、端末の書きかけ（diary-studio:draft:{リスト}）を消し、
//   まだ控えていない書きかけ（src/store/draftRegistry）も控えずに捨てる（後で pagehide に書き戻さない）。聞かない・足さない
// - 行の中で直している途中の件名・本文（その場の直し）は捨てない（今までの決まりどおり、保存する物は保存する）
// - 見出しの［▾］で畳む・切り替えの列で別のリストへ移る・幅が L になる時は呼ばない（打ちかけは残す。3.6・6.13・D16）
// 契約の形だけ（S3-STUB）: 今はどちらも何もしない（中身は段階3の WP0 が入れる。入力欄の部品 useListInput は、欄を出している間
// registerDraftClear で欄を空にする関数を届ける）
import type { ListKey } from '../../../store/uiStore'

/** そのリストの入力欄の打ちかけを捨てる（上の決まり） */
export function discardListDraft(list: ListKey): void {
  void list
}

/**
 * 入力欄を出している間、その欄を空にする関数（字・［開始日］［締め切り日］［依頼者］・［指定］・変換の途中の字を捨てる）を届ける。
 * 戻り値で外す（入力欄の部品が外れる時）
 */
export function registerDraftClear(list: ListKey, clear: () => void): () => void {
  void list
  void clear
  return () => {}
}
