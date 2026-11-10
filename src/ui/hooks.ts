// 画面の小さな共通のフック。NS の src/ui/hooks.ts から（原稿の比較の分割の向き useSplitOrientation は DS に無いので外し、
// 幅の区分を DS の S・M・L にした。docs/SPEC.md の 3.2・4.11）
import { useEffect, useState } from 'react'

/** 幅の区分（docs/SPEC.md の 3.2）。S は 600px 未満（スマホ）、M は 600〜899px、L は 900px 以上（PC） */
export type WidthClass = 'S' | 'M' | 'L'
/** M の始まりの幅。src/styles.css の @media（max-width: 599px）と同じ値にする */
export const WIDTH_M = 600
/** L の始まりの幅。src/styles.css の @media（max-width: 899px）と同じ値にする */
export const WIDTH_L = 900

/** 画面の幅から幅の区分を決める */
export function widthClassOf(width: number): WidthClass {
  if (width >= WIDTH_L) return 'L'
  if (width >= WIDTH_M) return 'M'
  return 'S'
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 今の幅の区分（向きを変えた・ウインドウの幅を変えた時はすぐに変わる） */
export function useWidthClass(): WidthClass {
  const l = useMediaQuery(`(min-width: ${WIDTH_L}px)`)
  const m = useMediaQuery(`(min-width: ${WIDTH_M}px)`)
  return l ? 'L' : m ? 'M' : 'S'
}

/** スマホの幅（S） */
export function useIsMobile(): boolean {
  return !useMediaQuery(`(min-width: ${WIDTH_M}px)`)
}

/** ドキュメントタイトルを設定する */
export function useDocumentTitle(title: string | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} — Diary Studio` : 'Diary Studio'
  }, [title])
}
