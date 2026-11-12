// 掴んでいる間の画面の端（docs/SPEC.md の 7.11・10.4。決まりは edges.ts）を、毎コマ測って動かす物。WeekDnd が掴んだ時に始め、
// 指が動くたびに位置を渡し、離した時に止める。
// - 上下の端: 週の中（S は週、L・M は指の下の段の中）だけを自動でスクロールする（ページは動かさない。dnd-kit の自動のスクロールは
//   使わない: dnd-kit は端をスクロールする要素の箱から測るので、S・M でページを送って週の上の端がヘッダーの下に入ると、上の端の
//   60px に指が届かなかった。作者の iPhone の「週が動かない」の原因）
// - 左右の端: 帯に留まると onShift（前後の週へ。WeekDnd が［‹］［›］と同じ移り方をする）。帯の目印は onCue で WeekDnd が描く
// 見えている所の上に重なる物（S・M でページを送った時のヘッダーと切り替えの列）は、掴んだ時と週を移した後に、指の届く所を上から
// 調べて決める（document.elementsFromPoint。掴んだ物と目印の帯は数えない）
import {
  allowedSpeed,
  edgeSpeed,
  NOT_MOVED,
  noteMove,
  sideOf,
  startSide,
  stepSide,
  visibleBox,
  type Box,
  type Moved,
  type Point,
  type Side,
  type SideState,
} from './edges'

/** 目印の帯（左右の端に留まっている間だけ）。箱は週の舞台（.wk-stage）の中の位置（px） */
export interface EdgeCue {
  side: Exclude<Side, 0>
  /** 帯が満ちるまで（ms。初めは 600、続けて移る時は 900） */
  period: number
  /** 満ち始めた時（帯の満ちる動きをやり直す印） */
  since: number
  /** 字を置く所（指で隠れないよう、指が下の半分なら上・上の半分なら下） */
  label: 'top' | 'bottom'
  left: number
  top: number
  width: number
  height: number
}

export interface EdgeDriverOptions {
  /** 今見ている週のいちばん外の要素（S は縦にスクロールする週、L・M は横にスクロールすることがある週） */
  root: () => HTMLElement | null
  /** 目印の帯を置く所（週の舞台。position: relative） */
  stage: () => HTMLElement | null
  /** 左右の帯の幅（px。S と L・M で違う） */
  band: () => number
  /** 前（-1）・次（1）の週へ */
  onShift: (side: Exclude<Side, 0>) => void
  /** 目印の帯を出す・消す（null） */
  onCue: (cue: EdgeCue | null) => void
}

