// 要素を、それを入れたスクロールする所（カレンダー・小さな画面の中の、overflow が auto・scroll の箱）の中で見える所まで出す。
// scrollIntoView({ block: 'nearest', inline: 'nearest' }) と同じ決め方（もう見えている時は動かさない。見える所より大きい時は近い方の
// 端をそろえる）だが、ページ（window・document）は動かさない。
// scrollIntoView はページも含めたスクロールする親を全部動かすので、S・M のウィークリー・デイリー（カレンダーの区切りの高さは
// 100dvh − ヘッダー − 切り替えの列。ページのいちばん上では、上の余白の分だけ区切りの下の端が画面の下に出ている。3.5・D15）で、
// 下の端の近くの物を出すとページが数 px 動いていた（ドラッグで落とした後にページが動かないこと。WP11s の G4・7.11）。
// - 画面の外（下の端より下など）にはみ出した所は見えないので、箱の中の、画面に入っている所の中へ出す（箱の中で送れる所まで）。
//   上に固定したヘッダー・切り替えの列の下は見込まない（S・M でページを送り、カレンダーの上の方がその下に入っている時だけ隠れる
//   ことがある。今の作りの限界。docs/SPEC.md の 4.9）
// - 中の箱から順に動かし、外の箱は中の箱を動かした後の位置で決める（入れ子の段の中・7日を横の横スクロールなど）
// - overflow が hidden・visible の向きは動かさない（字を切るための hidden の箱をずらさない）
// - 位置の決まった（position: fixed）箱より外は動かしても要素が動かないので、そこで止める（下からのシート・小窓）
// - 要素の scroll-margin と箱の scroll-padding は scrollIntoView と同じく見込む
// - bottomInset を渡すと、画面の下の端からその高さは見える所に数えない（下に重なるお知らせ。toastInset）。箱の中で送れる所までなので、
//   箱の終わりの近くの物はお知らせの下に残ることがある（docs/SPEC.md の 4.9）
// - isShownWithin は、同じ決め方で、もう見える所に入っているか（送らなくてよいか）を見る（元に戻す・やり直すで当てた所が見えている
//   時だけ、開いているすばやく足すの入力欄をお知らせの上へ送る。7.13・■26）
import { scrollBehavior } from './motion'

export interface ScrollWithinOptions {
  /** なめらかに動かすか（既定は src/ui/motion.ts の scrollBehavior。視差効果を減らす設定ではすぐに） */
  behavior?: ScrollBehavior
  /** 画面の下の端からこの高さ（px）は、上に重なる物（お知らせ）があるので見える所に数えない（既定 0） */
  bottomInset?: number
}

/** お知らせとその上に出す物の間 */
const TOAST_GAP = 8

/** スクロールできる向きの overflow */
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/** これより小さいずれは無いことにする（足し引きの誤差） */
const EPSILON = 0.01

/** ページそのもの（動かさない物） */
function isPage(el: Element): boolean {
  return el === document.documentElement || el === document.body || el === document.scrollingElement
}

const px = (v: string) => Number.parseFloat(v) || 0

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * 動かす量を、0 から遠い方の整数にする（ブラウザはスクロールの位置を整数の px にそろえることがあり、10.42px 送ると 10px になって
 * 0.42px 切れたままになるので）。ごく小さいずれは 0
 */
const roundOut = (v: number) => (Math.abs(v) < EPSILON ? 0 : v > 0 ? Math.ceil(v) : Math.floor(v))

/**
 * 1つの向きの 'nearest' で動かす量（CSSOM View の scrollIntoView と同じ決まり）。start・end は要素の端、lo・hi は見える所の端。
 * 正なら先（下・右）へ送る。もう全部見えている時・見える所より大きくて両側にはみ出している時は 0
 */
export function nearestDelta(start: number, end: number, lo: number, hi: number): number {
  if (start >= lo && end <= hi) return 0
  if (start < lo && end > hi) return 0
  const fits = end - start <= hi - lo
  if (start < lo) return fits ? start - lo : end - hi
  return fits ? end - hi : start - lo
}

/** 画面（レイアウトの表示領域）の高さと幅（測れない時は 0） */
function viewport(): { width: number; height: number } {
  const root = document.documentElement
  return { width: root.clientWidth || window.innerWidth || 0, height: root.clientHeight || window.innerHeight || 0 }
}

/** 見える所 [lo, hi] を画面の [0, size] の中に狭める（画面と重ならない時は狭めない） */
function onScreen(lo: number, hi: number, size: number): [number, number] {
  if (!(size > 0)) return [lo, hi]
  const a = Math.max(lo, 0)
  const b = Math.min(hi, size)
  return b > a ? [a, b] : [lo, hi]
}

function scrollBox(el: Element, left: number, top: number, behavior: ScrollBehavior): void {
  if (typeof el.scrollTo === 'function') el.scrollTo({ left, top, behavior })
  else {
    el.scrollLeft = left
    el.scrollTop = top
  }
}

