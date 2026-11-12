// 掴んでいる間の画面の端の決まり（docs/SPEC.md の 7.11・10.4。22. の段階2の終わりの確かめ）。画面にも dnd-kit にも頼らない純粋な
// 関数だけを置く（purity.test.ts）。測るのと動かすのは edgeDriver.ts。
// - 上下の端: 見えている所の上下の端から 60px に入ると、週の中（S は週、L・M は指の下の段）だけを自動でスクロールする（端に近いほど
//   速い）。掴んだ後にその向きへ指を動かした時だけ（掴んだ所がもう端の近くでも、すぐには動かさない。dnd-kit の決め方と同じ）
// - 左右の端: どの端末でも、見えている週の左右の端の帯（S 28px・L・M 40px）に 0.6秒留まると前（左）・次（右）の週へ移り、留まって
//   いる間は 0.9秒ごとに続けて移る。帯から出ると止める。掴んだ時から帯の中にいた時は、一度帯の外へ出てから入った時だけ数える（端の
//   近くの物を掴んだだけで週が替わらないように）。週が横にスクロールする時（L の狭いウインドウ）は、その向きにまだスクロールできる
//   間は横にスクロールし、端まで来てから留まった時間を数える
// 「見えている所」は、要素の箱を画面（表示されている所）と、上に重なっている物（S・M でページを送った時のヘッダーと切り替えの列）の
// 下で狭めた所。要素の箱のままだと、ページを送って週の上の端がヘッダーの下に入った時に上の端の 60px が指の届かない所になり、
// 下の端は画面の下に出た分だけ狭くなる（作者が iPhone で「週が動かない」と書いた時の原因の1つ）

/** 画面の座標の箱（px） */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Point {
  x: number
  y: number
}

/** 上下の端の自動のスクロールが始まる幅（px） */
export const EDGE_SCROLL_PX = 60
/** 自動のスクロールのいちばん速い時（px/ms。端にいちばん近い時。dnd-kit の 10ms ごとに 25px に近い速さ） */
export const EDGE_SCROLL_MAX = 2
/** 左右の端の帯の幅（px）: S（7日を縦）と L・M（7日を横） */
export const WEEK_EDGE_PX = { S: 28, wide: 40 } as const
/** 帯に留まってから前後の週へ移るまで（ms） */
export const WEEK_DWELL_MS = 600
/** 移った後も帯に留まっている時、続けて次の週へ移る間（ms） */
export const WEEK_REPEAT_MS = 900

/** 2つの箱の重なり（重ならない時は null） */
export function intersect(a: Box, b: Box): Box | null {
  const box = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  }
  return box.right > box.left && box.bottom > box.top ? box : null
}

/**
 * 見えている所: 要素の箱 rect を、画面 screen と、上に重なっている物の下の端 coverTop（無ければ -Infinity）で狭める。
 * 見えていなければ null
 */
export function visibleBox(rect: Box, screen: Box, coverTop = Number.NEGATIVE_INFINITY): Box | null {
  const box = intersect(rect, screen)
  if (!box) return null
  const top = Math.max(box.top, coverTop)
  return box.bottom > top ? { ...box, top } : null
}

/** 左右の向き: -1 = 左（前の週）、1 = 右（次の週）、0 = どちらでもない */
export type Side = -1 | 0 | 1

/** 指が見えている週の箱 box の左右の端の帯（幅 band）に入っているか（縦は箱の中だけ） */
export function sideOf(p: Point, box: Box, band: number): Side {
  if (p.y < box.top || p.y > box.bottom || p.x < box.left || p.x > box.right) return 0
  // 週がとても狭い時は、帯が重ならないよう半分まで
  const w = Math.min(band, (box.right - box.left) / 2)
  if (p.x <= box.left + w) return -1
  if (p.x >= box.right - w) return 1
  return 0
}

/**
 * 端の帯の中での速さ（px/ms）: pos が lo の側の帯（lo から zone）なら負、hi の側なら正。端に近いほど速く、端で max。見えている所の
 * 外（lo より前・hi より後。S・M でページを送った時の、ヘッダーの下に隠れた週の上の所など）は max。真ん中は 0。
 * 上下の自動のスクロール（lo・hi は見えている所の上下）と、横にスクロールする週の左右（lo・hi は左右）に使う
 */
export function edgeSpeed(pos: number, lo: number, hi: number, zone = EDGE_SCROLL_PX, max = EDGE_SCROLL_MAX): number {
  if (hi <= lo) return 0
  const z = Math.min(zone, (hi - lo) / 2)
  if (z <= 0) return 0
  if (pos <= lo + z) return -max * Math.min(1, (lo + z - pos) / z)
  if (pos >= hi - z) return max * Math.min(1, (pos - (hi - z)) / z)
  return 0
}

// ---------- 上下の自動のスクロールの向き（掴んだ後にその向きへ動かした時だけ） ----------

/** 動かした向き（掴んだ後に上へ・下へ動かしたことがあるか） */
export interface Moved {
  up: boolean
  down: boolean
}

export const NOT_MOVED: Moved = { up: false, down: false }

/** 指が from から to へ動いた後の Moved */
export function noteMove(m: Moved, from: Point, to: Point): Moved {
  const up = m.up || to.y < from.y
  const down = m.down || to.y > from.y
  return up === m.up && down === m.down ? m : { up, down }
}

/** 掴んだ後に動かした向きだけの速さ（まだ動かしていない向きは 0） */
export function allowedSpeed(speed: number, m: Moved): number {
  if (speed < 0) return m.up ? speed : 0
  if (speed > 0) return m.down ? speed : 0
  return 0
}

// ---------- 左右の端に留まって前後の週へ ----------

/** 左右の帯の様子 */
export interface SideState {
  /** 帯の外にいたことがある（掴んだ時から帯の中にいた時は false。一度出ると true） */
  armed: { left: boolean; right: boolean }
  /** 今留まっている帯（0 は無し） */
  side: Side
  /** 次に週を移す時刻（ms。side が 0 の時は意味が無い） */
  due: number
  /** due までの長さ（目印の帯の満ちる時間。初めは WEEK_DWELL_MS、移った後は WEEK_REPEAT_MS） */
  period: number
}

/** 掴んだ時の様子（その時の指の所が帯の中なら、その帯はまだ数えない） */
export function startSide(at: Side): SideState {
  return { armed: { left: at !== -1, right: at !== 1 }, side: 0, due: 0, period: 0 }
}

export interface SideInput {
  /** 今の時刻（ms） */
  now: number
  /** 指のいる帯 */
  side: Side
  /** その向きに週がまだ横にスクロールできる（スクロールが先。留まった時間を数えない） */
  scrollable: boolean
}

/** 1つ進める。shift は今移る向き（0 は移らない） */
export function stepSide(s: SideState, input: SideInput): { state: SideState; shift: Side } {
  const { now, side, scrollable } = input
  const armed = {
    left: s.armed.left || side !== -1,
    right: s.armed.right || side !== 1,
  }
  const counts = side !== 0 && !scrollable && (side === -1 ? armed.left : armed.right)
  if (!counts) {
    const changed = s.side !== 0 || armed.left !== s.armed.left || armed.right !== s.armed.right
    return { state: changed ? { armed, side: 0, due: 0, period: 0 } : s, shift: 0 }
  }
  if (s.side !== side) return { state: { armed, side, due: now + WEEK_DWELL_MS, period: WEEK_DWELL_MS }, shift: 0 }
  if (now >= s.due) return { state: { armed, side, due: now + WEEK_REPEAT_MS, period: WEEK_REPEAT_MS }, shift: side }
  return { state: s, shift: 0 }
}
