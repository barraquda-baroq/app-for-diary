// 予定の右上の印（ItemMarks。7.7・6.3・7.10・4.10）と AI の札（AiTag。7.7・D26・AMB-CAL-15）
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mkItem, mkTask } from '../../../../domain/testData'
import type { Item } from '../../../../domain/types'
import { setupCalendarTests } from '../../../../test/renderCalendar'
import { testIds } from '../testIds'
import { AiTag } from './AiTag'
import { ItemMarks, LOCK_SELECTOR } from './ItemMarks'

setupCalendarTests()

const VIA = 'メール: 打ち合わせの候補日について'
const claudeItem = (p: Partial<Item> = {}) => mkItem({ id: 'c1', by: 'connector', ai: 'claude', via: VIA, ...p })

/** 印の並び（左から） */
function markOrder(container: HTMLElement): string[] {
  const marks = container.querySelector('.cp-marks')
  return [...(marks?.children ?? [])].map((el) => el.getAttribute('data-mark') ?? (el.classList.contains('cp-ai') ? 'ai' : '?'))
}

describe('印の並び（CALENDAR-107・D39）', () => {
  it('左から 〆 → ロック → AI の札', () => {
    const item = mkTask({ id: 'c1', due: '2026-11-12', locked: true, by: 'connector', ai: 'claude', via: VIA })
    const { container } = render(<ItemMarks item={item} />)
    expect(markOrder(container)).toEqual(['due', 'lock', 'ai'])
  })

  it('タイムスケジュールでは区分のアイコンを先頭に（kindIcon）', () => {
    const item = claudeItem({ locked: true })
    const { container } = render(<ItemMarks item={item} kindIcon />)
    expect(markOrder(container)).toEqual(['kind', 'lock', 'ai'])
  })

  it('印が1つも無ければ何も出さない', () => {
    expect(render(<ItemMarks item={mkItem()} />).container.innerHTML).toBe('')
  })

  it('印の字と線は --text-muted の .cp-marks の中（FRAME-172）', () => {
    const { container } = render(<ItemMarks item={mkItem({ locked: true })} className="wk-marks" />)
    const marks = container.querySelector('.cp-marks') as HTMLElement
    expect(marks.classList.contains('wk-marks')).toBe(true)
  })
})

describe('「〆」（CALENDAR-010）', () => {
  it('list 生まれでカレンダーに出ている物だけ（締め切り日がある時）', () => {
    const shown = render(<ItemMarks item={mkTask({ due: '2026-11-12' })} />).container
    expect(shown.querySelector('[data-mark="due"]')?.textContent).toBe('〆')
    expect(shown.querySelector('[data-mark="due"]')?.getAttribute('aria-label')).toBe('締め切りのあるタスク')
  })

  it('calendar 生まれ・締め切り日の無い list 生まれには付けない', () => {
    expect(render(<ItemMarks item={mkItem({ due: '2026-11-12' })} />).container.innerHTML).toBe('')
    expect(render(<ItemMarks item={mkTask({ start: '2026-11-10', due: null })} />).container.innerHTML).toBe('')
  })
})

describe('ロックの印・区分のアイコン（CALENDAR-149・113・FRAME-240・242）', () => {
  it('ロック中は LockIcon 12px（線 2.4）。読み上げは「ロック中」。data-lock で探せる', () => {
    const { container } = render(<ItemMarks item={mkItem({ locked: true })} />)
    const lock = container.querySelector(LOCK_SELECTOR) as SVGElement
    expect(lock.tagName.toLowerCase()).toBe('svg')
    expect(lock.classList.contains('icon-sm')).toBe(true)
    expect(lock.getAttribute('stroke-width')).toBe('2.4')
    expect(lock.getAttribute('role')).toBe('img')
    expect(lock.querySelector('title')?.textContent).toBe('ロック中')
  })

  it.each([
    ['work', '仕事'],
    ['private', 'プライベート'],
  ] as const)('区分のアイコン（%s）は 12px・線 2.4・読み上げ「%s」', (kind, name) => {
    const { container } = render(<ItemMarks item={mkItem({ kind })} kindIcon />)
    const icon = container.querySelector('[data-mark="kind"]') as SVGElement
    expect(icon.classList.contains('icon-sm')).toBe(true)
    expect(icon.getAttribute('stroke-width')).toBe('2.4')
    expect(icon.querySelector('title')?.textContent).toBe(name)
  })
})

