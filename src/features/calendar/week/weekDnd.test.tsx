// ウィークリーとドラッグ（week/dnd。WP11 が中身を作る）の約束（docs/SPEC.md の 7.11・10.2・10.4。WP11s の G4・G8、D19・D41）:
// - 掴む所: 1日のカードは 'card'、始点のカードは 'start'、終点の●と S の「● 件名」の行は 'end'。受けた表示と＞は掴めない
//   （CALENDAR-176）。カードの useItemDrag の ref と grabProps は入れ物（data-testid の付いた要素）に付ける（D19）
// - 落とせる所: L・M はその段のその日の列（.wk-cell）、S は日のかたまりのその半分の全体（.wk-half。余白も含む。G8）。様子は data-drop
// - WeekDnd の中から useWeekScroller() でウィークリーのスクロールする要素が取れる（自動のスクロールを絞る。G4）
// week/dnd は仮の物（何もしない）なので、ここでは呼ばれ方を記録する物に差し替えて確かめる
import { screen } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkItem, mkTask } from '../../../domain/testData'
import type { Item, ItemKind } from '../../../domain/types'
import { renderView, setupCalendarTests, viewProps } from '../../../test/renderCalendar'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'
import { useWeekScroller } from './weekScroller'
import { WeekView } from './WeekView'

/** 呼ばれ方の記録（掴む所は「id:handle」→ 付けた要素、落とせる所は「日付:区分」→ 付けた要素、スクロールする要素） */
const seen = vi.hoisted(() => ({
  drags: new Map<string, Element>(),
  drops: new Map<string, Element>(),
  scroller: null as Element | null,
  hover: '' as string,
}))

vi.mock('./dnd', () => ({
  WeekDnd: function WeekDnd({ children }: { children: ReactNode }) {
    const ref = useWeekScroller()
    useEffect(() => {
      seen.scroller = ref.current
    })
    return children
  },
  useItemDrag: ({ item, handle }: { item: Item; handle: string }) => ({
    ref: (el: Element | null) => {
      if (el) seen.drags.set(`${item.id}:${handle}`, el)
    },
    isDragging: false,
    grabProps: { 'data-grab': handle },
  }),
  useDayDrop: ({ date, kind }: { date: string; kind: ItemKind }) => ({
    ref: (el: Element | null) => {
      if (el) seen.drops.set(`${date}:${kind}`, el)
    },
    state: `${date}:${kind}` === seen.hover ? 'hover' : 'none',
  }),
}))

setupCalendarTests()

beforeEach(() => {
  seen.drags.clear()
  seen.drops.clear()
  seen.scroller = null
  seen.hover = '2026-11-12:work'
})

const DATES = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const span = (id: string, start: string, due: string, p: Partial<Item> = {}) => mkItem({ id, title: id, start, due, ...p })
const items = (...list: Item[]) => Object.fromEntries(list.map((it) => [it.id, it]))

const WEEK = items(
  span('recv', '2026-11-05', '2026-11-10'),
  span('ends-sun', '2026-11-04', '2026-11-08'),
  span('multi', '2026-11-09', '2026-11-12'),
  span('next', '2026-11-12', '2026-11-17'),
  mkItem({ id: 'one', title: '1日の予定' }),
  mkTask({ id: 'quote', due: '2026-11-11' }),
  mkItem({ id: 'locked', title: 'ロック中', locked: true }),
)

async function renderWeek(over: Partial<ViewProps> = {}, data = WEEK) {
  const props = viewProps({ mode: 'week', viewed: '2026-11-10', area: { width: 994, height: 760 }, ...over })
  return renderView(WeekView, props, { path: '/week/2026-11-08', width: over.width ?? 'L', data: { items: data } })
}

/** その予定の掴む所の種類（並びは名前の順） */
const handlesOf = (id: string) =>
  [...seen.drags.keys()]
    .filter((k) => k.startsWith(`${id}:`))
    .map((k) => k.slice(id.length + 1))
    .sort()

