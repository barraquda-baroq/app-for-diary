// 3つのリストの入力欄の決まり（docs/SPEC.md の 3.6・12.1・13.2・14.2・15.1・6.13）: Enter で足すか改行か、端末に控える書きかけの
// キーと形。画面（useListInput・ListInput）に頼らない純粋な決まり（*Model.ts。src/features/calendar/purity.test.ts）。
// 契約の形だけ（S3-STUB）: ListName・ListDraft・draftKey はこれで決まり。parseDraft・serializeDraft・enterAction の中身と、［足す］（✓）の
// 押し方の決まり（すばやく足すの ✓ と変換の決まりを写した addPressStep）は段階3の WP0 が入れる。今の関数は空の結果を返すだけ
// （どの画面もまだ呼ばない）。使わない引数は void で読む（名前を契約のまま残すため）
import type { TaskEntry } from '../../../domain/taskList'

/** 3つのリスト（src/store/uiStore.ts の ListKey と同じ3つ。決まりのファイルなので store を読まずに同じ形をここに書く） */
export type ListName = 'routine' | 'task' | 'favorite'

/**
 * 入力欄の書きかけ（D23）。Task List は件名の字と［開始日］［締め切り日］［依頼者］、Routine List・Favorite List は字だけを持つ
 * （start・due は null、requester は '' のまま。Routine List の種類は端末の設定 routineAddCycle に覚え、［指定］は足すたびに戻す）。
 * 形は Task List の入力（src/domain/taskList.ts の TaskEntry）と同じにした（§3.2 で開いていた形。足す時にそのまま taskInputOf へ渡せる）
 */
export type ListDraft = TaskEntry

/** 空の書きかけ */
export const EMPTY_DRAFT: ListDraft = { text: '', start: null, due: null, requester: '' }

/** 端末に控える書きかけのキー（diary-studio:draft:{routine,task,favorite}。6.13・FRAME-095） */
export const draftKey = (list: ListName) => `diary-studio:draft:${list}` as const

/**
 * 控えた書きかけを読む（Task List は JSON の {text, start, due, requester}、ほかは字のまま）。壊れた値・知らない形は空の書きかけ
 */
export function parseDraft(list: ListName, raw: string | null): ListDraft {
  void list
  void raw
  return EMPTY_DRAFT
}

/** 控える値（null はキーを消す: 空の書きかけ） */
export function serializeDraft(list: ListName, d: ListDraft): string | null {
  void list
  void d
  return null
}

/**
 * Enter を押した時（変換の途中 isComposing・keyCode 229 は none）。Task List は PC の Shift+Enter が改行・ほかは足す（指の端末も。
 * 13.2）。Favorite List は指の端末は改行・PC は Shift+Enter が改行で Enter が足す（15.1）。Routine List は足す（1行の欄）
 */
export function enterAction(
  list: ListName,
  e: { shift: boolean; composing: boolean; coarse: boolean },
): 'add' | 'newline' | 'none' {
  void list
  void e
  return 'none'
}
