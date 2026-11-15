// 掴んだ物の種類ごとの受け持ち（docs/SPEC.md の 7.11・13.6・14.2・15.2。（開発））。TopDnd の1つの DragDropProvider が、掴み始め・動き・
// 上にある落とす所が替わった時・離した時を、掴んだ物の種類（dragData.ts の dragTypeOf）の受け持ちへ渡す。ウィークリー（week/dnd の
// WeekDnd）は 'week-item'、Task List の行は 'task-row'、並べ替えは 'sort' を、出している間だけ届ける。どの種類でも、掴み始めに TopDnd が
// useCalendarUi.setDragging(true)（掴んでいる間は「戻る」「進む」・端からのフリックで画面を動かさない）・入力欄のフォーカスを外す・
// すばやく足すへ知らせる・指なら 15ms 震わせ、離した時は受け持ちの後に setDragging(false) にする（TopDnd.tsx）。
// - 届けた受け持ちは、描き直しても外さない（dnd-kit へは、いつも最後に描いた時の受け持ちを呼ぶ代わりの物を届ける。受け持ちの物が
//   描くたびに替わっても、掴んでいる間に外れて、その種類の出来事を取りこぼさないように）。届けた部品が外れた時だけ外す
// - その種類を掴んでいる間に届けた部品が外れた時（掴んだまま幅が替わってウィークリーが外れたなど）は、やめたこととして終える:
//   受け持ちの「離した時」を canceled で呼んでから外す（ウィークリーが自分で dnd-kit の入れ物を持っていた時に、入れ物が外れて dnd-kit が
//   していたことと同じ。落とさず、掴んだまま別の週へ移っていたら掴んだ週へ戻す）。dnd-kit の入れ物は残るので、次のドラッグもそのまま掴める
// - 「上にある落とす所が替わった時」（onDragOver）を持つ受け持ちが届いている間だけ、TopDnd はそれを dnd-kit へ頼む（dnd-kit は頼んだ
//   出来事の後に描き終えるのを待ってから次の当たりを数えるので、要らない間は頼まない。ウィークリーは持たない）
import type { DragDropManager, DragEndEvent, DragMoveEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/dom'
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { DragType } from './dragData'

/** その種類の掴み始め・動き・上にある落とす所が替わった時・離した時にすること */
export interface DragController {
  onDragStart?: (event: DragStartEvent, manager: DragDropManager) => void
  onDragMove?: (event: DragMoveEvent, manager: DragDropManager) => void
  /** 上にある落とす所が替わった時（並べ替えで見せる並びを替えるなど） */
  onDragOver?: (event: DragOverEvent, manager: DragDropManager) => void
  onDragEnd?: (event: DragEndEvent, manager: DragDropManager) => void
}

/** TopDnd 1つ分の受け持ちの控え（今掴んでいる種類と、その時の dnd-kit の manager も TopDnd ごとに持つ） */
export class DragControllers {
  private readonly map = new Map<DragType, DragController>()
  private readonly listeners = new Set<() => void>()
  /** 今掴んでいる物の種類（掴み始めから離すまで。知らない物は null） */
  private active: DragType | null = null
  /** 掴んでいる間の dnd-kit の manager（届けた部品が掴んでいる間に外れた時に、やめさせる） */
  private manager: DragDropManager | null = null

  /** 掴み始めた: その種類の受け持ち（届いていなければ undefined） */
  begin(type: DragType | null, manager: DragDropManager): DragController | undefined {
    this.active = type
    this.manager = manager
    return this.current()
  }

  /** 掴んでいる物の種類の受け持ち（掴んでいない・届いていなければ undefined） */
  current(): DragController | undefined {
    return this.active ? this.map.get(this.active) : undefined
  }

  /** 離した（やめた）: 掴んでいた物の種類の受け持ち（届いていなければ undefined）。この後は掴んでいない */
  end(): DragController | undefined {
    const c = this.current()
    this.active = null
    this.manager = null
    return c
  }

  /** 受け持ちを届ける（返す関数で外す。その種類を掴んでいる間に外す時は、やめたこととして終えてから外す） */
  set(type: DragType, controller: DragController): () => void {
    this.map.set(type, controller)
    this.changed()
    return () => {
      if (this.map.get(type) !== controller) return
      const m = this.manager
      // dnd-kit は、やめさせるとすぐ（この中で）離した時の出来事を出す。TopDnd がそれを受けて、まだ届いている受け持ちの「離した時」を
      // canceled で呼ぶ（end で掴んでいない状態に戻る）
      if (this.active === type && m && !m.dragOperation.status.idle) m.actions.stop({ canceled: true })
      this.map.delete(type)
      this.changed()
    }
  }

  /** 「上にある落とす所が替わった時」を持つ受け持ちが届いているか（TopDnd が useSyncExternalStore で読む） */
  readonly wantsOver = (): boolean => [...this.map.values()].some((c) => c.onDragOver !== undefined)

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

/** いちばん近い TopDnd の受け持ちの控え（TopDnd の外では null） */
export const DragControllersContext = createContext<DragControllers | null>(null)

/**
 * 出している間、その種類の受け持ちを届ける（部品が外れると外す）。controller は描き直すたびに替わってもよい（いつも最後に描いた時の
 * 物を呼ぶ）。onDragOver を持つかは、初めに描いた時の controller で決まる。TopDnd の外では何もしない
 */
export function useDragController(type: DragType, controller: DragController): void {
  const controllers = useContext(DragControllersContext)
  const latest = useRef(controller)
  useLayoutEffect(() => {
    latest.current = controller
  })
  const [proxy] = useState<DragController>(() => ({
    onDragStart: (e, m) => latest.current.onDragStart?.(e, m),
    onDragMove: (e, m) => latest.current.onDragMove?.(e, m),
    ...(controller.onDragOver ? { onDragOver: (e: DragOverEvent, m: DragDropManager) => latest.current.onDragOver?.(e, m) } : {}),
    onDragEnd: (e, m) => latest.current.onDragEnd?.(e, m),
  }))
  useLayoutEffect(() => controllers?.set(type, proxy), [controllers, type, proxy])
}
