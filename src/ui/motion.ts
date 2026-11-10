// 動きの共通の決まり（docs/SPEC.md の 4.9）。端末の「視差効果を減らす」（prefers-reduced-motion: reduce）では、
// scrollTo・scrollIntoView のなめらかなスクロールをやめて、すぐに移る。
// 段階2・3で、目立たせる枠（.flash）・ロック中の揺れ（.shake）を JS で付け外しする処理もここに足す

/** 端末で「視差効果を減らす」を選んでいる */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** scrollTo・scrollIntoView の behavior（視差効果を減らす設定では 'auto'、ふだんは 'smooth'） */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
