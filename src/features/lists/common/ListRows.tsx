// 3つのリストの行の並び（docs/SPEC.md の 3.6・13.4・14.2・15.3。開発・P11）: まだの行 → 「済み n件」の区切り（common/DoneSection）→ 済んだ行
// （区切りを畳んでいる間は出さない）を、1つの平らな並びに記録の id を key にして置く。チェックで行が区切りをまたいでも同じ親の中で
// 動くだけなので、行の部品は作り直さない（フォーカス・開いたメニュー・その場で直している欄が残る）。各リストの中身が使う:
//   <ListRows open={view.open} done={view.done} doneSection={{ collapsed, onToggle, testId }}
//     renderRow={(r) => <TaskRow view={r} />} />
// renderRow は行（React.memo で包んだ物）を返す。Routine List はかたまりごとに1つずつ置く（並べ替えはかたまりの中だけ）
import { Fragment, type ReactNode } from 'react'
import type { ID } from '../../../domain/types'
import { DoneSection, type DoneSectionProps } from './DoneSection'
import './lists.css'

export interface ListRowsProps<R extends { id: ID }> {
  /** まだの行（並べた順） */
  open: readonly R[]
  /** 済んだ行（並べた順） */
  done: readonly R[]
  /** 「済み n件」の区切り（count は done の数）。collapsed の間は済んだ行を出さない */
  doneSection: Omit<DoneSectionProps, 'count'>
  renderRow: (row: R) => ReactNode
  testId?: string
}

/** 「済み n件」の区切りの key（記録の id とぶつからない） */
const DONE_KEY = '\u0000done'

export function ListRows<R extends { id: ID }>({ open, done, doneSection, renderRow, testId }: ListRowsProps<R>) {
  const entries: ReactNode[] = open.map((r) => <Fragment key={r.id}>{renderRow(r)}</Fragment>)
  if (done.length > 0) {
    entries.push(<DoneSection key={DONE_KEY} {...doneSection} count={done.length} />)
    if (!doneSection.collapsed) for (const r of done) entries.push(<Fragment key={r.id}>{renderRow(r)}</Fragment>)
  }
  return (
    <div className="list-rows" data-testid={testId}>
      {entries}
    </div>
  )
}
