// 休みを付ける状態の帯（docs/SPEC.md の 9.5・3.10。D30）。操作の列のすぐ下に「休みを付ける: 日付を押すと休みが付いたり外れたりします
// ［終わる］」（地 --accent-soft・字 --accent-strong・高さ 36px）を出す。［終わる］と Esc で休みを付ける状態を終える。
// Esc は window の泡の段階で受け、ほかの部品が先に受けた物（preventDefault した物: すばやく足す・メニュー）と、document で
// 止めた物（stopPropagation: 上に開いた小さな画面。［＋ 登録］を開いたまま Esc を押すと、その画面だけを閉じる）と、日本語の変換を
// 取り消す Esc（isComposing。Safari は変換が終わってから keyCode 229 で届く）は見送る
import { useEffect, useRef } from 'react'
import { testIds } from '../common/testIds'
import './month.css'

/** 操作の列の［休み］へフォーカスを移す（帯と一緒に消えるボタンにフォーカスがあった時。ページの頭へ戻らないように） */
function focusOffButton(): void {
  document.querySelector<HTMLElement>(`[data-testid="${testIds.calOff}"]`)?.focus()
}

export function OffModeBanner({ onEnd }: { onEnd: () => void }) {
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const inside = ref.current?.contains(document.activeElement) ?? false
      onEndRef.current()
      if (inside) focusOffButton()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={ref} className="mo-banner" data-testid={testIds.offBanner}>
      <p className="mo-banner-text">休みを付ける: 日付を押すと休みが付いたり外れたりします</p>
      <button
        type="button"
        className="btn btn-sm mo-banner-end"
        onClick={() => {
          onEnd()
          focusOffButton()
        }}
        data-testid={testIds.offEnd}
      >
        終わる
      </button>
    </div>
  )
}
