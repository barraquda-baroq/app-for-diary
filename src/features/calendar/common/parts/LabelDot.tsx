// ラベルの色の●（直径 10px。docs/SPEC.md の 4.3・4.6・6.12・7.8・7.9）。デイリーのリストの行頭（押すと完了。DoneToggle の
// look="dot"）と、複数日の終点の●に使う。色はラベルの色、ラベルが無い・知らないキーなら土台の色（--work-line／--private-line）。
// 完了の見せ方は2つ: check = ●の色は残して中に --on-label の✓（デイリーのリスト）、fade = ●を --done-text に（線と●。7.9）
import type { Item } from '../../../../domain/types'
import { cls, itemAttrs } from './itemLook'
import './parts.css'

export interface LabelDotProps {
  item: Pick<Item, 'kind' | 'label' | 'done'>
  /** 完了した時の見せ方（既定は check） */
  doneLook?: 'check' | 'fade'
  className?: string
}

export function LabelDot({ item, doneLook = 'check', className }: LabelDotProps) {
  const check = item.done && doneLook === 'check'
  return (
    <span
      className={cls('cp-dot', item.done && doneLook === 'fade' && 'is-faded', className)}
      aria-hidden="true"
      data-done={item.done ? 'true' : undefined}
      {...itemAttrs(item)}
    >
      {check ? (
        <svg className="cp-dot-check" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth={1.4}>
          <path d="M1.6 4.2 3.2 5.8 6.4 2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  )
}
