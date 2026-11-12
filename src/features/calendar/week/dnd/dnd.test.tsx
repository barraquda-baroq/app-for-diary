// ウィークリーのドラッグ（week/dnd。docs/SPEC.md の 7.10・7.11・3.9・4.9）の部品のテスト。本物の dnd-kit を jsdom で動かす
// （jsdom に無い setPointerCapture・IntersectionObserver・getAnimations・animate だけをこのファイルの中で置く）。jsdom は大きさを
// 測らないので、どこに落ちたか（重なりの判定）は E2E（e2e/week-drag.spec.ts）で確かめ、ここは掴んだ時の落とせる日の印・
// 掴めない物・ロック中の揺れ・落とした時の動き（applyDrop）を見る
import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getData, replaceAllData } from '../../../../store/appStore'
import { mkItem, mkTask } from '../../../../domain/testData'
import type { Item } from '../../../../domain/types'
import { useCalendarUi, useToasts } from '../../../../store/uiStore'
import { renderView, setupCalendarTests, viewProps } from '../../../../test/renderCalendar'
import { testIds } from '../../common/testIds'
import type { ViewProps } from '../../common/types'
import { WeekView } from '../WeekView'
import { applyDrop } from './drop'
import { REFUSED_CLASS } from './lockGesture'
import { asDragData, asDropData, dragId, dropId } from './types'

setupCalendarTests()

const DATES = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const WEEK = { from: '2026-11-08', to: '2026-11-14' }

/** jsdom に無い物（このファイルの間だけ） */
const stubs: [object, string, unknown][] = []
function stub(target: object, key: string, value: unknown) {
  stubs.push([target, key, Object.getOwnPropertyDescriptor(target, key)])
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
}

beforeEach(() => {
  stub(document.body, 'setPointerCapture', () => {})
  stub(
    window,
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    },
  )
  stub(document, 'getAnimations', () => [])
  stub(Element.prototype, 'getAnimations', () => [])
  stub(Element.prototype, 'animate', () => ({ finished: Promise.resolve(), cancel() {}, finish() {} }))
  stub(
    navigator,
    'vibrate',
    vi.fn(() => true),
  )
  stub(document, 'elementFromPoint', () => null)
  // dnd-kit が <head> に差し込む CSS（入れ子の @layer）は jsdom が読めずにエラーを出すので、中身を空にして差し込む（jsdom は描かない）
  const prepend = document.head.prepend.bind(document.head)
  stub(document.head, 'prepend', (...nodes: (Node | string)[]) => {
    for (const n of nodes) if (n instanceof HTMLStyleElement && n.textContent?.includes('data-dnd')) n.textContent = ''
    prepend(...nodes)
  })
})

afterEach(() => {
  for (const [target, key, desc] of stubs.splice(0).reverse()) {
    if (desc) Object.defineProperty(target, key, desc as PropertyDescriptor)
    else delete (target as Record<string, unknown>)[key]
  }
  document.documentElement.classList.remove(REFUSED_CLASS)
})

const span = (id: string, start: string, due: string, p: Partial<Item> = {}) => mkItem({ id, title: id, start, due, ...p })
const items = (...list: Item[]) => Object.fromEntries(list.map((it) => [it.id, it]))

const DATA = items(
  mkItem({ id: 'one', title: '1日の予定' }),
  span('multi', '2026-11-09', '2026-11-12'),
  span('recv', '2026-11-05', '2026-11-10'),
  mkTask({ id: 'quote', due: '2026-11-11' }),
  mkItem({ id: 'locked', title: 'ロック中', locked: true, start: '2026-11-12' }),
  span('lockspan', '2026-11-09', '2026-11-11', { locked: true, kind: 'private' }),
  mkItem({ id: 'priv', title: 'プライベート', kind: 'private', start: '2026-11-13' }),
)

async function renderWeek(over: Partial<ViewProps> & { reducedMotion?: boolean } = {}, data = DATA) {
  const { reducedMotion, ...rest } = over
  const props = viewProps({ mode: 'week', viewed: '2026-11-10', area: { width: 994, height: 760 }, ...rest })
  return renderView(WeekView, props, {
    path: '/week/2026-11-08',
    width: rest.width ?? 'L',
    reducedMotion,
    data: { items: data },
  })
}

type PointerKind = 'mouse' | 'touch'
const pointer = (type: string, kind: PointerKind, x: number, buttons = 1) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: kind,
    isPrimary: true,
    button: 0,
    buttons,
    clientX: x,
    clientY: 10,
  })

