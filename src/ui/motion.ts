// 動きの共通の決まり（docs/SPEC.md の 4.9）。端末の「視差効果を減らす」（prefers-reduced-motion: reduce）では、
// scrollTo・scrollIntoView のなめらかなスクロールをやめて、すぐに移る。
// 目立たせる枠（.flash）・ロック中の揺れ（.shake）・その代わりのロックの印の色（.lock-accent）も、ここで JS で付け外しする
// （CSS の動きは視差効果を減らす設定で全部止まるので、知らせの役目の物は付けた側が時間で外す。FRAME-236・237）

/** 端末で「視差効果を減らす」を選んでいる */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** scrollTo・scrollIntoView の behavior（視差効果を減らす設定では 'auto'、ふだんは 'smooth'） */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

/** 目立たせる枠を出す時間（最後の 400ms で薄くなる。src/styles.css の --dur-flash と同じ） */
export const FLASH_MS = 1200
/** ロック中で掴めない時の揺れ（左右に 3px を3回。--dur-shake と同じ） */
export const SHAKE_MS = 240
/** 視差効果を減らす設定で、揺らす代わりにロックの印を --accent にする時間 */
export const LOCK_ACCENT_MS = 600

/** 要素ごと・クラスごとの「外す」タイマー */
const timers = new WeakMap<Element, Map<string, number>>()

/** クラスを付け、ms 後に外す。付いている間にもう一度呼ぶと、動きを最初からやり直して時間も数え直す */
function pulseClass(el: Element, name: string, ms: number): void {
  let own = timers.get(el)
  if (!own) {
    own = new Map()
    timers.set(el, own)
  }
  const running = own.get(name)
  if (running !== undefined) {
    window.clearTimeout(running)
    // 一度外して組み直させると、CSS の動きが最初から始まる
    el.classList.remove(name)
    void (el as HTMLElement).offsetWidth
  }
  el.classList.add(name)
  own.set(
    name,
    window.setTimeout(() => {
      el.classList.remove(name)
      own.delete(name)
    }, ms),
  )
}

/**
 * 移った先・押した区切りを目立たせる（地の色は変えず 2px の --accent の枠を 1.2秒。最後の 400ms で薄くする。FRAME-231）。
 * 視差効果を減らす設定では CSS の動きが止まるので、薄くならずに 1.2秒出て消える（FRAME-236）
 */
export function flash(el: Element | null | undefined): void {
  if (el) pulseClass(el, 'flash', FLASH_MS)
}

/**
 * ロック中で掴めない時に揺らす（240ms。FRAME-232）。視差効果を減らす設定では揺らさず、ロックの印（lockIcon。無ければ el）を
 * 600ms だけ --accent の色にする（.lock-accent。FRAME-235）
 */
export function shake(el: Element | null | undefined, lockIcon?: Element | null): void {
  if (!el) return
  if (prefersReducedMotion()) pulseClass(lockIcon ?? el, 'lock-accent', LOCK_ACCENT_MS)
  else pulseClass(el, 'shake', SHAKE_MS)
}

/** 指でカードを掴めた時の短い振動（15ms。対応する端末だけ。docs/SPEC.md の 7.11） */
export function vibrate15(): void {
  try {
    navigator.vibrate?.(15)
  } catch {
    /* 振動できない端末では何もしない */
  }
}
