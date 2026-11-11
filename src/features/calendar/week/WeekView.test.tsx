// ウィークリーの画面（docs/SPEC.md の 10.・7.7〜7.9・4.3・12.3）: 7日を横（L・M）と7日を縦（S）の描き方、区分ごとのレーン・
// 受けた表示・端の＞・終点の●・完了の見え方・印・休みの列・見出しの行の数・縦のレールと「● 件名」の行・「＋」の行、
// 予定を押すと詳細が開く（丸・AI の札は別のボタン）
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mkItem, mkOffDay, mkTask, T0 } from '../../../domain/testData'
import type { AppData, Item } from '../../../domain/types'
import { getData } from '../../../store/appStore'
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

  it('M の列（100px）では、ロックの付いた始点のカードと AI の札の付いた受けた表示の印を下の行へ', async () => {
    const data = {
      items: items(
        span('lk', '2026-11-09', '2026-11-11', { title: '鍵のかかった予定', locked: true, startTime: '10:00', endTime: '12:00' }),
        span('cl', '2026-11-05', '2026-11-10', { title: 'Claude の予定', by: 'connector', ai: 'claude', via: 'メール' }),
        span('pl', '2026-11-10', '2026-11-12', { title: '印の無い予定' }),
      ),
    }
    await renderWeek({ width: 'M', area: { width: 700, height: 800 } }, { data })
    const lk = screen.getByTestId(testIds.weekStart('lk'))
    expect(lk.classList.contains('is-marks-low')).toBe(true)
    // 期間の行の右のあきはロックの印の幅（12px＋4px）
    expect(lk.style.getPropertyValue('--wk-marks-w')).toBe('16px')
    // 期間は日付だけ（印の分も引いた幅に入らない）
    expect(lk.querySelector('.wk-period')?.textContent).toBe('11/9〜11/11')
    expect(screen.getByTestId(testIds.weekReceived('cl')).classList.contains('is-marks-low')).toBe(true)
    expect(screen.getByTestId(testIds.weekStart('pl')).classList.contains('is-marks-low')).toBe(false)
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
