// 3つのリストの行の中で直している欄（その場の直し: Task List の件名・L の行の依頼者、Routine List の件名、Favorite List の本文）の
// 「やめる」（Esc と同じ。保存せずに元に戻して閉じる）を、欄ごとに届ける所（docs/SPEC.md の 3.1・22. の ■36）。iPhone・iPad で、
// 直している間（欄にフォーカスがある間）に端からのフリックが来た時に、src/features/top/typingCancel.ts が、フォーカスのある欄の物を
// 呼ぶ（入力をやめるだけで、リストは畳まない・モードは替えない）。届けるのは common/useInlineEdit（直している間）と
// task/RequesterInput（出している間）

/** 欄ごとの、やめる関数 */
const cancels = new Map<Element, () => void>()

/** 欄 el を出している間、やめる関数を届ける（戻り値で外す） */
export function registerFieldCancel(el: Element, cancel: () => void): () => void {
  cancels.set(el, cancel)
  return () => {
    if (cancels.get(el) === cancel) cancels.delete(el)
  }
}

/** 欄 el のやめる関数（届いていなければ undefined） */
export function fieldCancelOf(el: Element): (() => void) | undefined {
  return cancels.get(el)
}
