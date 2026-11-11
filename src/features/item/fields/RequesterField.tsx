// 依頼者の欄（docs/SPEC.md の 12.2 の 5・13.2・12.4）。0〜60字（コードポイントで数える。上限を超えて打てない・貼れない）。
// 直近 365日に使った名前の候補（AMB-ITEMS-28。src/domain/requesters.ts）を出す所は WP9 の後半
import { limitChars } from '../../../domain/itemInput'
import { LIMITS } from '../../../domain/types'
import { testIds } from '../../calendar/common/testIds'

export interface RequesterFieldProps {
  id: string
  value: string
  onChange: (requester: string) => void
  /** 欄を離れた（詳細の画面で保存する所。WP9 の後半） */
  onCommit?: () => void
}

export function RequesterField({ id, value, onChange, onCommit }: RequesterFieldProps) {
  return (
    <div className="it-field">
      <label className="it-field-label" htmlFor={id}>
        依頼者
      </label>
      <input
        id={id}
        className="input"
        value={value}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => onChange(limitChars(e.target.value, LIMITS.requester))}
        onBlur={onCommit}
        data-testid={testIds.itemRequester}
      />
    </div>
  )
}
