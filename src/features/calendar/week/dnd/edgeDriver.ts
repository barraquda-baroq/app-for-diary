// 掴んでいる間の画面の端（docs/SPEC.md の 7.11・10.4。決まりは edges.ts）を、毎コマ測って動かす物。WeekDnd が掴んだ時に始め、
// 指が動くたびに位置を渡し、離した時に止める。
// - 上下の端: 週の中（S は週、L・M は指の下の段の中）だけを自動でスクロールする（ページは動かさない。dnd-kit の自動のスクロールは
//   使わない: dnd-kit は端をスクロールする要素の箱から測るので、S・M でページを送って週の上の端がヘッダーの下に入ると、上の端の
//   60px に指が届かなかった。作者の iPhone の「週が動かない」の原因）。左右の帯の上でも、まだ送れる間は先に送る
// - 左右の端: 帯（見えている週の端の内側と、その外の画面の端までの余白）に留まると onShift（前後の週へ。WeekDnd が［‹］［›］と
//   同じ移り方をする）。帯の目印は onCue で WeekDnd が描く（画面の座標。週の外の余白にも掛かるので、ページの上に固定して描く）
// - 落とす所を探す範囲（area）: 同じ見えている所と帯を、WeekDnd の当たりの計算に渡す（範囲の外では落とさない。edges.ts の inDropArea）
// 見えている所の上に重なる物（S・M でページを送った時のヘッダーと切り替えの列）は、掴んだ時と週を移した後に、指の届く所を上から
// 調べて決める（document.elementsFromPoint。掴んだ物と目印の帯は数えない）
import {
  allowedSpeed,
  bandRect,
  CUE_DELAY_MS,
  cueLabel,
  edgeSpeed,
  NOT_MOVED,
  noteMove,
  sideOf,
  startSide,
  stepSide,
  visibleBox,
  type Box,
  type CueLabel,
  type Moved,
  type Outer,
  type Point,
  type Side,
  type SideState,
} from './edges'

/** 目印の帯（左右の端に留まっている間だけ。帯に入って 0.15秒たってから）。箱は画面の座標（px） */
export interface EdgeCue {
  side: Exclude<Side, 0>
  /** 帯が満ちるまで（ms。初めは 600、続けて移る時は 900） */
  period: number
  /** 満ち始めた時（帯の満ちる動きをやり直す印） */
  since: number
  /** 目印を出した時に、もう満ち始めてからたっていた時間（ms。満ちる動きをその所から始める） */
  elapsed: number
  /** 字の所（浮いたカードのすぐ上か下） */
  label: CueLabel
  left: number
  top: number
  width: number
  height: number
}

/** 落とす所を探す範囲（画面の座標）: 見えている週の箱と、左右の帯の内側の幅・外の端 */
export interface DropArea {
  box: Box
  inside: number
  outer: Outer
}

export interface EdgeDriverOptions {
  /** 今見ている週のいちばん外の要素（S は縦にスクロールする週、L・M は横にスクロールすることがある週） */
  root: () => HTMLElement | null
  /** 左右の帯の、見えている週の内側の幅（px。edges.ts の insideBand） */
  band: () => number
  /** 左右の帯の外の端（S・M は画面の端まで、L の右はカレンダーの領域の右の端まで） */
  outer: () => Outer
  /** 前（-1）・次（1）の週へ */
  onShift: (side: Exclude<Side, 0>) => void
  /** 目印の帯を出す・動かす・消す（null） */
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
/** 掴んで浮いている物（dnd-kit が元の場所に置く写しは除く） */
const LIFTED = '[data-dnd-dragging]:not([data-dnd-placeholder])'

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

/**
 * 端まで残り半ピクセル未満なら、もう送れないとみなす（scrollTop は小数になることがある。1px の余りを見ると、整数の歩みで端の1つ手前
 * （max − 1）に止まった時に送り切らずに終わっていた。e2e/week-drag.spec.ts の自動のスクロールで 858 のはずが 857 になった）
 */
const END_SLACK_PX = 0.5

/** その向きにまだスクロールできるか（axis の向き dir。1 は下・右） */
export function canScroll(el: HTMLElement, axis: 'x' | 'y', dir: number): boolean {
  const cs = getComputedStyle(el)
  if (!SCROLLS.test(axis === 'x' ? cs.overflowX : cs.overflowY)) return false
  if (axis === 'x') return dir < 0 ? el.scrollLeft > 0 : el.scrollLeft < el.scrollWidth - el.clientWidth - END_SLACK_PX
  return dir < 0 ? el.scrollTop > 0 : el.scrollTop < el.scrollHeight - el.clientHeight - END_SLACK_PX
}

/**
 * 指の下の、縦にスクロールする所（S は週そのもの、L・M は段の中）。指が週の外の余白（左右の帯）にある時は、見えている週の箱 box の
 * 端の所で探す
 */
function verticalScrollerAt(root: HTMLElement, p: Point, box: Box): HTMLElement | null {
  const x = Math.min(Math.max(p.x, box.left + 1), box.right - 1)
  const list = [...root.querySelectorAll<HTMLElement>('.wk-tier-body'), root]
  for (const el of list) {
    if (!SCROLLS.test(getComputedStyle(el).overflowY) || el.scrollHeight <= el.clientHeight) continue
    const b = boxOf(el)
    if (x >= b.left && x <= b.right && p.y >= b.top && p.y <= b.bottom) return el
  }
  return null
}

const sameCue = (a: EdgeCue | null, b: EdgeCue): boolean =>
  a !== null &&
  a.side === b.side &&
  a.since === b.since &&
  a.label.place === b.label.place &&
  a.label.edge === b.label.edge &&
  a.left === b.left &&
  a.top === b.top &&
  a.width === b.width &&
  a.height === b.height

export class EdgeDriver {
  private readonly opts: EdgeDriverOptions
  private p: Point | null = null
  private moved: Moved = NOT_MOVED
  private side: SideState = startSide(0)
  /** 今の帯に入った時刻（目印の帯は CUE_DELAY_MS たってから出す） */
  private entered = 0
  private cover: number | null = null
  private raf = 0
  private last = 0
  /** スクロールの端数（px。小さい速さでも少しずつ進むように。横と縦は別に持つ） */
  private readonly carry = {
    x: { el: null as HTMLElement | null, px: 0 },
    y: { el: null as HTMLElement | null, px: 0 },
  }
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
    this.side = startSide(box ? sideOf(p, box, this.opts.band(), this.opts.outer()) : 0)
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

