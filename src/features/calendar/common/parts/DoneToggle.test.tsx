// 完了の丸・●のボタン（DoneToggle。12.5・4.11・3.9・7.9）と、ラベルの色の●（LabelDot。4.3・7.8・7.9）
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mkItem, T0 } from '../../../../domain/testData'
import type { ID, Item } from '../../../../domain/types'
import { getData, useApp } from '../../../../store/appStore'
import { actions } from '../../../../store/actions'
import { useToasts } from '../../../../store/uiStore'
import { renderView, setupCalendarTests } from '../../../../test/renderCalendar'
import { testIds } from '../testIds'
import { DoneToggle, type DoneToggleProps } from './DoneToggle'
import { ItemMarks } from './ItemMarks'
import { ItemTitle } from './ItemTitle'
import { LabelDot } from './LabelDot'
import { OffMark } from './OffMark'

setupCalendarTests()

/** 押すと詳細を開くカード（丸はその中の別のボタン）。予定はストアから読む（完了の切り替えがそのまま映る） */
function Card({ id, onOpen, ...rest }: { id: ID; onOpen: () => void } & Omit<DoneToggleProps, 'item'>) {
  const item = useApp((s) => s.data.items[id])
  if (!item) return null
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={onOpen} data-testid="card">
      <DoneToggle item={item} {...rest} />
      <span>{item.title}</span>
    </div>
  )
}

async function renderCard(item: Item, props: Omit<DoneToggleProps, 'item'> = {}) {
  const onOpen = vi.fn()
  const r = await renderView(Card, { id: item.id, onOpen, ...props }, { data: { items: { [item.id]: item } } })
  return { ...r, onOpen, button: screen.getByTestId(testIds.done(item.id)) }
}

const toastTexts = () => useToasts.getState().toasts.map((t) => t.message)

describe('押すと完了・もう一度押すと戻す（12.5・ITEMS-241・243）', () => {
  it('完了にすると done・doneAt（今）・doneOn（今日）、戻すと3つとも消す。カードの詳細は開かない', async () => {
    const user = userEvent.setup()
    const { button, onOpen } = await renderCard(mkItem({ id: 'a', title: '資料の確認' }))
    await user.click(button)
    expect(getData().items.a).toMatchObject({ done: true, doneAt: T0, doneOn: '2026-11-10' })
    expect(button.getAttribute('data-done')).toBe('true')
    await user.click(button)
    expect(getData().items.a).toMatchObject({ done: false, doneAt: null, doneOn: null })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('複数日の予定はどの日の丸で押しても予定全体で1回（ITEMS-240）', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'm', start: '2026-11-09', due: '2026-11-12' }))
    await user.click(button)
    expect(getData().items.m.done).toBe(true)
  })

  it('丸の上の Enter・スペースはカードの「押すと詳細」に渡さない', async () => {
    const user = userEvent.setup()
    const { button, onOpen } = await renderCard(mkItem({ id: 'a' }))
    button.focus()
    await user.keyboard('{Enter}')
    expect(getData().items.a.done).toBe(true)
    await user.keyboard(' ')
    expect(getData().items.a.done).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('読み上げ（FRAME-251・CALENDAR-146・ITEMS-247）', () => {
  it('「『件名』を完了にする」、完了している時は「『件名』の完了を外す」', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'a', title: '定例ミーティング' }))
    expect(button.getAttribute('aria-label')).toBe('『定例ミーティング』を完了にする')
    await user.click(button)
    expect(button.getAttribute('aria-label')).toBe('『定例ミーティング』の完了を外す')
  })

  it('空の件名は「（件名なし）」で読む', async () => {
    const { button } = await renderCard(mkItem({ id: 'a', title: '' }))
    expect(button.getAttribute('aria-label')).toBe('『（件名なし）』を完了にする')
  })
})