/** 押して（マウスは 20px 動かして）掴む。指は 0.4秒待つ（偽物のタイマーの時は進める） */
async function grab(el: Element, kind: PointerKind = 'mouse') {
  await act(async () => {
    el.dispatchEvent(pointer('pointerdown', kind, 10))
    if (kind === 'mouse') document.dispatchEvent(pointer('pointermove', kind, 30))
    else await vi.advanceTimersByTimeAsync(400)
  })
}

/** 離す（浮いた物が片付くまで待つ） */
async function release(kind: PointerKind = 'mouse') {
  await act(async () => {
    document.dispatchEvent(pointer('pointerup', kind, 30, 0))
  })
  await waitFor(() => expect(document.querySelector('[data-dnd-dragging], [data-dnd-placeholder]')).toBeNull())
}

/** その区分の落とす所の様子（日付の順） */
const drops = (kind: 'work' | 'private') =>
  DATES.map((d) => {
    const el = document.querySelector(
      `[data-tier="${kind}"] .wk-cell[data-date="${d}"], .wk-half[data-tier="${kind}"][data-date="${d}"]`,
    )
    return el?.getAttribute('data-drop')
  })
const marked = (kind: 'work' | 'private') => DATES.filter((_, i) => drops(kind)[i] !== 'none')

describe('掴むと、その週の落とせる日すべてに印（useDayDrop。D25・CALENDAR-165・166）', () => {
  it('1日のカード: 同じ区分の7日（元の日も）。違う区分には付かない。離すと消える', async () => {
    await renderWeek()
    const card = screen.getByTestId(testIds.weekCard('one'))
    await grab(card)
    expect(card.getAttribute('data-dnd-dragging')).toBe('true')
    // 掴んでいる間は isDragging（次の描き直しで true になる）
    await waitFor(() => expect(card.classList.contains('is-dragging')).toBe(true))
    expect(drops('work')).toEqual(DATES.map(() => 'ok'))
    expect(marked('private')).toEqual([])
    await release()
    expect(marked('work')).toEqual([])
    expect(card.hasAttribute('data-dnd-dragging')).toBe(false)
  })

  it('始点のカードは締め切り日まで、終点の●は開始日から（drag.ts の dropDays と同じ）', async () => {
    await renderWeek()
    await grab(screen.getByTestId(testIds.weekStart('multi')))
    expect(marked('work')).toEqual(DATES.slice(0, 5))
    await release()
    await grab(screen.getByTestId(testIds.weekEnd('multi')))
    expect(marked('work')).toEqual(DATES.slice(1))
    await release()
  })

  it('S（7日を縦）: 日のかたまりの同じ半分だけ。指は 0.4秒押し続けると掴み、15ms 振動する', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    const card = screen.getByTestId(testIds.weekCard('priv'))
    await act(async () => {
      card.dispatchEvent(pointer('pointerdown', 'touch', 10))
      await vi.advanceTimersByTimeAsync(399)
    })
    expect(marked('private')).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(marked('private')).toEqual(DATES)
    expect(marked('work')).toEqual([])
    expect(document.querySelectorAll('.wk-half[data-drop="ok"]')).toHaveLength(7)
    expect(navigator.vibrate).toHaveBeenCalledWith(15)
    vi.useRealTimers()
    await release('touch')
  })

  it('マウスで掴んでも振動しない', async () => {
    await renderWeek()
    await grab(screen.getByTestId(testIds.weekCard('one')))
    expect(navigator.vibrate).not.toHaveBeenCalled()
    await release()
  })

  it('掴んだ時に、文字を打っている欄からフォーカスを外す（指で掴んだ時に週が欄の所へ飛ばないように）。欄の中身はそのまま', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    const field = document.createElement('input')
    field.value = '打ちかけ'
    document.body.appendChild(field)
    field.focus()
    const card = screen.getByTestId(testIds.weekCard('priv'))
    await act(async () => {
      card.dispatchEvent(pointer('pointerdown', 'touch', 10))
      await vi.advanceTimersByTimeAsync(399)
    })
    // 掴む前（軽く押しただけ）はそのまま
    expect(document.activeElement).toBe(field)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(card.getAttribute('data-dnd-dragging')).toBe('true')
    expect(document.activeElement).not.toBe(field)
    expect(field.value).toBe('打ちかけ')
    vi.useRealTimers()
    await release('touch')
    field.remove()
  })
})

