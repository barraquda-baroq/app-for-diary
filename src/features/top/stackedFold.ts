// S・M の積んだ所で、リストをページの位置を跳ばさずに畳む（docs/SPEC.md の 3.1・3.5・■34 の作者の答え「上まで戻さなくて良いです。
// リストから出るだけで構いません」）。■34 で、開いているリストを端からのフリック・OS の［戻る］で畳む時に使う口（呼ぶ所は
// src/features/top/listBack.ts の closeShownList で、打ちかけを捨てた後に呼ぶ。closeShownList は、履歴の決まり（src/history/popRules.ts
// の close-list）から src/App.tsx が置いた handlers.closeList として呼ばれる）。
// - そのリストを畳む（useStackedLists）。いちばん上のカレンダーへスクロールで戻さない: 畳んだリストの見出しの行が画面の中に残るように、
//   今の位置からいちばん近い所にとどめる（見出しが切り替えの列の下に隠れていれば、切り替えの列のすぐ下（切り替えの列で飛んだ時と同じ
//   所）まで戻すだけ。見えていれば動かさない。畳んで下の物が上がってきても、見出しはその所に残る）。ページの終わりが近くて、畳んで
//   縮んだ分だけブラウザが位置を上へ止め直してしまう時は、いちばん下の空き（切り替えの列で飛ぶ時と同じ top-stack-spacer）を足りない分
//   だけ足して、位置を動かさない（foldSpacerHeight。空きは次に切り替えの列で飛んだ時に合わせ直す）
// - フォーカスは、フォーカスがそのリストの中にあった時だけ、そのリストの見出しの畳む・開くボタンへ preventScroll で移す（カレンダーの
//   見出しへは移さない。iPhone のキーボードも閉じる。common/ListSection の releaseFocusBeforeFold）
// - 見ている所（切り替えの列で選ばれた物）は、畳んだ後のスクロールの位置で今までの決まりどおりに決め直す（切り替えで固定していた物は外す）
// - 履歴は動かさない。StackedTop を出していない（L・ほかの画面・S の全面の MIM）・そのリストをもう畳んでいる時は何もしない
// 区切りの id・固定の印・見ている所の決め直し・いちばん下の空きは StackedTop（TopPage.tsx）が持つので、StackedTop が出している間
// provideStackedFold で畳む関数を届ける
import type { ListKey } from '../../store/uiStore'

type Folder = (list: ListKey) => void

let folder: Folder | null = null

/** StackedTop が出している間、その場で畳む関数を届ける（戻り値で外す） */
export function provideStackedFold(fn: Folder): () => void {
  folder = fn
  return () => {
    if (folder === fn) folder = null
  }
}

/** そのリストをページの位置を跳ばさずに畳む（上の決まり。StackedTop が無ければ何もしない） */
export function foldListInPlace(list: ListKey): void {
  folder?.(list)
}

/**
 * 畳む前のスクロールの直し: 見出しの上の端（画面の上からの位置 top）が、見える所の上の端（margin。ヘッダーと切り替えの列の下）より上に
 * 隠れていれば、見出しをちょうどそこへ戻すページの位置（無ければ null。動かさない）
 */
export function foldScrollTop(top: number, margin: number, scrollY: number): number | null {
  if (top >= margin) return null
  return Math.max(0, scrollY + top - margin)
}

/**
 * 畳むと縮む高さ（lost。そのリストの中身の高さ）でページの終わりが近くなり、ブラウザが畳む前の位置（scrollY。見出しを戻した時は戻した
 * 位置）を上へ止め直してしまう時に、いちばん下の空きを何 px にするか（今の空き spacer に足りない分を足した高さ。足りている時は null）
 */
export function foldSpacerHeight(p: {
  scrollY: number
  scrollHeight: number
  innerHeight: number
  spacer: number
  lost: number
}): number | null {
  if (p.lost <= 0) return null
  const maxAfter = Math.max(0, p.scrollHeight - p.lost - p.innerHeight)
  if (p.scrollY <= maxAfter) return null
  return p.spacer + Math.ceil(p.scrollY - maxAfter)
}