describe('お知らせ（FRAME-091・095・CALENDAR-147・ITEMS-244・245）', () => {
  it('完了にした時だけ「『件名』を完了にしました［元に戻す］」。［元に戻す］で完了を外す', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'a', title: '経費の精算' }))
    await user.click(button)
    expect(toastTexts()).toEqual(['『経費の精算』を完了にしました'])
    const toast = screen.getByText('『経費の精算』を完了にしました').closest('.toast') as HTMLElement
    expect(useToasts.getState().toasts[0].action?.label).toBe('元に戻す')
    const spy = vi.spyOn(actions, 'setItemDone')
    await user.click(within(toast).getByRole('button', { name: '元に戻す' }))
    expect(spy).toHaveBeenCalledWith('a', false)
    spy.mockRestore()
    expect(getData().items.a.done).toBe(false)
    expect(toastTexts()).toEqual([])
  })

  it('完了を外した時は出さない', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'a', done: true, doneAt: T0, doneOn: '2026-11-10' }))
    await user.click(button)
    expect(getData().items.a.done).toBe(false)
    expect(toastTexts()).toEqual([])
  })

  it('toast={false}（詳細の中のチェック・Task List のチェック）では完了にしても出さない', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'a' }), { toast: false })
    await user.click(button)
    expect(getData().items.a.done).toBe(true)
    expect(toastTexts()).toEqual([])
  })

  it('空の件名は「『（件名なし）』を完了にしました」', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'a', title: '' }))
    await user.click(button)
    expect(toastTexts()).toEqual(['『（件名なし）』を完了にしました'])
  })

  it('［元に戻す］の前に予定が消えていたら、戻せないことを知らせる', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'a', title: '見積もりの提出' }))
    await user.click(button)
    const undo = useToasts.getState().toasts[0].action
    // ほかの端末で消された（表示のデータから無くなった）
    act(() => useApp.setState((s) => ({ data: { ...s.data, items: {} } })))
    act(() => undo?.run())
    expect(
      useToasts
        .getState()
        .toasts.filter((t) => t.kind === 'error')
        .map((t) => t.message),
    ).toEqual(['予定が見つかりません。'])
  })
})

describe('見た目と押せる所（4.11・FRAME-247〜250・CALENDAR-144）', () => {
  it('点線の丸は既定 16px（ウィークリーのカード・タイムスケジュールの予定）、リストは 18px', async () => {
    const { button, setProps, onOpen } = await renderCard(mkItem({ id: 'a' }))
    expect(button.classList.contains('dot-check')).toBe(true)
    const svg = button.querySelector('svg') as SVGElement
    expect(svg.getAttribute('width')).toBe('16')
    // 線は点線（1.5px）。完了は塗って✓
    expect(svg.getAttribute('stroke-width')).toBe('1.5')
    expect(svg.querySelector('.dot-check-ring')?.getAttribute('stroke-dasharray')).toBeTruthy()
    setProps({ id: 'a', onOpen, size: 18 })
    expect(screen.getByTestId(testIds.done('a')).querySelector('svg')?.getAttribute('width')).toBe('18')
  })

  it('完了は丸を塗って中に✓（.dot-check-mark。色は --surface）', async () => {
    const { button } = await renderCard(mkItem({ id: 'a', done: true, doneAt: T0, doneOn: '2026-11-10' }))
    const ring = button.querySelector('.dot-check-ring') as SVGElement
    expect(ring.getAttribute('fill')).toBe('currentColor')
    expect(ring.hasAttribute('stroke-dasharray')).toBe(false)
    expect(button.querySelector('.dot-check-mark')).not.toBeNull()
  })

  it('押せる所は既定 40px（CSS の --dot-hit の既定）。枠の中に収める大きさを hit で渡す（高さ 24px の予定は 24）', async () => {
    const { button, setProps, onOpen } = await renderCard(mkItem({ id: 'a' }))
    expect(button.style.getPropertyValue('--dot-hit')).toBe('')
    setProps({ id: 'a', onOpen, hit: 24 })
    expect(screen.getByTestId(testIds.done('a')).style.getPropertyValue('--dot-hit')).toBe('24px')
  })

  it('look="dot"（デイリーのリストの行頭の●）はラベルの色の●。完了すると色を残して✓', async () => {
    const user = userEvent.setup()
    const { button } = await renderCard(mkItem({ id: 'a', label: 'sky-l', kind: 'private' }), { look: 'dot' })
    const dot = button.querySelector('.cp-dot') as HTMLElement
    expect(button.classList.contains('is-dot')).toBe(true)
    expect(dot.getAttribute('data-label')).toBe('sky-l')
    expect(dot.getAttribute('data-kind')).toBe('private')
    expect(dot.querySelector('svg')).toBeNull()
    await user.click(button)
    const done = screen.getByTestId(testIds.done('a')).querySelector('.cp-dot') as HTMLElement
    expect(done.querySelector('.cp-dot-check')).not.toBeNull()
    expect(done.classList.contains('is-faded')).toBe(false)
    expect(done.getAttribute('data-label')).toBe('sky-l')
  })

  it('testId を替えられる（同じ予定の丸が画面に2つある時）', async () => {
    const item = mkItem({ id: 'a' })
    await renderView(Card, { id: 'a', onOpen: () => {}, testId: 'start-done-a' }, { data: { items: { a: item } } })
    expect(screen.getByTestId('start-done-a')).toBeTruthy()
    expect(screen.queryByTestId(testIds.done('a'))).toBeNull()
  })
})

