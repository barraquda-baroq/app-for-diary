// iPhone の画面キーボードに隠れる高さ（docs/SPEC.md の 2.7・FRAME-086・ITEMS-191）。NS の src/features/piece/keyboardInset.ts から、
// アプリ（Capacitor）から届く高さ（--kb-native）と原稿の欄の処理を外し、DS の CSS 変数 --kb に入れるようにした物。
// Android Chrome はキーボードの分だけ画面（レイアウトの表示領域）が縮むので 0 のまま。iOS は画面が縮まず、見えている範囲
// （visualViewport）だけが縮むので、その差を --kb に入れる。下からのシート・お知らせ・メニューは bottom: var(--kb) で
// キーボードの上に収まる（src/styles.css）。入力欄にフォーカスしている時は、その欄がキーボードの上 16px に来るまでスクロールする
// （キーボードの上のお知らせと重なる時は、その上まで）
import { useEffect } from 'react'
import { scrollBehavior } from './motion'
import { toastEdge } from './scrollWithin'

/** 拡大している時（ピンチ）は測らない */
const MAX_SCALE = 1.01
/** 入力欄とキーボードの間 */
export const KEYBOARD_GAP = 16

/**
 * layoutHeight（レイアウトの表示領域の高さ）のうち、見えている範囲（visualViewport）より下に隠れている高さ。
 * iOS ではキーボードを出しても innerHeight が変わらない版と見えている高さになる版があるので、
 * 呼ぶ側は innerHeight と documentElement.clientHeight の大きい方を渡す
 */
export function keyboardInset(layoutHeight: number, vv: { height: number; offsetTop: number; scale: number }): number {
  if (vv.scale > MAX_SCALE) return 0
  return Math.max(0, Math.round(layoutHeight - vv.height - vv.offsetTop))
}

/** 今のキーボードの高さ（visualViewport が無い所では 0） */
export function currentKeyboardInset(): number {
  const vv = window.visualViewport
  if (!vv) return 0
  return keyboardInset(Math.max(window.innerHeight, document.documentElement.clientHeight), vv)
}

/** 文字を打つ欄か（入力欄・複数行の欄・選ぶ欄・書ける要素） */
function isTypingField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  return el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(el.type)
}

/** いちばん近いスクロールする親（無ければページ） */
function scrollParent(el: HTMLElement): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return document.scrollingElement
}

/**
 * 入力欄がキーボードの上 16px より下に隠れていたら、見える所までスクロールする。キーボードの上に画面の下のお知らせ（［OK］まで出す
 * 「元に戻しました：…」など。3.9）が出ていて欄と横に重なる時は、お知らせの上の端の 8px 上まで（toastEdge。4.9・■26）
 */
export function revealAboveKeyboard(el: HTMLElement): void {
  const vv = window.visualViewport
  if (!vv) return
  const edge = toastEdge(el)
  const limit = Math.min(vv.offsetTop + vv.height - KEYBOARD_GAP, edge ?? Number.POSITIVE_INFINITY)
  const over = el.getBoundingClientRect().bottom - limit
  if (over <= 0) return
  scrollParent(el)?.scrollBy({ top: over, behavior: scrollBehavior() })
}

/** キーボードの高さを <html> の --kb に入れ続ける（アプリの外枠 AppFrame で1回だけ使う） */
export function useKeyboardInset(): void {
  useEffect(() => {
    const root = document.documentElement
    let frame = 0
    let last = -1
    const apply = () => {
      const inset = currentKeyboardInset()
      if (inset === last) return
      last = inset
      root.style.setProperty('--kb', `${inset}px`)
      // キーボードが出た・高さが変わった時、打っている欄が隠れたら見える所まで送る（シートが持ち上がった後に測る）
      const active = document.activeElement
      if (inset > 0 && isTypingField(active)) requestAnimationFrame(() => revealAboveKeyboard(active))
    }
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(apply)
    }
    // キーボードが出たまま別の欄へ移った時
    const onFocus = (e: FocusEvent) => {
      if (last > 0 && isTypingField(e.target as Element)) revealAboveKeyboard(e.target as HTMLElement)
    }
    apply()
    // 測る相手は毎回 window.visualViewport から読む（テストで高さを差し替えて resize を送れるように）
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    document.addEventListener('focusin', onFocus)
    return () => {
      cancelAnimationFrame(frame)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.removeEventListener('focusin', onFocus)
      root.style.removeProperty('--kb')
    }
  }, [])
}