/** el を、それを入れたスクロールする所の中で見える所まで出す（ページは動かさない） */
export function scrollIntoViewWithin(el: Element | null | undefined, opts: ScrollWithinOptions = {}): void {
  if (!el?.isConnected) return
  const behavior = opts.behavior ?? scrollBehavior()
  const r = el.getBoundingClientRect()
  const m = getComputedStyle(el)
  // 要素の箱（scroll-margin を含める）。中の箱を動かした分だけずらしながら、外の箱と比べる
  let top = r.top - px(m.scrollMarginTop)
  let bottom = r.bottom + px(m.scrollMarginBottom)
  let left = r.left - px(m.scrollMarginLeft)
  let right = r.right + px(m.scrollMarginRight)
  const screen = viewport()
  /** 縦に見える所の下の端（画面の下の端から bottomInset を除く。測れない時・除くと残らない時は 0 = 画面で狭めない） */
  const screenBottom = Math.max(screen.height - (opts.bottomInset ?? 0), 0)
  for (let p = el.parentElement; p && !isPage(p); p = p.parentElement) {
    const cs = getComputedStyle(p)
    const canY = SCROLLS.has(cs.overflowY) && p.scrollHeight > p.clientHeight
    const canX = SCROLLS.has(cs.overflowX) && p.scrollWidth > p.clientWidth
    if (canY || canX) {
      const b = p.getBoundingClientRect()
      const boxTop = b.top + p.clientTop
      const boxLeft = b.left + p.clientLeft
      let dy = 0
      let dx = 0
      if (canY) {
        const [lo, hi] = onScreen(
          boxTop + px(cs.scrollPaddingTop),
          boxTop + p.clientHeight - px(cs.scrollPaddingBottom),
          screenBottom,
        )
        dy = clamp(roundOut(nearestDelta(top, bottom, lo, hi)), -p.scrollTop, p.scrollHeight - p.clientHeight - p.scrollTop)
      }
      if (canX) {
        const [lo, hi] = onScreen(
          boxLeft + px(cs.scrollPaddingLeft),
          boxLeft + p.clientWidth - px(cs.scrollPaddingRight),
          screen.width,
        )
        dx = clamp(roundOut(nearestDelta(left, right, lo, hi)), -p.scrollLeft, p.scrollWidth - p.clientWidth - p.scrollLeft)
      }
      if (dx || dy) {
        scrollBox(p, p.scrollLeft + dx, p.scrollTop + dy, behavior)
        top -= dy
        bottom -= dy
        left -= dx
        right -= dx
      }
    }
    if (cs.position === 'fixed') break
  }
}

/**
 * el が、それを入れたスクロールする所と画面の中で、もう見える所に入っているか（scrollIntoViewWithin が送らない時。見える所より大きくて
 * 両側にはみ出している物も入っているとする）。スクロールする箱の中で少しでも切れている物（画面の下の端で切れている物も）は見えて
 * いない。スクロールしない箱の中の物は、画面の外へ全部出ている時（S・M でページを下のリストまで送った時のカレンダー）だけ見えて
 * いない（ページは動かさないので、送っても変わらない）。上に固定したヘッダーの下と、お知らせの下は見込まない
 */
export function isShownWithin(el: Element | null | undefined): boolean {
  if (!el?.isConnected) return false
  const r = el.getBoundingClientRect()
  // 大きさを測れない（描いていない所・jsdom）時は見えているとする
  if (r.width === 0 && r.height === 0) return true
  const m = getComputedStyle(el)
  const top = r.top - px(m.scrollMarginTop)
  const bottom = r.bottom + px(m.scrollMarginBottom)
  const left = r.left - px(m.scrollMarginLeft)
  const right = r.right + px(m.scrollMarginRight)
  const screen = viewport()
  for (let p = el.parentElement; p && !isPage(p); p = p.parentElement) {
    const cs = getComputedStyle(p)
    const canY = SCROLLS.has(cs.overflowY) && p.scrollHeight > p.clientHeight
    const canX = SCROLLS.has(cs.overflowX) && p.scrollWidth > p.clientWidth
    if (canY || canX) {
      const b = p.getBoundingClientRect()
      const boxTop = b.top + p.clientTop
      const boxLeft = b.left + p.clientLeft
      if (canY) {
        const [lo, hi] = onScreen(
          boxTop + px(cs.scrollPaddingTop),
          boxTop + p.clientHeight - px(cs.scrollPaddingBottom),
          screen.height,
        )
        if (roundOut(nearestDelta(top, bottom, lo, hi)) !== 0) return false
      }
      if (canX) {
        const [lo, hi] = onScreen(
          boxLeft + px(cs.scrollPaddingLeft),
          boxLeft + p.clientWidth - px(cs.scrollPaddingRight),
          screen.width,
        )
        if (roundOut(nearestDelta(left, right, lo, hi)) !== 0) return false
      }
    }
    if (cs.position === 'fixed') break
  }
  // スクロールする箱の外（ページ）は動かさないので、画面と重なっていれば見えているとする（画面の外へ全部出ていれば見えていない。
  // 画面を測れない時は見えているとする）
  if (screen.height > 0 && (r.bottom <= 0 || r.top >= screen.height)) return false
  return !(screen.width > 0 && (r.right <= 0 || r.left >= screen.width))
}

/**
 * 画面の下に出ているお知らせ（src/ui/Layout.tsx の .toasts。3.9）が el と横に重なる時の、お知らせの上の端から画面の下の端までの
 * 高さに、すき間 8px を足した物（scrollIntoViewWithin の bottomInset。出ていない・重ならない・上に出している時は 0）。ドラッグで
 * 落とした時の「〜へ移しました［元に戻す］」は 6秒出るので、移した物をその下に出すと、目立たせる 1.2秒の間も見えない（7.11）
 */
export function toastInset(el: Element): number {
  const toasts = document.querySelector('.toasts')
  if (!toasts || toasts.childElementCount === 0) return 0
  const t = toasts.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const { height } = viewport()
  // 小さな画面を開いている間は上に出す（その時は下を空けない）
  if (!(height > 0) || t.height === 0 || t.top < height / 2 || t.top >= height) return 0
  if (r.right <= t.left || r.left >= t.right) return 0
  return height - t.top + TOAST_GAP
}
