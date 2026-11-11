// ウィークリーの画面（docs/SPEC.md の 10.・7.7〜7.9・4.3・12.3）: 7日を横（L・M）と7日を縦（S）の描き方、区分ごとのレーン・
// 受けた表示・端の＞・終点の●・完了の見え方・印・休みの列・見出しの行の数・縦のレールと「● 件名」の行・「＋」の行、
// 予定を押すと詳細が開く（丸・AI の札は別のボタン）、日付の見出し → デイリー・休みのチェック・「＋」→ すばやく足す（その場で
// 入力欄に替わる）、列が狭い時の始点のカード・受けた表示の件名の2行
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mkItem, mkOffDay, mkTask, T0 } from '../../../domain/testData'
import type { AppData, Item } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData } from '../../../store/appStore'
import { useCalendarUi } from '../../../store/uiStore'
import { quickDraftKey, readLocal } from '../../../store/localDrafts'
import { renderView, setupCalendarTests, viewProps } from '../../../test/renderCalendar'
import { sheetOf } from '../common/sheets'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'
import { WeekView } from './WeekView'

setupCalendarTests()

const DATES = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const span = (id: string, start: string, due: string, p: Partial<Item> = {}) => mkItem({ id, title: id, start, due, ...p })
const items = (...list: Item[]) => Object.fromEntries(list.map((it) => [it.id, it]))

/** いつもの週の形（前の週から続く・時刻のある複数日・土曜の＞・土曜に始まって縮む・1日の予定・完了・ロック・〆・Claude） */
const WEEK = items(
  span('recv', '2026-11-05', '2026-11-10', { title: '研修' }),
  span('ends-sun', '2026-11-04', '2026-11-08', { title: '申請の受付', done: true, label: 'apricot-l' }),
  span('multi', '2026-11-09', '2026-11-12', { title: '資料づくり', startTime: '10:00', endTime: '18:00', label: 'sky-l' }),
  span('next', '2026-11-12', '2026-11-17', { title: '出張の準備', label: 'blue-d' }),
  span('sat', '2026-11-14', '2026-11-16', { title: '棚卸し' }),
  mkItem({ id: 'meet', title: '定例ミーティング', startTime: '10:00', endTime: '11:30', label: 'sky-d' }),
  mkItem({ id: 'mail', title: 'メールの返信', order: T0 + 1 }),
  mkItem({ id: 'paid', title: '経費の精算', done: true }),
  mkItem({ id: 'lock', title: 'レビュー', startTime: '15:00', locked: true }),
  mkItem({ id: 'ai', title: '候補日を返す', start: '2026-11-11', by: 'connector', ai: 'claude', via: 'メール: 候補日' }),
  mkTask({ id: 'quote', title: '見積もりの提出', due: '2026-11-11', kind: 'work' }),
  mkItem({ id: 'dinner', kind: 'private', title: '夕食', startTime: '19:00', endTime: '21:00' }),
)

/** ウィークリーだけを描く（既定は L・2026-11-08 の週・領域 994px = 列 142px・休みは 11/11 と 11/14） */
async function renderWeek(over: Partial<ViewProps> = {}, opts: { path?: string; data?: Partial<AppData> } = {}) {
  const props = viewProps({ mode: 'week', viewed: '2026-11-10', area: { width: 994, height: 760 }, ...over })
  return renderView(WeekView, props, {
    path: opts.path ?? '/week/2026-11-08',
    width: over.width ?? 'L',
    data: opts.data ?? {
      items: WEEK,
      offDays: { '2026-11-11': mkOffDay('2026-11-11'), '2026-11-14': mkOffDay('2026-11-14') },
    },
  })
}

const tier = (kind: 'work' | 'private') => document.querySelector<HTMLElement>(`[data-tier="${kind}"]`) as HTMLElement

