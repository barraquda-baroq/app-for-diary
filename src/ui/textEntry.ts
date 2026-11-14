// 押した所が、横に動かす物（文字を打つ・選ぶ欄、横にスクロールできる所）の上か（docs/SPEC.md の 3.1・3.7）。その上から押した指は、
// なぞって前後の期間へ移る指（src/features/calendar/common/useSwipe.ts）にも、iPhone・iPad の画面の端からのフリックの指
// （src/history/edgeFlick.ts）にも数えない（字を選ぶ・カーソルを動かす・横にスクロールする指）

/** 文字・値を打つ・選ぶ欄でない input の種類（押すだけの物。この上から押してもなぞれる） */
const PRESS_ONLY_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'color', 'file', 'hidden'])

/** 文字・値を打つ・選ぶ欄か（入力欄・複数行・選ぶ欄・範囲・書ける要素） */
export function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return el instanceof HTMLInputElement && !PRESS_ONLY_INPUTS.has(el.type)
}

/** 押した所から root まで（root は含めない）に、横に動かす物（文字を打つ欄・横にスクロールできる所）があるか */
export function needsSideways(target: EventTarget | null, root: Element): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (isTextEntry(el)) return true
    if (el.scrollWidth > el.clientWidth + 1) {
      const x = getComputedStyle(el).overflowX
      if (x === 'auto' || x === 'scroll') return true
    }
  }
  return false
}
