// 期間を移った時にページをめくる動き（docs/SPEC.md の 3.7・4.9。22. の段階2の終わりの確かめ）。イヤー・マンスリー・ウィークリー・
// デイリーで、モードはそのままで期間が替わった時（なぞる・［‹］［›］・［今日］・マンスリーの前後の月の日）に、モードの画面を入れる所
// （.cal-body）を1枚のページに見立ててめくる。モードを替えた時（［年｜月｜週｜日］）・ドラッグ中に週が替わった時はめくらない。
// - 次へ: 前の期間のページが右の端から持ち上がり、左の端（綴じ目）を軸に奥行きを付けて左へめくれ、下の新しい期間が見えてくる
// - 前へ: その逆。新しい期間のページが左からめくれて来て、前の期間のページの上に重なる
// - 前の期間（と、前へめくる時に重なって来る新しい期間）は、本物の画面を写した絵（pageTurnDom.ts の cloneForTurn）で、めくる間（--dur-turn
//   の 420ms）だけ置く。本物の画面は1つのまま、いつもの所で描き直すので、フォーカス・大きさの測り・スクロールの位置・ドラッグの
//   落とす所・目立たせる所はめくらない時と同じ。写した絵は押せず（inert・pointer-events: none）、読み上げにも出ない（aria-hidden）
// - めくっている間にもう一度期間が替わる・押す・ホイール・キー・窓の大きさが替わる・モードを替える・画面が裏へ回る時は、今のめくりを
//   すぐ終える
//   （次の切り替えは、そこからまためくる）
// - 視差効果を減らす設定ではめくらない（すぐ替える。4.9）
// - 片付けは、ページのめくる動きが終わった時（animationend）。動きが始まった時から数えて少し長く待っても終わりの知らせが来なければ
//   外す。その時に動きがまだ途中なら（重くて知らせより先に時間が来た）、残りの分だけ待ち直す（遅い端末では、写した絵を描くまでに
//   時間がかかり、動きが始まるのが遅れる。置いた時から数えると途中で切れる）
// 前の期間の絵は、描き直しで画面が替わる前に写す（クラスの部品の getSnapshotBeforeUpdate。関数の部品には、DOM を替える直前に呼ばれる
// 所が無い）。モードの画面を包まない（.cal-body の横に置く）ので、モードの画面の並べ方・高さの決まりには触らない
import { Component, type RefObject } from 'react'
import { useCalendarUi } from '../../../store/uiStore'
import { TURN_MS } from '../../../ui/motion'
import {
  applyScroll,
  canTurn,
  cloneForTurn,
  takeSkip,
  turnDirection,
  turnsHeld,
  type TurnClone,
  type TurnDirection,
} from './pageTurnDom'
import type { CalendarMode } from './types'

export interface PageTurnProps {
  /** 今のモード（替わった時はめくらない） */
  mode: CalendarMode
  /** 見ている期間の初めの日（'YYYY-MM-DD'。替わるとめくる。先へ進めば次、戻れば前） */
  from: string
  /** 見ている期間の最後の日（'YYYY-MM-DD'。skipTurnTo の日を含むかを見る） */
  to: string
  /** モードの画面を入れる所（.cal-body）。この要素を写し、この要素の上（親の .cal の中）にめくるページを置く */
  body: RefObject<HTMLElement | null>
}

/** めくる動きが始まってから、終わるのを待つ長さ（animationend が来ない時の片付け。動きの長さより少し長く） */
export const TURN_CLEANUP_MS = TURN_MS + 120

/**
 * 箱を置いてから、めくる動きが始まるのを待つ長さの上限（始まらない時の片付け。CPU を 4倍遅くした Chromium で、イヤーの写しを
 * 置いてから動きが始まるまで 0.3秒ほどかかったので、それより十分に長く）
 */
export const TURN_START_GUARD_MS = 2000

/** ページをめくる動きの名前（src/features/calendar/common/frame.css の @keyframes） */
const TURN_ANIMATIONS = new Set(['cal-turn-out', 'cal-turn-in'])

/**
 * 遠近の強さ（px）。ページの幅の 3 倍（持ち上がった端が手前へ大きくなりすぎない。めくれた端が見る人の前を越えない。狭い時も
 * 1200px より近くしない）
 */
