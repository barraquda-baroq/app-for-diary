// 期間を移った時にページをめくる部品（PageTurn。docs/SPEC.md の 3.7・4.9。22. の段階2の終わりの確かめ）: めくる向き、片付け、
// めくっている間にまた替わった時、視差効果を減らす設定・ドラッグ中・モードを替えた時、前の期間の写しが押せず読み上げに出ず、
// ドラッグの落とす所・テストの印・フォーカスを持たないこと。jsdom は CSS の動きを動かさないので、動きの終わりは animationend を送るか、
// 片付けの時間（TURN_CLEANUP_MS）を進めて確かめる。めくった絵そのものは E2E（e2e/calendar-frame.spec.ts）と画面の撮影で見る
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTestMedia } from '../../../test/renderCalendar'
import { PageTurn, TURN_CLEANUP_MS, turnPerspective } from './PageTurn'
import { cloneForTurn, skipNextTurn, turnDirection } from './pageTurnDom'
import type { CalendarMode } from './types'

const originalMatchMedia = window.matchMedia

/** .cal の中に .cal-body（中に期間の中身）と PageTurn を置く（CalendarView と同じ並び） */
function Frame({ mode = 'month', from }: { mode?: CalendarMode; from: string }) {
  const body = useRef<HTMLDivElement>(null)
  return (
    <div className="cal" data-testid="cal">
      <div ref={body} className="cal-body" data-testid="body">
        <section data-testid={`period-${from}`} id={`period-${from}`} aria-labelledby={`period-${from}`}>
          <h2>{from}</h2>
          <input name="quick" defaultValue="" aria-label="すばやく足す" />
          {/* ドラッグの落とす所・掴んだ物の印の代わり */}
          <div data-drop="ok" data-dnd-placeholder="">
            落とす所
          </div>
          <button type="button">押す</button>
        </section>
      </div>
      <PageTurn mode={mode} from={from} body={body} />
    </div>
  )
}

const cal = () => document.querySelector<HTMLElement>('[data-testid="cal"]')!
const layers = () => [...cal().querySelectorAll<HTMLElement>('.cal-turn')]
const layer = () => cal().querySelector<HTMLElement>('.cal-turn')

/** めくるページのそれ自体の動きが終わった（animationend）ことにする */
function endAnimation(target: Element, animationName: string, pseudoElement = '') {
  const e = new Event('animationend', { bubbles: true })
  Object.assign(e, { animationName, pseudoElement })
  act(() => {
    target.dispatchEvent(e)
  })
}

beforeEach(() => {
  setTestMedia({ width: 'L' })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.matchMedia = originalMatchMedia
})

describe('turnDirection・turnPerspective', () => {
  it('期間の初めの日が先へ進めば次、戻れば前、同じなら無し', () => {
    expect(turnDirection('2026-11-01', '2026-12-01')).toBe('next')
    expect(turnDirection('2026-11-08', '2026-11-01')).toBe('prev')
    expect(turnDirection('2026-01-01', '2026-01-01')).toBeNull()
    expect(turnDirection('2025-01-01', '2026-01-01')).toBe('next')
  })

  it('遠近はページの幅の 3 倍（1200px より近くしない）', () => {
    expect(turnPerspective(390)).toBe(1200)
    expect(turnPerspective(1068)).toBe(3204)
  })
})

