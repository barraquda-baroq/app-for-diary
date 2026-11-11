// カレンダーの画面が読むデータ（useCalendarData。6.3・6.5・6.6・6.12・CALENDAR-269・ITEMS-036）
import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mkItem, mkLabelName, mkOffDay, mkTask } from '../../../../domain/testData'
import type { AppData, Item } from '../../../../domain/types'
import { actions } from '../../../../store/actions'
import { renderView, setupCalendarTests } from '../../../../test/renderCalendar'
import { useCalendarData, type CalendarData } from './useCalendarData'

setupCalendarTests()

/** 描くたびに読んだ物を控える */
const seen: CalendarData[] = []
function Probe() {
  seen.push(useCalendarData())
  return null
}
const last = () => seen[seen.length - 1]

async function renderProbe(data: Partial<AppData>) {
  seen.length = 0
  return renderView(Probe, {}, { data })
}

describe('カレンダーに出る項目・休み・ラベルの呼び名', () => {
  it('カレンダーに出る物だけ（① 日付なし・④ 開始日だけの list 生まれは出ない。6.3）', async () => {
    await renderProbe({
      items: {
        a: mkItem({ id: 'a', start: '2026-11-10' }),
        b: mkTask({ id: 'b', due: '2026-11-12' }),
        c: mkTask({ id: 'c' }),
        d: mkTask({ id: 'd', start: '2026-11-10' }),
      },
    })
    expect(
      last()
        .list.map((c) => c.item.id)
        .sort(),
    ).toEqual(['a', 'b'])
  })

  it('休みは off が true の日だけ。ラベルの呼び名はそのまま', async () => {
    await renderProbe({
      offDays: { '2026-11-11': mkOffDay('2026-11-11'), '2026-11-14': mkOffDay('2026-11-14', false) },
      labelNames: { 'sky-l': mkLabelName('sky-l', '社内') },
    })
    expect([...last().off]).toEqual(['2026-11-11'])
    expect(last().labelNames['sky-l']?.name).toBe('社内')
  })

  it('表示用に直した記録を出す（知らない kind は仕事・空の件名は「（件名なし）」・start の無い calendar 生まれは due の日。6.12）', async () => {
    const odd = mkItem({ id: 'x', kind: 'family' as Item['kind'], title: '', start: null, due: '2026-11-13' })
    await renderProbe({ items: { x: odd } })
    const c = last().list[0]
    expect(c.item.kind).toBe('work')
    expect(c.item.title).toBe('（件名なし）')
    expect([c.from, c.to]).toEqual(['2026-11-13', '2026-11-13'])
  })
})

describe('表ごとに覚える（変わった表の分だけ作り直す）', () => {
  it('休みを付けても項目の一覧は作り直さず、予定を足しても休みは作り直さない', async () => {
    await renderProbe({ items: { a: mkItem({ id: 'a' }) } })
    const first = last()
    act(() => actions.setOffDay('2026-11-11', true))
    expect(last().off.has('2026-11-11')).toBe(true)
    expect(last().list).toBe(first.list)
    expect(last().labelNames).toBe(first.labelNames)
    const afterOff = last()
    act(() => {
      actions.addItem({ origin: 'calendar', title: '打ち合わせ', start: '2026-11-12' })
    })
    expect(last().list).toHaveLength(2)
    expect(last().off).toBe(afterOff.off)
  })

  it('1件を直しても、ほかの予定の項目（CalItem）は同じ物のまま（記録ごとの React.memo が効く。FRAME-284）', async () => {
    await renderProbe({
      items: { a: mkItem({ id: 'a', start: '2026-11-10' }), b: mkItem({ id: 'b', start: '2026-11-11' }) },
    })
    const byId = (id: string) => last().list.find((c) => c.item.id === id)
    const a0 = byId('a')
    const b0 = byId('b')
    act(() => actions.setItemDone('a', true))
    expect(byId('a')).not.toBe(a0)
    expect(byId('a')?.item.done).toBe(true)
    expect(byId('b')).toBe(b0)
  })

  it('何も変わらない描き直しでは同じ物を返す', async () => {
    const { setProps } = await renderProbe({ items: { a: mkItem({ id: 'a' }) } })
    const first = last()
    setProps({})
    expect(seen.length).toBeGreaterThan(1)
    expect(last()).toBe(first)
  })
})
