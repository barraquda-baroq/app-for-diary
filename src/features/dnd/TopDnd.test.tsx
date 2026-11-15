// トップの画面のドラッグの入れ物（src/features/dnd/TopDnd.tsx・controllers.ts。docs/SPEC.md の 7.11・13.6・14.2・15.2）の部品のテスト。
// 本物の dnd-kit を jsdom で動かす（jsdom に無い setPointerCapture・IntersectionObserver・getAnimations・animate だけをこのファイルの中で
// 置く。week/dnd の dnd.test.tsx と同じ）。ウィークリーのドラッグの決まりそのものは dnd.test.tsx と e2e/week-drag.spec.ts が確かめ、
// ここは入れ物が1つであること・掴んだ物の種類ごとの受け持ち・どの種類でもする掴み始めの決まり・種類ごとに断る押し方・掴んでいる間に
// 受け持ちが外れた時を見る（S3-FRAME-016・200・222・223・S3-TASK-049・184・199・201）
import { Feedback, type DragDropManager, type DragEndEvent } from '@dnd-kit/dom'
import { useDraggable, useDragDropManager, useDroppable } from '@dnd-kit/react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createElement, useState, type ComponentProps, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkItem } from '../../domain/testData'
import type { Item } from '../../domain/types'
import { getData } from '../../store/appStore'
import { useCalendarUi, useToasts } from '../../store/uiStore'
import { renderView, setTestMedia, setupCalendarTests, viewProps } from '../../test/renderCalendar'
import { quickAddDragStarted } from '../calendar/common/parts/QuickAdd'
import { testIds } from '../calendar/common/testIds'
import type { ViewProps } from '../calendar/common/types'
import { WeekView } from '../calendar/week/WeekView'
import { DragControllers, useDragController, type DragController } from './controllers'
import type { DragType } from './dragData'
import { TopDnd } from './TopDnd'

// すばやく足すへの知らせ（掴み始めにどの種類でも呼ぶ）だけを見張る（ほかはそのまま）
vi.mock('../calendar/common/parts/QuickAdd', async (importOriginal) => {
  const real = await importOriginal<typeof import('../calendar/common/parts/QuickAdd')>()
  return { ...real, quickAddDragStarted: vi.fn(real.quickAddDragStarted) }
})

// dnd-kit の入れ物に渡した onDragOver を控える（入れ物の中身は本物のまま）
const overProps: unknown[] = []
vi.mock('@dnd-kit/react', async (importOriginal) => {
  const real = await importOriginal<typeof import('@dnd-kit/react')>()
  function DragDropProvider(props: ComponentProps<typeof real.DragDropProvider>) {
    overProps.push(props.onDragOver)
    return createElement(real.DragDropProvider, props)
  }
  return { ...real, DragDropProvider }
})

setupCalendarTests()

/** jsdom に無い物（このファイルの間だけ） */
const stubs: [object, string, unknown][] = []
function stub(target: object, key: string, value: unknown) {
  stubs.push([target, key, Object.getOwnPropertyDescriptor(target, key)])
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
}

beforeEach(() => {
  // dnd-kit は落とす動きの前に視差効果を減らす設定を読む（L・マウスの画面。renderView の物は描く時に置き直す）
  setTestMedia()
  overProps.length = 0
  vi.mocked(quickAddDragStarted).mockClear()
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
})

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

/** 押して（マウスは 20px 動かして）掴もうとする。指は 0.4秒待つ（偽物のタイマーを進める） */
async function grab(el: Element, kind: PointerKind = 'mouse') {
  await act(async () => {
    el.dispatchEvent(pointer('pointerdown', kind, 10))
    if (kind === 'mouse') document.dispatchEvent(pointer('pointermove', kind, 30))
    else await vi.advanceTimersByTimeAsync(400)
  })
}

/** 動かす（掴んでいる間） */
async function move(kind: PointerKind, x: number) {
  await act(async () => {
    document.dispatchEvent(pointer('pointermove', kind, x))
  })
}