describe('7日を横（L・M。10.2）', () => {
  it('日曜から土曜の7列・日の見出し（丸いラベル・「11/8」・休みのチェック・祝日名）・段の名札（ITEMS-055・057・063）', async () => {
    await renderWeek()
    const view = screen.getByTestId(testIds.view('week'))
    expect(view.classList.contains('wk-h')).toBe(true)
    for (const d of DATES) {
      expect(screen.getByTestId(testIds.weekCol(d))).toBeTruthy()
      expect(screen.getByTestId(testIds.weekOff(d))).toBeTruthy()
    }
    const head = screen.getByTestId(testIds.weekHead('2026-11-08'))
    expect(head.textContent).toContain('SUN')
    expect(head.textContent).toContain('11/8')
    expect(within(head).getByText('日曜日')).toBeTruthy()
    // 今日は丸いラベルが今日の印・日付は太く
    const today = screen.getByTestId(testIds.weekHead('2026-11-10'))
    expect(today.querySelector('.pill.is-today')).toBeTruthy()
    expect(today.querySelector('.wk-md.is-today')).toBeTruthy()
    expect(within(tier('work')).getByText('WORK')).toBeTruthy()
    expect(within(tier('work')).getByText('仕事')).toBeTruthy()
    expect(within(tier('private')).getByText('PRIVATE')).toBeTruthy()
    expect(within(tier('private')).getByText('プライベート')).toBeTruthy()
  })

  it.each([
    ['2026-11-08', 'cp-sun'],
    ['2026-11-14', 'cp-sat'],
  ])('今日が %s でも、日付は土日・祝日の色のまま（7.1）で太さ 600（今日の印は丸いラベル。7.3）', async (today, tone) => {
    await renderWeek({ today })
    const md = screen.getByTestId(testIds.weekHead(today)).querySelector('.wk-md') as HTMLElement
    expect(md.classList.contains('is-today')).toBe(true)
    expect(md.classList.contains(tone)).toBe(true)
    expect(screen.getByTestId(testIds.weekHead(today)).querySelector('.pill.is-today')).toBeTruthy()
  })

  it('祝日名を日付の見出しの下に（CALENDAR-066）', async () => {
    await renderWeek({ viewed: '2026-11-03' }, { path: '/week/2026-11-01' })
    expect(within(screen.getByTestId(testIds.weekHead('2026-11-03'))).getByText('文化の日')).toBeTruthy()
  })

  it('休みの日は列の地を --off-fill（.cp-offday）にし、休みのチェックが付く（ITEMS-059・D33）', async () => {
    await renderWeek()
    expect(screen.getByTestId(testIds.weekCol('2026-11-11')).classList.contains('cp-offday')).toBe(true)
    expect(screen.getByTestId(testIds.weekCol('2026-11-10')).classList.contains('cp-offday')).toBe(false)
    expect((screen.getByTestId(testIds.weekOff('2026-11-11')) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId(testIds.weekOff('2026-11-10')) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByTestId(testIds.weekHead('2026-11-11')).classList.contains('is-off')).toBe(true)
  })

  it.each([
    [994, '1'],
    [840, '1'],
    [833, '2'],
    [700, '2'],
  ])('領域 %spx（列 = 1/7）→ 見出しは %s 行（120px より狭いと2行。ITEMS-060）', async (width, rows) => {
    await renderWeek({ area: { width, height: 760 } })
    expect(screen.getByTestId(testIds.view('week')).dataset.headRows).toBe(rows)
    expect(screen.getByTestId(testIds.weekHead('2026-11-08')).classList.contains(`is-rows-${rows}`)).toBe(true)
  })

  it('M（幅の区分）でも7日を横に並べる（ITEMS-052）', async () => {
    await renderWeek({ width: 'M', area: { width: 700, height: 800 } })
    expect(screen.getByTestId(testIds.view('week')).classList.contains('wk-h')).toBe(true)
  })

  it('上が仕事・下がプライベートの段。レーンはその段の7列すべてに同じ高さ（レーンの数 × 40px。ITEMS-061・067）', async () => {
    await renderWeek()
    const tiers = [...document.querySelectorAll<HTMLElement>('.wk-tier')].map((t) => t.dataset.tier)
    expect(tiers).toEqual(['work', 'private'])
    const lanes = [...tier('work').querySelectorAll<HTMLElement>('.wk-lanes')]
    expect(lanes).toHaveLength(7)
    // 仕事のレーン: 研修＋出張の準備（0）・申請の受付＋資料づくり＋棚卸し（1）
    for (const el of lanes) {
      expect(el.style.height).toBe('80px')
      expect(el.querySelectorAll('.wk-lane')).toHaveLength(2)
    }
    // プライベートは複数日の予定が無いのでレーンの行も無い
    expect(tier('private').querySelectorAll('.wk-lanes')).toHaveLength(0)
  })

  it('始点のカード（件名1行・期間）・受けた表示（‹ 件名）・終点の●・土曜の＞・土曜に始まって縮むカード（CALENDAR-114〜122）', async () => {
    await renderWeek()
    const start = screen.getByTestId(testIds.weekStart('multi'))
    expect(start.textContent).toContain('資料づくり')
    // 列 142px では「11/9 10:00〜11/12 18:00」が入らないので日付だけ（CALENDAR-130）
    expect(start.textContent).toContain('11/9〜11/12')
    expect(start.dataset.label).toBe('sky-l')
    const recv = screen.getByTestId(testIds.weekReceived('recv'))
    expect(recv.textContent).toBe('‹ 研修')
    expect(within(recv).queryByRole('button', { name: /完了/ })).toBeNull()
    expect(screen.getByTestId(testIds.weekEnd('recv')).closest('.wk-cell')).toBe(tier('work').querySelectorAll('.wk-cell')[2])
    expect(screen.getByTestId(testIds.weekEnd('multi')).closest('.wk-cell')).toBe(tier('work').querySelectorAll('.wk-cell')[4])
    expect(screen.getByTestId(testIds.weekEdge('next')).textContent).toBe('>')
    expect(screen.getByTestId(testIds.weekEdge('next')).closest('.wk-cell')).toBe(tier('work').querySelectorAll('.wk-cell')[6])
    const sat = screen.getByTestId(testIds.weekStart('sat'))
    expect(sat.classList.contains('is-shrink')).toBe(true)
    expect(screen.getByTestId(testIds.weekEdge('sat')).closest('.wk-lane')).toBe(sat.closest('.wk-lane'))
    // 前の週から続いて日曜に終わる物は、受けた表示の中に●（線なし）
    const endsSun = screen.getByTestId(testIds.weekReceived('ends-sun'))
    expect(within(endsSun).getByTestId(testIds.weekEnd('ends-sun'))).toBeTruthy()
    expect(endsSun.closest('.wk-lane')?.querySelector('.wk-line')).toBeNull()
  })

  it('線はカードの端から●まで（日ごとの部分）。色はラベル（data-label）、無ければ土台の色（data-kind だけ。CALENDAR-117）', async () => {
    await renderWeek()
    const lanes = [...tier('work').querySelectorAll<HTMLElement>('.wk-lane[data-kind]')]
    // 資料づくり（sky-l）: 月曜の始点のカードから木曜の●まで
    const multi = lanes.filter((l) => l.dataset.label === 'sky-l')
    expect(multi.map((l) => l.querySelector('.wk-line')?.className)).toEqual([
      'wk-line is-from-card',
      'wk-line is-through',
      'wk-line is-through',
      'wk-line is-to-dot',
    ])
    expect(multi.map((l) => l.closest('.wk-cell'))).toEqual([...tier('work').querySelectorAll('.wk-cell')].slice(1, 5))
    // 研修（ラベルなし）: 線の色は土台の色（data-label を付けない）
    const recv = lanes.filter((l) => l.querySelector(`[data-testid="${testIds.weekReceived('recv')}"]`))
    expect(recv).toHaveLength(1)
    expect(recv[0].dataset.label).toBeUndefined()
    expect(recv[0].dataset.kind).toBe('work')
    // 出張の準備: 土曜は右の端の＞まで
    const next = lanes.filter((l) => l.dataset.label === 'blue-d')
    expect(next.map((l) => l.querySelector('.wk-line')?.className)).toEqual([
      'wk-line is-from-card',
      'wk-line is-through',
      'wk-line is-to-arrow',
    ])
  })

  it('1日のカードは 7.5 の順（時刻のある物 → 時刻の無い物 → 完了した物）でレーンの下に（CALENDAR-128）', async () => {
    await renderWeek()
    const cell = tier('work').querySelectorAll('.wk-cell')[2]
    const order = [...cell.querySelectorAll<HTMLElement>('.wk-singles > .wk-card')].map((c) => c.dataset.testid)
    expect(order).toEqual(['meet', 'lock', 'mail', 'paid'].map((id) => testIds.weekCard(id)))
  })

  it('カード: 地は区分（data-kind）、ラベルの一辺（data-label）、点線の丸、件名・時刻（7.7）。依頼者・メモは出さない（CALENDAR-112）', async () => {
    await renderWeek(
      {},
      {
        data: {
          items: items(
            mkItem({ id: 'c', title: '打ち合わせ', startTime: '13:00', requester: '総務', memo: 'メモの中身', label: 'teal-l' }),
            mkItem({ id: 'mail', title: 'メールの返信' }),
          ),
        },
      },
    )
    const card = screen.getByTestId(testIds.weekCard('c'))
    expect(card.dataset.kind).toBe('work')
    expect(card.dataset.label).toBe('teal-l')
    expect(within(card).getByTestId(testIds.done('c'))).toBeTruthy()
    expect(card.textContent).toContain('打ち合わせ')
    expect(card.querySelector('.wk-time')?.textContent).toBe('13:00')
    expect(card.textContent).not.toContain('総務')
    expect(card.textContent).not.toContain('メモの中身')
    // ラベルの無いカードは data-label を付けない（一辺なし）
    expect(screen.getByTestId(testIds.weekCard('mail')).dataset.label).toBeUndefined()
  })

  it('完了した物（7.9）: カード・始点のカード・受けた表示・●に is-done、丸に✓', async () => {
    await renderWeek()
    const paid = screen.getByTestId(testIds.weekCard('paid'))
    expect(paid.classList.contains('is-done')).toBe(true)
    expect(within(paid).getByTestId(testIds.done('paid')).dataset.done).toBe('true')
    expect(screen.getByTestId(testIds.weekReceived('ends-sun')).classList.contains('is-done')).toBe(true)
    expect(screen.getByTestId(testIds.weekEnd('ends-sun')).classList.contains('is-done')).toBe(true)
    expect(screen.getByTestId(testIds.weekCard('mail')).classList.contains('is-done')).toBe(false)
  })

  it('右上の印（〆・ロック・AI の札。7.7・ITEMS-078）', async () => {
    await renderWeek()
    expect(within(screen.getByTestId(testIds.weekCard('quote'))).getByText('〆')).toBeTruthy()
    expect(screen.getByTestId(testIds.weekCard('lock')).querySelector('[data-lock]')).toBeTruthy()
    const ai = screen.getByTestId(testIds.weekCard('ai'))
    expect(within(ai).getByTestId(testIds.aiTag('ai')).textContent).toBe('Claude')
    expect(screen.getByTestId(testIds.weekCard('mail')).querySelector('.cp-marks')).toBeNull()
  })

  it('列が狭くて件名が細くなる時は、丸の行と件名の行に分ける（AI の札がとても狭い列に入らない時は印を下に）', async () => {
    await renderWeek({ area: { width: 700, height: 800 } })
    expect(screen.getByTestId(testIds.weekCard('quote')).classList.contains('is-stacked')).toBe(true)
    expect(screen.getByTestId(testIds.weekCard('mail')).classList.contains('is-stacked')).toBe(false)
  })

  it('始点のカード・受けた表示の印は、件名の横に置くと件名が細くなりすぎる狭い列では下の行の右に（期間はその分あける。開発）', async () => {
    const data = {
      items: items(
        span('lk', '2026-11-09', '2026-11-11', { title: '鍵のかかった予定', locked: true, startTime: '10:00', endTime: '12:00' }),
        span('cl', '2026-11-05', '2026-11-10', { title: 'Claude の予定', by: 'connector', ai: 'claude', via: 'メール' }),
      ),
    }
    // 列 142px: ロックは件名の横、AI の札は受けた表示の件名を細くしすぎないので横のまま（受けた表示は丸が無く広い）
    await renderWeek({}, { data })
    expect(screen.getByTestId(testIds.weekStart('lk')).classList.contains('is-marks-low')).toBe(false)
    expect(screen.getByTestId(testIds.weekReceived('cl')).classList.contains('is-marks-low')).toBe(false)
  })

  it('印を期間の行の右に置き、そこに期間が入らない始点のカード（〆・ロック・Claude）は、期間を読み上げだけにして件名は1行目のまま（印と重ねない）', async () => {
    const data = {
      items: items(
        span('busy', '2026-11-10', '2026-11-12', {
          title: '見積もりの確認と返送',
          origin: 'list',
          locked: true,
          by: 'connector',
          ai: 'claude',
          via: 'メール',
        }),
        span('plain', '2026-11-10', '2026-11-12', { title: '資料づくり', locked: true }),
      ),
    }
    // L の 1400px（列 142px）
    await renderWeek({}, { data })
    const card = screen.getByTestId(testIds.weekStart('busy'))
    expect(card.classList.contains('is-two-lines')).toBe(false)
    expect(card.classList.contains('is-marks-low')).toBe(true)
    expect(card.classList.contains('is-period-hidden')).toBe(true)
    expect(card.querySelector('.wk-period')).toBeNull()
    expect(card.querySelector('.visually-hidden')?.textContent).toBe('〜11/12')
    // 期間を出す時は付けない
    const plain = screen.getByTestId(testIds.weekStart('plain'))
    expect(plain.querySelector('.wk-period')?.textContent).toBe('〜11/12')
    expect(plain.classList.contains('is-period-hidden')).toBe(false)
  })

  it('M の列（100px）では、始点のカードは件名を2行にして印を2行目の右の端へ、AI の札の付いた受けた表示は印を下の行へ', async () => {
    const data = {
      items: items(
        span('lk', '2026-11-09', '2026-11-11', { title: '鍵のかかった予定', locked: true, startTime: '10:00', endTime: '12:00' }),
        span('cl', '2026-11-05', '2026-11-10', { title: 'Claude の予定', by: 'connector', ai: 'claude', via: 'メール' }),
        span('pl', '2026-11-10', '2026-11-12', { title: '印の無い予定' }),
      ),
    }
    await renderWeek({ width: 'M', area: { width: 700, height: 800 } }, { data })
    const lk = screen.getByTestId(testIds.weekStart('lk'))
    expect(lk.classList.contains('is-two-lines')).toBe(true)
    expect(lk.classList.contains('has-marks')).toBe(true)
    expect(lk.classList.contains('is-marks-low')).toBe(true)
    // 2行目の右のあきはロックの印の幅（12px＋4px）
    expect(lk.style.getPropertyValue('--wk-marks-w')).toBe('16px')
    // 期間は読み上げにだけ残す（見えない）
    expect(lk.querySelector('.wk-period')).toBeNull()
    expect(lk.querySelector('.visually-hidden')?.textContent).toBe('11/9 10:00〜11/11 12:00')
    expect(screen.getByTestId(testIds.weekReceived('cl')).classList.contains('is-marks-low')).toBe(true)
    expect(screen.getByTestId(testIds.weekReceived('cl')).classList.contains('is-two-lines')).toBe(false)
    const pl = screen.getByTestId(testIds.weekStart('pl'))
    expect(pl.classList.contains('is-two-lines')).toBe(true)
    expect(pl.classList.contains('has-marks')).toBe(false)
    expect(pl.style.getPropertyValue('--wk-marks-w')).toBe('')
  })

  it('「＋」の行を各日・各段のいちばん下に（ITEMS-066）', async () => {
    await renderWeek()
    for (const d of DATES)
      for (const kind of ['work', 'private'] as const) {
        const add = screen.getByTestId(testIds.weekAdd(d, kind))
        expect(add.closest('.wk-tier')?.getAttribute('data-tier')).toBe(kind)
        expect(add.parentElement?.lastElementChild).toBe(add)
      }
  })

  it('いちばん外の要素がスクロールする要素（data-week-scroller。ドラッグの自動のスクロールを絞る）', async () => {
    await renderWeek()
    expect(screen.getByTestId(testIds.view('week')).hasAttribute('data-week-scroller')).toBe(true)
  })

  it('落とせる所（その段のその日の列）に日付と段の印（data-date・段の data-tier の中）', async () => {
    await renderWeek()
    for (const kind of ['work', 'private'] as const)
      expect([...tier(kind).querySelectorAll<HTMLElement>('.wk-cell')].map((c) => c.dataset.date)).toEqual(DATES)
  })
})

describe('予定を押すと詳細（12.3・ITEMS-079・195）', () => {
  it.each([
    ['1日のカード', testIds.weekCard('meet'), 'meet'],
    ['始点のカード', testIds.weekStart('multi'), 'multi'],
    ['受けた表示', testIds.weekReceived('recv'), 'recv'],
    ['終点の●', testIds.weekEnd('multi'), 'multi'],
    ['端の＞', testIds.weekEdge('next'), 'next'],
  ])('%s', async (_, testId, id) => {
    const user = userEvent.setup()
    const { router } = await renderWeek()
    const el = screen.getByTestId(testId)
    const target = el.tagName === 'BUTTON' ? el : (el.querySelector('.wk-open') as HTMLElement)
    await user.click(target)
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'detail', id })
    expect(router.state.location.pathname).toBe('/week/2026-11-08')
  })

  it('点線の丸は完了にするだけで詳細を開かない（カードの中の別のボタン。D19）', async () => {
    const user = userEvent.setup()
    const { router } = await renderWeek()
    await user.click(screen.getByTestId(testIds.done('mail')))
    expect(getData().items.mail.done).toBe(true)
    expect(sheetOf(router.state.location.state)).toBeNull()
    expect(screen.getByTestId(testIds.weekCard('mail')).classList.contains('is-done')).toBe(true)
  })

  it('AI の札は出どころのメモを出すだけで詳細を開かない', async () => {
    const user = userEvent.setup()
    const { router } = await renderWeek()
    await user.click(screen.getByTestId(testIds.aiTag('ai')))
    expect(screen.getByTestId(`${testIds.aiTag('ai')}-via`).textContent).toContain('メール: 候補日')
    expect(sheetOf(router.state.location.state)).toBeNull()
  })
})

