// 3つのリストの自動で高さが伸びる欄（Task List・Favorite List の入力欄、Favorite List の本文のその場の直し。docs/SPEC.md の 13.2・15.1・
// 15.2・3.6）。中身に合わせて伸ばし（item/fields/useAutoGrow の fitHeight）、CSS の高さの上限（common/lists.css の .list-input・
// .list-grow の max-height。6行ほど）まで伸びたら、その後は欄の中でスクロールする（開発）。スマホでキーボードが出ていても、欄の右上の
// ［足す］（✓）と打っているカーソルが見える所に残る（360px のスマホでも、ヘッダー・切り替えの列とキーボードの間に収まる高さ）。
// 打つたびと、幅が替わった時（折り返しの数が替わる）に測り直す。欄に付ける ref を返す（欄を出したり消したりしても、付いた時に測る）
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { fitHeight } from '../../item/fields/useAutoGrow'

/** 中身に合わせた高さにし、上限を超えた分は欄の中でスクロールさせる（超えていない間はスクロールの棒を出さない） */
export function fitGrow(el: HTMLTextAreaElement): void {
  fitHeight(el)
  // 描いていない（display: none の中など）時は測れない
  if (el.scrollHeight === 0) return
  const max = Number.parseFloat(getComputedStyle(el).maxHeight)
  const full = el.scrollHeight + el.offsetHeight - el.clientHeight
  el.style.overflowY = Number.isFinite(max) && full > max + 1 ? 'auto' : 'hidden'
}

/** 欄に付ける ref（value は欄の今の字。替わるたびに測り直す） */
export function useGrowField(value: string): (el: HTMLTextAreaElement | null) => void {
  const field = useRef<HTMLTextAreaElement | null>(null)
  const observer = useRef<ResizeObserver | null>(null)

  const attach = useCallback((el: HTMLTextAreaElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    field.current = el
    if (!el) return
    fitGrow(el)
    if (typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const o = new ResizeObserver(() => {
      // 高さを変えると、また知らせが来るので、幅が変わった時だけ測り直す
      if (el.clientWidth === width) return
      width = el.clientWidth
      fitGrow(el)
    })
    o.observe(el)
    observer.current = o
  }, [])

  useLayoutEffect(() => {
    if (field.current) fitGrow(field.current)
  }, [value])

  useEffect(() => () => observer.current?.disconnect(), [])

  return attach
}