/** 離す（浮いた物が片付き、dnd-kit が掴んでいない状態に戻るまで待つ） */
async function release(kind: PointerKind = 'mouse', manager?: () => DragDropManager | null) {
  await act(async () => {
    document.dispatchEvent(pointer('pointerup', kind, 30, 0))
  })
  await waitFor(() => expect(document.querySelector('[data-dnd-dragging], [data-dnd-placeholder]')).toBeNull())
  if (manager) await waitFor(() => expect(manager()?.dragOperation.status.idle).toBe(true))
}

/** 指の長押しを使うテスト（0.4秒。偽物のタイマー） */
function fakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

const WEEK = { from: '2026-11-08', to: '2026-11-14' }
const ITEM: Item = mkItem({ id: 'a', title: '見積もりの返事', start: '2026-11-10' })
const DATA: Record<DragType, Record<string, unknown>> = {
  'week-item': { item: ITEM, handle: 'card', week: WEEK },
  'task-row': { type: 'task-row', item: ITEM },
  sort: { type: 'sort', table: 'routines', group: 'daily', id: 'r1', index: 0 },
}

/** 掴める物（data の種類の物。中にボタン、つまみ [data-reorder-grip] を持つ） */
function Grabbable({ id, data }: { id: string; data: Record<string, unknown> }) {
  const d = useDraggable({ id, data })
  return (
    <div ref={d.ref} data-testid={id}>
      <span data-testid={`${id}-body`}>件名</span>
      <button type="button" data-testid={`${id}-button`}>
        ○
      </button>
      <span data-reorder-grip="" data-testid={`${id}-grip`}>
        ⋮⋮
      </span>
    </div>
  )
}

/** 受け持ちを届ける部品（中身も一緒に描く。外すと受け持ちも外れる） */
function Owner({ type, controller, children }: { type: DragType; controller: DragController; children?: ReactNode }) {
  useDragController(type, controller)
  return <>{children}</>
}

/** dnd-kit の入れ物の manager を控える */
let manager: DragDropManager | null = null
function ManagerProbe() {
  manager = useDragDropManager()
  return null
}

/** 種類ごとの受け持ち（呼ばれた順に控える） */
function spyController(type: string, log: string[]): DragController & { ends: DragEndEvent[] } {
  const ends: DragEndEvent[] = []
  return {
    ends,
    onDragStart: () => log.push(`${type}:start`),
    onDragMove: () => log.push(`${type}:move`),
    onDragEnd: (e) => {
      ends.push(e)
      log.push(`${type}:end${e.canceled ? ':canceled' : ''}`)
    },
  }
}

/** 動き（掴み方で数が替わる）を除いた控え */
const noMoves = (log: string[]) => log.filter((l) => !l.endsWith(':move'))

const dragging = () => document.querySelector('[data-dnd-dragging]')?.getAttribute('data-testid') ?? null

