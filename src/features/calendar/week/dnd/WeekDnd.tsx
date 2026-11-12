// ウィークリーのドラッグ（docs/SPEC.md の 7.10・7.11・10.4・4.9・3.9。@dnd-kit/react・@dnd-kit/dom 0.5.3。CALENDAR-155）。
// dnd-kit を読み込むのは week/dnd だけ。WeekDnd は週を包む（段階2はウィークリーだけ。段階3で TopPage へ上げ、Task List の行からも
// 落とせるようにする。D52）。WP11s の試しで確かめた作り（wp11s-verdict の G1〜G12）:
// - 掴み方: マウスは 5px を超えて動かす、指・ペンは 0.4秒（8px 以内）押し続ける（gesture.ts の値。CALENDAR-158・159）。すぐ動かした
//   指はスクロール（CALENDAR-160）。キーボードでは掴まない（Enter・Space は詳細を開く。詳細の日付の欄で同じことができる。G2・CALENDAR-183）
// - カードの中の点線の丸・AI の札の上から押しても掴める（どれもカードの入れ物の中。dnd-kit の初めの決まりは、中のボタンからは掴まない）
// - 掴むと、見ている週の落とせる日すべてに印（地 --accent-soft と 1px の --accent の点線、上にある日は線。D25・CALENDAR-166）。
//   区分は掴んだ物と同じ段だけ（CALENDAR-165・ITEMS-098）。指で掴んだ時は 15ms 振動（CALENDAR-163）。文字を打っている欄
//   （すばやく足す）からはフォーカスを外す（指で動かし始めた時に、週がその欄の所へ飛ばないように）。開いているすばやく足すには
//   ドラッグを始めたと伝える（離した後に、打った字を足さずに閉じる。12.1）
// - 浮いた見た目は dnd.css（1.03倍・--shadow-lift・0.95・120ms。G1）。読み上げの案内（英語）は出さない（Accessibility を外す。G2）
// - 画面の端（edges.ts・edgeDriver.ts。dnd-kit の自動のスクロールは使わない）: 上下の端の 60px では週の中（S は週、L・M は段の中）
//   だけを自動でスクロールする（ページは動かさない。G3・G4・CALENDAR-167・ITEMS-099）。左右の端の帯（週の端の内側と、その外の画面の
//   端までの余白。L の右はカレンダーの領域まで）に 0.6秒留まると前・次の週へ移る（［‹］［›］と同じ移り方。置き換える。ページをめくる
//   動きは付けない）。留まっている間は目印の帯を出す（ページの上に固定して描く。週の外の余白にも掛かるので。22. の段階2の終わりの確かめ）。
//   S で前の週へ移った時は、その週をいちばん下（土曜）まで送って出す（移った週のいちばん近い日が見えるように）
// - 掴んだまま別の週へ移った間も、掴んだ物（dnd-kit が浮かせている元のカード）を外さないように、掴んだ週を見えないまま残す
//   （WeekSlot の is-frozen。落とす所は止める）。今の週は別の入れ物に描く。落とすと今の週に残り、落とさずにやめると（Esc・落とせない
//   所で離す・指を取られた）掴んだ週へ戻って、浮いたカードが元の所へ戻る
// - 落とした時は drop.ts（動かす・お知らせ・目立たせる・収める）。動かさなかった時は、浮いたカードが元の場所へ 160ms で戻る
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
  type DragStartEvent,
} from '@dnd-kit/dom'
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { canGrab, dropDays, dropPatch } from '../../../../domain/drag'
import { quickAddDragStarted } from '../../common/parts/QuickAdd'
import type { Item, ItemKind } from '../../../../domain/types'
import { useCalendarUi } from '../../../../store/uiStore'
import { ChevronLeftIcon, ChevronRightIcon } from '../../../../ui/icons'
import { vibrate15 } from '../../../../ui/motion'
import { scrollIntoViewWithin, toastInset } from '../../../../ui/scrollWithin'
import { testIds } from '../../common/testIds'
import type { WidthClass } from '../../common/types'
import { useCalendarNav } from '../../common/useCalendarRoute'
import { useWeekScroller } from '../weekScroller'
import { applyDrop, settle, SETTLE_BACK } from './drop'
import { EdgeDriver, type EdgeCue } from './edgeDriver'
import { insideBand, TO_SCREEN, type Outer, type Side } from './edges'
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