describe('掴めない物（CALENDAR-150・176・ITEMS-249）', () => {
  it('ロック中のカード・●は dnd-kit に渡さない（浮かず、印も出ない）', async () => {
    await renderWeek()
    for (const el of [screen.getByTestId(testIds.weekCard('locked')), screen.getByTestId(testIds.weekEnd('lockspan'))]) {
      await grab(el)
      expect(el.hasAttribute('data-dnd-dragging')).toBe(false)
      expect([...marked('work'), ...marked('private')]).toEqual([])
      await release()
    }
  })

  it('受けた表示は掴めない（中の●だけが終点として掴める）', async () => {
    await renderWeek()
    const recv = screen.getByTestId(testIds.weekReceived('recv'))
    await grab(recv.querySelector('.wk-open')!)
    expect(marked('work')).toEqual([])
    await release()
    await grab(screen.getByTestId(testIds.weekEnd('recv')))
    expect(marked('work')).toEqual(DATES)
    await release()
  })

  it('ロック中の物を掴もうとすると揺れ、離すまでページに not-allowed のクラス。知らせは出さず、離した後の click は捨てる', async () => {
    await renderWeek()
    const card = screen.getByTestId(testIds.weekCard('locked'))
    const root = document.documentElement
    await act(async () => {
      card.dispatchEvent(pointer('pointerdown', 'mouse', 10))
      window.dispatchEvent(pointer('pointermove', 'mouse', 15))
    })
    // 5px ちょうどはまだ掴もうとしていない
    expect(card.classList.contains('shake')).toBe(false)
    expect(root.classList.contains(REFUSED_CLASS)).toBe(false)
    await act(async () => {
      window.dispatchEvent(pointer('pointermove', 'mouse', 16))
    })
    expect(card.classList.contains('shake')).toBe(true)
    expect(root.classList.contains(REFUSED_CLASS)).toBe(true)
    await act(async () => {
      window.dispatchEvent(pointer('pointerup', 'mouse', 16, 0))
    })
    expect(root.classList.contains(REFUSED_CLASS)).toBe(false)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    card.querySelector('.wk-open')!.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('指の長押し（0.4秒）でも揺れる。その前に 8px を超えて動いた（スクロール）時は揺れない。指の長押しのメニューは止める', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await renderWeek()
    const card = screen.getByTestId(testIds.weekCard('locked'))
    await act(async () => {
      card.dispatchEvent(pointer('pointerdown', 'touch', 10))
      window.dispatchEvent(pointer('pointermove', 'touch', 19))
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(card.classList.contains('shake')).toBe(false)
    await act(async () => {
      window.dispatchEvent(pointer('pointercancel', 'touch', 19, 0))
      card.dispatchEvent(pointer('pointerdown', 'touch', 10))
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(card.classList.contains('shake')).toBe(true)
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    card.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(true)
    await act(async () => {
      window.dispatchEvent(pointer('pointerup', 'touch', 10, 0))
    })
  })

  it('指で押した後でも、マウスの右クリックのメニューは止めない（右ボタンの押し方も控える）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await renderWeek()
    const card = screen.getByTestId(testIds.weekCard('locked'))
    await act(async () => {
      card.dispatchEvent(pointer('pointerdown', 'touch', 10))
      await vi.advanceTimersByTimeAsync(400)
      window.dispatchEvent(pointer('pointerup', 'touch', 10, 0))
    })
    const right = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 2,
      buttons: 2,
    })
    await act(async () => {
      card.dispatchEvent(right)
    })
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    card.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(false)
  })

  it('視差効果を減らす設定では揺らさず、ロックの印（●の時は同じ予定のカードの中の印）を --accent にする', async () => {
    await renderWeek({ reducedMotion: true })
    const card = screen.getByTestId(testIds.weekCard('locked'))
    await grab(card)
    expect(card.classList.contains('shake')).toBe(false)
    expect(card.querySelector('[data-lock]')!.classList.contains('lock-accent')).toBe(true)
    await release()
    await grab(screen.getByTestId(testIds.weekEnd('lockspan')))
    expect(
      screen.getByTestId(testIds.weekStart('lockspan')).querySelector('[data-lock]')!.classList.contains('lock-accent'),
    ).toBe(true)
    await release()
  })
})

describe('落とした時（applyDrop。7.11・3.9・FRAME-231）', () => {
  const data = (id: string, handle: 'card' | 'start' | 'end' = 'card') => ({ item: getData().items[id], handle })

  it('動かし、「11/12（木）へ移しました［元に戻す］」を出し、移った先のカードを目立たせる。［元に戻す］で戻る', async () => {
    await renderWeek()
    let moved = false
    await act(async () => {
      moved = applyDrop(data('one'), { date: '2026-11-12', kind: 'work' }, WEEK)
    })
    expect(moved).toBe(true)
    expect(getData().items.one.start).toBe('2026-11-12')
    // 目立たせるだけ（目立つ側は動かさない。見える所へ出すのは WeekDnd が、動かした物を）
    expect(useCalendarUi.getState().flash).toMatchObject({ keys: ['item:one'], scroll: false })
    const [toast] = useToasts.getState().toasts
    expect(toast).toMatchObject({ kind: 'info', message: '11/12（木）へ移しました', action: { label: '元に戻す' } })
    await act(async () => toast.action!.run())
    expect(getData().items.one.start).toBe('2026-11-10')
  })

  it('始点は「開始日を…」、終点・〆は「締め切り日を…」', async () => {
    await renderWeek()
    await act(async () => {
      applyDrop(data('multi', 'start'), { date: '2026-11-08', kind: 'work' }, WEEK)
      applyDrop(data('multi', 'end'), { date: '2026-11-14', kind: 'work' }, WEEK)
      applyDrop(data('quote'), { date: '2026-11-13', kind: 'work' }, WEEK)
    })
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual([
      '開始日を 11/8（日）にしました',
      '締め切り日を 11/14（土）にしました',
      '締め切り日を 11/13（金）にしました',
    ])
    expect(getData().items.multi).toMatchObject({ start: '2026-11-08', due: '2026-11-14' })
    expect(getData().items.quote).toMatchObject({ start: null, due: '2026-11-13' })
  })

  it('元の日・違う区分・ロック中は何もしない（知らせも出さない）', async () => {
    await renderWeek()
    expect(applyDrop(data('one'), { date: '2026-11-10', kind: 'work' }, WEEK)).toBe(false)
    expect(applyDrop(data('one'), { date: '2026-11-12', kind: 'private' }, WEEK)).toBe(false)
    expect(applyDrop(data('locked'), { date: '2026-11-13', kind: 'work' }, WEEK)).toBe(false)
    expect(useToasts.getState().toasts).toEqual([])
    expect(useCalendarUi.getState().flash).toBeNull()
  })

  it('掴んだ後にロックされていた時は、決まりのエラーを知らせて動かさない', async () => {
    await renderWeek()
    const stale = { item: { ...getData().items.locked, locked: false }, handle: 'card' as const }
    await act(async () => {
      expect(applyDrop(stale, { date: '2026-11-13', kind: 'work' }, WEEK)).toBe(false)
    })
    expect(useToasts.getState().toasts).toMatchObject([{ kind: 'error', message: 'ロック中の予定は動かせません。' }])
    expect(getData().items.locked.start).toBe('2026-11-12')
  })

  it('［元に戻す］の前に予定が消えた（ほかの端末でゴミ箱へ移したなど）時は、戻せない旨を知らせる', async () => {
    await renderWeek()
    await act(async () => {
      applyDrop(data('one'), { date: '2026-11-12', kind: 'work' }, WEEK)
    })
    const [toast] = useToasts.getState().toasts
    await act(async () => {
      const { one: _gone, ...rest } = getData().items
      await replaceAllData({ ...getData(), items: rest })
    })
    await act(async () => toast.action!.run())
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({
      kind: 'error',
      message: '元に戻せませんでした（予定が見つからないか、今の内容に合いません）',
    })
  })
})

describe('id と受け渡す値（D52）', () => {
  it('掴む物は item:{id}:{handle}、落とす所は day:{date}:{kind}', () => {
    expect(dragId('a', 'end')).toBe('item:a:end')
    expect(dropId('2026-11-12', 'private')).toBe('day:2026-11-12:private')
  })

  it('知らない data は読まない（段階3で別の物が来ても読み違えない）', () => {
    const item = mkItem()
    expect(asDragData({ item, handle: 'start' })).toEqual({ item, handle: 'start' })
    expect(asDragData({ item, handle: 'row' })).toBeNull()
    expect(asDragData(null)).toBeNull()
    expect(asDropData({ date: '2026-11-12', kind: 'work', extra: 1 })).toEqual({ date: '2026-11-12', kind: 'work' })
    expect(asDropData({ date: '2026-11-12', kind: 'other' })).toBeNull()
  })
})