describe('S3 入れ物は1つ（S3-FRAME-200・S3-TASK-184）', () => {
  it('ウィークリーを TopDnd の中で描くと、外の入れ物（同じ manager）で掴む。WeekDnd は入れ物を足さない', async () => {
    const props = viewProps({ mode: 'week', viewed: '2026-11-10', area: { width: 994, height: 760 } })
    function Top(p: ViewProps) {
      return (
        <TopDnd>
          <ManagerProbe />
          <WeekView {...p} />
        </TopDnd>
      )
    }
    await renderView(Top, props, { path: '/week/2026-11-08', width: 'L', data: { items: { one: mkItem({ id: 'one' }) } } })
    // 入れ物（DragDropProvider）は外の TopDnd の1つだけ
    expect(overProps.length).toBeGreaterThan(0)
    const card = screen.getByTestId(testIds.weekCard('one'))
    await grab(card)
    expect(card.getAttribute('data-dnd-dragging')).toBe('true')
    expect(manager?.dragOperation.status.dragging).toBe(true)
    expect(manager?.dragOperation.source?.id).toBe('item:one:card')
    expect(useCalendarUi.getState().dragging).toBe(true)
    await release('mouse', () => manager)
    expect(useCalendarUi.getState().dragging).toBe(false)
  })

  it('掴んだままウィークリーが外れると（幅が替わった時など）、やめたこととして終え（動かさない）、入れ物は残る。描き直したウィークリーでまた掴んで落とせる', async () => {
    const props = viewProps({ mode: 'week', viewed: '2026-11-10', area: { width: 994, height: 760 } })
    let setShown: (on: boolean) => void = () => {}
    function Top(p: ViewProps) {
      const [on, setOn] = useState(true)
      setShown = setOn
      return (
        <TopDnd>
          <ManagerProbe />
          {on ? <WeekView {...p} /> : null}
        </TopDnd>
      )
    }
    const one = mkItem({ id: 'one', start: '2026-11-10' })
    await renderView(Top, props, { path: '/week/2026-11-08', width: 'L', data: { items: { one } } })
    const before = manager
    await grab(screen.getByTestId(testIds.weekCard('one')))
    expect(manager?.dragOperation.status.dragging).toBe(true)
    expect(document.querySelectorAll('.wk-cell[data-drop="ok"]').length).toBeGreaterThan(0)
    await act(async () => setShown(false))
    expect(useCalendarUi.getState().dragging).toBe(false)
    await waitFor(() => expect(manager?.dragOperation.status.idle).toBe(true))
    await act(async () => {
      document.dispatchEvent(pointer('pointerup', 'mouse', 30, 0))
    })
    expect(getData().items.one.start).toBe('2026-11-10')
    expect(useToasts.getState().toasts).toEqual([])
    await act(async () => setShown(true))
    expect(manager).toBe(before)
    const card = screen.getByTestId(testIds.weekCard('one'))
    await grab(card)
    expect(card.getAttribute('data-dnd-dragging')).toBe('true')
    expect(useCalendarUi.getState().dragging).toBe(true)
    await release('mouse', () => manager)
    expect(useCalendarUi.getState().dragging).toBe(false)
  })

  it('TopDnd の中の TopDnd は何も足さない（中で掴んだ物も外の manager）', async () => {
    let inner: DragDropManager | null = null
    function InnerProbe() {
      inner = useDragDropManager()
      return null
    }
    render(
      <TopDnd>
        <ManagerProbe />
        <TopDnd>
          <InnerProbe />
          <Grabbable id="row" data={DATA['task-row']} />
        </TopDnd>
      </TopDnd>,
    )
    expect(inner).toBe(manager)
    await grab(screen.getByTestId('row'))
    expect(manager?.dragOperation.status.dragging).toBe(true)
    await release('mouse', () => manager)
  })
})