/**
 * 使う plugin: カーソル（grabbing）・浮いた見た目（落とす時の動きは落とすたびに決める）・文字の選択を止める。自動のスクロールは
 * edgeDriver.ts が受け持つ（AutoScroller を外す）
 */
const PLUGINS = defaultPreset.plugins.flatMap((p): PluginEntry[] => {
  if (p === Feedback) return [Feedback.configure({ dropAnimation: null })]
  if (p === Accessibility || p === AutoScroller) return []
  return [p]
})

// ---------- 掴んでいる間の落とせる日・目印の帯（変わった時だけ、それを使う所を描き直す） ----------

/** 掴んでいる物の区分と、見ている週の落とせる日（元の日も含む。D25） */
interface ActiveDrag {
  kind: ItemKind
  days: ReadonlySet<string>
}

/** 外から読む値の入れ物（useSyncExternalStore で読む） */
class Signal<T> {
  private value: T
  private readonly listeners = new Set<() => void>()
  constructor(value: T) {
    this.value = value
  }
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  readonly get = () => this.value
  set(next: T): void {
    if (next === this.value) return
    this.value = next
    for (const fn of this.listeners) fn()
  }
}

class ActiveDragStore extends Signal<ActiveDrag | null> {
  /** その日・その区分が、今掴んでいる物の落とせる日か */
  marks(date: string, kind: ItemKind): boolean {
    const v = this.get()
    return v !== null && v.kind === kind && v.days.has(date)
  }
}

const ActiveDragContext = createContext<ActiveDragStore | null>(null)
const noSubscribe = () => () => {}

/** 掴んだ物の、見ている週 shown の落とせる日（掴めるかは掴んだ週で決める） */
function activeOf(data: DragData, shown: WeekCtx): ActiveDrag {
  return { kind: data.item.kind, days: new Set(dropDays(data.item, data.handle, data.week, shown).keys()) }
}

// ---------- 入力欄のフォーカス ----------

/**
 * 掴んだ時に、文字を打っている欄（すばやく足すの入力欄など）からフォーカスを外す。指で掴むとフォーカスは欄に残ったままで、Chromium は
 * 指を動かし始めた時に、その欄を見える所へ出そうと週をスクロールする（欄が見えていない時は、掴んだカードの下の日が飛ぶ）。マウスは
 * 押した時にフォーカスがカードへ移るので同じになる。欄は閉じない（すばやく足すは、押し終わってから、打った字を足さずに閉じる。
 * quickAddDragStarted・QuickAdd・12.1）
 */
function blurTextField(): void {
  const el = document.activeElement
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable))
    el.blur()
}

// ---------- 週の入れ物（掴んだまま別の週へ移った間は、掴んだ週を見えないまま残す） ----------

/** 見えないまま残している掴んだ週の中か（その週の落とす所は止める） */
const FrozenWeekContext = createContext(false)

function WeekSlot({ frozen, children }: { frozen: boolean; children: ReactNode }) {
  return (
    <FrozenWeekContext.Provider value={frozen}>
      <div className={frozen ? 'wk-slot is-frozen' : 'wk-slot'} aria-hidden={frozen || undefined}>
        {children}
      </div>
    </FrozenWeekContext.Provider>
  )
}

/** 掴んだまま週が替わった後、落とす所を数え直すコマ数（今の週の落とす所の大きさが測られるまで。0.3秒ほど） */
const RECOUNT_FRAMES = 20

/** 掴んだ週と、その時に見ていた日 */
interface Origin {
  week: WeekCtx
  viewed: string
}

/**
 * 落とし終えてから（dnd-kit が浮いた物を片付け終えてから）fn を呼ぶ。片付ける前に週の入れ物を描き直すと、移った先に新しく出たカード
 * （掴んだ物と同じ id）を dnd-kit が掴んだ物として浮かせたままの間が長くなる（数十 ms、移った先で浮いて見える）
 */
function afterDrop(m: DragDropManager, fn: () => void, frames = 120): void {
  requestAnimationFrame(() => (m.dragOperation.status.idle || frames <= 0 ? fn() : afterDrop(m, fn, frames - 1)))
}

// ---------- 目印の帯（左右の端に留まっている間） ----------