describe('登録した予定（item:{id}）を目立たせて、週の中で見える所まで動かす（4.9・12.2。デイリー・落とした時と同じ。開発）', () => {
  /**
   * jsdom は大きさを測らないので、el を「画面の上の端から縦に 300px 見えて、中身が 1000px のスクロールする所」にし、card をその所の
   * 上の端から 500px（見えていない所）に置く。el.scrollTo を返す
   */
  function layout(el: HTMLElement, card: HTMLElement) {
    el.style.overflowY = 'auto'
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1000 })
    el.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 140, height: 300 })
    card.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 500, width: 140, height: 40 })
    const scrollTo = vi.fn()
    el.scrollTo = scrollTo as unknown as typeof el.scrollTo
    return scrollTo
  }

  it.each([
    ['1日のカード', testIds.weekCard('mail'), 'mail', 'L'],
    ['始点のカード', testIds.weekStart('multi'), 'multi', 'L'],
    ['受けた表示', testIds.weekReceived('recv'), 'recv', 'L'],
    ['7日を縦のカード', testIds.weekCard('mail'), 'mail', 'S'],
  ] as const)('%s', async (_, testId, id, width) => {
    await renderWeek({ width })
    const el = screen.getByTestId(testId)
    // L は段の中（仕事の段）、S は週の全体がスクロールする
    const scroller = (width === 'S' ? screen.getByTestId(testIds.view('week')) : el.closest('.wk-tier-body')) as HTMLElement
    const scrollTo = layout(scroller, el)
    const page = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const native = vi.mocked(Element.prototype.scrollIntoView)
    native.mockClear()
    act(() => useCalendarUi.getState().flashTarget(`item:${id}`))
    expect(el.classList.contains('flash')).toBe(true)
    // block: nearest と同じ（カードの下の端を見える所の下の端に合わせる）。ページは動かさない
    expect(scrollTo).toHaveBeenCalledWith({ top: 540 - 300, behavior: 'smooth' })
    expect(native).not.toHaveBeenCalled()
    expect(page).not.toHaveBeenCalled()
  })

  it('もう見えている時は動かさない', async () => {
    await renderWeek()
    const el = screen.getByTestId(testIds.weekCard('mail'))
    const scrollTo = layout(el.closest('.wk-tier-body') as HTMLElement, el)
    el.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 100, width: 140, height: 40 })
    act(() => useCalendarUi.getState().flashTarget('item:mail'))
    expect(el.classList.contains('flash')).toBe(true)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('視差効果を減らす設定では、すぐに動かす', async () => {
    const props = viewProps({ mode: 'week', viewed: '2026-11-10', area: { width: 994, height: 760 } })
    await renderView(WeekView, props, { path: '/week/2026-11-08', data: { items: WEEK }, reducedMotion: true })
    const el = screen.getByTestId(testIds.weekCard('meet'))
    const scrollTo = layout(el.closest('.wk-tier-body') as HTMLElement, el)
    act(() => useCalendarUi.getState().flashTarget('item:meet'))
    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: 'auto' })
  })
})