describe('S3 掴んだ物の種類ごとの受け持ち（controllers.ts）', () => {
  it('掴み始め・動き・離した時は、掴んだ物の種類の受け持ちだけへ渡す', async () => {
    const log: string[] = []
    render(
      <TopDnd>
        <ManagerProbe />
        <Owner type="week-item" controller={spyController('week', log)} />
        <Owner type="task-row" controller={spyController('row', log)} />
        <Owner type="sort" controller={spyController('sort', log)} />
        <Grabbable id="card" data={DATA['week-item']} />
        <Grabbable id="row" data={DATA['task-row']} />
      </TopDnd>,
    )
    await grab(screen.getByTestId('row'))
    expect(dragging()).toBe('row')
    // 動きは dnd-kit が次に描く時にまとめて出すので、出るまで動かす
    await waitFor(async () => {
      await move('mouse', 40 + log.length)
      expect(log).toContain('row:move')
    })
    await release('mouse', () => manager)
    await grab(screen.getByTestId('card'))
    expect(dragging()).toBe('card')
    await release('mouse', () => manager)
    expect(noMoves(log)).toEqual(['row:start', 'row:end', 'week:start', 'week:end'])
    expect(log.some((l) => l.startsWith('sort:'))).toBe(false)
  })

  it('受け持ちが届いていない種類でも掴める（掴み始めの決まりだけ）。知らない data でも同じ', async () => {
    render(
      <TopDnd>
        <ManagerProbe />
        <Grabbable id="row" data={DATA['task-row']} />
        <Grabbable id="other" data={{ type: 'other' }} />
      </TopDnd>,
    )
    for (const id of ['row', 'other']) {
      await grab(screen.getByTestId(id))
      expect(dragging()).toBe(id)
      expect(useCalendarUi.getState().dragging).toBe(true)
      await release('mouse', () => manager)
      expect(useCalendarUi.getState().dragging).toBe(false)
    }
  })

  it('受け持ちの物を描くたびに替えても、掴んでいる間に外れない（やめない）。離した時は最後に描いた時の物を呼ぶ', async () => {
    const calls: string[] = []
    let bump: () => void = () => {}
    function Changing() {
      const [n, setN] = useState(0)
      bump = () => setN((x) => x + 1)
      // 描くたびに新しい受け持ち
      useDragController('task-row', {
        onDragStart: () => calls.push(`start${n}`),
        onDragEnd: (e) => calls.push(`end${n}${e.canceled ? ':canceled' : ''}`),
      })
      return <Grabbable id="row" data={DATA['task-row']} />
    }
    render(
      <TopDnd>
        <ManagerProbe />
        <Changing />
      </TopDnd>,
    )
    await grab(screen.getByTestId('row'))
    await act(async () => bump())
    await act(async () => bump())
    expect(manager?.dragOperation.status.dragging).toBe(true)
    expect(dragging()).toBe('row')
    await release('mouse', () => manager)
    expect(calls).toEqual(['start0', 'end2'])
  })

  it('掴んでいる間に受け持ちの部品が外れると、やめたこととして終える（離した時を canceled で呼んでから外す）。入れ物は残り、また掴める', async () => {
    const log: string[] = []
    const ctrl = spyController('row', log)
    let setShown: (on: boolean) => void = () => {}
    function Host() {
      const [on, setOn] = useState(true)
      setShown = setOn
      return on ? (
        <Owner type="task-row" controller={ctrl}>
          <Grabbable id="row" data={DATA['task-row']} />
        </Owner>
      ) : null
    }
    render(
      <TopDnd>
        <ManagerProbe />
        <Host />
      </TopDnd>,
    )
    await grab(screen.getByTestId('row'))
    expect(useCalendarUi.getState().dragging).toBe(true)
    const before = manager
    await act(async () => setShown(false))
    expect(noMoves(log)).toEqual(['row:start', 'row:end:canceled'])
    expect(ctrl.ends[0].canceled).toBe(true)
    expect(useCalendarUi.getState().dragging).toBe(false)
    await waitFor(() => expect(manager?.dragOperation.status.idle).toBe(true))
    // 指を離しても、もう何も呼ばない
    await act(async () => {
      document.dispatchEvent(pointer('pointerup', 'mouse', 30, 0))
    })
    expect(noMoves(log)).toEqual(['row:start', 'row:end:canceled'])
    // 同じ入れ物で、また掴める
    await act(async () => setShown(true))
    expect(manager).toBe(before)
    await grab(screen.getByTestId('row'))
    expect(dragging()).toBe('row')
    await release('mouse', () => manager)
    expect(noMoves(log)).toEqual(['row:start', 'row:end:canceled', 'row:start', 'row:end'])
  })

  it('掴んでいない時に受け持ちの部品が外れても、何も呼ばない。ほかの種類を掴んでいる間に外れても、そのドラッグは続く', async () => {
    const log: string[] = []
    let setShown: (on: boolean) => void = () => {}
    function Host() {
      const [on, setOn] = useState(true)
      setShown = setOn
      return on ? <Owner type="week-item" controller={spyController('week', log)} /> : null
    }
    render(
      <TopDnd>
        <ManagerProbe />
        <Owner type="task-row" controller={spyController('row', log)} />
        <Host />
        <Grabbable id="row" data={DATA['task-row']} />
      </TopDnd>,
    )
    await grab(screen.getByTestId('row'))
    await act(async () => setShown(false))
    expect(manager?.dragOperation.status.dragging).toBe(true)
    expect(dragging()).toBe('row')
    await release('mouse', () => manager)
    await act(async () => setShown(true))
    await act(async () => setShown(false))
    expect(noMoves(log)).toEqual(['row:start', 'row:end'])
  })

  it('TopDnd の外では、受け持ちを届けても何もしない（エラーにならない）', () => {
    render(<Owner type="week-item" controller={{ onDragStart: () => {} }} />)
  })
})

