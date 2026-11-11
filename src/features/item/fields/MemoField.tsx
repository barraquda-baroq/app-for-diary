// メモの欄（docs/SPEC.md の 12.2 の 5・12.3）。自動で高さが伸びる入力欄（4行から）。長さの制限なし。
// 詳細の画面で、入力欄から離れている間は文章として出し URL を押せるリンクにする所（D33）は WP9 の後半
import { useRef } from 'react'
import { testIds } from '../../calendar/common/testIds'
import { useAutoGrow } from './useAutoGrow'

export interface MemoFieldProps {
  id: string
  value: string
  onChange: (memo: string) => void
  /** 欄を離れた（詳細の画面で保存する所。WP9 の後半） */
  onCommit?: () => void
}

export function MemoField({ id, value, onChange, onCommit }: MemoFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value)
  return (
    <div className="it-field">
      <label className="it-field-label" htmlFor={id}>
        メモ
      </label>
      <textarea
        ref={ref}
        id={id}
        className="textarea it-memo"
        rows={4}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        data-testid={testIds.itemMemo}
      />
    </div>
  )
}
