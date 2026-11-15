// 「済み n件」の区切りの行（docs/SPEC.md の 3.6・6.13・13.4・14.2・15.3）: 済んだ行は、リスト（Routine List はその種類のかたまり）の下の
// この区切りへ沈む。ふだんは畳んでおき（初めは畳む）、押すと開く。開いた・畳んだは、どの幅でも端末ごとに覚える
// （diary-studio:prefs の collapsed.taskDone・favoriteDone・routineDone.{種類}）。済んだ物が無い間は出さない。
// 区切りは済んだ行を包まない: 行は1つの平らな並び（まだの行 → この区切り → 済んだ行。畳んでいる間は済んだ行を出さない）に置き、
// チェックで行が区切りをまたいでも作り直さない（フォーカス・開いたメニューが残る。開発・P11）。footer は区切りの右に出す物
// （Favorite List の［済みを片付ける］。15.3）。flash は目立たせるキー（済みへ移した時に区切りを目立たせる。common/listFlash.ts）
import type { ReactNode } from 'react'
import { usePrefs, type RoutineCycle } from '../../../store/uiStore'
import { DownIcon } from '../../../ui/icons'
import { useFlashTarget } from '../../calendar/common/parts/useFlashTarget'
import './lists.css'

/** どの「済み n件」か（Task List・Favorite List は1つ、Routine List は種類ごと） */
export type DoneWhich = { list: 'task' } | { list: 'favorite' } | { list: 'routine'; cycle: RoutineCycle }

/** その「済み n件」を畳んでいるか（端末ごとに覚える。どの幅でも同じ） */
export function useDoneCollapsed(which: DoneWhich): [boolean, (collapsed: boolean) => void] {
  const collapsed = usePrefs((s) =>
    which.list === 'task'
      ? s.collapsed.taskDone
      : which.list === 'favorite'
        ? s.collapsed.favoriteDone
        : s.collapsed.routineDone[which.cycle],
  )
  const setCollapsed = usePrefs((s) => s.setCollapsed)
  const set = (value: boolean) => {
    const c = usePrefs.getState().collapsed
    if (which.list === 'task') setCollapsed({ taskDone: value })
    else if (which.list === 'favorite') setCollapsed({ favoriteDone: value })
    else setCollapsed({ routineDone: { ...c.routineDone, [which.cycle]: value } })
  }
  return [collapsed, set]
}

export interface DoneSectionProps {
  /** 済んだ物の数（0 の間は出さない） */
  count: number
  collapsed: boolean
  onToggle: () => void
  testId: string
  /** 目立たせるキー（listFlashKey.done・routineDone） */
  flash?: string
  /** 区切りの右に出す物（［済みを片付ける］） */
  footer?: ReactNode
}

export function DoneSection({ count, collapsed, onToggle, testId, flash, footer }: DoneSectionProps) {
  const ref = useFlashTarget<HTMLDivElement>(flash, { scroll: true })
  if (count <= 0) return null
  return (
    <div ref={ref} className={`list-done${collapsed ? ' is-collapsed' : ''}`} data-testid={testId}>
      <button type="button" className="list-done-toggle" aria-expanded={!collapsed} onClick={onToggle}>
        <span>済み {count}件</span>
        <DownIcon className="icon list-done-chevron" />
      </button>
      {footer ? <span className="list-done-footer">{footer}</span> : null}
    </div>
  )
}