describe('ラベルの色の●（LabelDot。FRAME-193・CALENDAR-264）', () => {
  it('ラベルがあればその色（data-label）、無ければ土台の色（data-kind の --kind-line）', () => {
    const { container: a } = render(<LabelDot item={mkItem({ label: 'peony-d' })} />)
    expect(a.querySelector('.cp-dot')?.getAttribute('data-label')).toBe('peony-d')
    const { container: b } = render(<LabelDot item={mkItem({ label: null, kind: 'private' })} />)
    const dot = b.querySelector('.cp-dot') as HTMLElement
    expect(dot.hasAttribute('data-label')).toBe(false)
    expect(dot.getAttribute('data-kind')).toBe('private')
  })

  it('知らないラベルのキーは「ラベルなし」（土台の色の●）', () => {
    const { container } = render(<LabelDot item={mkItem({ label: 'gold-l' })} />)
    expect(container.querySelector('.cp-dot')?.hasAttribute('data-label')).toBe(false)
  })

  it('doneLook="fade"（複数日の終点の●）は完了で --done-text（is-faded）、✓は無し', () => {
    const { container } = render(<LabelDot item={mkItem({ label: 'sky-l', done: true })} doneLook="fade" />)
    const dot = container.querySelector('.cp-dot') as HTMLElement
    expect(dot.classList.contains('is-faded')).toBe(true)
    expect(dot.querySelector('svg')).toBeNull()
    expect(dot.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('ディープダークでの見分け（FRAME-121・253）', () => {
  it('区分は区分のアイコン、休みは「休」、完了は斜線と✓で分かる（色に頼らない）', async () => {
    document.documentElement.dataset.theme = 'deep-dark'
    try {
      const done = mkItem({ id: 'd', kind: 'private', done: true, doneAt: T0, doneOn: '2026-11-10' })
      const { container } = render(
        <div>
          <ItemMarks item={done} kindIcon />
          <ItemTitle item={done} highlight strike />
          <OffMark />
        </div>,
      )
      expect(container.querySelector('[data-mark="kind"] title')?.textContent).toBe('プライベート')
      expect(container.querySelector('.cp-title.is-strike')).not.toBeNull()
      expect(container.querySelector('.cp-off')?.textContent).toContain('休')
      const { button } = await renderCard(done)
      expect(button.querySelector('.dot-check-mark')).not.toBeNull()
    } finally {
      delete document.documentElement.dataset.theme
    }
  })
})
