// 元に戻す・やり直す（docs/SPEC.md の 7.13・3.7・3.9・3.10。22. の段階2の終わりの確かめ）の並びと、それを当てる所。並びの決まりは
// src/domain/undo.ts（純粋な関数）、当てるのは画面と同じ actions（attempt と同じく、決まりで断られたらお知らせ。保存・同期はふつうに
// 流れる）。端末には覚えない（アプリを開き直すと空）。
// - 積むのは、ウィークリー・デイリーを出している間（その画面と、そこから開いた登録・詳細のシート）の、予定を変える操作だけ
//   （enterUndoScope。年・月を出している間・設定などでした操作は積まない）。年・月へ替えても並びは消さない（開発。■24 で作者に聞いている）
// - 画面が操作の後に recordStep で積む（前・後の記録を渡す）。お知らせの［元に戻す］も同じステップを戻す（undoStep。後で同じ記録に
//   触れた操作があれば、それも新しい方から先に戻す）。ボタンで戻したステップのお知らせは消す。積まなかった操作（年・月の画面など）の
//   お知らせの［元に戻す］も、同じ確かめで戻す（並びには入れない）
// - 詳細の画面は、開いてから閉じるまでに直した所を1つにまとめる（beginItemSession。中で複製・削除をした時は、その前までをまとめて
//   先に積む）
// - 戻す・やり直すは1つずつ順に当てる（続けて押した分は待って順に。ゴミ箱の出し入れは保存を待つ）。ほかの所で直されていたら
//   当てずに「ほかの所で直されたので戻せません」と出し、そのステップを捨てる
import { create } from 'zustand'
import { undoText } from '../domain/itemText'
import { UNDO_REFUSED } from '../domain/ops'
import * as U from '../domain/undo'
import { DomainError, type ID, type Item } from '../domain/types'
import { actions } from './actions'
import { getData } from './appStore'
import { notify, notifyError, useToasts } from './uiStore'

/** お知らせの［元に戻す］の字（3.9） */
export const UNDO_LABEL = '元に戻す'

/** ほかの所で直されていて戻せない・やり直せない時の文（7.13） */
export const UNDO_CONFLICT = 'ほかの所で直されたので戻せません'

export interface UndoState {
  stack: U.UndoStack
}

export const useUndo = create<UndoState>(() => ({ stack: U.emptyUndoStack() }))

/** 戻した・やり直した後にすること（すばやく足すの、打った字を書きかけに戻す・消すなど） */
export interface StepHooks {
  afterUndo?: () => void
  afterRedo?: () => void
}

let seq = 0
/** 新しい操作を積んだ回数（戻している間に新しい操作が来たかを見る） */
let pushes = 0
/** ウィークリー・デイリーを出している数（0 の間は積まない） */
let scope = 0
const hooks = new Map<number, StepHooks>()
/** ステップの番号 → そのお知らせの番号（ボタンで戻した時に、そのお知らせを消す） */
const toastOf = new Map<number, number>()
/** 積まなかったステップを覚えておく数（お知らせの［元に戻す］のため。お知らせは3つまでしか出ない） */
const DETACHED_MAX = 10
/** 積まなかったステップ（お知らせの［元に戻す］だけで戻せる） */
const detached = new Map<number, U.UndoStep>()
/** 開いている詳細の画面（予定の id → まとめ始めた時の記録） */
const sessions = new Map<ID, { base: Item | null }>()
let queue: Promise<unknown> = Promise.resolve()

const stackNow = () => useUndo.getState().stack
const setStack = (stack: U.UndoStack) => useUndo.setState({ stack })

function reader(): U.UndoReader {
  const d = getData()
  return {
    item: (id) => d.items[id],
    inTrash: (entry) => d.trashEntries[entry] !== undefined,
    off: (date) => Boolean(d.offDays[date]?.off),
  }
}

/** ウィークリー・デイリーの画面を出した（戻り値で終える。重ねて呼んでよい） */
export function enterUndoScope(): () => void {
  scope += 1
  let left = false
  return () => {
    if (left) return
    left = true
    scope -= 1
  }
}

/** 今、操作を積むか（ウィークリー・デイリーを出している） */
export const undoScopeActive = (): boolean => scope > 0

function push(step: U.UndoStep): void {
  pushes += 1
  const before = stackNow()
  const next = U.pushStep(before, step)
  // 消えたやり直せる物・あふれた古い物の後始末
  const kept = new Set([...next.past, ...next.future].map((s) => s.id))
  for (const s of [...before.past, ...before.future]) if (!kept.has(s.id)) forget(s.id)
  setStack(next)
}

function forget(id: number): void {
  hooks.delete(id)
  toastOf.delete(id)
}

