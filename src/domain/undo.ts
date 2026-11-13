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
// - ボタン・キーで戻した・やり直した後に見せる所（undoFocus。予定とその日、休みの日。今の週・日に無ければ、今のモードのまま
//   その日へ移る。■26）
import { revOf } from './hash'
import { periodOf } from './items'
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

/** 変わり方の記録の印（表と id） */
const keyOf = (c: UndoChange): string => `${c.table}:${c.id}`

/**
 * お知らせの［元に戻す］で、いちばん新しくないステップを戻す時に、先に戻す物: past の中でそのステップより後ろ（後に当てた物。
 * 番号ではなく並びの順で見る。お知らせで戻してやり直した物は後ろへ移る）のステップのうち、同じ記録に触れる物（それが触れた記録に、
 * さらに後で触れた物も）。新しい順（戻す順）。そのステップが past に無い（積まなかった物）時は無し（並びの中の物は一緒に戻さない）
 */
export function laterDependents(past: UndoStep[], step: UndoStep): UndoStep[] {
  const at = past.findIndex((s) => s.id === step.id)
  if (at < 0) return []
  const keys = new Set(step.changes.map(keyOf))
  const out: UndoStep[] = []
  for (const s of past.slice(at + 1)) {
    if (!s.changes.some((c) => keys.has(keyOf(c)))) continue
    out.push(s)
    for (const c of s.changes) keys.add(keyOf(c))
  }
  return out.reverse()
}

/**
 * 並びに無いステップ（積まなかった物。年・月の画面でした操作など）より後に積んだステップ（番号が大きい。番号は積んだ順に振る）のうち、
 * 同じ記録に触れる物が並び（戻せる物・やり直せる物）にあるか（お知らせの［元に戻す］で、それを一緒に戻さないので断る）
 */
export function touchedAfter(stack: UndoStack, step: UndoStep): boolean {
  const keys = new Set(step.changes.map(keyOf))
  return [...stack.past, ...stack.future].some((s) => s.id > step.id && s.changes.some((c) => keys.has(keyOf(c))))
}

/**
 * 続けて戻すステップ（steps。戻す順 = 新しい順）を、前から順に戻せるかを、当てる前に確かめる: 1つ目は今の記録と、2つ目からは
 * その前のステップを戻した後の記録（そのステップの「前」）と比べる（conflictOf）。合わない最初のステップと変わり方を返す
 * （どれも合えば null）
 */
export function chainConflict(steps: UndoStep[], read: UndoReader): { step: UndoStep; change: UndoChange } | null {
  const items = new Map<ID, Item | undefined>()
  const off = new Map<string, boolean>()
  /** 戻すとゴミ箱から出る1件 */
  const restored = new Set<ID>()
  const after: UndoReader = {
    item: (id) => (items.has(id) ? items.get(id) : read.item(id)),
    inTrash: (entry) => !restored.has(entry) && read.inTrash(entry),
    off: (date) => off.get(date) ?? read.off(date),
  }
  for (const step of steps) {
    const change = conflictOf(step, 'undo', after)
    if (change) return { step, change }
    for (const c of step.changes) {
      if (c.table === 'offDays') {
        off.set(c.id, c.before)
        continue
      }
      items.set(c.id, c.before ?? undefined)
      if (c.after === null && c.entry !== null) restored.add(c.entry)
    }
  }
  return null
}

// ---------- 戻した・やり直した後に見せる所（7.13・■26） ----------

/**
 * 戻した・やり直した後に見せる所。予定（id）か休みの日。date は見に行く日（今のモードのままその日の期間へ移る）、from〜to は動いた
 * 所（日付の動いた操作は動いた端の日だけ、日付の変わらない操作は予定の期間の全部）、span は当てた後の予定の期間の全部（6.3。休みは
 * その日）。今の期間に span のどこかが入っていて、そこに出ている物があれば、動いた端が今の期間の外でも移らずにそこを見せる
 */
export type UndoFocus =
  | { table: 'items'; id: ID; date: string; from: string; to: string; span: { from: string; to: string } }
  | { table: 'offDays'; date: string; from: string; to: string; span: { from: string; to: string } }

/** 1つの変わり方の、当てる前と当てた後（戻す時は「後」→「前」、やり直す時は「前」→「後」） */
export function appliedSides<T extends UndoChange>(c: T, dir: UndoDirection): { from: T['before']; to: T['before'] } {
  return dir === 'undo' ? { from: c.after, to: c.before } : { from: c.before, to: c.after }
}

/**
 * 戻した（undo）・やり直した（redo）ステップの、見せる所（最初の変わり方で決める。どのステップも変わり方は1つ）:
 * - 予定: 当てた後の記録の期間（6.3）。開始日が動いた（か、前はカレンダーに出ていなかった）時は期間の初めの日（始点・1日のカード）、
 *   締め切り日だけが動いた時は期間の終わりの日（終点の●・〆）、日付の変わらない時は期間の全部（見に行くのは初めの日）
 * - 当てた後に予定が無い（足したのを戻した・削除をやり直した。ゴミ箱へ）・カレンダーに出ない時は null
 * - 休み: その日
 */
export function undoFocus(step: UndoStep, dir: UndoDirection): UndoFocus | null {
  const c = step.changes[0]
  if (!c) return null
  if (c.table === 'offDays') return { table: 'offDays', date: c.id, from: c.id, to: c.id, span: { from: c.id, to: c.id } }
  const { from: was, to: now } = appliedSides(c, dir)
  const p = now ? periodOf(now) : null
  if (!p) return null
  const span = { from: p.from, to: p.to }
  const prev = was ? periodOf(was) : null
  if (prev && prev.from === p.from && prev.to === p.to)
    return { table: 'items', id: c.id, date: p.from, from: p.from, to: p.to, span }
  const date = prev && prev.from === p.from ? p.to : p.from
  return { table: 'items', id: c.id, date, from: date, to: date, span }
}
