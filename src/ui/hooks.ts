// 画面の小さな共通のフック。NS の src/ui/hooks.ts から（原稿の比較の分割の向き useSplitOrientation は DS に無いので外し、
// 幅の区分を DS の S・M・L にした。docs/SPEC.md の 3.2・4.11）
import { useEffect, useState } from 'react'
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
