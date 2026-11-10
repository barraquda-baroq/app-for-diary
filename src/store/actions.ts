// 画面から呼ぶ操作（docs/SPEC.md の 2.9 の「画面の書き方の約束」: attempt(() => actions.xxx(...))）。ドメインの純粋関数を今のデータに
// 当てて保存する。決まりの上でできない操作は DomainError を投げるので、画面では attempt() で受けてお知らせにする。
// NS の src/store/actions.ts の apply・run の形だけを写した。段階1は、データの読み書きに要る操作（手の操作・ゴミ箱・バックアップ・
// 受け取り箱の当て方と答え）だけを置く。画面の操作は段階2〜5で足す。
// 受け取り箱の当て方（src/domain/inbox.ts）は、端末の raw の記録に当てる（指紋と patch は修復の前の記録に。19.5）ので commitRaw で書き
// （commitRaw は、このタブの変更を保存してから端末の中を読み直して当てる）、
// 依頼ごとのまとまり（touched）を保存に渡す。アプリを開いた時に自動で当てる所は段階5（形5）。
// ゴミ箱の出し入れも raw の記録に当てる（ゴミ箱の中身に、表示用に直す前の記録を知らない値ごと控え、戻した時もそのまま戻す。
// 表示用のデータに当てると、新しい版が足した kind などが、ゴミ箱を通るだけで既定値に変わってしまう。6.12・形3）。
import { backupJson, parseBackup, restoreData, type BackupOptions } from '../domain/backup'
import * as I from '../domain/inbox'
import * as O from '../domain/ops'
import * as T from '../domain/trash'
import type { AppData, ID } from '../domain/types'
import { commit, commitRaw, getData, loadFromDisk, replaceAllData } from './appStore'

function apply(fn: (d: AppData) => AppData): void {
  commit(fn(getData()))
}

function run<R>(fn: (d: AppData) => { data: AppData; result: R }): R {
  const r = fn(getData())
  commit(r.data)
  return r.result
}

/** 端末の raw の記録に当てて保存する（ゴミ箱の出し入れ。先にこのタブの未保存の編集を保存してから当てる） */
function runRaw<R>(fn: (raw: AppData) => { data: AppData; result: R }): Promise<R> {
  return commitRaw((raw) => fn(raw)) as Promise<R>
}

/** 受け取り箱の当て方を raw に当てて、依頼ごとのまとまりで保存する */
function runInbox<R>(fn: (raw: AppData) => { data: AppData; touched: I.Touched; result?: R }): Promise<R | undefined> {
  return commitRaw((raw) => {
    const r = fn(raw)
    return { data: r.data, groups: r.touched, result: r.result }
  })
}

export const actions = {
  // 予定・タスク（6.2・6.3）
  addItem: (input: O.ItemInput) => run((d) => O.addItem(d, input)),
  updateItem: (id: ID, patch: O.ItemPatch) => run((d) => O.updateItem(d, id, patch)),
  setItemDone: (id: ID, done: boolean) => apply((d) => O.setItemDone(d, id, done)),
  trashItem: (id: ID) => runRaw((d) => T.trashItem(d, id)),

  // 休み・ラベルの呼び名（6.5・6.6）
  setOffDay: (date: string, off: boolean) => apply((d) => O.setOffDay(d, date, off)),
  setLabelName: (key: string, name: string) => apply((d) => O.setLabelName(d, key, name)),

  // ルーチン（6.7・14.）
  addRoutine: (input: O.RoutineInput) => run((d) => O.addRoutine(d, input)),
  updateRoutine: (id: ID, patch: Parameters<typeof O.updateRoutine>[2]) => apply((d) => O.updateRoutine(d, id, patch)),
  checkRoutine: (id: ID, today: string) => apply((d) => O.checkRoutine(d, id, today)),
  uncheckRoutine: (id: ID, today: string) => apply((d) => O.uncheckRoutine(d, id, today)),
  trashRoutine: (id: ID) => runRaw((d) => T.trashRoutine(d, id)),

  // やりたいこと（6.8）
  addFavorite: (text: string) => run((d) => O.addFavorite(d, text)),
  updateFavorite: (id: ID, patch: Parameters<typeof O.updateFavorite>[2]) => apply((d) => O.updateFavorite(d, id, patch)),
  trashFavorite: (id: ID) => runRaw((d) => T.trashFavorite(d, id)),
  trashDoneFavorites: () => runRaw((d) => T.trashDoneFavorites(d)),

  // MIM（6.9）
  addMimNote: (input?: Parameters<typeof O.addMimNote>[1]) => run((d) => O.addMimNote(d, input)),
  updateMimNote: (id: ID, patch: Parameters<typeof O.updateMimNote>[2]) => apply((d) => O.updateMimNote(d, id, patch)),
  trashMimNote: (id: ID) => runRaw((d) => T.trashMimNote(d, id)),

  reorder: (table: 'favorites' | 'routines' | 'mimNotes', ids: readonly ID[]) => apply((d) => O.reorder(d, table, ids)),

  // ゴミ箱（6.15）。移す・戻す・完全に削除は raw の記録に当てる（上の説明。画面からは await して結果を受け取る）
  restoreTrashEntry: (entryId: ID) => runRaw((d) => T.restoreTrashEntry(d, entryId)),
  deleteTrashEntry: (entryId: ID) => runRaw((d) => ({ data: T.deleteTrashEntry(d, entryId), result: undefined })),
  emptyTrash: () => runRaw((d) => ({ data: T.emptyTrash(d), result: undefined })),

  // バックアップ（6.16）。書き出しは、このタブの変更を保存してから読み直した端末の raw の記録から（ほかのタブ・同期が書いた後の物も入る）
  exportBackup: async (opts: BackupOptions) => backupJson(await loadFromDisk(), opts),
  /**
   * ファイルを確かめて読み込む（MIM を含まないファイルなら、今の MIM とゴミ箱の MIM はそのまま。形4）。今の端末の記録との合わせ方
   * （restoreData）は、保存先のトランザクションの中で読んだ端末の記録に当てる
   */
  importBackup: async (json: string) => {
    const parsed = parseBackup(json)
    await replaceAllData((disk) => restoreData(disk, parsed))
    return { includesMim: parsed.includesMim }
  },

  // 受け取り箱（19.5。画面と自動で当てる所は段階5。ctx.perms は config/connector の許可、ctx.isGone は _gone の控え）
  processInbox: (ctx: I.InboxContext) => runInbox((raw) => I.processInbox(raw, ctx)),
  answerProposal: (id: ID, answer: 'accept' | 'decline', ctx: I.InboxContext, opts?: { confirmed?: boolean }) =>
    runInbox((raw) => I.answerProposal(raw, id, answer, ctx, opts)),
  approveConflict: (id: ID, ctx: I.InboxContext) => runInbox((raw) => I.approveConflict(raw, id, ctx)),
  declineConflict: (id: ID, ctx: I.InboxContext) =>
    runInbox((raw) => ({ ...I.declineConflict(raw, id, ctx), result: undefined })),
  undoRequest: (id: ID, ctx: I.InboxContext, opts?: { confirmed?: boolean }) =>
    runInbox((raw) => I.undoRequest(raw, id, ctx, opts)),
  cleanupInbox: (ctx: I.InboxContext) => runInbox((raw) => ({ ...I.cleanupInbox(raw, ctx), result: undefined })),
}
