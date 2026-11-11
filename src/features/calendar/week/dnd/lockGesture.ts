// ロック中の物を掴もうとした時（docs/SPEC.md の 7.10・4.9・D25）。ロック中のカード・始点のカード・●は dnd-kit に渡さない（掴めない・
// 持ち上がらない）。代わりに、掴む時と同じ決まり（gesture.ts。マウスは 5px を超えて動かす、指は 0.4秒押し続ける）で
// 「掴もうとした」と分かった時に、その要素を 240ms 揺らし（視差効果を減らす設定ではロックの印を 600ms --accent に。src/ui/motion.ts の
// shake）、離すまでカーソルを not-allowed にする（CALENDAR-150・152・153）。知らせの文は出さない（CALENDAR-151）。
// 掴もうとした後に離した時の click は捨てる（5px を超えて動かした・長押しした物はクリックではない。詳細を開かない）。
// 押した時に preventDefault しないので、指ですぐ動かすとふつうにスクロールする（CALENDAR-160）。指の長押しで Android の
// 長押しのメニュー（contextmenu）を出さない（CALENDAR-164・WP11s の G10。マウスの右クリックのメニューはそのまま）
import { useMemo, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react'
import type { ID } from '../../../../domain/types'
import { shake } from '../../../../ui/motion'
import { LOCK_SELECTOR } from '../../common/parts'
import { testIds } from '../../common/testIds'
import { useWeekScroller } from '../weekScroller'
import { gesture, IDLE, TOUCH_HOLD_MS, type GestureInput, type GestureState, type PointerKind } from './gesture'

/** 掴もうとしている間、ページ（html）に付けるクラス（dnd.css でカーソルを not-allowed にする） */
export const REFUSED_CLASS = 'dnd-refused'

/** 掴もうとした後に離した時、来る click を捨てる長さ（ms。指の長押しの後の click は少し遅れて来る。次に押した時にはやめる） */
const SWALLOW_CLICK_MS = 600

const NO_GRAB: HTMLAttributes<HTMLElement> = Object.freeze({})

/** 今見ている押し方を終える関数（同時に1つだけ見る） */
let stopCurrent: (() => void) | null = null
/** 最後にロック中の物を押した物の種類（contextmenu を止めるか決める） */
let lastPointer: PointerKind = 'mouse'

/** 次の click を1回だけ捨てる（次に押した時・SWALLOW_CLICK_MS たった時はやめる） */
function swallowNextClick(): void {
  let timer = 0
  const swallow = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    done()
  }
  const done = () => {
    window.clearTimeout(timer)
    window.removeEventListener('click', swallow, true)
    window.removeEventListener('pointerdown', done, true)
  }
  window.addEventListener('click', swallow, true)
  window.addEventListener('pointerdown', done, true)
  timer = window.setTimeout(done, SWALLOW_CLICK_MS)
}

/** ロックの印（その要素の中、無ければ同じ予定の始点のカード・受けた表示の中。●・「● 件名」の行には印が無い） */
function lockIconOf(el: Element, id: ID, scroller: Element | null): Element | null {
  const own = el.querySelector(LOCK_SELECTOR)
  if (own) return own
  const root = scroller ?? el.ownerDocument
  return root.querySelector(
    `[data-testid="${testIds.weekStart(id)}"] ${LOCK_SELECTOR}, [data-testid="${testIds.weekReceived(id)}"] ${LOCK_SELECTOR}`,
  )
}

/** ロック中の物の上で押した時から、離すまでを見る */
function watchLockedPress(ev: PointerEvent, el: HTMLElement, lockIcon: () => Element | null): void {
  stopCurrent?.()
  let state: GestureState = gesture(IDLE, {
    type: 'down',
    pointerId: ev.pointerId,
    pointerType: ev.pointerType,
    x: ev.clientX,
    y: ev.clientY,
    button: ev.button,
    isPrimary: ev.isPrimary,
  }).state
  if (state.phase !== 'pressed') return
  lastPointer = state.pointer
  const root = el.ownerDocument.documentElement
  let timer = 0

  const stop = () => {
    window.clearTimeout(timer)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    root.classList.remove(REFUSED_CLASS)
    if (stopCurrent === stop) stopCurrent = null
  }
  const feed = (input: GestureInput) => {
    const step = gesture(state, input)
    state = step.state
    if (step.effect === 'attempt') {
      shake(el, lockIcon())
      root.classList.add(REFUSED_CLASS)
    }
    if (step.effect === 'release') swallowNextClick()
    if (state.phase === 'idle') stop()
  }
  const onMove = (e: PointerEvent) => feed({ type: 'move', pointerId: e.pointerId, x: e.clientX, y: e.clientY })
  const onUp = (e: PointerEvent) => feed({ type: 'up', pointerId: e.pointerId })
  const onCancel = (e: PointerEvent) => feed({ type: 'cancel', pointerId: e.pointerId })

  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  if (state.pointer !== 'mouse') timer = window.setTimeout(() => feed({ type: 'hold' }), TOUCH_HOLD_MS)
  stopCurrent = stop
}

/**
 * ロック中の物（locked）の掴む要素に広げて渡す物（onPointerDown・onContextMenu）。ロック中でなければ空（dnd-kit が掴む）。
 * id は予定の id（●・「● 件名」の行の時に、同じ予定のロックの印を探す）
 */
export function useLockGesture(locked: boolean, id: ID): HTMLAttributes<HTMLElement> {
  const scroller = useWeekScroller()
  return useMemo(() => {
    if (!locked) return NO_GRAB
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        const el = e.currentTarget
        watchLockedPress(e.nativeEvent, el, () => lockIconOf(el, id, scroller.current))
      },
      onContextMenu: (e) => {
        if (lastPointer !== 'mouse') e.preventDefault()
      },
    }
  }, [locked, id, scroller])
}
