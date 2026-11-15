// トップの画面のドラッグの入れ物（docs/SPEC.md の 7.11・13.6・14.2・15.2。（開発））: ウィークリーの予定・Task List の行・リストの並べ替えを、
// 1つの DragDropProvider（dnd-kit の入れ物。manager は1つ）で扱う。TopPage が L の WideTop と S・M の StackedTop を両方包むので、幅が
// 替わっても、モードを替えても、MIM を開いても同じ物が残る（掴んでいない間は何も描かず、ページに CSS も足さない）。
// - 掴み方（SENSORS）: マウスは 5px を超えて動かす、指・ペンは 0.4秒（8px 以内）押し続ける（week/dnd の gesture.ts の値）。中のボタン
//   （点線の丸・AI の札・詳細を開くボタン）の上から押しても掴む。種類ごとに断る押し方: Task List の行はマウスだけ（13.6。指・ペンは行を
//   押す・スクロールするまま）、並べ替えの行はマウスならつまみ（[data-reorder-grip]）からだけ（指は行のどこを 0.4秒押しても。14.2・15.2）。
//   断った押し方は dnd-kit が受け取らない（ふつうに押す・スクロールする）。ウィークリーの予定は断らない。掴む物ごとの sensors は使わない
//   （dnd-kit 0.5.3 では、ほかの物の掴み方の決まりまで消える）
// - 見た目（PLUGINS）: カーソル（grabbing）・浮いた見た目・文字の選択を止める。落とす時の動きは付けない（種類の受け持ちが離した時に
//   決める。離すたびにこの決まりに戻してから受け持ちを呼ぶ）。読み上げの案内（英語）は出さない。自動のスクロールは dnd-kit の物を
//   使わない（ウィークリーは edgeDriver.ts。7.11）
// - 掴み始め・動き・上にある落とす所が替わった時・離した時は、掴んだ物の種類の受け持ち（controllers.ts）へ渡す。dnd-kit の入れ物の
//   出来事として渡すので、動き・上にある落とす所が替わった時・離した時は、dnd-kit が受け持ちの中の描き直しを待ってから次へ進む
//   （ウィークリーが自分で入れ物を持っていた時と同じ）
// - どの種類でも、掴み始めに: 画面の状態 dragging を true（掴んでいる間は「戻る」「進む」・端からのフリックが来ても画面を動かさない。
//   closeApp.ts の consumeBackPress。元に戻す・ページをめくる動きも見る）、文字を打っている欄からフォーカスを外す、開いているすばやく
//   足すに知らせる（離した後に、打った字を足さずに閉じる。12.1）、指なら 15ms 振動する（7.11）。離した時は、受け持ちの後に dragging を
//   false
// - TopDnd の中の TopDnd は何も足さない（外の物をそのまま使う。ウィークリーだけを描くテストでは、WeekDnd が自分を TopDnd で包む）
import {
  Accessibility,
  AutoScroller,
  defaultPreset,
  Feedback,
  PointerActivationConstraints,
  PointerSensor,
  type DragDropManager,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Draggable,
} from '@dnd-kit/dom'
import { DragDropProvider } from '@dnd-kit/react'
import { useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useCalendarUi } from '../../store/uiStore'
import { vibrate15 } from '../../ui/motion'
import { quickAddDragStarted } from '../calendar/common/parts/QuickAdd'
import { activationOf, pointerKind } from '../calendar/week/dnd/gesture'
import { DragControllers, DragControllersContext } from './controllers'
import { dragTypeOf } from './dragData'

/**
 * その押し方を断るか（断った押し方は dnd-kit が受け取らない）。Task List の行はマウスだけ（13.6）、並べ替えの行はマウスならつまみから
 * だけ（指は行のどこからでも。14.2・15.2）。ウィークリーの予定は断らない（中のボタンの上から押しても掴む）
 */
function refuses(event: PointerEvent, source: Draggable): boolean {
  const type = dragTypeOf(source.data)
  if (type === 'task-row') return event.pointerType !== 'mouse'
  if (type !== 'sort' || event.pointerType !== 'mouse') return false
  const t = event.target
  return !(t instanceof Element && t.closest('[data-reorder-grip]'))
}