function EdgeCueView({ cue }: { cue: Signal<EdgeCue | null> }) {
  const c = useSyncExternalStore(cue.subscribe, cue.get, () => null)
  if (!c) return null
  const next = c.side > 0
  const style = {
    left: c.left,
    top: c.top,
    width: c.width,
    height: c.height,
    '--cue-ms': `${c.period}ms`,
  } as CSSProperties
  // 字は浮いたカードのすぐ上（場所が無い時はすぐ下）。指を動かすとついてくる
  const label: CSSProperties = c.label.place === 'above' ? { bottom: c.height - c.label.edge } : { top: c.label.edge }
  return createPortal(
    <div
      className={`wk-cue ${next ? 'is-next' : 'is-prev'} is-label-${c.label.place}`}
      style={style}
      data-edge-cue=""
      data-side={next ? 'next' : 'prev'}
      data-testid={testIds.weekEdgeCue}
      aria-hidden="true"
    >
      {/* 満ちる地（留まった時間。続けて移る時はやり直す。目印は帯に入って少したってから出すので、その分だけ満ちた所から始める） */}
      <span key={c.since} className="wk-cue-fill" style={{ animationDelay: `-${c.elapsed}ms` }} />
      <span className="wk-cue-body" style={label}>
        {next ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        {/* 縦に1字ずつ（帯が狭いので。縦書きの設定は字が重なる端末があるので使わない） */}
        <span className="wk-cue-label">
          {[...(next ? '次の週へ' : '前の週へ')].map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </span>
      </span>
    </div>,
    document.body,
  )
}

// ---------- WeekDnd ----------

export interface WeekDndProps {
  /** 今見ている週 */
  week: WeekCtx
  /** 今見ている日（落とさずにやめた時に、掴んだ週と一緒に戻す） */
  viewed: string
  /** 幅の区分（左右の端の帯の幅と、帯の外の端。edges.ts） */
  width: WidthClass
  /** 週を描く（frozen は、掴んだまま別の週へ移った間の、見えないまま残す掴んだ週） */
  renderWeek: (week: WeekCtx, frozen: boolean) => ReactNode
}

/** ウィークリーを包む（ドラッグの受け持ち。段階2はウィークリーだけ、段階3で TopPage へ上げる。D52） */
export function WeekDnd({ week, viewed, width, renderWeek }: WeekDndProps): ReactElement {
  const scroller = useWeekScroller()
  const nav = useCalendarNav()
  const [store] = useState(() => new ActiveDragStore(null))
  const [cue] = useState(() => new Signal<EdgeCue | null>(null))
  /** 今の週の入れ物の key（掴んだまま別の週へ移って落とした後は、その週の入れ物の key へ進める） */
  const [liveKey, setLiveKey] = useState(0)
  const stageEl = useRef<HTMLDivElement>(null)
  /** 掴んでいる物（離すまで） */
  const dragging = useRef<DragData | null>(null)
  /**
   * 掴んだ週（掴んでいる間と、落とさずにやめて掴んだ週へ戻るまで・別の週へ落として入れ物を片付けるまで）。描く時に今の週と比べ、
   * 違えば掴んだ週の入れ物を見えないまま残す（週が替わる時は行き先が替わって描き直すので、ここは描き直しを起こさない ref）
   */
  const origin = useRef<Origin | null>(null)
  /** 別の週へ落とした後、入れ物を片付けるのを待っている */
  const rekey = useRef(false)
  const manager = useRef<DragDropManager | null>(null)
  // 描くたびに新しい値を置く（掴んでいる間の出来事は、その時の週・見ている日・行き来で決める）
  const latest = useRef({ week, viewed, nav, width })
  latest.current = { week, viewed, nav, width }
  /** 掴んだまま左右の端で今移った向き（S で前の週へ移った時は、その週をいちばん下まで送って出す） */
  const shifted = useRef<Side>(0)

  const [driver] = useState(
    () =>
      new EdgeDriver({
        root: () => scroller.current,
        // 週の内側の幅: S 28px、L・M は 40px か日の列の 1/4 の狭い方（S は半分、L・M は 7日の列の幅で測る）
        band: () => {
          const el = scroller.current
          const s = latest.current.width === 'S'
          return insideBand(s ? 'S' : 'wide', el ? el.scrollWidth / (s ? 2 : 7) : Number.POSITIVE_INFINITY)
        },
        // 帯の外の端: S・M は画面の左右の端まで。L は左は画面の端まで、右はカレンダーの領域の右の端まで（右の列には掛けない）
        outer: (): Outer => {
          if (latest.current.width !== 'L') return TO_SCREEN
          const cal = stageEl.current?.closest('.cal')
          return cal ? { ...TO_SCREEN, right: cal.getBoundingClientRect().right } : TO_SCREEN
        },
        onShift: (side) => {
          shifted.current = side
          latest.current.nav.shift(side)
        },
        onCue: (c) => cue.set(c),
      }),
  )

  // S で、掴んだまま前の週へ移った時は、その週をいちばん下（土曜）まで送って出し、次の週へ移った時はいちばん上（日曜）から出す
  // （移った週の、元の週にいちばん近い日が見えるように。描いた後すぐ、見える前に。掴んだ週へ戻ってきた時は、掴んだ時の所のまま）（開発）
  useLayoutEffect(() => {
    const side = shifted.current
    shifted.current = 0
    const el = scroller.current
    if (side === 0 || !dragging.current || !el || latest.current.width !== 'S') return
    if (origin.current?.week.from === week.from) return
    el.scrollTop = side < 0 ? el.scrollHeight : 0
  }, [week, scroller])

  // 週が替わった: 掴んでいる間なら、落とせる日の印を今の週で付け直し、指を止めたままでも落とす所を数え直す（dnd-kit は指の位置が
  // 変わらない間は数え直さないので、前の週の日（見えないまま残した掴んだ週の日）が「上にある日」のまま残り、そのまま離すとその日へ
  // 落ちる。今の週の落とす所の大きさは少し後に測られるので、数コマの間数え直す）。やめて掴んだ週へ戻ってきたら、残していた掴んだ週を
  // 今の週に戻す
  useEffect(() => {
    const data = dragging.current
    if (data) {
      store.set(activeOf(data, week))
      driver.remeasure()
      const m = manager.current
      let frames = 0
      let id = 0
      const recount = () => {
        if (!dragging.current || !m) return
        m.collisionObserver.forceUpdate(true)
        if (++frames < RECOUNT_FRAMES) id = requestAnimationFrame(recount)
      }
      recount()
      return () => cancelAnimationFrame(id)
    }
    if (!rekey.current && origin.current?.week.from === week.from) origin.current = null
    return undefined
  }, [week, store, driver])

  // 描き終えずに外れた時（掴んだままモードを替えたなど）は止める
  useEffect(
    () => () => {
      driver.stop()
      if (dragging.current) useCalendarUi.getState().setDragging(false)
    },
    [driver],
  )

  /** 別の週へ落とした後: 掴んだ週の入れ物を外し、今の週の入れ物をそのまま今の週にする */
  const settleStage = useCallback(() => {
    if (!rekey.current) return
    rekey.current = false
    origin.current = null
    setLiveKey((k) => k + 1)
  }, [])

  const onDragStart = useCallback(
    (event: DragStartEvent, m: DragDropManager) => {
      const data = asDragData(event.operation.source?.data)
      if (!data) return
      settleStage()
      manager.current = m
      dragging.current = data
      const { week: shown, viewed: day } = latest.current
      origin.current = { week: data.week, viewed: day }
      useCalendarUi.getState().setDragging(true)
      store.set(activeOf(data, shown))
      blurTextField()
      quickAddDragStarted()
      const activator = event.operation.activatorEvent
      if (activator instanceof PointerEvent && pointerKind(activator.pointerType) === 'touch') vibrate15()
      driver.start(event.operation.position.current)
    },
    [store, driver, settleStage],
  )

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      driver.move(event.to ?? event.operation.position.current)
    },
    [driver],
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent, m: DragDropManager) => {
      driver.stop()
      store.set(null)
      dragging.current = null
      useCalendarUi.getState().setDragging(false)
      const { source, target } = event.operation
      const data = asDragData(source?.data)
      // 見えないまま残した掴んだ週の日（止めてある）には落とさない（週が替わった直後に数え直す前に離した時）
      const drop = target && !target.disabled ? asDropData(target.data) : null
      const moved = !event.canceled && data !== null && drop !== null && applyDrop(data, drop)
      const feedback = m.registry.plugins.get(Feedback)
      // 動かした時、元のカードは React が外す（戻る動きは見えない）ので、すぐ片付けて移った先のカードを収める。
      // 動かさなかった時は、浮いたカードが元の場所へ戻る
      if (feedback) feedback.dropAnimation = moved ? null : SETTLE_BACK
      // 掴んだ週の外へ移っていたか
      const away = data !== null && data.week.from !== latest.current.week.from
      if (away && moved) {
        // 今の週に残る（落とし終えてから、掴んだ週の入れ物を片付ける）
        rekey.current = true
        afterDrop(m, settleStage)
      } else if (away && origin.current) {
        // 落とさずにやめた: 掴んだ週へ戻る（掴んだ週の入れ物は、戻ってから今の週の入れ物に戻る。上の useEffect）
        latest.current.nav.goTo(origin.current.viewed)
      } else origin.current = null
      if (moved && data) {
        // 移った先の要素（始点・●を動かして1日の予定になった時は、カード。元の要素は外れている）を見える所まで出し、収める
        const ids = [source?.id, dragId(data.item.id, 'card')]
        requestAnimationFrame(() => {
          const el = ids
            .map((id) => (id === undefined ? undefined : m.registry.draggables.get(id)?.element))
            .find((x) => x?.isConnected)
          // 出す所は、収める動き（1.03倍から）を掛ける前の大きさで測る。週・段の中だけを動かし、ページは動かさない（G4）。落とした時に
          // 見える所へ出すのはここだけ（目立つ側は applyDrop の flashInPlace で動かない。●を動かした時に、目立つ始点のカード・受けた
          // 表示の方へ送って●を画面の外へ出さないように。7.11）。画面の下の「〜へ移しました［元に戻す］」（applyDrop が出した物）の
          // 下には出さず、その上まで（6秒のお知らせに隠れて、目立たせても見えないことが無いように）
          if (el) scrollIntoViewWithin(el, { bottomInset: toastInset(el) })
          settle(el)
        })
      }
    },
    [store, driver, settleStage],
  )

  const live = week
  // 掴んだ週の入れ物（掴んだまま別の週へ移った間）。描いている間に読む ref だが、変わるのは週が替わる（行き先が替わって描き直す）時と、
  // 別の週へ落として片付ける（liveKey を進めて描き直す）時だけ
  const o = origin.current
  const frozen = o && o.week.from !== live.from ? o.week : null
  return (
    <DragDropProvider sensors={SENSORS} plugins={PLUGINS} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}>
      <ActiveDragContext.Provider value={store}>
        <div ref={stageEl} className="wk-stage">
          {/* 掴んだ週（掴んだまま別の週へ移った間だけ。見えないまま残す）。入れ物の key は、掴んだ時の今の週の入れ物と同じにして、
              掴んだカードを外さない */}
          {frozen ? (
            <WeekSlot key={`w${liveKey}`} frozen>
              {renderWeek(frozen, true)}
            </WeekSlot>
          ) : null}
          <WeekSlot key={`w${frozen ? liveKey + 1 : liveKey}`} frozen={false}>
            {renderWeek(live, false)}
          </WeekSlot>
          <EdgeCueView key="cue" cue={cue} />
        </div>
      </ActiveDragContext.Provider>
    </DragDropProvider>
  )
}