/** 詳細の画面で直した所を1つのステップにして積む（変わっていなければ積まない） */
function flushSession(id: ID, cur: Item | null): void {
  const s = sessions.get(id)
  if (!s) return
  const step = cur ? U.sessionStep(seq + 1, undoText.edited(cur.title), s.base, cur) : null
  if (step) {
    seq += 1
    push(step)
  }
  s.base = cur
}

/**
 * 操作を積む（画面が操作の後に呼ぶ）。ウィークリー・デイリーを出していない時は積まない（お知らせの［元に戻す］だけで戻せる）。
 * 開いている詳細の画面があれば、それまでに直した所を先に積む（操作がその予定を変えたなら、その前の記録まで）。何も変わらなかった
 * 時は積まずに null
 */
export function recordStep(label: string, changes: U.UndoChange[], stepHooks?: StepHooks): U.UndoStep | null {
  // 何も変わらなかった操作（もう完了だった予定を完了にした・同じ日へ動かした）は積まない
  changes = changes.filter((c) => !U.isNoopChange(c))
  if (changes.length === 0) return null
  seq += 1
  const step: U.UndoStep = { id: seq, label, changes }
  if (stepHooks) hooks.set(step.id, stepHooks)
  if (scope === 0) {
    detached.set(step.id, step)
    // お知らせは 6秒で消えるので、古い物は覚えておかない
    for (const old of detached.keys()) {
      if (detached.size <= DETACHED_MAX) break
      detached.delete(old)
      forget(old)
    }
    return step
  }
  for (const [id, s] of sessions) {
    const ch = step.changes.find((c): c is U.ItemChange => c.table === 'items' && c.id === id)
    if (ch) {
      flushSession(id, ch.before)
      s.base = ch.after
    } else flushSession(id, getData().items[id] ?? null)
  }
  push(step)
  return step
}

/** 予定1件の変わり方（前・後は表示用の記録。無ければ null） */
export function itemChange(
  id: ID,
  before: Item | null | undefined,
  after: Item | null | undefined,
  entry: ID | null = null,
): U.ItemChange {
  return { table: 'items', id, before: before ?? null, after: after ?? null, entry }
}

/** お知らせを［元に戻す］付きで出す（押すとそのステップを戻す。ボタンで戻した時は、このお知らせを消す） */
export function notifyUndoable(message: string, step: U.UndoStep | null): void {
  if (!step) {
    notify(message)
    return
  }
  const id = notify(message, { label: UNDO_LABEL, run: () => void undoStep(step.id) })
  toastOf.set(step.id, id)
}

/**
 * 詳細の画面を開いた（予定の id）。閉じるまでに直した所を1つにまとめ、閉じた時（戻り値を呼んだ時）に積む。ウィークリー・デイリーを
 * 出していない時は何もしない
 */
export function beginItemSession(id: ID): () => void {
  if (scope === 0) return () => {}
  const own = { base: getData().items[id] ?? null }
  sessions.set(id, own)
  return () => {
    if (sessions.get(id) !== own) return
    flushSession(id, getData().items[id] ?? null)
    sessions.delete(id)
  }
}

/** 1つの変わり方を当てる（当てた後の変わり方を返す。ゴミ箱の1件が替わる） */
async function applyChange(c: U.UndoChange, dir: U.UndoDirection): Promise<U.UndoChange> {
  if (c.table === 'offDays') {
    actions.setOffDay(c.id, dir === 'undo' ? c.before : c.after)
    return c
  }
  const target = dir === 'undo' ? c.before : c.after
  if (target === null) {
    // 足した物を戻す・消した物をやり直す: ゴミ箱へ（30日は戻せる。お知らせの［元に戻す］の前の作りと同じ）
    const entry = await actions.trashItem(c.id)
    return { ...c, entry }
  }
  if (!getData().items[c.id]) {
    // 消した物を戻す・足した物をやり直す: ゴミ箱から元の所へ
    if (c.entry === null) throw new DomainError(UNDO_REFUSED)
    await actions.restoreTrashEntry(c.entry)
    const back = getData().items[c.id]
    if (back && U.itemPrint(back) !== U.itemPrint(target)) actions.restoreItemContent(c.id, target)
    return { ...c, entry: null }
  }
  actions.restoreItemContent(c.id, target)
  return c
}

function dismissToast(stepId: number): void {
  const t = toastOf.get(stepId)
  if (t !== undefined) useToasts.getState().dismiss(t)
  toastOf.delete(stepId)
}

/** 戻せない・やり直せない: 知らせて、そのステップを捨てる */
function refuse(step: U.UndoStep, e?: unknown): void {
  if (e !== undefined && !(e instanceof DomainError)) {
    notifyError(e instanceof Error ? e.message : String(e))
    console.error(e)
  } else notifyError(UNDO_CONFLICT)
  dismissToast(step.id)
  detached.delete(step.id)
  setStack(U.dropStep(stackNow(), step.id))
  forget(step.id)
}

