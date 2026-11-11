// 画面の小さな共通のフック。NS の src/ui/hooks.ts から（原稿の比較の分割の向き useSplitOrientation は DS に無いので外し、
// 幅の区分を DS の S・M・L にした。docs/SPEC.md の 3.2・4.11）
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { msUntilNextDay, sameDay, todayYmd, type Ymd } from '../domain/dates'

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

/**
 * マウスなどで「上に載せる」ができる端末か（(hover: hover) and (pointer: fine)）。ウィークリーの「＋」の行は、この時だけ
 * 上に載せた（・フォーカスした）時に出し、指の端末ではいつも出す（D43）
 */
export function useHoverCapable(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
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

/**
 * 今日（端末の暦の日付。docs/SPEC.md の 6.4・7.3）。PWA を開いたまま 0時を過ぎても今日の印・ログインの画面の日付が前の日のままに
 * ならないよう、次の 0時にタイマーで計算し直し、画面が見えるようになった時（visibilitychange）・フォーカスが戻った時にも計算し直す
 * （裏にある間はタイマーが遅れることがあるため）。日付が変わった時だけ描き直す。
 * 段階2で、ルーチンの戻り・締め切りを過ぎた色・裏から戻った時に見ている期間を移す決まり（6.4）もこれに乗せる
 */
export function useToday(): Ymd {
  const [today, setToday] = useState(() => todayYmd())
  useEffect(() => {
    let timer = 0
    const refresh = () => {
      const now = todayYmd()
      setToday((prev) => (sameDay(prev, now) ? prev : now))
      window.clearTimeout(timer)
      // 0時の少し後に（タイマーが少し早く来ても、前の日のまま次の日を待たないように）
      timer = window.setTimeout(refresh, msUntilNextDay() + 1000)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return today
}

/**
 * 今の時刻（ミリ秒）。ms ごと（既定は 1分。時計の分の変わり目にそろえる）に描き直す。画面が見えるようになった時にも計算し直す
 * （裏にある間はタイマーが遅れるため）。デイリーの今の時刻の線（11.3）に使う
 */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer = 0
    const tick = () => {
      const t = Date.now()
      setNow(t)
      window.clearTimeout(timer)
      timer = window.setTimeout(tick, ms - (t % ms))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    timer = window.setTimeout(tick, ms - (Date.now() % ms))
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms])
  return now
}

/** 要素の大きさ（px。中身の箱 contentRect） */
export interface ElementSize {
  width: number
  height: number
}

/**
 * 要素の大きさ（ResizeObserver で測る。要素が無い間は 0×0）。CSS の幅の区分（599/600/899/900px）とは別に、領域の幅で決める所
 * （イヤーの 870px・ウィークリーの列の 120px。D53）に使う。大きさが変わった時だけ描き直す
 */
export function useElementSize(ref: RefObject<Element | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (width: number, height: number) =>
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    const rect = el.getBoundingClientRect()
    update(rect.width, rect.height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect
      if (box) update(box.width, box.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** 要素の幅（px。useElementSize の幅） */
export function useElementWidth(ref: RefObject<Element | null>): number {
  return useElementSize(ref).width
}
