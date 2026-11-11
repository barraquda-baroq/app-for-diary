// 入力欄の高さを中身に合わせて伸ばす（件名の欄・メモ。docs/SPEC.md の 12.2「自動で高さが伸びる入力欄・4行から」）。
// rows で決めた高さより低くはしない（scrollHeight は rows の高さ以上なので、そのまま使えば良い）。中身が変わるたびと、
// 幅が変わった時（折り返しの数が変わる）に測り直す
import { useLayoutEffect, type RefObject } from 'react'

/** 中身が全部見える高さにする（枠線の分を足す。box-sizing は border-box） */
export function fitHeight(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  // 描いていない（display: none の中など）時は測れないので、CSS の高さ（rows）のままにする
  if (el.scrollHeight === 0) return
  const border = el.offsetHeight - el.clientHeight
  el.style.height = `${el.scrollHeight + border}px`
}

export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (el) fitHeight(el)
  }, [ref, value])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      // 高さを変えると、また知らせが来るので、幅が変わった時だけ測り直す
      if (el.clientWidth === width) return
      width = el.clientWidth
      fitHeight(el)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
}
