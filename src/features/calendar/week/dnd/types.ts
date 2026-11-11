// ウィークリーのドラッグ（week/dnd）の約束の形（docs/SPEC.md の 7.11・D52）。ウィークリー（WP7）は index から読む
import type { HTMLAttributes } from 'react'
import type { Handle } from '../../../../domain/drag'
import type { ID, Item, ItemKind } from '../../../../domain/types'

/** 見ている週（日曜・土曜の 'YYYY-MM-DD'。src/domain/drag.ts の WeekCtx と同じ形） */
export interface WeekCtx {
  from: string
  to: string
}

/** 掴む所: カード（1日の予定・〆）・開始のカード・終わりの● */
export type DragHandle = Handle

export interface ItemDrag {
  /** 掴む要素に付ける */
  ref: (el: Element | null) => void
  /** 今その予定を掴んで動かしている */
  isDragging: boolean
  /** 掴む要素に広げて渡す（ロック中に掴もうとした時の揺れ。D25） */
  grabProps: HTMLAttributes<HTMLElement>
}

/** 落とせる所の様子: none = 掴んでいない・落とせない、ok = 落とせる（点線の枠）、hover = 今その上にある（線の枠） */
export type DropState = 'none' | 'ok' | 'hover'

export interface DayDrop {
  /** その日・その区分の段（落とす所）に付ける */
  ref: (el: Element | null) => void
  state: DropState
}

/** 掴んだ物に持たせる値（dnd-kit の draggable の data）: 掴んだ時の予定（表示用に直した物）と掴む所 */
export interface DragData {
  item: Item
  handle: DragHandle
}

/** 落とす所に持たせる値（dnd-kit の droppable の data。段階3の Task List の行からも同じ所に落とすので、日と区分だけ。D52） */
export interface DropData {
  date: string
  kind: ItemKind
}

/** 掴む物の id（item:{id}:{card|start|end}） */
export const dragId = (id: ID, handle: DragHandle): string => `item:${id}:${handle}`

/** 落とす所の id（day:{date}:{kind}） */
export const dropId = (date: string, kind: ItemKind): string => `day:${date}:${kind}`

/** dnd-kit から受け取った data が、ウィークリーの予定を掴んだ物か（段階3で別の物が来ても読み違えない） */
export function asDragData(data: unknown): DragData | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Partial<DragData>
  const handle = d.handle
  return d.item && typeof d.item.id === 'string' && (handle === 'card' || handle === 'start' || handle === 'end')
    ? (d as DragData)
    : null
}

/** dnd-kit から受け取った落とす所の data（日と区分）。違う物なら null */
export function asDropData(data: unknown): DropData | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Partial<DropData>
  return typeof d.date === 'string' && (d.kind === 'work' || d.kind === 'private') ? { date: d.date, kind: d.kind } : null
}