describe('7日を縦（S。10.4）', () => {
  it('段の名札の行・日曜から土曜の日のかたまり（見出し・左が仕事・右がプライベート）・休みの日のかたまりの地（ITEMS-083〜088）', async () => {
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    const view = screen.getByTestId(testIds.view('week'))
    expect(view.classList.contains('wk-v')).toBe(true)
    expect(view.hasAttribute('data-week-scroller')).toBe(true)
    const tags = view.querySelector('.wk-vtags') as HTMLElement
    expect(tags.textContent).toBe('WORK仕事PRIVATEプライベート')
    const blocks = [...view.querySelectorAll<HTMLElement>('.wk-block')]
    expect(blocks.map((b) => b.dataset.testid)).toEqual(DATES.map((d) => testIds.weekCol(d)))
    const sun = blocks[0]
    expect(within(sun).getByTestId(testIds.weekHead('2026-11-08')).classList.contains('is-block')).toBe(true)
    expect([...sun.querySelectorAll<HTMLElement>('.wk-half')].map((h) => h.dataset.tier)).toEqual(['work', 'private'])
    expect(blocks[3].classList.contains('cp-offday')).toBe(true)
    expect(blocks[2].classList.contains('cp-offday')).toBe(false)
    // 「＋」はいつも出す行（各半分のいちばん下）
    const add = within(blocks[2]).getByTestId(testIds.weekAdd('2026-11-10', 'private'))
    expect(add.parentElement?.lastElementChild).toBe(add)
    // 半分（落とせる所）に日付と段の印
    expect([...blocks[2].querySelectorAll<HTMLElement>('.wk-half')].map((h) => [h.dataset.date, h.dataset.tier])).toEqual([
      ['2026-11-10', 'work'],
      ['2026-11-10', 'private'],
    ])
  })

  it('5本のレーンの週: レールは3本（左から 4・14・24px）、4本目からは期間付きの始点のカードと締め切り日の「● 件名」の行（ITEMS-090〜097）', async () => {
    const dense = items(
      span('l0', '2026-11-08', '2026-11-11', { title: '企画書' }),
      span('l1', '2026-11-08', '2026-11-10', { title: '見積もり' }),
      span('l2', '2026-11-09', '2026-11-13', { title: '契約の確認' }),
      span('l3', '2026-11-09', '2026-11-12', { title: '納品の準備' }),
      span('l4', '2026-11-10', '2026-11-13', { title: '請求' }),
    )
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } }, { data: { items: dense } })
    const half = (d: string) =>
      screen.getByTestId(testIds.weekCol(d)).querySelector<HTMLElement>('[data-tier="work"]') as HTMLElement
    // レールは3本: 半分の左の余白は 30px＋4px（どの日も）
    for (const d of DATES) expect(half(d).style.paddingLeft).toBe('34px')
    const rails = (d: string) => [...half(d).querySelectorAll<HTMLElement>('.wk-rail')].map((r) => r.style.left)
    expect(rails('2026-11-08')).toEqual(['4px', '14px'])
    expect(rails('2026-11-09')).toEqual(['4px', '14px', '24px'])
    // 4本目・5本目のレーンの物は線を引かない
    expect(half('2026-11-10').querySelectorAll('.wk-rail[data-lane="3"], .wk-rail[data-lane="4"]')).toHaveLength(0)
    // 始点のカードは期間付き
    expect(screen.getByTestId(testIds.weekStart('l3')).textContent).toContain('〜11/12')
    // 締め切り日の半分のいちばん上に「● 件名」
    const row = screen.getByTestId(testIds.weekOverflow('2026-11-12', 'l3'))
    expect(row.textContent).toBe('納品の準備')
    expect(half('2026-11-12').querySelector('.wk-over')).toBe(row)
    expect(screen.getByTestId(testIds.weekOverflow('2026-11-13', 'l4'))).toBeTruthy()
    // レールの締め切り日の●（企画書は 11/11、見積もりは 11/10）
    expect(within(half('2026-11-11')).getByTestId(testIds.weekEnd('l0')).classList.contains('is-rail')).toBe(true)
    expect(within(half('2026-11-10')).getByTestId(testIds.weekEnd('l1'))).toBeTruthy()
  })

  it('前の週から続く物は日曜のいちばん上に受けた表示、次の週へ続く物は土曜の下の端に下向きの矢印（ITEMS-094・095）', async () => {
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    const sunWork = screen.getByTestId(testIds.weekCol('2026-11-08')).querySelector('[data-tier="work"]') as HTMLElement
    expect(within(sunWork).getByTestId(testIds.weekReceived('recv'))).toBeTruthy()
    // 日曜に終わる物は受けた表示の中に●
    expect(within(screen.getByTestId(testIds.weekReceived('ends-sun'))).getByTestId(testIds.weekEnd('ends-sun'))).toBeTruthy()
    const satWork = screen.getByTestId(testIds.weekCol('2026-11-14')).querySelector('[data-tier="work"]') as HTMLElement
    const arrow = within(satWork).getByTestId(testIds.weekEdge('next'))
    expect(arrow.classList.contains('is-down')).toBe(true)
    // 土曜に始まる物は縮めずに、線を下の端の矢印まで（10.4）
    expect(screen.getByTestId(testIds.weekStart('sat')).classList.contains('is-shrink')).toBe(false)
    expect(within(satWork).getByTestId(testIds.weekEdge('sat')).classList.contains('is-down')).toBe(true)
  })

  it('S でもカード・受けた表示を押すと詳細', async () => {
    const user = userEvent.setup()
    const { router } = await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    await user.click(screen.getByTestId(testIds.weekReceived('recv')).querySelector('.wk-open') as HTMLElement)
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'detail', id: 'recv' })
  })
})

