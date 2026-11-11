// ウィークリーのドラッグ（docs/SPEC.md の 7.10・7.11・10.4・4.9・3.9。@dnd-kit/react・@dnd-kit/dom 0.5.3。CALENDAR-155）。
// dnd-kit を読み込むのは week/dnd だけ。WeekDnd は週を包む（段階2はウィークリーだけ。段階3で TopPage へ上げ、Task List の行からも
// 落とせるようにする。D52）。WP11s の試しで確かめた作り（wp11s-verdict の G1〜G12）:
// - 掴み方: マウスは 5px を超えて動かす、指・ペンは 0.4秒（8px 以内）押し続ける（gesture.ts の値。CALENDAR-158・159）。すぐ動かした
//   指はスクロール（CALENDAR-160）。キーボードでは掴まない（Enter・Space は詳細を開く。詳細の日付の欄で同じことができる。G2・CALENDAR-183）
// - カードの中の点線の丸・AI の札の上から押しても掴める（どれもカードの入れ物の中。dnd-kit の初めの決まりは、中のボタンからは掴まない）
// - 掴むと、その週の落とせる日すべてに印（地 --accent-soft と 1px の --accent の点線、上にある日は線。D25・CALENDAR-166）。
//   区分は掴んだ物と同じ段だけ（CALENDAR-165・ITEMS-098）。指で掴んだ時は 15ms 振動（CALENDAR-163）。文字を打っている欄
//   （すばやく足す）からはフォーカスを外す（指で動かし始めた時に、週がその欄の所へ飛ばないように）
// - 浮いた見た目は dnd.css（1.03倍・--shadow-lift・0.95・120ms。G1）。読み上げの案内（英語）は出さない（Accessibility を外す。G2）
// - 画面の端（60px）に近づくと、ウィークリーのスクロールの中だけを自動でスクロールする（ページは動かさない。G3・G4・CALENDAR-167・
//   ITEMS-099）
// - 落とした時は drop.ts（動かす・お知らせ・目立たせる・収める）。動かさなかった時は、浮いたカードが元の場所へ 160ms で戻る
import {
  Accessibility,
  AutoScroller,
  defaultPreset,
  Feedback,
  PointerActivationConstraints,
  PointerSensor,
  Scroller,
  type DragDropManager,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/dom'
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { canGrab, dropDays, dropPatch } from '../../../../domain/drag'
import type { Item, ItemKind } from '../../../../domain/types'
import { vibrate15 } from '../../../../ui/motion'
import { revealInWeek, useWeekScroller } from '../weekScroller'
import { applyDrop, settle, SETTLE_BACK } from './drop'
import { activationOf, pointerKind } from './gesture'
import { useLockGesture } from './lockGesture'
import {
  asDragData,
  asDropData,
  dragId,
  dropId,
  type DayDrop,
  type DragData,
  type DragHandle,
  type DropData,
  type DropState,
  type ItemDrag,
  type WeekCtx,
} from './types'
import './dnd.css'

/** 画面の端からこの幅（px）に入ると自動でスクロールする（S の縦の並びは上下 60px。10.4・ITEMS-099） */
export const AUTO_SCROLL_EDGE_PX = 60

/** 掴み方（マウスは距離、指・ペンは長押し）。中のボタン（点線の丸・AI の札・詳細を開くボタン）の上から押しても掴む */
const SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event: PointerEvent) => {
      const a = activationOf(event.pointerType)
      return a.kind === 'distance'
        ? [new PointerActivationConstraints.Distance({ value: a.px })]
        : [new PointerActivationConstraints.Delay({ value: a.ms, tolerance: a.slopPx })]
    },
    preventActivation: () => false,
  }),
]

type PluginEntry = (typeof defaultPreset.plugins)[number]

/** 使う plugin: 自動のスクロール・カーソル（grabbing）・浮いた見た目（落とす時の動きは落とすたびに決める）・文字の選択を止める */
const PLUGINS = defaultPreset.plugins.flatMap((p): PluginEntry[] => {
  if (p === Feedback) return [Feedback.configure({ dropAnimation: null })]
  if (p === Accessibility) return []
  return [p]
})