describe('S3 どの種類でも、掴み始めと離した時にすること（S3-FRAME-016・S3-TASK-049・199）', () => {
  it.each(['week-item', 'task-row', 'sort'] as const)(
    '%s: 画面の状態 dragging（「戻る」を止める）・入力欄のフォーカスを外す（字はそのまま）・すばやく足すへ知らせる。離すと dragging は false',
    async (type) => {
      render(
        <TopDnd>
          <ManagerProbe />
          <Grabbable id="it" data={DATA[type]} />
        </TopDnd>,
      )
      const field = document.createElement('textarea')
      field.value = '打ちかけ'
      document.body.appendChild(field)
      field.focus()
      // 並べ替えの行はマウスならつまみから
      const from = type === 'sort' ? screen.getByTestId('it-grip') : screen.getByTestId('it')
      await act(async () => {
        from.dispatchEvent(pointer('pointerdown', 'mouse', 10))
        document.dispatchEvent(pointer('pointermove', 'mouse', 14))
      })
      // 掴む前（5px まで）はそのまま
      expect(document.activeElement).toBe(field)
      expect(quickAddDragStarted).not.toHaveBeenCalled()
      await act(async () => {
        document.dispatchEvent(pointer('pointermove', 'mouse', 30))
      })
      expect(dragging()).toBe('it')
      expect(useCalendarUi.getState().dragging).toBe(true)
      expect(document.activeElement).not.toBe(field)
      expect(field.value).toBe('打ちかけ')
      expect(quickAddDragStarted).toHaveBeenCalledTimes(1)
      expect(navigator.vibrate).not.toHaveBeenCalled()
      await release('mouse', () => manager)
      expect(useCalendarUi.getState().dragging).toBe(false)
      field.remove()
    },
  )

  it('指で掴んだ時は 15ms 振動する（並べ替えの行・ウィークリーの予定）', async () => {
    fakeTimers()
    render(
      <TopDnd>
        <ManagerProbe />
        <Grabbable id="sort" data={DATA.sort} />
        <Grabbable id="card" data={DATA['week-item']} />
      </TopDnd>,
    )
    for (const id of ['sort', 'card']) {
      vi.mocked(navigator.vibrate).mockClear()
      await grab(screen.getByTestId(`${id}-body`), 'touch')
      expect(dragging()).toBe(id)
      expect(navigator.vibrate).toHaveBeenCalledWith(15)
      vi.useRealTimers()
      await release('touch', () => manager)
      fakeTimers()
    }
  })

  it('離した時、落とす時の動きは、受け持ちが決めなければ付けない（前に掴んだ種類の決め方を持ち越さない）', async () => {
    const seen: unknown[] = []
    const settle = { duration: 160, easing: 'ease-out' }
    render(
      <TopDnd>
        <ManagerProbe />
        <Owner
          type="week-item"
          controller={{ onDragEnd: (_e, m) => void (m.registry.plugins.get(Feedback)!.dropAnimation = settle) }}
        />
        <Owner
          type="task-row"
          controller={{ onDragEnd: (_e, m) => void seen.push(m.registry.plugins.get(Feedback)!.dropAnimation) }}
        />
        <Grabbable id="card" data={DATA['week-item']} />
        <Grabbable id="row" data={DATA['task-row']} />
      </TopDnd>,
    )
    await grab(screen.getByTestId('card'))
    await release('mouse', () => manager)
    expect(manager?.registry.plugins.get(Feedback)?.dropAnimation).toBe(settle)
    await grab(screen.getByTestId('row'))
    await release('mouse', () => manager)
    expect(seen).toEqual([undefined])
  })
})