describe('日付の見出し・休みのチェック（10.2・10.4・7.4・7.12）', () => {
  it.each([
    ['L', 994],
    ['S', 341],
  ] as const)(
    '%s: 日付の見出し（丸いラベル＋「11/10」）を押すと、その日のデイリーへ積む（ITEMS-055・CALENDAR-192）',
    async (width, px) => {
      const user = userEvent.setup()
      const { router } = await renderWeek({ width, area: { width: px, height: 600 } })
      await user.click(within(screen.getByTestId(testIds.weekHead('2026-11-12'))).getByRole('button', { name: /デイリーを開く/ }))
      expect(router.state.location.pathname).toBe('/day/2026-11-12')
      expect(router.state.historyAction).toBe('PUSH')
    },
  )

  it('休みのチェックを押すと setOffDay で休みが付き、もう一度押すと外れる（記録は消さない。ITEMS-056・CALENDAR-046・D33）', async () => {
    const user = userEvent.setup()
    const spy = vi.spyOn(actions, 'setOffDay')
    await renderWeek()
    const check = screen.getByTestId(testIds.weekOff('2026-11-10')) as HTMLInputElement
    await user.click(check)
    expect(spy).toHaveBeenLastCalledWith('2026-11-10', true)
    expect(getData().offDays['2026-11-10']?.off).toBe(true)
    expect(check.checked).toBe(true)
    expect(screen.getByTestId(testIds.weekCol('2026-11-10')).classList.contains('cp-offday')).toBe(true)
    // 休みの日（11/11）は外す。記録は off: false で残る
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-11')))
    expect(spy).toHaveBeenLastCalledWith('2026-11-11', false)
    expect(getData().offDays['2026-11-11']?.off).toBe(false)
    expect(screen.getByTestId(testIds.weekCol('2026-11-11')).classList.contains('cp-offday')).toBe(false)
    spy.mockRestore()
  })

  it('S の日のかたまりの見出しの休みのチェックも同じ（ITEMS-085）', async () => {
    const user = userEvent.setup()
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    await user.click(screen.getByTestId(testIds.weekOff('2026-11-13')))
    expect(getData().offDays['2026-11-13']?.off).toBe(true)
    expect(screen.getByTestId(testIds.weekCol('2026-11-13')).classList.contains('cp-offday')).toBe(true)
  })
})

