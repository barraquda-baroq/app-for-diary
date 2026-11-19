// iPhone・iPad で打っている間の端からのフリック（typingCancel.ts。docs/SPEC.md の 3.1・22. の ■36 の作者の答え「画面の上下移動も
// なし」）で入力をやめると、打ちかけを捨てたリストの入力欄・やめた行の中の直しの欄・閉じて「＋」の行に戻るすばやく足すは、伸びていた
// 分だけ縮む。その欄が見える所の上の端より上にはみ出していると、欄より下の物が縮んだ分だけ上がり、見えている物が上へ動いてしまう。
// Chromium はスクロールの錨（overflow-anchor）でページの位置を替えて見えている物を保つが、iPhone・iPad の WebKit には錨が無いので、
// アプリで保つ:
// - やめる前に measureKeep（欄）で目印を選んで上の端を控え、やめて描き直した後・描く前に、返された関数を呼ぶ。目印が中身の中で動いた分
//   （ブラウザがスクロールの位置を替えた分は除く）だけ、すぐ（なめらかにせず）スクロールして元の所へ戻す。ブラウザがもう保っていれば
//   （Chromium の錨）、今の位置がもうそこなので送らない
// - 送るのは、縮んだ分のうち、欄の上の端が見える所の上の端より上に隠れていた分まで: 欄の上の端が少しだけ隠れていた時は、欄の上の端が
//   見える所の上の端に来るまで送るだけで、欄より上の物は下ろさない（縮んだ残りの分は、欄が全部見えている時と同じく下の物が上がって
//   くる。隠れていた分が縮んだ分より大きければ、下の物は動かない）
// - 欄の上の端が見える所の上の端より下（全部見えている）なら目印は選ばない（縮んでも、欄より上の見えている物は動かない。今までどおり、
//   アプリはスクロールしない）
// - S・M のページの終わりの近くで、縮んでページが短くなり、ブラウザが位置を上へ止め直した時（欄が全部見えていても）は、いちばん下の
//   空き（TopPage.tsx の top-stack-spacer。■34 で畳む時と同じ物）を足りない分だけ足して、位置を戻す（欄も欄より上の物も下りてこない。
//   空きは次に切り替えの列で飛んだ時に合わせ直す）
// - 見える所: 欄を入れたいちばん近いスクロールする所（L は右の列 .top-side、S の週は週の中）の中で、上に固定した物の分（その箱の
//   scroll-padding-top。S の週の名札の行）と、上に固定したヘッダー・切り替えの列の下。無ければページで、その上の端は上に固定した
//   ヘッダーと S・M の切り替えの列の下
// - 目印: 欄の箱（リストの入力欄は下のチップも入れた入力の箱、行の中の直しはその行、すばやく足すはその入力の行）より後ろの物のうち、
//   欄の箱の下の端より下から始まり、見える所の上の端（欄の箱の下の端の方が下ならそこ）より下まで届く、文書の順でいちばん初めの物。
//   欄の箱の中の物・やめて外れる物・欄の箱より上から始まる物や横に並んだ物（S の週の隣の半分など。縮んでも動かない）とその中・
//   上に固定した物は選ばない。欄の箱が見える所の下の端まで届く時（欄より後ろが見えていない）は選ばない

/** 縦にスクロールできる overflow */
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/** 目印に選ばない、決まった所に固定した物の position */
const FIXED = new Set(['fixed', 'sticky'])

/** 目印が動いた・位置が替わったとみなす差（px。これ以下の違い（丸めなど）では送らない） */
export const KEEP_MIN_PX = 0.5

/** 目印を探す時に見る物の数の上限 */
const MAX_LOOK = 5000

/** 見える所（スクロールする所。ページは null）と、その上下の端（画面の上から） */
interface View {
  scroller: HTMLElement | null
  top: number
  bottom: number
}

/** 見えている物を戻した時の、送った px（上へ送った（中身が下りた）時は負）と、ページの終わりで足した空きの px */
export interface Kept {
  moved: number
  space: number
}

const px = (v: string | undefined) => Number.parseFloat(v ?? '') || 0

/** 上に固定したヘッダーと S・M の切り替えの列の下の端（画面の上から。無ければ 0） */
function barsBottom(): number {
  let bottom = 0
  for (const bar of document.querySelectorAll('.app-header, .top-switcher'))
    bottom = Math.max(bottom, bar.getBoundingClientRect().bottom)
  return bottom
}

/** 欄を入れたいちばん近いスクロールする所の見える所（無ければページの、ヘッダーと切り替えの列の下から画面の下の端まで） */
function viewOf(field: HTMLElement): View {
  const bars = barsBottom()
  for (let p = field.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const style = getComputedStyle(p)
    if (SCROLLS.has(style.overflowY) && p.scrollHeight > p.clientHeight) {
      const top = p.getBoundingClientRect().top + p.clientTop
      return {
        scroller: p,
        top: Math.max(top + px(style.scrollPaddingTop), bars),
        bottom: Math.min(top + p.clientHeight, window.innerHeight),
      }
    }
  }
  return { scroller: null, top: bars, bottom: window.innerHeight }
}