export function turnPerspective(width: number): number {
  return Math.max(1200, Math.round(width * 3))
}

/** getSnapshotBeforeUpdate が返す物（描き直す前に写した前の期間） */
interface Snapshot {
  dir: TurnDirection
  old: TurnClone
}

/** めくっている間の物 */
interface Running {
  layer: HTMLElement
  host: HTMLElement
  timer: number
}

/**
 * めくっているページの動き（cal-turn-out・cal-turn-in）が終わるまでの残り（ms）。走っている動きが無ければ 0（動きを読めない所
 * （jsdom）・止めた動き・終えた動きも 0）
 */
function remainingMs(layer: HTMLElement): number {
  let left = 0
  for (const page of layer.querySelectorAll<HTMLElement>('.cal-turn-page.is-out, .cal-turn-page.is-in')) {
    for (const a of page.getAnimations?.() ?? []) {
      if (a.playState !== 'running' || !TURN_ANIMATIONS.has((a as CSSAnimation).animationName)) continue
      const t = a.effect?.getComputedTiming()
      const rest = Number(t?.endTime ?? 0) - Number(t?.localTime ?? 0)
      if (Number.isFinite(rest)) left = Math.max(left, rest)
    }
  }
  return left
}

/**
 * めくる中身の1枚（地は --surface）。写した .cal-body は、写した時の元の大きさのまま左上に置く（新しい期間の大きさに伸ばし
 * 縮めしない）。めくれるページ（fit）は、ページそのものも写した大きさにする（S・M のマンスリーで前の月の行が少ない時、下の
 * 新しい期間の残りの行はそのまま見える）。下に敷くページ（前へめくる時の前の期間）は箱いっぱいにし、写しの外は地の色にする
 * （新しい期間が、めくれて来る前に見えないように）
 */
function makePage(clone: TurnClone, className: string, fit: boolean): HTMLElement {
  const page = document.createElement('div')
  page.className = className
  clone.el.classList.add('cal-turn-body')
  clone.el.style.width = `${clone.width}px`
  clone.el.style.height = `${clone.height}px`
  if (fit) {
    page.style.width = `${clone.width}px`
    page.style.height = `${clone.height}px`
  }
  page.appendChild(clone.el)
  const shade = document.createElement('div')
  shade.className = 'cal-turn-shade'
  page.appendChild(shade)
  return page
}

export class PageTurn extends Component<PageTurnProps> {
  private running: Running | null = null

  /** 描き直す前（画面がまだ前の期間の時）に、めくるなら前の期間を写す */
  getSnapshotBeforeUpdate(prev: Readonly<PageTurnProps>): Snapshot | null {
    const { mode, from, to, body } = this.props
    if (prev.mode === mode && prev.from === from) return null
    // めくっている間にまた替わった（モードを替えた時も）: 今のめくりはすぐ終える
    this.finish()
    // skipTurnTo の控えは、替わるたびに使い切る（モードを替えた時も）
    const skipped = takeSkip(from, to)
    if (prev.mode !== mode || skipped) return null
    const dir = turnDirection(prev.from, from)
    const el = body.current
    // 掴んでいる間（ウィークリーの WeekDnd が付ける印。dnd-kit の掴んだ物の印 canTurn と重ねて見る）もめくらない
    if (!dir || !el?.isConnected || !el.parentElement || !canTurn() || useCalendarUi.getState().dragging) return null
    return { dir, old: cloneForTurn(el) }
  }

  componentDidUpdate(_prev: Readonly<PageTurnProps>, _state: unknown, snapshot: Snapshot | null): void {
    if (snapshot) this.start(snapshot)
  }

  componentWillUnmount(): void {
    this.finish()
  }

  render() {
    return null
  }

