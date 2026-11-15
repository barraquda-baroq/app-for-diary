// S・M の「開いているリスト」（src/features/top/stackModel.ts の listToClose。docs/SPEC.md の 3.1・3.5・■34）: S・M だけで、S の全面の
// MIM でない時に、見ている所（切り替えの列で選ばれた物）が開いているリストの時だけそのリスト。幅・全面の MIM・見ている所・畳んだ
// 状態の組み合わせを全部確かめる
import { describe, expect, it } from 'vitest'
import type { ListKey, PaneKey, WidthClass } from '../calendar/common/types'
import { listToClose } from './stackModel'

const WIDTHS: WidthClass[] = ['S', 'M', 'L']
const PANES: PaneKey[] = ['calendar', 'routine', 'task', 'favorite']
const LISTS: ListKey[] = ['routine', 'task', 'favorite']

/** 3つのリストの畳んだ状態の8通り */
const COLLAPSED: Record<ListKey, boolean>[] = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({
  routine: Boolean(n & 1),
  task: Boolean(n & 2),
  favorite: Boolean(n & 4),
}))

describe('S3 listToClose（S3-FRAME-007〜010）', () => {
  it('S・M で全面の MIM でなく、見ている所が開いているリストの時だけ、そのリスト（全部の組み合わせ）', () => {
    for (const width of WIDTHS)
      for (const fullMim of [false, true])
        for (const shown of PANES)
          for (const collapsed of COLLAPSED) {
            const expected =
              width !== 'L' && !fullMim && shown !== 'calendar' && !collapsed[shown as ListKey] ? (shown as ListKey) : null
            expect(listToClose({ width, fullMim, shown, collapsed }), JSON.stringify({ width, fullMim, shown, collapsed })).toBe(
              expected,
            )
          }
  })

  it('S で Task List を見ていて開いていれば task。ほかのリストが開いていても、見ている物だけ', () => {
    const open = { routine: false, task: false, favorite: false }
    expect(listToClose({ width: 'S', fullMim: false, shown: 'task', collapsed: open })).toBe('task')
    for (const list of LISTS) expect(listToClose({ width: 'M', fullMim: false, shown: list, collapsed: open })).toBe(list)
  })

  it('L（iPad の横向きも）は、見ている所・畳んだ状態に関わらず null（右の列のリストはいつも出ているので、モードを回す・閉じるか聞くのまま）', () => {
    const open = { routine: false, task: false, favorite: false }
    for (const shown of PANES) expect(listToClose({ width: 'L', fullMim: false, shown, collapsed: open })).toBeNull()
  })

  it('カレンダーを見ている時・見ているリストを畳んでいる時・S の全面の MIM は null', () => {
    const open = { routine: false, task: false, favorite: false }
    expect(listToClose({ width: 'S', fullMim: false, shown: 'calendar', collapsed: open })).toBeNull()
    expect(listToClose({ width: 'S', fullMim: false, shown: 'task', collapsed: { ...open, task: true } })).toBeNull()
    expect(listToClose({ width: 'S', fullMim: true, shown: 'task', collapsed: open })).toBeNull()
  })
})
