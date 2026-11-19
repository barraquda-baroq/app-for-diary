// iPhone・iPad で打っている間の端からのフリック（typingCancel.ts。docs/SPEC.md の 3.1・22. の ■36 の作者の答え「画面の上下移動も
// なし」）で入力をやめると、打ちかけを捨てたリストの入力欄・やめた行の中の直しの欄は、伸びていた分だけ縮む。その欄が見える所の上の端
// より上にはみ出していると、欄より下の物が縮んだ分だけ上がり、見えている物が上へ動いてしまう。Chromium はスクロールの錨
// （overflow-anchor）でページの位置を替えて見えている物を保つが、iPhone・iPad の WebKit には錨が無いので、アプリで保つ:
// - やめる前に measureKeep（欄）で目印を選んで上の端を控え、やめて描き直した後・描く前に、返された関数を呼ぶ。目印が動いていれば、
//   その分だけすぐ（なめらかにせず）スクロールして元の所へ戻す。ブラウザがもう保っていれば（Chromium の錨）、目印は動いていないので
//   送らない（ブラウザが保ちきらなかった残りの分だけ送る）
// - 欄の上の端が見える所の上の端より下（全部見えている）なら何もしない（縮んでも、欄より上の見えている物は動かない。今までどおり、
//   アプリはスクロールしない）
// - 見える所: 欄を入れたいちばん近いスクロールする所（L は右の列 .top-side）の中。無ければページで、その上の端は上に固定したヘッダーと
//   S・M の切り替えの列の下
// - 目印: 欄の箱（リストの入力欄は下のチップも入れた入力の箱、行の中の直しはその行）より後ろの物のうち、見える所の上の端（欄の箱の
//   下の端の方が下ならそこ）より下まで届く、文書の順でいちばん初めの物（欄の箱の中の物・やめて外れる物は選ばない）。欄の箱が見える
//   所の下の端まで届く時（欄より後ろが見えていない）は何もしない

/** 縦にスクロールできる overflow */
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/** 目印が動いたとみなす差（px。これ以下の違い（丸めなど）では送らない） */
export const KEEP_MIN_PX = 0.5

/** 目印を探す時に見る物の数の上限 */
const MAX_LOOK = 5000

/** 見える所（スクロールする所。ページは null）と、その上下の端（画面の上から） */
interface View {
  scroller: HTMLElement | null
  top: number
  bottom: number
}

/** 欄を入れたいちばん近いスクロールする所の見える所（無ければページの、ヘッダーと切り替えの列の下から画面の下の端まで） */
function viewOf(field: HTMLElement): View {
  for (let p = field.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (SCROLLS.has(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) {
      const top = p.getBoundingClientRect().top + p.clientTop
      return { scroller: p, top, bottom: top + p.clientHeight }
    }
  }
  let top = 0
  for (const bar of document.querySelectorAll('.app-header, .top-switcher'))
    top = Math.max(top, bar.getBoundingClientRect().bottom)
  return { scroller: null, top, bottom: window.innerHeight }
}

/** 欄の箱（リストの入力欄は下のチップも入れた入力の箱、行の中の直しはその行。どちらでもなければ欄） */
function holderOf(field: HTMLElement): HTMLElement {
  return field.closest<HTMLElement>('.list-input-box, .list-row') ?? field
}

/** root の中で holder より後ろ（holder の中を除く）の物のうち、line より下まで届く、文書の順でいちばん初めの物 */
function markAfter(holder: HTMLElement, root: Element, line: number): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  walker.currentNode = holder
  // holder の後ろの兄弟か、親（の親…）の後ろの兄弟から（holder の中は見ない）
  let node = walker.nextSibling()
  while (!node && walker.parentNode()) node = walker.nextSibling()
  for (let i = 0; node && i < MAX_LOOK; i += 1, node = walker.nextNode()) {
    if (!(node instanceof HTMLElement)) continue
    const r = node.getBoundingClientRect()
    if (r.bottom > line && (r.width > 0 || r.height > 0)) return node
  }
  return null
}

/**
 * 打っている欄 field をやめる前に呼ぶ（上の決まり）: 欄が見える所の上の端より上にはみ出していれば、目印を選んで上の端を控え、やめて
 * 描き直した後（描く前）に呼ぶ関数を返す。その関数は、目印が動いた分だけすぐスクロールして戻し、動いた px を返す（上へ動いたら負。
 * 動いていない・目印が外れた時は 0）。はみ出していない・目印が無い時は null
 */
export function measureKeep(field: HTMLElement): (() => number) | null {
  const view = viewOf(field)
  if (field.getBoundingClientRect().top >= view.top) return null
  const holder = holderOf(field)
  const box = holder.getBoundingClientRect()
  if (box.bottom >= view.bottom) return null
  const root = view.scroller ?? field.closest('main') ?? document.body
  const mark = markAfter(holder, root, Math.max(view.top, box.bottom))
  if (!mark) return null
  const before = mark.getBoundingClientRect().top
  return () => {
    if (!mark.isConnected) return 0
    const moved = mark.getBoundingClientRect().top - before
    if (Math.abs(moved) <= KEEP_MIN_PX) return 0
    const { scroller } = view
    if (scroller) scroller.scrollTo({ top: scroller.scrollTop + moved, behavior: 'auto' })
    else window.scrollTo({ top: window.scrollY + moved, behavior: 'auto' })
    return moved
  }
}
