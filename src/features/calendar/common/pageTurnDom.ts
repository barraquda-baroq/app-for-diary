// ページをめくる動き（PageTurn.tsx）と指でなぞる所（useSwipe.ts）が使う、画面の要素を読む小さな決まり（docs/SPEC.md の 3.7・4.9）。
// React・ストアを読まない（PageTurn・useSwipe のほかに、ドラッグの部品からも呼べる）
//
// - めくる向き: 期間の初めの日が先へ進めば次（右の端から左へめくる）、戻れば前（左から新しいページが重なる）
// - めくる間の前の期間の絵は、モードの画面を入れる所（.cal-body）を写した物（cloneForTurn）。写した物は React の外の、ただの要素
//   なので、ドラッグの落とす所・目立たせる所にならず、押せず（inert・pointer-events: none）、読み上げにも出ない（aria-hidden）。
//   テストの印・id・name などは外す（本物と同じ印が2つにならないように）。中のスクロールの位置は、置いた後に写す（applyScroll）
// - めくらない時: 視差効果を減らす設定・画面が裏にある・ドラッグ中（掴んだ物には dnd-kit が data-dnd-dragging を付ける。ドラッグ中に
//   端で週が替わる時は、めくらずにすぐ替える）・裏から戻って今日へ移す時（skipNextTurn。開いた時と同じ扱い）
import { prefersReducedMotion } from '../../../ui/motion'

/** めくる向き（next = 次の期間へ。前のページが右の端から持ち上がり、左の端（綴じ目）を軸に左へめくれる。prev = 前の期間へ。逆向き） */
export type TurnDirection = 'next' | 'prev'

/** 期間の初めの日（'YYYY-MM-DD'）から、めくる向き。同じなら null */
export function turnDirection(before: string, after: string): TurnDirection | null {
  if (before === after) return null
  return after > before ? 'next' : 'prev'
}

/** ドラッグ中か（dnd-kit が掴んだ物に付ける印。docs/SPEC.md の 7.11。week/dnd/dnd.css も同じ印を見る） */
export function dragActive(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[data-dnd-dragging]') !== null
}

/** 次にめくらない時刻（performance.now()）の終わり */
let skipUntil = 0

/** 次の期間の切り替え（ms の間）をめくらずに替える（裏から戻って今日へ移す時。6.4。開いた時と同じく動かさない） */
export function skipNextTurn(ms = 1000): void {
  skipUntil = performance.now() + ms
}

/** 今、期間の切り替えをめくってよいか（視差効果を減らす設定・画面が裏にある・ドラッグ中・skipNextTurn の間はめくらない） */
export function canTurn(): boolean {
  if (typeof document === 'undefined') return false
  if (prefersReducedMotion()) return false
  if (document.visibilityState === 'hidden') return false
  if (dragActive()) return false
  return performance.now() >= skipUntil
}

/** 写した物から外す属性（同じ印・id が2つにならない・押せない・フォーカスが来ない・ドラッグの印を持たないように） */
const STRIP_ATTRS = [
  'id',
  'data-testid',
  'name',
  'for',
  'form',
  'tabindex',
  'autofocus',
  'accesskey',
  'popover',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-activedescendant',
  'data-drop',
]

/** 写した要素から、本物と同じ印・押せる・フォーカスの来る属性と、ドラッグの印（data-dnd-…）を外す */
function strip(el: Element): void {
  for (const name of STRIP_ATTRS) if (el.hasAttribute(name)) el.removeAttribute(name)
  for (const attr of [...el.attributes]) if (attr.name.startsWith('data-dnd')) el.removeAttribute(attr.name)
}

/** 写した物と、置いた後に写すスクロールの位置 */
export interface TurnClone {
  /** 写した要素（.cal-body の写し。まだどこにも置いていない） */
  el: HTMLElement
  /** 写した中のスクロールした要素と、その位置（置いた後に applyScroll で当てる。置く前の要素には当たらない） */
  scrolls: { el: Element; top: number; left: number }[]
}

/**
 * 要素を写す（cloneNode。中の入力欄の値もそのまま）。写した物の印・id などを外し、スクロールの位置を控える。
 * 本物と写した物の並びは同じなので、querySelectorAll('*') の順で組にする
 */
export function cloneForTurn(source: HTMLElement): TurnClone {
  const el = source.cloneNode(true) as HTMLElement
  const from = [source, ...source.querySelectorAll('*')]
  const to = [el, ...el.querySelectorAll('*')]
  const scrolls: TurnClone['scrolls'] = []
  for (let i = 0; i < to.length; i++) {
    const s = from[i]
    if (s && (s.scrollTop || s.scrollLeft)) scrolls.push({ el: to[i], top: s.scrollTop, left: s.scrollLeft })
    strip(to[i])
  }
  return { el, scrolls }
}

/** 置いた写しに、控えたスクロールの位置を当てる */
export function applyScroll(clone: TurnClone): void {
  for (const { el, top, left } of clone.scrolls) {
    el.scrollTop = top
    el.scrollLeft = left
  }
}