async function apply(dir: U.UndoDirection, pick: () => U.UndoStep | null): Promise<boolean> {
  const step = pick()
  if (!step) return false
  const at = pushes
  if (U.conflictOf(step, dir, reader()) !== null) {
    refuse(step)
    return false
  }
  let next: U.UndoStep
  try {
    const order = dir === 'undo' ? [...step.changes].reverse() : step.changes
    const done: U.UndoChange[] = []
    for (const c of order) done.push(await applyChange(c, dir))
    next = { ...step, changes: dir === 'undo' ? done.reverse() : done }
  } catch (e) {
    refuse(step, e)
    return false
  }
  if (detached.has(step.id)) detached.delete(step.id)
  else if (dir === 'undo' && pushes !== at) setStack(U.dropStep(stackNow(), step.id))
  else setStack(U.settleStep(stackNow(), next, dir))
  dismissToast(step.id)
  // 開いている詳細の画面のまとめは、当てた後の記録から（戻した分を、閉じた時に「直した」として積まない）
  for (const id of U.itemIdsOf(step)) {
    const s = sessions.get(id)
    if (s) s.base = getData().items[id] ?? null
  }
  const h = hooks.get(step.id)
  if (dir === 'undo') h?.afterUndo?.()
  else h?.afterRedo?.()
  return true
}

/** 当てるのを順に並べる（続けて押した分は、前の分が終わってから） */
function enqueueRun(op: () => Promise<boolean>): Promise<boolean> {
  const run = queue.then(op)
  queue = run.catch(() => undefined)
  return run
}

const enqueue = (dir: U.UndoDirection, pick: () => U.UndoStep | null): Promise<boolean> => enqueueRun(() => apply(dir, pick))

/** 並びの中か、積まなかった物の、まだ戻していないステップ（無ければ null） */
function undoableStep(stepId: number): U.UndoStep | null {
  const st = stackNow()
  if (U.placeOf(st, stepId) === 'past') return st.past.find((s) => s.id === stepId) ?? null
  return detached.get(stepId) ?? null
}

/**
 * お知らせの［元に戻す］: そのステップの前の形へ。後で同じ記録に触れた操作があれば（並びの中の物）、それを新しい方から先に戻す
 * （どれもやり直せる物になり、やり直すで古い方から順にまたできる）。開いている詳細の画面でその記録を直していれば、それを先に
 * 1つにまとめて積む。当てる前に、続けて戻せるかを確かめ（chainConflict）、ほかの所で直されていれば何も戻さずに断る
 */
async function undoWithLater(stepId: number): Promise<boolean> {
  const step = undoableStep(stepId)
  if (!step) return false
  const touched = new Set([step, ...U.laterDependents(stackNow().past, step)].flatMap(U.itemIdsOf))
  for (const id of touched) if (sessions.has(id)) flushSession(id, getData().items[id] ?? null)
  const later = U.laterDependents(stackNow().past, step)
  const blocked = U.chainConflict([...later, step], reader())
  if (blocked) {
    refuse(blocked.step)
    return false
  }
  for (const s of later) if (!(await apply('undo', () => (U.placeOf(stackNow(), s.id) === 'past' ? s : null)))) return false
  return apply('undo', () => undoableStep(stepId))
}

/** いちばん新しい操作を元に戻す（ボタン・Ctrl/⌘+Z）。戻せた時 true */
export const undo = (): Promise<boolean> => enqueue('undo', () => U.nextUndo(stackNow()))

/** 戻した操作をやり直す（ボタン・Ctrl/⌘+Shift+Z・Ctrl+Y）。やり直せた時 true */
export const redo = (): Promise<boolean> => enqueue('redo', () => U.nextRedo(stackNow()))

/**
 * そのステップを戻す（お知らせの［元に戻す］）。並びの中でまだ戻していなければ、いちばん新しい物でなくても戻す（ボタンの元に戻すの
 * 1つ分になり、やり直すで戻せる）。後で同じ予定・休みに触れた操作があれば、それも新しい方から先に戻して、その操作の前の形にする
 * （undoWithLater）。積まなかった操作も戻す。もう戻した・捨てた物は何もしない
 */
export function undoStep(stepId: number): Promise<boolean> {
  return enqueueRun(() => undoWithLater(stepId))
}

/** 当て終えるまで待つ（テスト用） */
export const undoIdle = (): Promise<unknown> => queue

/** テスト用: 並びと控えを空にする */
export function resetUndoForTests(): void {
  seq = 0
  pushes = 0
  scope = 0
  hooks.clear()
  toastOf.clear()
  detached.clear()
  sessions.clear()
  queue = Promise.resolve()
  setStack(U.emptyUndoStack())
}
