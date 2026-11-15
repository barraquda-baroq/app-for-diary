// 押した所が、横に動かす物（文字を打つ・選ぶ欄、横にスクロールできる所）の上か（docs/SPEC.md の 3.1・3.7）。
// - なぞって前後の期間へ移る指（src/features/calendar/common/useSwipe.ts）は、その上から押した物をどれも数えない（needsSideways。字を
//   選ぶ・カーソルを動かす・横にスクロールする指）
// - iPhone・iPad の画面の端からのフリックの指（src/history/edgeFlick.ts）は、横にスクロールできる所・範囲（スライダー）の上と、
//   フォーカスのある入力欄（カーソル・字を選ぶつまみがある）の上から押した物だけを数えない（edgeFlickBlocked）。フォーカスの無い入力欄
//   （登録・詳細の画面の件名・メモの欄は、画面の端から 16px ほどまで届く）の上から押した指は、端からのフリックに数える（開発。端を
//   甘くする。22. の「端からのフリックの3回目の直した版（788e842）を試した答え」）。フォーカスの無い欄へは、押して動かさずに離した時
//   （押した物の click）にフォーカスが移るので、払う指ではカーソルも字を選ぶつまみも出ない

/** 文字・値を打つ・選ぶ欄でない input の種類（押すだけの物。この上から押してもなぞれる） */
const PRESS_ONLY_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'color', 'file', 'hidden'])

/** 文字・値を打つ・選ぶ欄か（入力欄・複数行・選ぶ欄・範囲・書ける要素） */
export function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return el instanceof HTMLInputElement && !PRESS_ONLY_INPUTS.has(el.type)
}

/** 横にスクロールできる所か（中身が横にはみ出していて、overflow-x が auto・scroll） */
function scrollsSideways(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false
  const x = getComputedStyle(el).overflowX
  return x === 'auto' || x === 'scroll'
}

/** 押した所から root まで（root は含めない）に、横に動かす物（文字を打つ欄・横にスクロールできる所）があるか */
export function needsSideways(target: EventTarget | null, root: Element): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (isTextEntry(el)) return true
    if (scrollsSideways(el)) return true
  }
  return false
}

/**
 * 画面の端からのフリックで、押した所から root まで（root は含めない）に数えない訳があるか: 横にスクロールできる所・範囲
 * （スライダー。フォーカスが無くても横に動かす）は 'sideways'、フォーカスのある入力欄（active がその欄。書ける要素は、active が押した
 * 所を含む）は 'focused'。無ければ null（フォーカスの無い入力欄の上も null）
 */
export function edgeFlickBlocked(
  target: EventTarget | null,
  root: Element,
  active: Element | null,
): 'sideways' | 'focused' | null {
  const pressed = target instanceof Node ? target : null
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (isTextEntry(el)) {
      if (el instanceof HTMLInputElement && el.type === 'range') return 'sideways'
      if (active === el || (isTextEntry(active) && pressed && active?.contains(pressed))) return 'focused'
    }
    if (scrollsSideways(el)) return 'sideways'
  }
  return null
}