describe('めくる向き', () => {
  it('次へ: 前の期間の写し（is-out）を、本物の新しい期間の上に置いてめくる', () => {
    const r = render(<Frame from="2026-11-01" />)
    expect(layer()).toBeNull()
    r.rerender(<Frame from="2026-12-01" />)
    expect(layers()).toHaveLength(1)
    expect(layer()?.dataset.turn).toBe('next')
    expect(layer()?.classList.contains('is-next')).toBe(true)
    expect(cal().dataset.turning).toBe('next')
    const pages = [...layer()!.querySelectorAll('.cal-turn-page')]
    expect(pages.map((p) => p.className)).toEqual(['cal-turn-page is-out'])
    expect(pages[0].textContent).toContain('2026-11-01')
    // 本物は新しい期間だけ（写しは箱の中だけ）
    expect(document.querySelector('[data-testid="body"]')?.textContent).toContain('2026-12-01')
    expect(document.querySelector('[data-testid="body"]')?.textContent).not.toContain('2026-11-01')
  })

  it('前へ: 前の期間の写し（is-under。動かない）の上へ、新しい期間の写し（is-in）がめくれて来る（新しい方は描き直しの後に写す）', async () => {
    const r = render(<Frame from="2026-12-01" />)
    r.rerender(<Frame from="2026-11-01" />)
    expect(layer()?.dataset.turn).toBe('prev')
    await act(async () => {})
    const pages = [...layer()!.querySelectorAll('.cal-turn-page')]
    expect(pages.map((p) => p.className)).toEqual(['cal-turn-page is-under', 'cal-turn-page is-in'])
    expect(pages[0].textContent).toContain('2026-12-01')
    expect(pages[1].textContent).toContain('2026-11-01')
  })
})

describe('片付け', () => {
  it('ページそのもののめくる動きが終わったら箱を外す（影・陰の動きの終わりでは外さない）', () => {
    const r = render(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    const page = layer()!.querySelector('.cal-turn-page')!
    endAnimation(page.querySelector('.cal-turn-shade')!, 'cal-turn-shade')
    endAnimation(page, 'cal-turn-lift', '::before')
    expect(layer()).not.toBeNull()
    endAnimation(page, 'cal-turn-out')
    expect(layer()).toBeNull()
    expect(cal().dataset.turning).toBeUndefined()
  })

  it('動きの終わりが来なくても（裏のタブなど）、少し後に外す', () => {
    vi.useFakeTimers()
    const r = render(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    act(() => vi.advanceTimersByTime(TURN_CLEANUP_MS - 1))
    expect(layer()).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(layer()).toBeNull()
  })

  it('めくっている間に押す・キーを打つ・ホイール・窓の大きさが替わると、すぐ終える', () => {
    const r = render(<Frame from="2026-11-01" />)
    const turnAgain = (from: string) => r.rerender(<Frame from={from} />)
    for (const [i, fire] of [
      () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })),
      () => document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })),
      () => document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true })),
      () => window.dispatchEvent(new Event('resize')),
    ].entries()) {
      turnAgain(`2027-0${i + 1}-01`)
      expect(layer()).not.toBeNull()
      act(fire)
      expect(layer()).toBeNull()
    }
  })

  it('外した後は何も残らない（外した部品から外す時も）', () => {
    const r = render(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    r.unmount()
    expect(document.querySelector('.cal-turn')).toBeNull()
  })
})

