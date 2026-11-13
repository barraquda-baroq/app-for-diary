// 元に戻す・やり直すの並びの決まり（docs/SPEC.md の 7.13・3.9。22. の段階2の終わりの確かめ）。純粋な関数だけ（画面・保存の仕組みに
// 頼らない。当てるのは src/store/undoStore.ts）。
// - 1つの操作（ステップ）は、変えた記録ごとに「前」と「後」を持つ（予定は記録まるごと、休みは休みかどうか）。予定を足した・消した
//   （ゴミ箱へ移した）時は、無い側を null にし、ゴミ箱にある間はそのゴミ箱の1件（entry）を覚える
// - 並びは「戻せる物」（past。新しい物が後ろ）と「やり直せる物」（future。次にやり直す物が後ろ）。新しい操作を積むと future は消え、
//   past は UNDO_LIMIT（50）まで（古い物から捨てる）。アプリを開き直すと空（端末に覚えない）
// - 戻す・やり直す前に、その記録が「後」（戻す時）・「前」（やり直す時）のままかを確かめる。ほかの所（ほかの端末・並びの外の操作）で
//   直されていたら、そのステップは当てずに捨てる（「ほかの所で直されたので戻せません」）。比べるのは記録の内容の指紋（revOf。直した
//   日時と並びの数は見ない。形2）
// - 詳細の画面を開いてから閉じるまでに直した所は、1つのステップにまとめる（sessionStep）
import { revOf } from './hash'
import type { ID, Item } from './types'

/** 戻せる操作の数（これより古い物は捨てる） */
export const UNDO_LIMIT = 50

/** 予定1件の変わり方（before・after が null = その側では無い（足す前・ゴミ箱へ移した後）） */
export interface ItemChange {
  table: 'items'
  id: ID
  before: Item | null
  after: Item | null
  /** 今その予定が入っているゴミ箱の1件（ゴミ箱へ移した後・足した物を戻した後。無ければ null） */
  entry: ID | null
}

/** 休みの1日の変わり方（休みかどうか） */
export interface OffDayChange {
  table: 'offDays'
  /** 日付（'YYYY-MM-DD'。休みの記録の id） */
  id: string
  before: boolean
  after: boolean
}

export type UndoChange = ItemChange | OffDayChange

/** 1つの操作 */
export interface UndoStep {
  /** この並びの中で1つだけの番号（お知らせの［元に戻す］が、どのステップかを覚える） */
  id: number
  /** 操作の名前（ボタンの読み上げ・ヒントの「元に戻す（『会議』を移した）」の括弧の中） */
  label: string
  changes: UndoChange[]
}

export interface UndoStack {
  /** 戻せる物（いちばん後ろが次に戻す物） */
  past: UndoStep[]
  /** やり直せる物（いちばん後ろが次にやり直す物） */
  future: UndoStep[]
}

export type UndoDirection = 'undo' | 'redo'

export const emptyUndoStack = (): UndoStack => ({ past: [], future: [] })

/** 新しい操作を積む（やり直せる物は消える。UNDO_LIMIT を超えた古い物は捨てる） */
export function pushStep(stack: UndoStack, step: UndoStep, limit: number = UNDO_LIMIT): UndoStack {
  const past = [...stack.past, step]
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] }
}

/** 次に戻す物（無ければ null） */
export const nextUndo = (stack: UndoStack): UndoStep | null => stack.past[stack.past.length - 1] ?? null

/** 次にやり直す物（無ければ null） */
export const nextRedo = (stack: UndoStack): UndoStep | null => stack.future[stack.future.length - 1] ?? null

/** そのステップがどちらにあるか（無ければ null） */
export function placeOf(stack: UndoStack, id: number): 'past' | 'future' | null {
  if (stack.past.some((s) => s.id === id)) return 'past'
  if (stack.future.some((s) => s.id === id)) return 'future'
  return null
}

/** そのステップを並びから外す */
export function dropStep(stack: UndoStack, id: number): UndoStack {
  return { past: stack.past.filter((s) => s.id !== id), future: stack.future.filter((s) => s.id !== id) }
}

/**
 * 戻した・やり直した後の並び: そのステップを今ある所から外し、戻したならやり直せる物の後ろへ、やり直したなら戻せる物の後ろへ
 * （step は当てた後の物。ゴミ箱の1件が替わった物）。お知らせの［元に戻す］で、いちばん後ろでないステップを戻した時も同じ
 */
export function settleStep(stack: UndoStack, step: UndoStep, dir: UndoDirection): UndoStack {
  const rest = dropStep(stack, step.id)
  return dir === 'undo'
    ? { past: rest.past, future: [...rest.future, step] }
    : { past: [...rest.past, step], future: rest.future }
}

/** 今の記録を読む物（表示用のデータから） */
export interface UndoReader {
  item: (id: ID) => Item | undefined
  /** そのゴミ箱の1件があるか */
  inTrash: (entry: ID) => boolean
  /** その日が休みか */
  off: (date: string) => boolean
}

/** 予定の記録の指紋（無い = ''。直した日時と並びの数は見ない。形2） */
export const itemPrint = (item: Item | null | undefined): string => revOf(item ?? null)

/**
 * 戻す（undo）・やり直す（redo）前の確かめ: 記録が、戻すなら「後」、やり直すなら「前」のままか。違う所（ほかの所で直された）の
 * 最初の変わり方を返す（どれも合えば null）。無い側（null）は、予定が無く、覚えているゴミ箱の1件がまだある時だけ合う
 */
export function conflictOf(step: UndoStep, dir: UndoDirection, read: UndoReader): UndoChange | null {
  for (const c of step.changes) {
    if (c.table === 'offDays') {
      const expected = dir === 'undo' ? c.after : c.before
      if (read.off(c.id) !== expected) return c
      continue
    }
    const expected = dir === 'undo' ? c.after : c.before
    const cur = read.item(c.id)
    if (expected === null) {
      if (cur !== undefined || c.entry === null || !read.inTrash(c.entry)) return c
      continue
    }
    if (cur === undefined || itemPrint(cur) !== itemPrint(expected)) return c
  }
  return null
}

/**
 * 詳細の画面で直した所を1つのステップにする（base = 開いた時（か前にまとめた時）の記録、cur = 今の記録）。変わっていない・
 * 予定が無くなった（消した。消したステップは別に積む）時は null
 */
export function sessionStep(id: number, label: string, base: Item | null, cur: Item | null | undefined): UndoStep | null {
  if (!base || !cur || itemPrint(base) === itemPrint(cur)) return null
  return { id, label, changes: [{ table: 'items', id: cur.id, before: base, after: cur, entry: null }] }
}

/** 何も変えていない変わり方か（前と後が同じ中身。予定は記録の指紋で比べる） */
export function isNoopChange(c: UndoChange): boolean {
  if (c.table === 'offDays') return c.before === c.after
  if (c.before === null || c.after === null) return c.before === c.after
  return itemPrint(c.before) === itemPrint(c.after)
}

/** そのステップが変える予定の id（詳細の画面のまとめと突き合わせる） */
export const itemIdsOf = (step: UndoStep): ID[] =>
  step.changes.filter((c): c is ItemChange => c.table === 'items').map((c) => c.id)