describe('AI の札（CALENDAR-108〜110）', () => {
  it('Claude が足した物は枠だけの小さな札「Claude」', () => {
    const { container } = render(<ItemMarks item={claudeItem()} />)
    const tag = screen.getByTestId(testIds.aiTag('c1'))
    expect(tag.tagName).toBe('BUTTON')
    expect(tag.textContent).toBe('Claude')
    expect(tag.classList.contains('cp-ai')).toBe(true)
    expect(container.querySelectorAll('.cp-ai')).toHaveLength(1)
  })

  it('ai が知らない値の時は「AI」', () => {
    render(<ItemMarks item={claudeItem({ ai: 'unknown' })} />)
    expect(screen.getByTestId(testIds.aiTag('c1')).textContent).toBe('AI')
  })

  it('作者が手で作った物を Claude が直しても札は付けない（by は user のまま）', () => {
    const { container } = render(<ItemMarks item={mkItem({ by: 'user', ai: 'claude', via: '依頼で直した' })} />)
    expect(container.querySelector('.cp-ai')).toBeNull()
  })
})

describe('AI の札を押すと出どころのメモ（via）の小窓（D26・AMB-CAL-15）', () => {
  /** 押すと詳細を開くカード（札はその中の別のボタン） */
  function Card({ item, onOpen, onKey }: { item: Item; onOpen: () => void; onKey?: () => void }) {
    return (
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={onKey} data-testid="card">
        <span>{item.title}</span>
        <AiTag item={item} />
      </div>
    )
  }

  it('押すと札の下に via を出し、カードの詳細は開かない', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<Card item={claudeItem()} onOpen={onOpen} />)
    const tag = screen.getByTestId(testIds.aiTag('c1'))
    expect(tag.getAttribute('aria-expanded')).toBe('false')
    await user.click(tag)
    const popup = screen.getByRole('dialog', { name: 'Claude が足した予定' })
    expect(popup.textContent).toContain(VIA)
    expect(popup.classList.contains('pm-menu')).toBe(true)
    expect(tag.getAttribute('aria-expanded')).toBe('true')
    expect(tag.getAttribute('aria-controls')).toBe(popup.id)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('小窓の中を押してもカードの詳細は開かない（小窓は body の下でも、React の出来事はカードへ伝わるので止める）', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<Card item={claudeItem()} onOpen={onOpen} />)
    await user.click(screen.getByTestId(testIds.aiTag('c1')))
    await user.click(screen.getByText(VIA))
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('もう一度押す・Esc・外を押すと閉じる。Esc では札へフォーカスを戻す（FRAME-103）', async () => {
    const user = userEvent.setup()
    render(<Card item={claudeItem()} onOpen={() => {}} />)
    const tag = screen.getByTestId(testIds.aiTag('c1'))
    await user.click(tag)
    await user.click(tag)
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(tag)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    const outerEsc = vi.fn()
    window.addEventListener('keydown', outerEsc)
    await user.keyboard('{Escape}')
    window.removeEventListener('keydown', outerEsc)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(tag)
    // 同じ Esc で下の小さな画面などは閉じない
    expect(outerEsc).not.toHaveBeenCalled()

    await user.click(tag)
    await user.click(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('札の上の Enter はカードの「押すと詳細」に渡さない（札の小窓は開く）', () => {
    const onKey = vi.fn()
    render(<Card item={claudeItem()} onOpen={() => {}} onKey={onKey} />)
    fireEvent.keyDown(screen.getByTestId(testIds.aiTag('c1')), { key: 'Enter' })
    expect(onKey).not.toHaveBeenCalled()
  })

  it('via が無い時は「出どころのメモはありません」', async () => {
    const user = userEvent.setup()
    render(<AiTag item={claudeItem({ via: null, ai: 'other' })} />)
    await user.click(screen.getByTestId(testIds.aiTag('c1')))
    const popup = screen.getByRole('dialog', { name: 'AI が足した予定' })
    expect(popup.textContent).toContain('出どころのメモはありません')
  })

  it('手で作った物には札も小窓も無い', () => {
    expect(render(<AiTag item={mkItem()} />).container.innerHTML).toBe('')
  })
})
