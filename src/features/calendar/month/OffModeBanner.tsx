// 休みを付ける状態の帯（docs/SPEC.md の 9.5・3.10。D30）。操作の列のすぐ下に「休みを付ける: 日付を押すと休みが付いたり外れたりします
// ［終わる］」（地 --accent-soft・字 --accent-strong・高さ 36px）を出す。［終わる］と Esc で休みを付ける状態を終える。
// Esc は window の泡の段階で受け、ほかの部品が先に受けた物（preventDefault した物: すばやく足す・メニュー）と、document で
// 止めた物（stopPropagation: 上に開いた小さな画面。［＋ 登録］を開いたまま Esc を押すと、その画面だけを閉じる）は見送る
import { useEffect, useRef } from 'react'
import { testIds } from '../common/testIds'
import './month.css'

export function OffModeBanner({ onEnd }: { onEnd: () => void }) {
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      onEndRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="mo-banner" data-testid={testIds.offBanner}>
      <p className="mo-banner-text">休みを付ける: 日付を押すと休みが付いたり外れたりします</p>
      <button
        type="button"
        className="btn btn-sm mo-banner-end"
        onClick={() => {
          onEnd()
          // 押したボタンは帯と一緒に消えるので、フォーカスを操作の列の［休み］へ移す（ページの頭へ戻らないように）
          document.querySelector<HTMLElement>('.cal-off')?.focus()
        }}
        data-testid={testIds.offEnd}
      >
        終わる
      </button>
    </div>
  )
}