/** 掴み方（マウスは距離、指・ペンは長押し）。中のボタン（点線の丸・AI の札・詳細を開くボタン）の上から押しても掴む */
const SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event: PointerEvent) => {
      const a = activationOf(event.pointerType)
      return a.kind === 'distance'
        ? [new PointerActivationConstraints.Distance({ value: a.px })]
        : [new PointerActivationConstraints.Delay({ value: a.ms, tolerance: a.slopPx })]
    },
    preventActivation: refuses,
  }),
]

type PluginEntry = (typeof defaultPreset.plugins)[number]

/**
 * 使う plugin: カーソル（grabbing）・浮いた見た目（落とす時の動きは落とすたびに決める）・文字の選択を止める。自動のスクロールは
 * 各受け持ちが受け持つ（AutoScroller を外す。ウィークリーは edgeDriver.ts）
 */
const PLUGINS = defaultPreset.plugins.flatMap((p): PluginEntry[] => {
  if (p === Feedback) return [Feedback.configure({ dropAnimation: null })]
  if (p === Accessibility || p === AutoScroller) return []
  return [p]
})

/**
 * 掴んだ時に、文字を打っている欄（すばやく足す・リストの入力欄など）からフォーカスを外す。指で掴むとフォーカスは欄に残ったままで、
 * Chromium は指を動かし始めた時に、その欄を見える所へ出そうとスクロールする（欄が見えていない時は、掴んだ物の下の日が飛ぶ）。
 * マウスは押した時にフォーカスが掴んだ物へ移るので同じになる。欄は閉じず、打った字も足さない（すばやく足すは、押し終わってから、
 * 打った字を足さずに閉じる。quickAddDragStarted・QuickAdd・12.1）
 */
function blurTextField(): void {
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable))
    el.blur()
}

/** トップの画面を包む（TopDnd の中なら何も足さない） */
export function TopDnd({ children }: { children: ReactNode }) {
  return useContext(DragControllersContext) ? <>{children}</> : <TopDndProvider>{children}</TopDndProvider>
}

function TopDndProvider({ children }: { children: ReactNode }) {
  const [controllers] = useState(() => new DragControllers())
  // 「上にある落とす所が替わった時」を持つ受け持ちが届いている間だけ dnd-kit へ頼む（controllers.ts）
  const over = useSyncExternalStore(controllers.subscribe, controllers.wantsOver, controllers.wantsOver)
  const handlers = useMemo(
    () => ({
      onDragStart: (event: DragStartEvent, m: DragDropManager) => {
        const c = controllers.begin(dragTypeOf(event.operation.source?.data), m)
        useCalendarUi.getState().setDragging(true)
        blurTextField()
        quickAddDragStarted()
        const activator = event.operation.activatorEvent
        if (activator instanceof PointerEvent && pointerKind(activator.pointerType) === 'touch') vibrate15()
        c?.onDragStart?.(event, m)
      },
      onDragMove: (event: DragMoveEvent, m: DragDropManager) => controllers.current()?.onDragMove?.(event, m),
      onDragOver: (event: DragOverEvent, m: DragDropManager) => controllers.current()?.onDragOver?.(event, m),
      onDragEnd: (event: DragEndEvent, m: DragDropManager) => {
        const c = controllers.end()
        // 落とす時の動きは、受け持ちが決めなければ PLUGINS の決まり（付けない）
        const feedback = m.registry.plugins.get(Feedback)
        if (feedback) feedback.dropAnimation = undefined
        c?.onDragEnd?.(event, m)
        if (useCalendarUi.getState().dragging) useCalendarUi.getState().setDragging(false)
      },
    }),
    [controllers],
  )
  return (
    <DragDropProvider
      sensors={SENSORS}
      plugins={PLUGINS}
      onDragStart={handlers.onDragStart}
      onDragMove={handlers.onDragMove}
      onDragOver={over ? handlers.onDragOver : undefined}
      onDragEnd={handlers.onDragEnd}
    >
      <DragControllersContext.Provider value={controllers}>{children}</DragControllersContext.Provider>
    </DragDropProvider>
  )
}