  /** めくり始める（描き直した後・画面に出る前） */
  private start({ dir, old }: Snapshot): void {
    const body = this.props.body.current
    const host = body?.parentElement
    if (!body || !host) return
    const layer = document.createElement('div')
    layer.className = `cal-turn is-${dir}`
    layer.dataset.turn = dir
    layer.setAttribute('aria-hidden', 'true')
    layer.setAttribute('inert', '')
    // .cal-body の枠（スクロールバーを含む）と同じ所・大きさ。外へはみ出す所は切る（ページを横にスクロールさせない）
    const b = body.getBoundingClientRect()
    const h = host.getBoundingClientRect()
    const width = body.offsetWidth
    const height = body.offsetHeight
    // 遠近の中心は、見えている所の縦の真ん中（S・M のイヤー・マンスリーは .cal-body がページより高い）
    const visibleMid = Math.min(Math.max(window.innerHeight / 2 - b.top, 0), height)
    Object.assign(layer.style, {
      left: `${Math.round(b.left - h.left - host.clientLeft)}px`,
      top: `${Math.round(b.top - h.top - host.clientTop)}px`,
      width: `${width}px`,
      height: `${height}px`,
      perspective: `${turnPerspective(width)}px`,
      perspectiveOrigin: `50% ${Math.round(visibleMid)}px`,
    })
    host.appendChild(layer)
    const running: Running = { layer, host, timer: 0 }
    this.running = running
    host.dataset.turning = dir

    if (dir === 'next') {
      // 前の期間のページが、本物の新しい期間の上でめくれていく
      this.turnPage(running, makePage(old, 'cal-turn-page is-out', true), old)
    } else {
      // 前の期間のページ（動かない）の上へ、新しい期間のページがめくれて来る。新しい期間は、描き直しが落ち着いてから写す
      // （画面の中で描いた後にすぐ描き直す物も写るように。画面に出る前の microtask）
      const under = makePage(old, 'cal-turn-page is-under', false)
      layer.appendChild(under)
      applyScroll(old)
      queueMicrotask(() => {
        if (this.running !== running) return
        const now = cloneForTurn(body)
        this.turnPage(running, makePage(now, 'cal-turn-page is-in', true), now)
      })
    }
    // 動きが始まらない時の片付け（始まったら、そこから数え直す。turnPage）
    running.timer = window.setTimeout(this.expire, TURN_START_GUARD_MS)
    document.addEventListener('pointerdown', this.finish, true)
    document.addEventListener('keydown', this.finish, true)
    document.addEventListener('wheel', this.finish, { capture: true, passive: true })
    document.addEventListener('visibilitychange', this.finish)
    window.addEventListener('resize', this.finish)
  }

  /** めくるページを置いて動かし、動きが終わったら片付ける */
  private turnPage(running: Running, page: HTMLElement, clone: TurnClone): void {
    running.layer.appendChild(page)
    applyScroll(clone)
    // ページそのもののめくる動き（cal-turn-out・cal-turn-in）だけを見る（影・陰の動きは見ない）
    const own = (e: AnimationEvent) =>
      e.target === page && !e.pseudoElement && TURN_ANIMATIONS.has(e.animationName) && this.running === running
    // 動きが始まった時から、終わるのを待つ（写した絵を描くのが遅く、始まるのが遅れても途中で切らない）
    page.addEventListener('animationstart', (e) => {
      if (!own(e)) return
      window.clearTimeout(running.timer)
      running.timer = window.setTimeout(this.expire, TURN_CLEANUP_MS)
    })
    page.addEventListener('animationend', (e) => {
      if (own(e)) this.settle()
    })
  }

  /**
   * 待つ長さを過ぎた: 動きがまだ途中なら（重くて、終わりの知らせより先に時間が来た）残りの分だけ待ち直し、そうでなければ片付ける
   */
  private expire = (): void => {
    const running = this.running
    if (!running) return
    const left = remainingMs(running.layer)
    if (left > 0) running.timer = window.setTimeout(this.expire, left + TURN_CLEANUP_MS - TURN_MS)
    else this.settle()
  }

  /** めくる動きが終わった（か、待つ長さを過ぎた）: 片付ける（E2E の開発用に止めている間は外さない。pageTurnDom の holdTurnsForTest） */
  private settle = (): void => {
    if (!turnsHeld()) this.finish()
  }

  /** めくりを終える（すぐ）。めくっていない時は何もしない */
  private finish = (): void => {
    const running = this.running
    if (!running) return
    this.running = null
    window.clearTimeout(running.timer)
    running.layer.remove()
    delete running.host.dataset.turning
    document.removeEventListener('pointerdown', this.finish, true)
    document.removeEventListener('keydown', this.finish, true)
    document.removeEventListener('wheel', this.finish, true)
    document.removeEventListener('visibilitychange', this.finish)
    window.removeEventListener('resize', this.finish)
  }
}
