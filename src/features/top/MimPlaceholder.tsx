// MIM（most important memo）の仮の画面（段階0）。ヘッダーの［MIM］で開き、L はカレンダーの領域、M は積んだ中のカレンダーの
// 区切りがこれに替わり、S は全面で開く（docs/SPEC.md の 3.5・16.1）。メモの一覧・中身・伏せる欄・QR は段階4で作る
import { useMim } from '../../ui/Layout'

export function MimPlaceholder({ headingId }: { headingId?: string }) {
  const { backToCalendar } = useMim()
  return (
    <div className="mim-ph" data-testid="mim-placeholder">
      <div className="mim-ph-bar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={backToCalendar} data-testid="mim-back">
          ‹ カレンダーに戻る
        </button>
        <h1 id={headingId} tabIndex={-1} className="mim-ph-title">
          <span className="mim-ph-name">MIM</span>
          <span className="head-ja">most important memo</span>
        </h1>
      </div>
      <div className="empty mim-ph-note">MIM（大事なメモ）は段階4で作ります</div>
    </div>
  )
}
