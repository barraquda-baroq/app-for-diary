// 「詳しく」の開閉（docs/SPEC.md の 12.2 の 5・12.3・4.9。D11）。開閉は高さを 180ms で（src/styles.css の .fold）。
// 開いているかは包む画面が決める: 登録の画面は端末ごとに覚えた detailsOpen（6.13）、詳細の画面は中に入っている物があれば開き、
// 無ければ detailsOpen。どちらの画面で開け閉めしても detailsOpen に書く（RegisterSheet・DetailSheet）
import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronRightIcon } from '../../../ui/icons'
import { cls } from '../../calendar/common/parts/itemLook'
import { testIds } from '../../calendar/common/testIds'

/** 畳む動きの長さ（src/styles.css の --dur-fold。4.9） */
const FOLD_MS = 180

export interface DetailsFoldProps {
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export function DetailsFold({ open, onToggle, children }: DetailsFoldProps) {
  const id = useId()
  // 畳み終えた中身は hidden（表示なし）にする。.fold の visibility: hidden だけだと、小さな画面（src/ui/Modal）の Tab の囲いが
  // 見えない欄（メモなど）を最後の物と数えるので、詳細の画面で「詳しく」から Tab を押すと画面の外へ出てしまう。
  // 開く時はすぐ外し（高さが伸びる動きはそのまま）、閉じる時は畳む動きが終わってから付ける
  const [folded, setFolded] = useState(!open)
  useEffect(() => {
    if (open) {
      setFolded(false)
      return
    }
    const timer = window.setTimeout(() => setFolded(true), FOLD_MS)
    return () => window.clearTimeout(timer)
  }, [open])
  return (
    <div className="it-details">
      <button
        type="button"
        className="it-details-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        data-testid={testIds.itemDetails}
      >
        <ChevronRightIcon />
        詳しく
      </button>
      <div id={id} className={cls('fold', !open && 'is-closed')}>
        <div className="it-details-clip" hidden={!open && folded}>
          <div className="it-details-body">{children}</div>
        </div>
      </div>
    </div>
  )
}