/** 画面の中の表示されている所（ピンチで拡大した時・iPhone の Chrome の上下のバーで狭まった時は visualViewport） */
function screenBox(): Box {
  const w = window.innerWidth
  const h = window.innerHeight
  const vv = window.visualViewport
  if (!vv) return { left: 0, top: 0, right: w, bottom: h }
  return {
    left: Math.max(0, vv.offsetLeft),
    top: Math.max(0, vv.offsetTop),
    right: Math.min(w, vv.offsetLeft + vv.width),
    bottom: Math.min(h, vv.offsetTop + vv.height),
  }
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/** 数えない物（掴んで浮いている物・目印の帯） */
const IGNORED = '[data-dnd-dragging], [data-edge-cue]'

/**
 * el の上に重なっている物の下の端（画面の座標。重なっていなければ el の見えている上の端）。el の見えている所の横の真ん中を上から
 * 2px ずつ調べ、いちばん上に el の中の物が来る所。調べられない（jsdom）時は -Infinity
 */
function coverTopOf(el: HTMLElement, box: Box): number {
  if (typeof document.elementsFromPoint !== 'function') return Number.NEGATIVE_INFINITY
  const x = (box.left + box.right) / 2
  for (let y = Math.ceil(box.top); y < box.bottom; y += 2) {
    const hit = document.elementsFromPoint(x, y).find((e) => !e.closest(IGNORED))
    if (!hit || el.contains(hit)) return y
  }
  return box.bottom
}

const SCROLLS = /(auto|scroll|overlay)/

/** その向きにまだスクロールできるか（axis の向き dir。1 は下・右） */
function canScroll(el: HTMLElement, axis: 'x' | 'y', dir: number): boolean {
  const cs = getComputedStyle(el)
  if (!SCROLLS.test(axis === 'x' ? cs.overflowX : cs.overflowY)) return false
  if (axis === 'x') return dir < 0 ? el.scrollLeft > 0 : el.scrollLeft < el.scrollWidth - el.clientWidth - 1
  return dir < 0 ? el.scrollTop > 0 : el.scrollTop < el.scrollHeight - el.clientHeight - 1
}

/** 指の下の、縦にスクロールする所（S は週そのもの、L・M は段の中） */
function verticalScrollerAt(root: HTMLElement, p: Point): HTMLElement | null {
  const list = [...root.querySelectorAll<HTMLElement>('.wk-tier-body'), root]
  for (const el of list) {
    if (!SCROLLS.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight) continue
    const b = boxOf(el)
    if (p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom) return el
  }
  return null
}

export class EdgeDriver {
  private readonly opts: EdgeDriverOptions
  private p: Point | null = null
  private moved: Moved = NOT_MOVED
  private side: SideState = startSide(0)
  private cover: number | null = null
  private raf = 0
  private last = 0
  /** スクロールの端数（px。小さい速さでも少しずつ進むように） */
  private carry = { el: null as HTMLElement | null, axis: 'y' as 'x' | 'y', px: 0 }
  private cue: EdgeCue | null = null

  constructor(opts: EdgeDriverOptions) {
    this.opts = opts
  }

  /** 掴んだ（p は指の位置） */
  start(p: Point): void {
    this.stop()
    this.p = p
    this.moved = NOT_MOVED
    this.cover = null
    const box = this.visible()
    this.side = startSide(box ? sideOf(p, box, this.opts.band()) : 0)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  /** 指が動いた */
  move(p: Point): void {
    if (this.p) this.moved = noteMove(this.moved, this.p, p)
    this.p = p
  }

  /** 週が替わった・大きさが変わった（上に重なる物を測り直す） */
  remeasure(): void {
    this.cover = null
  }

  /** 離した・やめた */
  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.p = null
    this.side = startSide(0)
    this.setCue(null)
  }

  /** 今見ている週の見えている所 */
  private visible(): Box | null {
    const root = this.opts.root()
    if (!root) return null
    const rect = boxOf(root)
    const screen = screenBox()
    if (this.cover === null) {
      const box = visibleBox(rect, screen)
      this.cover = box ? coverTopOf(root, box) : Number.NEGATIVE_INFINITY
    }
    return visibleBox(rect, screen, this.cover)
  }

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(50, Math.max(0, now - this.last))
    this.last = now
    const root = this.opts.root()
    const p = this.p
    const box = this.visible()
    if (!root || !p || !box) return
    const band = this.opts.band()
    const at = sideOf(p, box, band)
    // 左右の帯: 週が横にスクロールする時は、まだスクロールできる間はスクロール
    const sx = at === 0 ? 0 : edgeSpeed(p.x, box.left, box.right, band)
    const scrollX = at !== 0 && sx !== 0 && canScroll(root, 'x', at)
    const step = stepSide(this.side, { now, side: at, scrollable: scrollX })
    const before = this.side
    this.side = step.state
    if (scrollX) this.scroll(root, 'x', sx * dt)
    if (step.state.side !== before.side || step.state.due !== before.due) this.showCue(box, band, p, now)
    if (step.shift !== 0) {
      this.cover = null
      this.opts.onShift(step.shift)
      return
    }
    if (at !== 0) return
    // 上下の端: 指の下の縦にスクロールする所の、見えている所の上下の端
    const el = verticalScrollerAt(root, p)
    const vis = el && visibleBox(boxOf(el), screenBox(), this.cover ?? Number.NEGATIVE_INFINITY)
    if (!el || !vis) return
    const sy = allowedSpeed(edgeSpeed(p.y, vis.top, vis.bottom), this.moved)
    if (sy !== 0 && canScroll(el, 'y', sy)) this.scroll(el, 'y', sy * dt)
  }

  /** px だけスクロールする（端数は次のコマへ持ち越す） */
  private scroll(el: HTMLElement, axis: 'x' | 'y', px: number): void {
    const c = this.carry
    if (c.el !== el || c.axis !== axis || Math.sign(c.px) !== Math.sign(px)) Object.assign(c, { el, axis, px: 0 })
    c.px += px
    const whole = Math.trunc(c.px)
    if (whole === 0) return
    c.px -= whole
    if (axis === 'x') el.scrollLeft += whole
    else el.scrollTop += whole
  }

  private showCue(box: Box, band: number, p: Point, now: number): void {
    const s = this.side
    const stage = this.opts.stage()
    if (s.side === 0 || !stage) {
      this.setCue(null)
      return
    }
    const st = stage.getBoundingClientRect()
    const width = Math.min(band, (box.right - box.left) / 2)
    this.setCue({
      side: s.side,
      period: s.period,
      since: now,
      label: p.y > (box.top + box.bottom) / 2 ? 'top' : 'bottom',
      left: (s.side < 0 ? box.left : box.right - width) - st.left,
      top: box.top - st.top,
      width,
      height: box.bottom - box.top,
    })
  }

  private setCue(cue: EdgeCue | null): void {
    if (cue === null && this.cue === null) return
    this.cue = cue
    this.opts.onCue(cue)
  }
}