// ---------- 掴んでいる間の落とせる日（落とす所ごとに、その日が変わった時だけ描き直す） ----------

/** 掴んでいる物の区分と、その週の落とせる日（元の日も含む。D25） */
interface ActiveDrag {
  kind: ItemKind
  days: ReadonlySet<string>
}

class ActiveDragStore {
  private value: ActiveDrag | null = null
  private readonly listeners = new Set<() => void>()
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  set(next: ActiveDrag | null): void {
    this.value = next
    for (const fn of this.listeners) fn()
  }
  /** その日・その区分が、今掴んでいる物の落とせる日か */
  marks(date: string, kind: ItemKind): boolean {
    const v = this.value
    return v !== null && v.kind === kind && v.days.has(date)
  }
}

const ActiveDragContext = createContext<ActiveDragStore | null>(null)
const noSubscribe = () => () => {}

// ---------- 自動のスクロール（G3・G4） ----------

/** px の幅を、dnd-kit の AutoScroller の threshold（スクロールする要素の大きさに対する割合）にする */
const edgeFraction = (size: number) => (size > 0 ? Math.min(0.5, AUTO_SCROLL_EDGE_PX / size) : 0)

/** from から week（含む）までで、いちばん近い縦にスクロールする要素 */
function verticalScroller(from: Element | undefined, week: HTMLElement): HTMLElement {
  for (let el = from?.parentElement ?? null; el && week.contains(el); el = el.parentElement) {
    const y = getComputedStyle(el).overflowY
    if ((y === 'auto' || y === 'scroll') && el.scrollHeight > el.clientHeight) return el
  }
  return week
}

/** getScrollableElements を絞った Scroller（manager ごとに1回） */
const limited = new WeakSet<object>()

/**
 * 掴むたびに、自動のスクロールの端の幅を 60px にし（dnd-kit は割合なので、縦はカードの入っているスクロールの高さ、横は週が横に
 * スクロールする時だけ週の幅から直す）、スクロールする物をウィークリーの中だけにする（週の端まで行った後にページを動かさない）
 */
function limitAutoScroll(manager: DragDropManager, week: RefObject<HTMLElement | null>, source: Element | undefined): void {
  const el = week.current
  if (!el) return
  const auto = manager.registry.plugins.get(AutoScroller)
  const sideways = el.scrollWidth > el.clientWidth
  auto?.configure({
    threshold: { x: sideways ? edgeFraction(el.clientWidth) : 0, y: edgeFraction(verticalScroller(source, el).clientHeight) },
  })
  const scroller = manager.registry.plugins.get(Scroller)
  if (!scroller || limited.has(scroller)) return
  limited.add(scroller)
  const all = scroller.getScrollableElements
  scroller.getScrollableElements = () => {
    const found = all()
    const root = week.current
    return found && root ? new Set([...found].filter((x) => root.contains(x))) : found
  }
}

// ---------- 入力欄のフォーカス ----------

/**
 * 掴んだ時に、文字を打っている欄（すばやく足すの入力欄など）からフォーカスを外す。指で掴むとフォーカスは欄に残ったままで、Chromium は
 * 指を動かし始めた時に、その欄を見える所へ出そうと週をスクロールする（欄が見えていない時は、掴んだカードの下の日が飛ぶ）。マウスは
 * 押した時にフォーカスがカードへ移るので同じになる。欄は閉じない（すばやく足すは、押し終わってから閉じる。QuickAdd）
 */
function blurTextField(): void {
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable))
    el.blur()
}

// ---------- WeekDnd ----------