/** 欄の箱（リストの入力欄は下のチップも入れた入力の箱、行の中の直しはその行、すばやく足すはその入力の行。どれでもなければ欄） */
function holderOf(field: HTMLElement): HTMLElement {
  return field.closest<HTMLElement>('.list-input-box, .list-row, .cp-quick') ?? field
}

/** スクロールの位置（スクロールする所。null はページ） */
const scrollOf = (scroller: HTMLElement | null) => (scroller ? scroller.scrollTop : window.scrollY)

/** ページのいちばん下の位置（いちばん下の空きの物と同じく、画面の高さは innerHeight） */
const maxPageScroll = () => document.documentElement.scrollHeight - window.innerHeight

/**
 * root の中で holder より後ろ（holder の中を除く）の物のうち、holder の箱 box の下の端より下から始まって横に重なり、line より下まで
 * 届く、文書の順でいちばん初めの物（上の決まり。箱より上から始まる物・横に並んだ物・固定した物は、その中も見ない）
 */
function markAfter(holder: HTMLElement, box: DOMRect, root: Element, line: number): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  walker.currentNode = holder
  /** 次に見る物（skip の時は今の物の中を飛ばして、後ろの兄弟か、親（の親…）の後ろの兄弟へ） */
  const next = (skip: boolean): Node | null => {
    if (!skip) {
      const child = walker.firstChild()
      if (child) return child
    }
    let node = walker.nextSibling()
    while (!node && walker.parentNode()) node = walker.nextSibling()
    return node
  }
  let node = next(true)
  for (let i = 0; node && i < MAX_LOOK; i += 1) {
    let skip = false
    if (node instanceof HTMLElement) {
      const r = node.getBoundingClientRect()
      if (r.width > 0 || r.height > 0) {
        if (r.top < box.bottom - KEEP_MIN_PX || r.right <= box.left || r.left >= box.right) skip = true
        else if (r.bottom > line) {
          if (!FIXED.has(getComputedStyle(node).position)) return node
          skip = true
        }
      }
    }
    node = next(skip)
  }
  return null
}

/**
 * 打っている欄 field をやめる前に呼ぶ（上の決まり）: 欄が見える所の上の端より上にはみ出していれば目印を選んで上の端を控え、やめて
 * 描き直した後（描く前）に呼ぶ関数を返す。その関数は、目印が中身の中で動いた分（隠れていた分まで）だけすぐスクロールして戻し、S・M の
 * ページの終わりでブラウザが位置を上へ止め直していれば、いちばん下の空きを足して戻す。送った時はその px と足した空きを返す（送らな
 * かった時は null）。目印が無く、ページの終わりの直しも無い所（スクロールする所の中）では null
 */
export function measureKeep(field: HTMLElement): (() => Kept | null) | null {
  const view = viewOf(field)
  const { scroller } = view
  const spacer = scroller ? null : document.querySelector<HTMLElement>('.top-stack-spacer')
  const before = scrollOf(scroller)
  const hidden = view.top - field.getBoundingClientRect().top
  let mark: HTMLElement | null = null
  let markTop = 0
  if (hidden > 0) {
    const holder = holderOf(field)
    const box = holder.getBoundingClientRect()
    if (box.bottom < view.bottom) {
      mark = markAfter(holder, box, scroller ?? field.closest('main') ?? document.body, Math.max(view.top, box.bottom))
      if (mark) markTop = mark.getBoundingClientRect().top
    }
  }
  if (!mark && !spacer) return null
  return () => {
    const now = scrollOf(scroller)
    let target: number
    if (mark?.isConnected) {
      // 目印が中身の中で動いた分（ブラウザがスクロールの位置を替えた分は除く）。縮んだ時は、隠れていた分まで
      const shift = mark.getBoundingClientRect().top + now - (markTop + before)
      target = before + (shift < 0 ? Math.max(shift, -hidden) : shift)
    } else {
      // 目印が無い: ページの終わりで、ブラウザが位置を上へ止め直した時だけ、元の位置へ
      if (!spacer || now >= before - KEEP_MIN_PX || now < maxPageScroll() - 1) return null
      target = before
    }
    if (Math.abs(target - now) <= KEEP_MIN_PX) return null
    let space = 0
    if (spacer && target > now) {
      const lack = target - maxPageScroll()
      if (lack > 0) {
        space = Math.ceil(lack)
        spacer.style.height = `${spacer.offsetHeight + space}px`
      }
    }
    if (scroller) scroller.scrollTo({ top: target, behavior: 'auto' })
    else window.scrollTo({ top: target, behavior: 'auto' })
    return { moved: target - now, space }
  }
}