describe('続けて替わった時', () => {
  it('めくっている間にまた替わると、今のめくりはすぐ終え、今の期間からまためくる（箱は1つだけ）', () => {
    const r = render(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    const first = layer()
    r.rerender(<Frame from="2027-01-01" />)
    expect(layers()).toHaveLength(1)
    expect(layer()).not.toBe(first)
    expect(first?.isConnected).toBe(false)
    // 写したのは、2回目に替わる前に見えていた 12月（11月の写しではない）
    expect(layer()?.textContent).toContain('2026-12-01')
    expect(layer()?.textContent).not.toContain('2026-11-01')
  })

  it('前へめくる途中で次へ替わっても、前の新しい期間の写しは置かない', async () => {
    const r = render(<Frame from="2026-12-01" />)
    r.rerender(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    await act(async () => {})
    expect(layers()).toHaveLength(1)
    expect([...layer()!.querySelectorAll('.cal-turn-page')].map((p) => p.className)).toEqual(['cal-turn-page is-out'])
  })
})

describe('めくらない時', () => {
  it('視差効果を減らす設定ではめくらない（すぐ替える）', () => {
    setTestMedia({ width: 'L', reducedMotion: true })
    const r = render(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    expect(layer()).toBeNull()
  })

  it('モードを替えた時はめくらない。めくっている間にモードを替えると、すぐ終える', () => {
    const r = render(<Frame mode="month" from="2026-11-01" />)
    r.rerender(<Frame mode="week" from="2026-11-01" />)
    expect(layer()).toBeNull()
    r.rerender(<Frame mode="week" from="2026-11-08" />)
    expect(layer()).not.toBeNull()
    r.rerender(<Frame mode="day" from="2026-11-08" />)
    expect(layer()).toBeNull()
  })

  it('ドラッグ中（dnd-kit が掴んだ物に付ける data-dnd-dragging がある間）は、めくらずにすぐ替える', () => {
    const r = render(<Frame mode="week" from="2026-11-08" />)
    const grabbed = document.createElement('div')
    grabbed.setAttribute('data-dnd-dragging', '')
    document.body.appendChild(grabbed)
    r.rerender(<Frame mode="week" from="2026-11-15" />)
    expect(layer()).toBeNull()
    grabbed.remove()
    r.rerender(<Frame mode="week" from="2026-11-22" />)
    expect(layer()).not.toBeNull()
  })

  it('画面が裏にある時・skipNextTurn の後（裏から戻って今日へ移す時）はめくらない', () => {
    const r = render(<Frame from="2026-11-01" />)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    r.rerender(<Frame from="2026-12-01" />)
    expect(layer()).toBeNull()
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    skipNextTurn()
    r.rerender(<Frame from="2027-01-01" />)
    expect(layer()).toBeNull()
    skipNextTurn(0)
    r.rerender(<Frame from="2027-02-01" />)
    expect(layer()).not.toBeNull()
  })
})

describe('前の期間の写し（押せず・読み上げに出ず・ドラッグの落とす所にならない）', () => {
  it('箱は aria-hidden・inert。写しにはテストの印・id・name・id を指す aria・ドラッグの印・落とす所の印が無い', () => {
    const r = render(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    const box = layer()!
    expect(box.getAttribute('aria-hidden')).toBe('true')
    expect(box.hasAttribute('inert')).toBe(true)
    const copy = box.querySelector('section')!
    expect(copy.textContent).toContain('2026-11-01')
    for (const sel of [
      '[data-testid]',
      '[id]',
      '[name]',
      '[aria-labelledby]',
      '[data-drop]',
      '[data-dnd-placeholder]',
      '[tabindex]',
    ])
      expect(box.querySelectorAll(sel), sel).toHaveLength(0)
    // テストの印・id は本物の1つだけ
    expect(document.querySelectorAll('[data-testid="period-2026-12-01"]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-testid="period-2026-11-01"]')).toHaveLength(0)
  })

  it('写しは React の外の要素（ドラッグの落とす所・目立たせる所として登録されない）', () => {
    const r = render(<Frame from="2026-11-01" />)
    r.rerender(<Frame from="2026-12-01" />)
    const live = document.querySelector('[data-testid="period-2026-12-01"]')!
    // 本物の要素には React の印がある（比べるため）
    expect(Object.keys(live).some((k) => k.startsWith('__react'))).toBe(true)
    const managed = [layer()!, ...layer()!.querySelectorAll('*')].filter((el) =>
      Object.keys(el).some((k) => k.startsWith('__react')),
    )
    expect(managed).toEqual([])
  })

  it('めくってもフォーカスは本物の画面に残る（写しへ移らない）', () => {
    const r = render(<Frame from="2026-11-01" />)
    const button = () => document.querySelector<HTMLButtonElement>('[data-testid="body"] button')!
    act(() => button().focus())
    r.rerender(<Frame from="2026-12-01" />)
    expect(layer()).not.toBeNull()
    expect(document.activeElement).toBe(button())
    expect(layer()?.contains(document.activeElement)).toBe(false)
  })

  it('cloneForTurn: 入力欄の値はそのまま写し、本物は変えない', () => {
    const source = document.createElement('div')
    source.innerHTML = '<input name="a" data-testid="x" id="y">'
    const input = source.querySelector('input')!
    input.value = '牛乳を買う'
    const { el } = cloneForTurn(source)
    expect(el.querySelector('input')?.value).toBe('牛乳を買う')
    expect(el.querySelector('input')?.hasAttribute('name')).toBe(false)
    expect(input.getAttribute('name')).toBe('a')
    expect(input.dataset.testid).toBe('x')
  })
})