describe('「＋」→ すばやく足す（12.1・ITEMS-068・D44）', () => {
  const input = () => screen.getByTestId(testIds.quickAddInput) as HTMLInputElement

  it('「＋」を押すと、その「＋」の行がその場で入力欄に替わる。Enter で足し、開いたまま続けて足せる（ITEMS-153〜155・161）', async () => {
    const user = userEvent.setup()
    await renderWeek()
    const cell = tier('work').querySelectorAll<HTMLElement>('.wk-cell')[4]
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    expect(screen.queryByTestId(testIds.weekAdd('2026-11-12', 'work'))).toBeNull()
    expect(cell.contains(input())).toBe(true)
    expect(cell.lastElementChild?.contains(input())).toBe(true)
    expect(document.activeElement).toBe(input())
    await user.type(input(), '電話をかける{Enter}')
    const added = Object.values(getData().items).find((it) => it.title === '電話をかける')
    expect(added).toMatchObject({
      origin: 'calendar',
      kind: 'work',
      start: '2026-11-12',
      due: null,
      startTime: null,
      listed: false,
    })
    // 足した予定はその日・その段のカードに（入力欄の上）。入力欄は空に戻って開いたまま
    const card = screen.getByTestId(testIds.weekCard(added?.id ?? ''))
    expect(cell.contains(card)).toBe(true)
    expect(card.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(input().value).toBe('')
    expect(document.activeElement).toBe(input())
    await user.type(input(), '資料を送る{Enter}')
    expect(Object.values(getData().items).some((it) => it.title === '資料を送る' && it.start === '2026-11-12')).toBe(true)
  })

  it('Esc で閉じると「＋」に戻ってフォーカスも戻る。書きかけは控えたままで、開き直すと戻る（ITEMS-156・159）', async () => {
    const user = userEvent.setup()
    await renderWeek()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-13', 'private')))
    await user.type(input(), '書きかけ')
    expect(readLocal(quickDraftKey('2026-11-13', 'private'))).toBe('書きかけ')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    const add = screen.getByTestId(testIds.weekAdd('2026-11-13', 'private'))
    expect(document.activeElement).toBe(add)
    expect(readLocal(quickDraftKey('2026-11-13', 'private'))).toBe('書きかけ')
    await user.click(add)
    expect(input().value).toBe('書きかけ')
  })

  it('開くのは1か所だけ: ほかの「＋」を押すと前の入力欄は閉じて、押した所に開く（フォーカスは戻さない）', async () => {
    const user = userEvent.setup()
    await renderWeek()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-09', 'private')))
    expect(screen.getAllByTestId(testIds.quickAddInput)).toHaveLength(1)
    expect(tier('private').querySelectorAll('.wk-cell')[1].contains(input())).toBe(true)
    expect(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work'))).toBeTruthy()
    expect(document.activeElement).toBe(input())
  })

  it('入力欄の外（カード）を押すと閉じ、押したカードの詳細が開く', async () => {
    const user = userEvent.setup()
    const { router } = await renderWeek()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    await user.click(screen.getByTestId(testIds.weekCard('meet')).querySelector('.wk-open') as HTMLElement)
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'detail', id: 'meet' })
  })

  it('入力欄の外の押せない所（列の地）を押して閉じた時は、「＋」へフォーカスを戻さない（戻すのは Esc の時だけ）', async () => {
    const user = userEvent.setup()
    await renderWeek()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    await user.click(screen.getByTestId(testIds.weekCol('2026-11-10')))
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(document.activeElement).not.toBe(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
  })

  it('入力欄の外を押した時は、押し終わる（click）まで閉じない（S で下のかたまりがずれて、指の下の別の予定が押されないように。開発）', async () => {
    const user = userEvent.setup()
    const { router } = await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-09', 'work')))
    const open = screen.getByTestId(testIds.weekCard('meet')).querySelector('.wk-open') as HTMLElement
    await user.pointer({ keys: '[MouseLeft>]', target: open })
    // 押している間は入力欄のまま（並びが変わらない）
    expect(screen.getByTestId(testIds.quickAddInput)).toBeTruthy()
    await user.pointer({ keys: '[/MouseLeft]', target: open })
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(sheetOf(router.state.location.state)).toEqual({ kind: 'detail', id: 'meet' })
  })

  it('押した後に click が来ない時（なぞってスクロールした・長押しした）も閉じる。Esc はすぐ閉じる', async () => {
    const user = userEvent.setup()
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    const add = () => screen.getByTestId(testIds.weekAdd('2026-11-09', 'work'))
    const card = screen.getByTestId(testIds.weekCard('meet'))
    // なぞってスクロールした（ブラウザが pointercancel）
    await user.click(add())
    fireEvent.pointerDown(card)
    expect(screen.getByTestId(testIds.quickAddInput)).toBeTruthy()
    fireEvent.pointerCancel(card)
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    // 離しても click が来ない（長押し）: 少し待って閉じる
    await user.click(add())
    fireEvent.pointerDown(card)
    fireEvent.pointerUp(card)
    expect(screen.getByTestId(testIds.quickAddInput)).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull())
    // 押していない時の Esc はすぐ
    await user.click(add())
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
  })

  it('週を移ると閉じ、戻ってきても開き直さない', async () => {
    const user = userEvent.setup()
    const view = await renderWeek()
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work')))
    const props = viewProps({ mode: 'week', viewed: '2026-11-10', area: { width: 994, height: 760 } })
    view.setProps({ ...props, viewed: '2026-11-17' })
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    view.setProps(props)
    expect(screen.queryByTestId(testIds.quickAddInput)).toBeNull()
    expect(screen.getByTestId(testIds.weekAdd('2026-11-12', 'work'))).toBeTruthy()
  })

  it('S: 日のかたまりの半分の「＋」も、その場で入力欄に替わる', async () => {
    const user = userEvent.setup()
    await renderWeek({ width: 'S', area: { width: 341, height: 600 } })
    await user.click(screen.getByTestId(testIds.weekAdd('2026-11-10', 'private')))
    const half = screen.getByTestId(testIds.weekCol('2026-11-10')).querySelector('[data-tier="private"]') as HTMLElement
    expect(half.contains(input())).toBe(true)
    await user.type(input(), '買い物{Enter}')
    expect(Object.values(getData().items).some((it) => it.title === '買い物' && it.kind === 'private')).toBe(true)
  })
})

