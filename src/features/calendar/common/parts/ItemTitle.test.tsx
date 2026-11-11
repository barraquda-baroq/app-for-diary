// 予定の件名（ItemTitle。4.3 の件名のハイライト・7.8 の受けた表示・7.9 の完了）と、時刻・期間の表記（ItemTime。7.7）
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { calendarItems } from '../../../../domain/calendar'
import { mkItem, mkTask } from '../../../../domain/testData'
import type { Item } from '../../../../domain/types'
import { setupCalendarTests } from '../../../../test/renderCalendar'
import { ItemTime } from './ItemTime'
import { ItemTitle } from './ItemTitle'

setupCalendarTests()

const titleOf = (c: HTMLElement) => c.querySelector('.cp-title') as HTMLElement

describe('件名のハイライト（FRAME-135〜138・174）', () => {
  it('件名の字を包む inline の要素（.kind-marker）に、その予定の区分で付ける', () => {
    const { container } = render(<ItemTitle item={mkItem({ title: '定例ミーティング', kind: 'private' })} highlight />)
    const marker = titleOf(container).querySelector('.kind-marker') as HTMLElement
    expect(marker.textContent).toBe('定例ミーティング')
    expect(marker.getAttribute('data-kind')).toBe('private')
    expect(marker.tagName).toBe('SPAN')
  })

  it('知らない区分の予定は仕事の色で引く（6.12）', () => {
    const { container } = render(<ItemTitle item={mkItem({ kind: 'family' as Item['kind'] })} highlight />)
    expect(container.querySelector('.kind-marker')?.getAttribute('data-kind')).toBe('work')
  })

  it('完了した物には付けない（Q14・FRAME-138）', () => {
    const { container } = render(<ItemTitle item={mkItem({ done: true })} highlight strike />)
    expect(container.querySelector('.kind-marker')).toBeNull()
    expect(container.querySelector('[data-kind]')).toBeNull()
    const t = titleOf(container)
    expect(t.classList.contains('is-done')).toBe(true)
    expect(t.classList.contains('is-strike')).toBe(true)
  })

  it('highlight を渡さない所（ウィークリーのカード・デイリーのリスト）には付けない', () => {
    const { container } = render(<ItemTitle item={mkItem()} />)
    expect(container.querySelector('.kind-marker')).toBeNull()
  })

  it('件名だけを包む（時刻・印は件名の外の部品なので帯の下に入らない。FRAME-136）', () => {
    const { container } = render(<ItemTitle item={mkItem({ title: 'レビュー', startTime: '10:00', locked: true })} highlight />)
    expect(titleOf(container).textContent).toBe('レビュー')
  })
})

describe('受けた表示の「‹ 」・完了・行の数', () => {
  it('received で頭に「‹ 」（帯の中に --text-muted の字で。FRAME-137）', () => {
    const { container } = render(<ItemTitle item={mkItem({ title: '夜行バス' })} highlight received />)
    const marker = container.querySelector('.kind-marker') as HTMLElement
    expect(marker.textContent).toBe('‹ 夜行バス')
    expect(marker.querySelector('.cp-title-received')?.textContent).toBe('‹ ')
  })

  it('muted で字を --text-muted に（ウィークリーの受けた表示）', () => {
    const { container } = render(<ItemTitle item={mkItem()} received muted lines={1} />)
    const t = titleOf(container)
    expect(t.classList.contains('is-muted')).toBe(true)
    expect(t.classList.contains('cp-lines-1')).toBe(true)
  })

  it('完了は is-done（字は --done-text）。斜線は strike の所だけ（7.9）', () => {
    const { container } = render(<ItemTitle item={mkItem({ done: true })} lines={2} />)
    const t = titleOf(container)
    expect(t.classList.contains('is-done')).toBe(true)
    expect(t.classList.contains('is-strike')).toBe(false)
    expect(t.classList.contains('cp-lines-2')).toBe(true)
  })

  it('strike は完了していない時は引かない', () => {
    const { container } = render(<ItemTitle item={mkItem()} strike />)
    expect(titleOf(container).classList.contains('is-strike')).toBe(false)
  })

  it('件名は ui の書体（等幅にしない。等幅は数字・英字だけの所。FRAME-147）', () => {
    const { container } = render(<ItemTitle item={mkItem({ title: 'Review 2026' })} highlight />)
    expect(container.querySelector('.mono, .mono-time, .caps')).toBeNull()
  })

  it('空の件名は「（件名なし）」（ITEMS-036）', () => {
    const { container } = render(<ItemTitle item={mkItem({ title: '' })} />)
    expect(titleOf(container).textContent).toBe('（件名なし）')
  })
})

describe('時刻・期間の表記（ItemTime。7.7・CALENDAR-101・FRAME-147・172）', () => {
  const cal = (p: Partial<Item>) => calendarItems({ x: mkItem({ id: 'x', ...p }) })[0]

  it.each([
    [{ startTime: '10:00', endTime: '11:30' }, {}, '10:00–11:30'],
    [{ startTime: '09:05' }, {}, '9:05'],
    [{ start: '2026-11-09', due: '2026-11-11' }, {}, '〜11/11'],
    [{ start: '2026-11-09', due: '2026-11-11' }, { on: '2026-11-11' }, '11/9〜'],
    [{ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '15:00' }, {}, '11/9 10:00〜11/11 15:00'],
    [{ start: '2026-11-28', due: '2026-12-02', startTime: '10:00', endTime: '15:00' }, { datesOnly: true }, '11/28〜12/2'],
  ] as const)('%o %o → %s（等幅 11px の .mono-time・--text-muted の .cp-time）', (p, opts, label) => {
    const { container } = render(<ItemTime c={cal(p)} {...opts} />)
    const el = container.querySelector('.mono-time') as HTMLElement
    expect(el.textContent).toBe(label)
    expect(el.classList.contains('cp-time')).toBe(true)
  })

  it('1日・時刻なしは何も出さない', () => {
    expect(render(<ItemTime c={cal({})} />).container.innerHTML).toBe('')
  })

  it('list 生まれの 〆 の予定も同じ表記（締め切り日の1日）', () => {
    const c = calendarItems({ t: mkTask({ id: 't', due: '2026-11-12' }) })[0]
    expect(render(<ItemTime c={c} />).container.innerHTML).toBe('')
  })
})
