// 切り替えの行（ロック・Task List にも出す。docs/SPEC.md の 12.2 の 7・12.3・12.6。オンの地は --switch-on。src/styles.css の .switch）
import type { ReactNode } from 'react'
import { cls } from '../../calendar/common/parts/itemLook'

export interface SwitchRowProps {
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  /** 押せない（list 生まれでカレンダーに出ていない時の「Task List にも出す」。6.3） */
  disabled?: boolean
  testId: string
}

export function SwitchRow({ label, checked, onChange, disabled, testId }: SwitchRowProps) {
  return (
    <label className={cls('switch', 'it-switch', disabled && 'is-disabled')}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
      <span className="track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}