/** ウィークリーを包む（ドラッグの受け持ち。段階2はウィークリーだけ、段階3で TopPage へ上げる。D52） */
export function WeekDnd({ week, children }: { week: WeekCtx; children: ReactNode }): ReactElement {
  const scroller = useWeekScroller()
  const [store] = useState(() => new ActiveDragStore())

  const onDragStart = useCallback(
    (event: DragStartEvent, manager: DragDropManager) => {
      const data = asDragData(event.operation.source?.data)
      if (!data) return
      const days = dropDays(data.item, data.handle, week)
      store.set({ kind: data.item.kind, days: new Set(days.keys()) })
      blurTextField()
      const activator = event.operation.activatorEvent
      if (activator instanceof PointerEvent && pointerKind(activator.pointerType) === 'touch') vibrate15()
      limitAutoScroll(manager, scroller, event.operation.source?.element)
    },
    [store, week, scroller],
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent, manager: DragDropManager) => {
      store.set(null)
      const { source, target } = event.operation
      const data = asDragData(source?.data)
      const drop = asDropData(target?.data)
      const moved = !event.canceled && data !== null && drop !== null && applyDrop(data, drop, week)
      const feedback = manager.registry.plugins.get(Feedback)
      // 動かした時、元のカードは React が外す（戻る動きは見えない）ので、すぐ片付けて移った先のカードを収める。
      // 動かさなかった時は、浮いたカードが元の場所へ戻る
      if (feedback) feedback.dropAnimation = moved ? null : SETTLE_BACK
      if (moved && data) {
        // 移った先の要素（始点・●を動かして1日の予定になった時は、カード。元の要素は外れている）を収め、見える所まで出す
        const ids = [source?.id, dragId(data.item.id, 'card')]
        requestAnimationFrame(() => {
          const el = ids
            .map((id) => (id === undefined ? undefined : manager.registry.draggables.get(id)?.element))
            .find((x) => x?.isConnected)
          settle(el)
          revealInWeek(el)
        })
      }
    },
    [store, week],
  )

  return (
    <DragDropProvider sensors={SENSORS} plugins={PLUGINS} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <ActiveDragContext.Provider value={store}>{children}</ActiveDragContext.Provider>
    </DragDropProvider>
  )
}

// ---------- useItemDrag ----------

/**
 * 予定を掴めるようにする（item:{id}:{card|start|end}）。掴めない物（ロック中・その週に見えていない端。drag.ts の canGrab）は
 * dnd-kit に要素を渡さない。ロック中なら grabProps で掴もうとした時に揺らす（lockGesture.ts）。受けた表示と＞はこれを呼ばない
 * （CALENDAR-176）
 */
export function useItemDrag({ item, handle, week }: { item: Item; handle: DragHandle; week: WeekCtx }): ItemDrag {
  const check = canGrab(item, handle, week)
  const data = useMemo<DragData>(() => ({ item, handle }), [item, handle])
  const draggable = useDraggable({ id: dragId(item.id, handle), data, disabled: !check.ok })
  const isDragging = draggable.isDragging
  const dndRef = draggable.ref
  const ok = check.ok
  const ref = useCallback((el: Element | null) => dndRef(ok ? el : null), [dndRef, ok])
  const grabProps = useLockGesture(!check.ok && check.reason === 'locked', item.id)
  return useMemo(() => ({ ref, isDragging, grabProps }), [ref, isDragging, grabProps])
}

// ---------- useDayDrop ----------

/**
 * その日・その区分の段を落とせる所にする（day:{date}:{kind}。段階3のリストの行からも同じ所に落とす）。落とせるかは drag.ts の
 * dropPatch（落とせない日は dnd-kit が落とす先にしない）、印は掴んだ時の dropDays（D25）
 */
export function useDayDrop({ date, kind, week }: { date: string; kind: ItemKind; week: WeekCtx }): DayDrop {
  const store = useContext(ActiveDragContext)
  const marked = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.marks(date, kind) ?? false,
    () => false,
  )
  const data = useMemo<DropData>(() => ({ date, kind }), [date, kind])
  const accept = useCallback(
    (source: { data: unknown }) => {
      const d = asDragData(source.data)
      return d !== null && dropPatch(d.item, d.handle, { date, kind }, week) !== null
    },
    [date, kind, week],
  )
  const droppable = useDroppable({ id: dropId(date, kind), data, accept })
  const hover = droppable.isDropTarget
  const ref = droppable.ref
  const state: DropState = !marked ? 'none' : hover ? 'hover' : 'ok'
  return useMemo(() => ({ ref, state }), [ref, state])
}
