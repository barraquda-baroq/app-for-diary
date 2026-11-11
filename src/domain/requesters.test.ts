// 依頼者の候補（docs/SPEC.md の 12.2・13.2・AMB-ITEMS-28）: 直近 365日に作った項目の依頼者を、使った回数の多い順、同じ数なら最後に
// 使った順に 8つまで。前後の空白を除き、空は数えない。ゴミ箱の物は数えない。打った字で前方一致に絞る
import { describe, expect, it } from 'vitest'
import { requesterCandidates } from './requesters'
import { DAY, T0, dataWith, mkItem } from './testData'
import { trashItem } from './trash'
import type { Item } from './types'

let seq = 0
const used = (requester: string, createdAt: number, p: Partial<Item> = {}) =>
  mkItem({ id: `r${++seq}`, requester, createdAt, ...p })

const itemsOf = (list: Item[]) => dataWith({ items: list }).items

describe('依頼者の候補（ITEMS-180）', () => {
  it('使った回数の多い順、同じ数なら最後に使った（createdAt の新しい）順', () => {
    const items = itemsOf([
      used('営業部', T0 - 10 * DAY),
      used('営業部', T0 - 9 * DAY),
      used('総務', T0 - 1 * DAY),
      used('経理', T0 - 2 * DAY),
      used('経理', T0 - 30 * DAY),
      used('経理', T0 - 40 * DAY),
    ])
    expect(requesterCandidates(items, T0, '')).toEqual(['経理', '営業部', '総務'])
    // 同じ数: 最後に使った方が先
    const tie = itemsOf([used('総務', T0 - 5 * DAY), used('営業部', T0 - 3 * DAY)])
    expect(requesterCandidates(tie, T0, '')).toEqual(['営業部', '総務'])
  })

  it('前後の空白を除いて数え、空（空白だけ）は数えない', () => {
    const items = itemsOf([used(' 総務 ', T0 - DAY), used('総務', T0 - 2 * DAY), used('   ', T0), used('', T0)])
    expect(requesterCandidates(items, T0, '')).toEqual(['総務'])
  })

  it('直近 365日に作った物だけ（ちょうど 365日は入る）', () => {
    const items = itemsOf([used('総務', T0 - 365 * DAY), used('営業部', T0 - 365 * DAY - 1)])
    expect(requesterCandidates(items, T0, '')).toEqual(['総務'])
  })

  it('8つまで', () => {
    const names = ['一課', '二課', '三課', '四課', '五課', '六課', '七課', '八課', '九課', '十課']
    const items = itemsOf(names.map((n, i) => used(n, T0 - i * DAY)))
    const got = requesterCandidates(items, T0, '')
    expect(got).toHaveLength(8)
    expect(got).toEqual(names.slice(0, 8))
  })

  it('打った字で前方一致に絞ってから 8つ（全角・半角と大文字・小文字は区別しない）', () => {
    const items = itemsOf([
      used('営業部', T0 - DAY),
      used('営業二課', T0 - 2 * DAY),
      used('総務', T0),
      used('Sales', T0 - 3 * DAY),
    ])
    expect(requesterCandidates(items, T0, '営業')).toEqual(['営業部', '営業二課'])
    expect(requesterCandidates(items, T0, ' 営業 ')).toEqual(['営業部', '営業二課'])
    expect(requesterCandidates(items, T0, 'sa')).toEqual(['Sales'])
    expect(requesterCandidates(items, T0, 'ＳＡ')).toEqual(['Sales'])
    expect(requesterCandidates(items, T0, '業')).toEqual([])
    // 絞る前の順で 9番目より後の名前も、絞った後の 8つには入る
    const many = itemsOf([
      ...['一課', '二課', '三課', '四課', '五課', '六課', '七課', '八課', '九課'].map((n, i) => used(n, T0 - i * DAY)),
      used('営業部', T0 - 20 * DAY),
    ])
    expect(requesterCandidates(many, T0, '')).not.toContain('営業部')
    expect(requesterCandidates(many, T0, '営')).toEqual(['営業部'])
  })

  it('ゴミ箱の物は数えない（data.items に無い）', () => {
    const data = dataWith({ items: [used('総務', T0 - DAY, { id: 'gone' }), used('営業部', T0 - DAY)] })
    const after = trashItem(data, 'gone', { at: T0 }).data
    expect(requesterCandidates(after.items, T0, '')).toEqual(['営業部'])
  })
})