  /**
   * 落とす所を探す範囲（今見ている週の見えている所と、左右の帯の内側の幅・外の端。edges.ts の inDropArea・dropHit。掴んでいる間の
   * 当たりの計算から読む）。週が見えていない・測れない（jsdom）時は null
   */
  area(): DropArea | null {
    const box = this.visible()
    return box ? { box, inside: this.opts.band(), outer: this.opts.outer() } : null
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
    const inside = this.opts.band()
    const outer = this.opts.outer()
    const at = sideOf(p, box, inside, outer)
    // 上下の端: 指の下の縦にスクロールする所の、見えている所の上下の端（左右の帯の上でも、まだ送れる間は先に送る）
    const el = verticalScrollerAt(root, p, box)
    const vis = el && visibleBox(boxOf(el), screenBox(), this.cover ?? Number.NEGATIVE_INFINITY)
    const sy = vis ? allowedSpeed(edgeSpeed(p.y, vis.top, vis.bottom), this.moved) : 0
    const scrollY = el !== null && sy !== 0 && canScroll(el, 'y', sy)
    // 左右の帯: 週が横にスクロールする時は、まだスクロールできる間はスクロール
    const sx = at === 0 ? 0 : edgeSpeed(p.x, box.left, box.right, inside)
    const scrollX = at !== 0 && sx !== 0 && canScroll(root, 'x', at)
    const before = this.side.side
    const step = stepSide(this.side, { now, side: at, scrollable: scrollX || scrollY })
    this.side = step.state
    if (step.state.side !== 0 && step.state.side !== before) this.entered = now
    if (scrollX) this.scroll(root, 'x', sx * dt)
    if (el && scrollY) this.scroll(el, 'y', sy * dt)
    if (step.shift !== 0) {
      this.cover = null
      this.opts.onShift(step.shift)
      return
    }
    this.showCue(box, inside, outer, p, now)
  }

  /** px だけスクロールする（端数は次のコマへ持ち越す） */
  private scroll(el: HTMLElement, axis: 'x' | 'y', px: number): void {
    const c = this.carry[axis]
    if (c.el !== el || Math.sign(c.px) !== Math.sign(px)) Object.assign(c, { el, px: 0 })
    c.px += px
    const whole = Math.trunc(c.px)
    if (whole === 0) return
    c.px -= whole
    if (axis === 'x') el.scrollLeft += whole
    else el.scrollTop += whole
  }

  /** 目印の帯（帯に入って CUE_DELAY_MS たってから。字は浮いたカードについてくる） */
  private showCue(box: Box, inside: number, outer: Outer, p: Point, now: number): void {
    const s = this.side
    if (s.side === 0 || now - this.entered < CUE_DELAY_MS) {
      this.setCue(null)
      return
    }
    const r = bandRect(s.side, box, inside, outer, screenBox())
    const lifted = document.querySelector(LIFTED)?.getBoundingClientRect()
    const anchor = lifted && lifted.height > 0 ? lifted : { top: p.y, bottom: p.y }
    const since = s.due - s.period
    const cue: EdgeCue = {
      side: s.side,
      period: s.period,
      since,
      elapsed: this.cue?.since === since ? this.cue.elapsed : Math.max(0, Math.round(now - since)),
      label: cueLabel(r, anchor),
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.right - r.left),
      height: Math.round(r.bottom - r.top),
    }
    if (!sameCue(this.cue, cue)) this.setCue(cue)
  }

  private setCue(cue: EdgeCue | null): void {
    if (cue === null && this.cue === null) return
    this.cue = cue
    this.opts.onCue(cue)
  }
}