describe('掴む所（useItemDrag）', () => {
  it('1日のカード・〆・ロック中のカードは card、始点のカードは start、終点の●は end。ref と grabProps はカードの入れ物に', async () => {
    await renderWeek()
    for (const id of ['one', 'quote', 'locked']) {
      const card = screen.getByTestId(testIds.weekCard(id))
      expect(handlesOf(id)).toEqual(['card'])
      expect(seen.drags.get(`${id}:card`)).toBe(card)
      expect(card.getAttribute('data-grab')).toBe('card')
    }
    const start = screen.getByTestId(testIds.weekStart('multi'))
    expect(seen.drags.get('multi:start')).toBe(start)
    expect(start.getAttribute('data-grab')).toBe('start')
    expect(seen.drags.get('multi:end')).toBe(screen.getByTestId(testIds.weekEnd('multi')))
    expect(handlesOf('multi')).toEqual(['end', 'start'])
  })

  it('受けた表示と＞は掴めない（受けた表示の中の●だけが end。CALENDAR-176）', async () => {
    await renderWeek()
    expect(handlesOf('recv')).toEqual(['end'])
    expect(handlesOf('ends-sun')).toEqual(['end'])
    expect(seen.drags.get('ends-sun:end')).toBe(screen.getByTestId(testIds.weekEnd('ends-sun')))
    expect(screen.getByTestId(testIds.weekReceived('recv')).hasAttribute('data-grab')).toBe(false)
    // 次の週へ続く物は始点のカードだけ（＞は掴めない）
    expect(handlesOf('next')).toEqual(['start'])
    expect(screen.getByTestId(testIds.weekEdge('next')).hasAttribute('data-grab')).toBe(false)
  })

  it('S の4本目のレーンからの「● 件名」の行は、終点の●と同じく end（D41）', async () => {
    const dense = items(
      span('l0', '2026-11-08', '2026-11-11'),
      span('l1', '2026-11-08', '2026-11-10'),
      span('l2', '2026-11-09', '2026-11-13'),
      span('l3', '2026-11-09', '2026-11-12'),
    )
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } }, dense)
    expect(seen.drags.get('l3:end')).toBe(screen.getByTestId(testIds.weekOverflow('2026-11-12', 'l3')))
    expect(handlesOf('l3')).toEqual(['end', 'start'])
  })
})

describe('落とせる所（useDayDrop）', () => {
  it('L・M: 各段の各日の列（その段の下の端まで）。様子は data-drop', async () => {
    await renderWeek()
    expect(seen.drops.size).toBe(14)
    for (const kind of ['work', 'private'] as const)
      for (const d of DATES) {
        const el = seen.drops.get(`${d}:${kind}`) as HTMLElement
        expect(el.classList.contains('wk-cell')).toBe(true)
        expect(el.dataset.date).toBe(d)
        expect(el.closest('[data-tier]')?.getAttribute('data-tier')).toBe(kind)
        // 「＋」の行も中（列の全体）
        expect(el.contains(screen.getByTestId(testIds.weekAdd(d, kind)))).toBe(true)
      }
    expect((seen.drops.get('2026-11-12:work') as HTMLElement).dataset.drop).toBe('hover')
    expect((seen.drops.get('2026-11-12:private') as HTMLElement).dataset.drop).toBe('none')
  })

  it('S: 日のかたまりのその半分の全体（レール・「● 件名」の行・カード・「＋」の行を含む。G8）', async () => {
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    expect(seen.drops.size).toBe(14)
    for (const kind of ['work', 'private'] as const)
      for (const d of DATES) {
        const el = seen.drops.get(`${d}:${kind}`) as HTMLElement
        expect(el.classList.contains('wk-half')).toBe(true)
        expect([el.dataset.date, el.dataset.tier]).toEqual([d, kind])
        expect(el.parentElement?.closest('[data-testid]')).toBe(screen.getByTestId(testIds.weekCol(d)))
        expect(el.contains(screen.getByTestId(testIds.weekAdd(d, kind)))).toBe(true)
      }
    expect((seen.drops.get('2026-11-12:work') as HTMLElement).dataset.drop).toBe('hover')
  })
})

describe('スクロールする要素（useWeekScroller。G4）', () => {
  it.each([
    ['L', 994],
    ['S', 341],
  ] as const)('%s: WeekDnd の中から、ウィークリーのいちばん外のスクロールする要素が取れる', async (width, px) => {
    await renderWeek({ width, area: { width: px, height: 600 } })
    const view = screen.getByTestId(testIds.view('week'))
    expect(seen.scroller).toBe(view)
    expect(view.hasAttribute('data-week-scroller')).toBe(true)
  })
})
