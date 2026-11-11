// 「詳しく」の開閉（docs/SPEC.md の 12.2 の 5・12.3・4.9。D11）。開閉は高さを 180ms で（src/styles.css の .fold）。
// 開いているかは包む画面が決める: 登録の画面は端末ごとに覚えた detailsOpen（6.13）、詳細の画面は中に入っている物があれば開き、
// 無ければ detailsOpen。どちらの画面で開け閉めしても detailsOpen に書く（RegisterSheet・DetailSheet）
import { useId, type ReactNode } from 'react'
import { ChevronRightIcon } from '../../../ui/icons'
import { cls } from '../../calendar/common/parts/itemLook'
import { testIds } from '../../calendar/common/testIds'

export interface DetailsFoldProps {
  open: boolean
  onToggle: () => void
  children: ReactNode
}

export function DetailsFold({ open, onToggle, children }: DetailsFoldProps) {
  const id = useId()
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
        <div className="it-details-clip">
          <div className="it-details-body">{children}</div>
        </div>
      </div>
    </div>
  )
}
