// ウィークリーのドラッグ（docs/SPEC.md の 7.11。dnd-kit を読み込むのはこのフォルダだけ）。WP11 が中身を作るまでの仮の物:
// 形（受け取る物・返す物）は最後の物で、何もしない（掴めない・落とせない）。ウィークリー（WP7）はこれを呼んでおけば、
// 中身ができた時に描き方を変えずにドラッグできるようになる
import { createElement, Fragment, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import type { Item, ItemKind } from '../../../../domain/types'

/** 見ている週（日曜・土曜の 'YYYY-MM-DD'。src/domain/drag.ts の WeekCtx と同じ形） */
export interface WeekCtx {
  from: string
  to: string
}

/** 掴む所: カード（1日の予定・〆）・開始のカード・終わりの● */
export type DragHandle = 'card' | 'start' | 'end'

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

/** ウィークリーを包む（ドラッグの受け持ち。段階2はウィークリーだけ、段階3で TopPage へ上げる。D52）。今は中身をそのまま出す */
export function WeekDnd({ children }: { week: WeekCtx; children: ReactNode }): ReactElement {
  return createElement(Fragment, null, children)
}

const noRef = (): void => {}
const NO_GRAB: HTMLAttributes<HTMLElement> = Object.freeze({})
const NOT_DRAGGING: ItemDrag = Object.freeze({ ref: noRef, isDragging: false, grabProps: NO_GRAB })
const NO_DROP: DayDrop = Object.freeze({ ref: noRef, state: 'none' as const })

/** 予定を掴めるようにする（カードは item:{id}:{card|start|end}）。今は何もしない */
export function useItemDrag(_a: { item: Item; handle: DragHandle; week: WeekCtx }): ItemDrag {
  return NOT_DRAGGING
}

/** その日・その区分の段を落とせる所にする（day:{date}:{kind}。段階3のリストの行からも同じ所に落とす）。今は何もしない */
export function useDayDrop(_a: { date: string; kind: ItemKind; week: WeekCtx }): DayDrop {
  return NO_DROP
}
