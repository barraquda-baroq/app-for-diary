// 詳細の画面の下の行（docs/SPEC.md の 12.3。12px・--text-faint。D47）: 「作った 2026/11/10 09:12」、完了なら「完了 2026/11/12 18:03」、
// Claude が足した物（by: 'connector'）は「Claude が追加（メール: 12/3 打ち合わせのご案内 …）」（ai・via。長い時は1行で切り、押すと全部）。
// 日時はミリ秒（UTC）で持ち、端末の暦と時刻で出す（ITEMS-019）。「Claude が直した」「Claude の提案で直した」の行は段階5（AMB-ITEMS-25）
import { useState } from 'react'
import type { Item } from '../../domain/types'
import { formatDateTime } from '../../ui/browser'
import { aiTagText, hasAiTag } from '../calendar/common/parts/itemLook'
import { testIds } from '../calendar/common/testIds'
import './item.css'

export interface DetailFooterProps {
  item: Pick<Item, 'createdAt' | 'done' | 'doneAt' | 'by' | 'ai' | 'via'>
}

/** Claude が足した物の行の字（via が無ければ「Claude が追加」だけ。知らない ai は「AI」。6.1・7.7） */
export function addedByLine(item: Pick<Item, 'ai' | 'via'>): string {
  const who = `${aiTagText(item)} が追加`
  const via = typeof item.via === 'string' ? item.via.trim() : ''
  return via ? `${who}（${via}）` : who
}

export function DetailFooter({ item }: DetailFooterProps) {
  const [full, setFull] = useState(false)
  return (
    <div className="it-meta" data-testid={testIds.itemFooter}>
      <p>作った {formatDateTime(item.createdAt)}</p>
      {item.done && typeof item.doneAt === 'number' ? <p>完了 {formatDateTime(item.doneAt)}</p> : null}
      {hasAiTag(item) ? (
        <p>
          <button type="button" className="it-via" aria-expanded={full} onClick={() => setFull((v) => !v)}>
            {addedByLine(item)}
          </button>
        </p>
      ) : null}
    </div>
  )
}
