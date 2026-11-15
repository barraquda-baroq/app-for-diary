// 3つのリストの行の点線の丸のチェック（docs/SPEC.md の 3.6・4.4・4.11・4.12）: 見える丸は 18px（線は 1.5px の点線、--text-faint。
// 乗せると実線。済みは丸を --text-faint で塗り、中に --surface の✓）。押せる所は 40px 四方を目安に、行の外にははみ出さない
// （.dot-check の --dot-hit）。ほかの押せる所と重なる時は丸が勝つ。読み上げは「『件名』を済みにする」／「『件名』の済みを外す」
// （リストは「済み」。完了ではない）。押した時のことは行が決める（チェックではお知らせを出さない。3.9）
import type { ButtonHTMLAttributes } from 'react'
import { DotCheckIcon } from '../../../ui/icons'
import './lists.css'

/** 読み上げの名前（名前は件名・やりたいことの1行目を 20字まで。domain/listText.ts の name20 を渡す） */
export function dotCheckLabel(name: string, done: boolean): string {
  return done ? `『${name}』の済みを外す` : `『${name}』を済みにする`
}

export interface DotCheckProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'aria-pressed' | 'aria-label'> {
  done: boolean
  /** 読み上げに入れる名前 */
  name: string
  onToggle: () => void
}

export function DotCheck({ done, name, onToggle, className, ...rest }: DotCheckProps) {
  return (
    <button
      {...rest}
      type="button"
      className={`dot-check list-check${className ? ` ${className}` : ''}`}
      aria-pressed={done}
      aria-label={dotCheckLabel(name, done)}
      onClick={onToggle}
    >
      <DotCheckIcon done={done} size={18} />
    </button>
  )
}
