// 依頼者の候補（docs/SPEC.md の 12.2・13.2・AMB-ITEMS-28）。登録・詳細の依頼者の欄と、段階3の Task List の［依頼者］が使う。
// 画面は表示用に直した記録（useData().items）を渡す。ゴミ箱の物は data.items に無いので数えない。
import type { ID, Item } from './types'
import { DAY_MS, compareStr } from './util'

/** 候補にする期間（直近 365日に作った項目の依頼者） */
export const REQUESTER_WINDOW_MS = 365 * DAY_MS
/** 出す候補の数 */
export const REQUESTER_MAX = 8

/** 前方一致で比べる形（全角・半角と大文字・小文字の違いを無くす） */
const fold = (s: string) => s.normalize('NFKC').toLowerCase()

/**
 * 依頼者の候補: ゴミ箱に無い項目のうち createdAt が今から 365日以内の物の依頼者（前後の空白を除く。空は数えない）を数え、使った回数の
 * 多い順、同じ数なら最後に使った（createdAt の新しい）順に並べ、打った字（prefix）で前方一致に絞って 8つまで。
 * prefix が空（空白だけ）なら絞らない
 */
export function requesterCandidates(items: Readonly<Record<ID, Item>>, nowMs: number, prefix: string): string[] {
  const stats = new Map<string, { count: number; last: number }>()
  for (const it of Object.values(items)) {
    if (typeof it.requester !== 'string' || typeof it.createdAt !== 'number') continue
    const name = it.requester.trim()
    if (!name || nowMs - it.createdAt > REQUESTER_WINDOW_MS) continue
    const s = stats.get(name)
    if (s) {
      s.count++
      s.last = Math.max(s.last, it.createdAt)
    } else stats.set(name, { count: 1, last: it.createdAt })
  }
  const typed = fold(prefix.trim())
  return [...stats.entries()]
    .filter(([name]) => fold(name).startsWith(typed))
    .sort(([an, a], [bn, b]) => b.count - a.count || b.last - a.last || compareStr(an, bn))
    .slice(0, REQUESTER_MAX)
    .map(([name]) => name)
}
