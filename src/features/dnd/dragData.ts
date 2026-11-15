// 掴んだ物に持たせる値（dnd-kit の draggable の data）の形と見分け方（docs/SPEC.md の 7.11・13.6・14.2・15.2。開発）。
// 1つのドラッグの入れ物（TopDnd）の中で、ウィークリーの予定・Task List の行・リストの並べ替えの3つを掴む。違う物を読み違えない:
// ウィークリーの落とす所は並べ替えの物を受けず、並べ替えはカレンダーの日を受けない（FRAME-224）。
// Task List の行と並べ替えは type の印（'task-row'・'sort'）で、ウィークリーの予定は今までどおり week/dnd の asDragData の形で見分ける
// （ウィークリーの予定の値には印を付けていない。印の付いた物はウィークリーの予定と読まない）。見分けるのは dragTypeOf の1か所
import type { ID, Item } from '../../domain/types'
import { asDragData, type DragData } from '../calendar/week/dnd/types'

/** 掴んだ物の種類（TopDnd が掴み始め・動き・離した時を、その種類の受け持ち（controllers.ts）へ渡す） */
export type DragType = 'week-item' | 'task-row' | 'sort'

/** ウィークリーで予定を掴んだ物（week/dnd の DragData。予定・掴む所・掴んだ週） */
export type WeekDragData = DragData

/** Task List の行を掴んだ物（L・マウスだけ。カレンダーの日へ落とす。13.6） */
export interface TaskRowDragData {
  type: 'task-row'
  /** 掴んだ時の予定（表示用に直した物） */
  item: Item
}

/** 並べ替える表（store/actions の reorder と同じ。MIM のメモは段階4） */
export type ReorderTable = 'routines' | 'favorites' | 'mimNotes'

/** リストの並べ替えで掴んだ物（Routine List は同じ種類のかたまりの中だけ、Favorite List はまだの行の中。14.2・15.2） */
export interface SortDragData {
  type: 'sort'
  table: ReorderTable
  /** 並べ替えるかたまり（Routine List は種類 daily…、Favorite List は 'open'） */
  group: string
  id: ID
  /** かたまりの中の今の位置（0 から） */
  index: number
}

export type AnyDragData = WeekDragData | TaskRowDragData | SortDragData

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const REORDER_TABLES: readonly ReorderTable[] = ['routines', 'favorites', 'mimNotes']

/** dnd-kit から受け取った data が Task List の行か（違えば null） */
export function asTaskRowDrag(data: unknown): TaskRowDragData | null {
  if (!isRecord(data) || data.type !== 'task-row') return null
  return isRecord(data.item) && typeof data.item.id === 'string' ? (data as unknown as TaskRowDragData) : null
}

/** dnd-kit から受け取った data がリストの並べ替えか（違えば null） */
export function asSortDrag(data: unknown): SortDragData | null {
  if (!isRecord(data) || data.type !== 'sort') return null
  const { table, group, id, index } = data
  return REORDER_TABLES.includes(table as ReorderTable) &&
    typeof group === 'string' &&
    typeof id === 'string' &&
    Number.isInteger(index) &&
    (index as number) >= 0
    ? (data as unknown as SortDragData)
    : null
}

/** 掴んだ物の種類（知らない物は null。印の付いた物はウィークリーの予定と読まない） */
export function dragTypeOf(data: unknown): DragType | null {
  if (asTaskRowDrag(data)) return 'task-row'
  if (asSortDrag(data)) return 'sort'
  if (isRecord(data) && 'type' in data) return null
  return asDragData(data) ? 'week-item' : null
}