// ---------- useItemDrag ----------

/**
 * 予定を掴めるようにする（item:{id}:{card|start|end}）。掴めない物（ロック中・その週に見えていない端。drag.ts の canGrab）は
 * dnd-kit に要素を渡さない。ロック中なら grabProps で掴もうとした時に揺らす（lockGesture.ts）。受けた表示と＞はこれを呼ばない
 * （CALENDAR-176）。week はその物を描いている週（掴んだ週になる）
 */
export function useItemDrag({ item, handle, week }: { item: Item; handle: DragHandle; week: WeekCtx }): ItemDrag {
  const check = canGrab(item, handle, week)
  const data = useMemo<DragData>(() => ({ item, handle, week }), [item, handle, week])
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
 * dropPatch（掴んだ週で決める。落とせない日は dnd-kit が落とす先にしない）、印は掴んだ時・週が替わった時の dropDays（D25）。
 * 見えないまま残している掴んだ週の中では、落とす所にしない
 */
export function useDayDrop({ date, kind }: { date: string; kind: ItemKind }): DayDrop {
  const store = useContext(ActiveDragContext)
  const frozen = useContext(FrozenWeekContext)
  const marked = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.marks(date, kind) ?? false,
    () => false,
  )
  const data = useMemo<DropData>(() => ({ date, kind }), [date, kind])
  const accept = useCallback(
    (source: { data: unknown }) => {
      const d = asDragData(source.data)
      return d !== null && dropPatch(d.item, d.handle, { date, kind }, d.week) !== null
    },
    [date, kind],
  )
  const droppable = useDroppable({ id: dropId(date, kind), data, accept, disabled: frozen })
  const hover = droppable.isDropTarget
  const ref = droppable.ref
  const state: DropState = !marked || frozen ? 'none' : hover ? 'hover' : 'ok'
  return useMemo(() => ({ ref, state }), [ref, state])
}