describe('列が狭い時の始点のカード・受けた表示（件名を2行に。開発。L の 960px ほどのウインドウ）', () => {
  /** 960px のウインドウの領域（554px。列 79px） */
  const NARROW = { width: 554, height: 700 }

  it('丸の横に4字も入らない列では、始点のカードの件名を2行にして期間は読み上げだけに。広い列は1行と期間のまま', async () => {
    await renderWeek({ area: NARROW })
    const multi = screen.getByTestId(testIds.weekStart('multi'))
    expect(multi.classList.contains('is-two-lines')).toBe(true)
    expect(multi.querySelector('.cp-title')?.classList.contains('cp-lines-2')).toBe(true)
    expect(multi.querySelector('.wk-period')).toBeNull()
    expect(multi.querySelector('.visually-hidden')?.textContent).toBe('11/9 10:00〜11/12 18:00')
    // 高さ 36px のカード・線の高さは変えない（クラスは同じ is-start）
    expect(multi.classList.contains('is-start')).toBe(true)
    // 土曜に始まって縮むカードも
    expect(screen.getByTestId(testIds.weekStart('sat')).classList.contains('is-two-lines')).toBe(true)
    // 受けた表示も「‹ 件名」を2行に
    const recv = screen.getByTestId(testIds.weekReceived('recv'))
    expect(recv.classList.contains('is-two-lines')).toBe(true)
    expect(recv.querySelector('.cp-title')?.classList.contains('cp-lines-2')).toBe(true)
  })

  it('AI の札が広くて2行目に2字も残らない時は、件名を1行目だけにして2行目は札（期間は読み上げだけ）', async () => {
    const data = {
      items: items(
        span('cl', '2026-11-10', '2026-11-12', { title: '展示会の手配', by: 'connector', ai: 'claude', via: 'メール' }),
      ),
    }
    await renderWeek({ area: NARROW }, { data })
    const cl = screen.getByTestId(testIds.weekStart('cl'))
    expect(cl.classList.contains('is-two-lines')).toBe(true)
    expect(cl.classList.contains('is-marks-low')).toBe(true)
    expect(cl.querySelector('.cp-title')?.classList.contains('cp-lines-1')).toBe(true)
    expect(cl.querySelector('.wk-period')).toBeNull()
    expect(within(cl).getByTestId(testIds.aiTag('cl'))).toBeTruthy()
  })

  it('件名が丸の右の1行に入る短い件名は、2行目に期間を出す', async () => {
    const data = { items: items(span('trip', '2026-11-13', '2026-11-15', { title: '旅行', kind: 'private' })) }
    await renderWeek({ area: NARROW }, { data })
    const trip = screen.getByTestId(testIds.weekStart('trip'))
    expect(trip.classList.contains('is-two-lines')).toBe(true)
    expect(trip.classList.contains('has-period')).toBe(true)
    expect(trip.querySelector('.cp-title')?.classList.contains('cp-lines-1')).toBe(true)
    expect(trip.querySelector('.wk-period')?.textContent).toBe('〜11/15')
  })

  it('L の広い列（142px）と S は、今までどおり件名 1行・期間', async () => {
    await renderWeek()
    expect(screen.getByTestId(testIds.weekStart('multi')).classList.contains('is-two-lines')).toBe(false)
    expect(screen.getByTestId(testIds.weekReceived('recv')).classList.contains('is-two-lines')).toBe(false)
  })

  it('S（390px の半分）でも1行のまま', async () => {
    await renderWeek({ width: 'S', area: { width: 374, height: 600 } })
    expect(screen.getByTestId(testIds.weekStart('multi')).classList.contains('is-two-lines')).toBe(false)
    expect(screen.getByTestId(testIds.weekStart('multi')).querySelector('.wk-period')).toBeTruthy()
  })
})