describe('S3 種類ごとに断る押し方（SENSORS。S3-TASK-201）', () => {
  it('Task List の行はマウスだけで掴む（指の長押しでは掴まない）', async () => {
    fakeTimers()
    render(
      <TopDnd>
        <ManagerProbe />
        <Grabbable id="row" data={DATA['task-row']} />
      </TopDnd>,
    )
    await grab(screen.getByTestId('row'), 'touch')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(dragging()).toBeNull()
    expect(manager?.dragOperation.status.idle).toBe(true)
    expect(useCalendarUi.getState().dragging).toBe(false)
    await act(async () => {
      document.dispatchEvent(pointer('pointerup', 'touch', 10, 0))
    })
    vi.useRealTimers()
    await grab(screen.getByTestId('row'))
    expect(dragging()).toBe('row')
    await release('mouse', () => manager)
  })

  it('並べ替えの行は、マウスならつまみからだけ。指は行のどこを 0.4秒押しても掴む', async () => {
    render(
      <TopDnd>
        <ManagerProbe />
        <Grabbable id="sort" data={DATA.sort} />
      </TopDnd>,
    )
    await grab(screen.getByTestId('sort-body'))
    expect(dragging()).toBeNull()
    await act(async () => {
      document.dispatchEvent(pointer('pointerup', 'mouse', 30, 0))
    })
    await grab(screen.getByTestId('sort-grip'))
    expect(dragging()).toBe('sort')
    await release('mouse', () => manager)
    fakeTimers()
    await grab(screen.getByTestId('sort-body'), 'touch')
    expect(dragging()).toBe('sort')
    vi.useRealTimers()
    await release('touch', () => manager)
  })

  it('ウィークリーの予定は、マウスでも指でも、中のボタンの上から押しても掴む（つまみは要らない）', async () => {
    render(
      <TopDnd>
        <ManagerProbe />
        <Grabbable id="card" data={DATA['week-item']} />
      </TopDnd>,
    )
    await grab(screen.getByTestId('card-button'))
    expect(dragging()).toBe('card')
    await release('mouse', () => manager)
    fakeTimers()
    await grab(screen.getByTestId('card-body'), 'touch')
    expect(dragging()).toBe('card')
    vi.useRealTimers()
    await release('touch', () => manager)
  })
})

describe('S3 上にある落とす所が替わった時（onDragOver）', () => {
  /** いつも当たる落とす所 */
  function Target({ id }: { id: string }) {
    const d = useDroppable({
      id,
      collisionDetector: ({ droppable }) => ({ id: droppable.id, value: 1, type: 2 as never, priority: 3 }),
    })
    return <div ref={d.ref} data-testid={id} />
  }

  it('それを持つ受け持ちが届いている間だけ dnd-kit へ頼み、掴んだ種類の受け持ちへ渡す（ウィークリーは持たないので頼まない）', async () => {
    const overs: string[] = []
    let setSort: (on: boolean) => void = () => {}
    function Host() {
      const [on, setOn] = useState(false)
      setSort = setOn
      return on ? <Owner type="sort" controller={{ onDragOver: (e) => void overs.push(String(e.operation.target?.id)) }} /> : null
    }
    render(
      <TopDnd>
        <ManagerProbe />
        <Owner type="week-item" controller={{ onDragMove: () => {} }} />
        <Host />
        <Grabbable id="sort" data={DATA.sort} />
        <Target id="slot" />
      </TopDnd>,
    )
    expect(overProps.at(-1)).toBeUndefined()
    await act(async () => setSort(true))
    expect(overProps.at(-1)).toBeTypeOf('function')
    await grab(screen.getByTestId('sort-grip'))
    let x = 40
    await waitFor(async () => {
      await move('mouse', (x += 5))
      expect(overs).toContain('slot')
    })
    await release('mouse', () => manager)
    await act(async () => setSort(false))
    expect(overProps.at(-1)).toBeUndefined()
  })

  it('DragControllers.wantsOver: onDragOver を持つ受け持ちが1つでも届いている間だけ true', () => {
    const c = new DragControllers()
    const seen: boolean[] = []
    c.subscribe(() => seen.push(c.wantsOver()))
    const offWeek = c.set('week-item', { onDragMove: () => {} })
    const offSort = c.set('sort', { onDragOver: () => {} })
    offSort()
    offWeek()
    expect(seen).toEqual([false, true, false, false])
  })
})
