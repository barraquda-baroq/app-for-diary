// S・M で開いているリストを「戻る」・端からのフリックで畳む（src/features/top/listBack.ts。docs/SPEC.md の 3.1・■34 の作者の答え）:
// listOpenNow は useStackedLists の形・見ている所・畳んだ状態だけで決め（画面は読まない）、closeShownList は見ているリストの入力欄の
// 打ちかけを捨ててから（discardListDraft）、その場で畳む（foldListInPlace）。畳むリストが無い時は何もしない（打ちかけも残す）。
// 本物の画面での確かめは src/history/appHistory.lists.test.ts・singleEntryHistory.lists.test.tsx と stackedFold.test.tsx。
// 設定で記録を取っている時だけ、listOpenNow は決めた時の形とページの位置を list-decide に控える（取っていない時は何も読まない）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSwipeLog, setSwipeLogEnabled, swipeLogText } from '../../history/swipeLog'
import { useStackedLists, type ListKey, type PaneKey, type StackedLayout } from '../../store/uiStore'
import { closeShownList, listOpenNow } from './listBack'

const calls = vi.hoisted(() => [] as string[])

vi.mock('../lists/common/listDraft', () => ({
  discardListDraft: (list: string) => calls.push(`discard ${list}`),
}))
vi.mock('./stackedFold', () => ({
  foldListInPlace: (list: string) => calls.push(`fold ${list}`),
}))

const ALL_OPEN = { routine: false, task: false, favorite: false }

function put(layout: StackedLayout | null, shown: PaneKey, collapsed: Record<ListKey, boolean> = ALL_OPEN) {
  useStackedLists.setState({ layout, shown, collapsed })
}

beforeEach(() => {
  calls.length = 0
  put(null, 'calendar', { routine: true, task: true, favorite: true })
})

describe('S3 listOpenNow（S3-FRAME-007・008・010）', () => {
  it('S・M（積んだ所の形がある）で、見ている所が開いているリストの時だけ true', () => {
    put({ width: 'S', fullMim: false }, 'task')
    expect(listOpenNow()).toBe(true)
    put({ width: 'M', fullMim: false }, 'favorite')
    expect(listOpenNow()).toBe(true)
  })

  it('積んだ所の形が無い（L・設定などほかの画面で StackedTop を出していない）時は false。見ている所が残っていても', () => {
    put(null, 'task')
    expect(listOpenNow()).toBe(false)
  })

  it('カレンダーを見ている・見ているリストを畳んでいる・S の全面の MIM は false', () => {
    put({ width: 'S', fullMim: false }, 'calendar')
    expect(listOpenNow()).toBe(false)
    put({ width: 'S', fullMim: false }, 'task', { ...ALL_OPEN, task: true })
    expect(listOpenNow()).toBe(false)
    put({ width: 'S', fullMim: true }, 'task')
    expect(listOpenNow()).toBe(false)
  })
})

describe('S3 closeShownList（■34 の作者の答え）', () => {
  it('見ているリストの打ちかけを捨ててから、その場で畳む（その順で1回ずつ。ほかのリストには触れない）', () => {
    for (const list of ['routine', 'task', 'favorite'] as const) {
      calls.length = 0
      put({ width: 'S', fullMim: false }, list)
      closeShownList()
      expect(calls).toEqual([`discard ${list}`, `fold ${list}`])
    }
  })

  it('畳むリストが無い時（L・カレンダーを見ている・畳んでいる・S の全面の MIM）は何もしない（打ちかけも捨てない）', () => {
    put(null, 'task')
    closeShownList()
    put({ width: 'S', fullMim: false }, 'calendar')
    closeShownList()
    put({ width: 'M', fullMim: false }, 'task', { ...ALL_OPEN, task: true })
    closeShownList()
    put({ width: 'S', fullMim: true }, 'favorite')
    closeShownList()
    expect(calls).toEqual([])
  })
})

describe('記録（list-decide。M1 の報告の調べ。開発）', () => {
  afterEach(() => {
    setSwipeLogEnabled(false)
    vi.restoreAllMocks()
  })

  it('記録を取っている時は、決めるたびに形（幅・全面の MIM か・見ている所・その所を畳んでいるか・決めた物）とページの位置・見えている所を1つ控える', () => {
    setSwipeLogEnabled(true)
    clearSwipeLog()
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(812.6)
    const vv = { offsetTop: 41.4, height: 507.8 }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
    put({ width: 'S', fullMim: false }, 'task')
    expect(listOpenNow()).toBe(true)
    put({ width: 'S', fullMim: false }, 'calendar')
    expect(listOpenNow()).toBe(false)
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    const lines = swipeLogText().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(
      / list-decide \{"width":"S","fullMim":false,"shown":"task","collapsed":false,"result":"task","scrollY":813,"vvTop":41,"vvHeight":508\}$/,
    )
    expect(lines[1]).toMatch(/ list-decide \{"width":"S","fullMim":false,"shown":"calendar","collapsed":null,"result":null,/)
  })

  it('記録を取っていない時は控えず、ページの位置も見えている所も読まない', () => {
    setSwipeLogEnabled(false)
    const scroll = vi.spyOn(window, 'scrollY', 'get')
    const vvRead = vi.fn(() => undefined)
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: vvRead })
    put({ width: 'S', fullMim: false }, 'task')
    expect(listOpenNow()).toBe(true)
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    expect(scroll).not.toHaveBeenCalled()
    expect(vvRead).not.toHaveBeenCalled()
    expect(swipeLogText()).toBe('')
  })
})
