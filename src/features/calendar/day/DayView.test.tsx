// デイリーの画面（DayView。docs/SPEC.md の 11.1〜11.3・7.3・7.4・7.7〜7.9・4.3・D21・D39・D40）。描いた物（クラス・data-*・字・
// 位置の style・読み上げ）と、押した時に呼ぶ物を確かめる。CSS の色・大きさの見え方は E2E（e2e/day.spec.ts）で見る
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mkItem, mkOffDay, mkTask, T0 } from '../../../domain/testData'
import type { AppData, Item } from '../../../domain/types'
import { getData } from '../../../store/appStore'
import { renderView, setupCalendarTests, viewProps } from '../../../test/renderCalendar'
import { testIds } from '../common/testIds'
import type { SheetLocationState, ViewProps, WidthClass } from '../common/types'
import { DayView } from './DayView'

setupCalendarTests()

const D = '2026-11-10'

const itemsOf = (...items: Item[]): Partial<AppData> => ({ items: Object.fromEntries(items.map((it) => [it.id, it])) })

const timed = (id: string, startTime: string, endTime: string | null, p: Partial<Item> = {}) =>
  mkItem({ id, title: id, start: D, startTime, endTime, ...p })

const dayProps = (over: Partial<ViewProps> = {}): ViewProps => viewProps({ mode: 'day', viewed: D, ...over })

async function renderDay(data: Partial<AppData>, over: Partial<ViewProps> & { width?: WidthClass } = {}) {
  const props = dayProps(over)
  return renderView(DayView, props, { data, width: props.width })
}

/** 予定の枠の style の数（top・height は px、--col・--cols は数） */
function boxStyle(el: HTMLElement) {
  return {
    top: el.style.top,
    height: el.style.height,
    col: el.style.getPropertyValue('--col'),
    cols: el.style.getPropertyValue('--cols'),
  }
}

describe('日の見出し（11.1・D21・D40）', () => {
  it('曜日の丸いラベル（今日の印）＋等幅の「2026.11.10」。祝日でも休みでもない日は名前も「休」も無い', async () => {
    await renderDay({})
    const head = screen.getByTestId(testIds.dayHead)
    expect(head.textContent).toContain('2026.11.10')
    expect(head.querySelector('.pill.is-today')?.getAttribute('aria-current')).toBe('date')
    expect(within(head).getByText('11月10日（火）')).toBeTruthy()
    expect(head.querySelector('.cp-holiday')).toBeNull()
    expect(head.classList.contains('cp-offday')).toBe(false)
  })

  it('祝日名は見出しの行の中に出し、日付は --sun の色（CALENDAR-066・D21）', async () => {
    await renderDay({}, { viewed: '2026-11-03' })
    const head = screen.getByTestId(testIds.dayHead)
    expect(within(head).getByText('文化の日').classList.contains('cp-holiday')).toBe(true)
    expect(head.querySelector('.dy-date')?.classList.contains('cp-sun')).toBe(true)
    expect(head.querySelector('.pill.is-today')).toBeNull()
  })

  it('休みの日は見出しの行だけを --off-fill（.cp-offday）にして「休」を出す。区切りとタイムスケジュールは変えない（D40）', async () => {
    await renderDay({ offDays: { [D]: mkOffDay(D) } })
    const head = screen.getByTestId(testIds.dayHead)
    expect(head.classList.contains('cp-offday')).toBe(true)
    expect(within(head).getByText('休み')).toBeTruthy()
    expect(document.querySelectorAll('.cp-offday')).toHaveLength(1)
    expect(screen.getByTestId(testIds.dayArea('work')).classList.contains('cp-offday')).toBe(false)
  })
})

describe('時間指定なしのリスト（11.2・7.5・7.9）', () => {
  const data = itemsOf(
    mkItem({ id: 'w1', title: 'メールの返信', label: 'sky-l', order: 1 }),
    mkItem({ id: 'w-done', title: '経費の精算', done: true, doneAt: T0, doneOn: D }),
    mkItem({ id: 'w-first', title: '展示会の手配', start: D, due: '2026-11-13' }),
    mkItem({ id: 'w-middle', title: '研修', start: '2026-11-08', due: '2026-11-12', label: 'apricot-l' }),
    mkItem({ id: 'w-last', title: '申請の受付', start: '2026-11-06', due: D }),
    mkItem({ id: 'p1', kind: 'private', title: '本を返す' }),
    timed('t1', '10:00', '11:00'),
    mkTask({ id: 'q', title: '見積もりの提出', due: D, kind: 'work', order: 2 }),
  )

  it('上＝仕事・下＝プライベートの区切り。区切りに data-kind（地は --work-area／--private-area）、行には区分の色を付けない', async () => {
    await renderDay(data)
    const areas = [screen.getByTestId(testIds.dayArea('work')), screen.getByTestId(testIds.dayArea('private'))]
    expect(areas.map((a) => a.getAttribute('data-kind'))).toEqual(['work', 'private'])
    expect(areas[0].compareDocumentPosition(areas[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(areas[1]).getByTestId(testIds.dayRow('p1'))).toBeTruthy()
    // 行の件名にハイライト（.kind-marker）は付けない（X2）
    expect(areas[0].querySelector('.kind-marker')).toBeNull()
  })

  it('見出し: 区分のアイコン＋WORK＋仕事＋まだ完了していない数（時刻のある物も含む。ITEMS-111・112）', async () => {
    await renderDay(data)
    const area = screen.getByTestId(testIds.dayArea('work'))
    const head = area.querySelector('.dy-area-head') as HTMLElement
    expect(head.textContent).toContain('WORK')
    expect(head.textContent).toContain('仕事')
    // w1・w-first・w-middle・w-last・t1・q（完了の w-done は数えない）
    expect(head.querySelector('.dy-count')?.textContent).toBe('6')
    expect(within(head).getByText('まだ完了していない予定 6件')).toBeTruthy()
    expect(area.getAttribute('aria-labelledby')).toBe(head.id)
  })

  it('行の並び（7.5）と時刻のある物を入れないこと（ITEMS-113・122）', async () => {
    await renderDay(data)
    const rows = [...screen.getByTestId(testIds.dayArea('work')).querySelectorAll<HTMLElement>('.dy-row')]
    expect(rows.map((r) => r.dataset.testid)).toEqual(
      ['w-last', 'w-middle', 'w-first', 'w1', 'q', 'w-done'].map((id) => testIds.dayRow(id)),
    )
  })

  it('複数日の右の端と受けた表示: 初日「━＞ 〜11/13」、間の日「‹ 研修 ━＞ 〜11/12」、最終日「‹ 申請の受付 ━●」（ITEMS-120・121）', async () => {
    await renderDay(data)
    const first = screen.getByTestId(testIds.dayRow('w-first'))
    expect(first.dataset.role).toBe('first')
    expect(first.querySelector('.dy-tail-mark')?.textContent).toBe('━＞')
    expect(first.querySelector('.dy-tail-range')?.textContent).toBe('〜11/13')
    expect(first.querySelector('.cp-title-received')).toBeNull()

    const middle = screen.getByTestId(testIds.dayRow('w-middle'))
    expect(middle.dataset.role).toBe('middle')
    expect(middle.querySelector('.cp-title-received')?.textContent).toBe('‹ ')
    expect(middle.querySelector('.dy-tail')?.textContent).toBe('━＞〜11/12')
    // 線の色はラベルの色（行の data-label。7.8）
    expect(middle.getAttribute('data-label')).toBe('apricot-l')

    const last = screen.getByTestId(testIds.dayRow('w-last'))
    expect(last.querySelector('.cp-title-received')).not.toBeNull()
    expect(last.querySelector('.dy-tail-mark')?.textContent).toBe('━●')
    expect(last.querySelector('.dy-tail-range')).toBeNull()

    expect(screen.getByTestId(testIds.dayRow('w1')).querySelector('.dy-tail')).toBeNull()
  })

  it('行: 行頭の●（ラベルの色・押せる所 40px）→ 件名（2行まで）→ 印（〆）。完了は●の中に✓・斜線（ITEMS-115・117・126）', async () => {
    await renderDay(data)
    const row = screen.getByTestId(testIds.dayRow('w1'))
    const dot = within(row).getByTestId(testIds.done('w1'))
    expect(dot.style.getPropertyValue('--dot-hit')).toBe('40px')
    expect(dot.querySelector('.cp-dot')?.getAttribute('data-label')).toBe('sky-l')
    expect(row.querySelector('.cp-title')?.classList.contains('cp-lines-2')).toBe(true)

    const quote = screen.getByTestId(testIds.dayRow('q'))
    expect(quote.querySelector('[data-mark="due"]')?.textContent).toBe('〆')

    const done = screen.getByTestId(testIds.dayRow('w-done'))
    expect(done.classList.contains('is-done')).toBe(true)
    expect(done.querySelector('.cp-dot-check')).not.toBeNull()
    expect(done.querySelector('.cp-title')?.classList.contains('is-strike')).toBe(true)
  })

  it('●を押すと完了（件名を押した時の詳細は開かない）、件名を押すと詳細（12.3・ITEMS-116・119）', async () => {
    const user = userEvent.setup()
    const { router } = await renderDay(data)
    await user.click(screen.getByTestId(testIds.done('w1')))
    expect(getData().items.w1.done).toBe(true)
    expect((router.state.location.state as SheetLocationState | null)?.sheet).toBeFalsy()
    await user.click(within(screen.getByTestId(testIds.dayRow('p1'))).getByText('本を返す'))
    expect((router.state.location.state as SheetLocationState).sheet).toEqual({ kind: 'detail', id: 'p1' })
  })

  it('各区切りのいちばん下に「＋ 予定を足す」の行（ITEMS-123）', async () => {
    await renderDay({})
    for (const kind of ['work', 'private'] as const) {
      const area = screen.getByTestId(testIds.dayArea(kind))
      const add = within(area).getByTestId(testIds.dayAdd(kind))
      expect(add.textContent).toBe('予定を足す')
      expect(area.querySelector('.dy-area-body')?.lastElementChild).toBe(add)
    }
  })
})

describe('タイムスケジュール（11.3）', () => {
  it('0:00〜23:00 の時刻の欄・24 時間の縞（奇数の時）・12:00 の点線・0:00 の 2px の印', async () => {
    await renderDay({})
    const tl = screen.getByTestId(testIds.dayTimeline)
    const labels = [...tl.querySelectorAll('.dy-axis-label')].map((e) => e.textContent)
    expect(labels).toHaveLength(24)
    expect([labels[0], labels[9], labels[23]]).toEqual(['0:00', '9:00', '23:00'])
    const hours = [...tl.querySelectorAll<HTMLElement>('.dy-hour')]
    expect(hours).toHaveLength(24)
    expect(hours.filter((h) => h.classList.contains('is-odd')).map((h) => h.dataset.hour)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i * 2 + 1)),
    )
    expect(hours[12].classList.contains('is-noon')).toBe(true)
    expect(hours[0].classList.contains('is-day-start')).toBe(true)
    expect(hours[13].style.top).toBe('624px')
  })

  it('1日の予定の枠の位置と高さは時刻から（L・M 48px、S 44px。開始だけは +30分。ITEMS-127・133）', async () => {
    const data = itemsOf(timed('a', '10:00', '11:30'), timed('b', '13:00', null))
    const l = await renderDay(data)
    expect(boxStyle(screen.getByTestId(testIds.dayEvent('a')))).toEqual({ top: '480px', height: '72px', col: '0', cols: '1' })
    expect(boxStyle(screen.getByTestId(testIds.dayEvent('b')))).toMatchObject({ top: '624px', height: '24px' })
    l.unmount()
    await renderDay(data, { width: 'S' })
    expect(boxStyle(screen.getByTestId(testIds.dayEvent('a')))).toMatchObject({ top: '440px', height: '66px' })
  })

  it('予定の枠: 左上の点線の丸・件名のハイライト（区分の色）・時刻・右上の区分のアイコンと印（ITEMS-134・139・140）', async () => {
    await renderDay(
      itemsOf(
        timed('w', '10:00', '11:00', { title: '定例', label: 'sky-d', locked: true }),
        timed('p', '19:00', '21:00', { kind: 'private', title: '夕食', by: 'connector', ai: 'claude', via: 'メール' }),
      ),
    )
    const w = screen.getByTestId(testIds.dayEvent('w'))
    expect(w.classList.contains('label-edge')).toBe(true)
    expect(w.getAttribute('data-label')).toBe('sky-d')
    expect(within(w).getByTestId(testIds.done('w')).style.getPropertyValue('--dot-hit')).toBe('24px')
    expect(w.querySelector('.kind-marker')?.getAttribute('data-kind')).toBe('work')
    expect(w.querySelector('.kind-marker')?.textContent).toBe('定例')
    expect(w.querySelector('.dy-ev-time')?.textContent).toBe('10:00–11:00')
    const marks = [...w.querySelectorAll('.dy-ev-marks [data-mark]')].map((e) => e.getAttribute('data-mark'))
    expect(marks).toEqual(['kind', 'lock'])
    expect(within(w).getByTitle('仕事')).toBeTruthy()

    const p = screen.getByTestId(testIds.dayEvent('p'))
    expect(p.querySelector('.kind-marker')?.getAttribute('data-kind')).toBe('private')
    expect(within(p).getByTitle('プライベート')).toBeTruthy()
    expect(within(p).getByTestId(testIds.aiTag('p')).textContent).toBe('Claude')
    // 依頼者・締め切り日・メモは出さない（ITEMS-137）
    expect(p.textContent).not.toContain('メール')
  })

  it('完了した予定: 地 --done-bg（is-done）・ハイライトを消して斜線・丸に✓（ITEMS-151）', async () => {
    await renderDay(itemsOf(timed('d', '10:00', '11:00', { done: true, doneAt: T0, doneOn: D, label: 'mint-l' })))
    const box = screen.getByTestId(testIds.dayEvent('d'))
    expect(box.classList.contains('is-done')).toBe(true)
    expect(box.querySelector('.kind-marker')).toBeNull()
    expect(box.querySelector('.cp-title')?.classList.contains('is-strike')).toBe(true)
    expect(box.getAttribute('data-label')).toBe('mint-l')
    expect(within(box).getByTestId(testIds.done('d')).dataset.done).toBe('true')
  })

  it('低い枠（2行が入らない）は件名と時刻を1行に。高い枠は件名を入るだけの行で', async () => {
    await renderDay(itemsOf(timed('short', '10:00', '10:30'), timed('tall', '13:00', '15:00')))
    expect(screen.getByTestId(testIds.dayEvent('short')).classList.contains('is-compact')).toBe(true)
    const tall = screen.getByTestId(testIds.dayEvent('tall'))
    expect(tall.classList.contains('is-compact')).toBe(false)
    expect((tall.querySelector('.dy-ev-open') as HTMLElement).style.getPropertyValue('--lines')).toBe('4')
  })

  it('重なる5件: L は4列＋「+1」の札（隠れた予定のいちばん早い時刻）、S は3列＋「+2」（ITEMS-146・147）', async () => {
    const data = itemsOf(
      timed('a', '14:00', '15:30'),
      timed('b', '14:00', '15:30'),
      timed('c', '14:15', '15:30'),
      timed('d', '14:30', '15:30'),
      timed('e', '14:45', '15:30'),
    )
    const l = await renderDay(data)
    expect(['a', 'b', 'c', 'd'].map((id) => boxStyle(screen.getByTestId(testIds.dayEvent(id))).col)).toEqual(['0', '1', '2', '3'])
    expect(boxStyle(screen.getByTestId(testIds.dayEvent('a'))).cols).toBe('4')
    expect(screen.queryByTestId(testIds.dayEvent('e'))).toBeNull()
    const more = screen.getByTestId(testIds.dayMore)
    expect(more.textContent).toBe('+1')
    expect(more.getAttribute('aria-label')).toBe('ほかに 1件の予定')
    expect(more.style.top).toBe('708px')
    l.unmount()
    await renderDay(data, { width: 'S' })
    expect(screen.getByTestId(testIds.dayMore).textContent).toBe('+2')
    expect(screen.queryByTestId(testIds.dayEvent('d'))).toBeNull()
  })

  it('日をまたぐ予定（初日）: 開始のカード（丸あり・件名＋期間）、カードの下から線、24:00 に下向きの矢印（ITEMS-143・145）', async () => {
    await renderDay(
      itemsOf(
        mkItem({
          id: 'm',
          title: '資料づくり',
          start: D,
          due: '2026-11-12',
          startTime: '10:00',
          endTime: '18:00',
          label: 'sky-l',
        }),
      ),
    )
    const card = screen.getByTestId(testIds.dayEvent('m'))
    expect(card.classList.contains('dy-start')).toBe(true)
    expect(card.style.height).toBe('40px')
    expect(within(card).getByTestId(testIds.done('m'))).toBeTruthy()
    expect(card.querySelector('.cp-title-received')).toBeNull()
    expect(card.querySelector('.dy-ev-time')?.textContent).toBe('11/10 10:00〜11/12 18:00')
    const piece = card.parentElement as HTMLElement
    expect(boxStyle(piece)).toMatchObject({ top: '480px', height: '672px' })
    expect(piece.getAttribute('data-label')).toBe('sky-l')
    expect(piece.querySelector('.dy-span-line')).not.toBeNull()
    expect(piece.querySelector('.dy-span-end .dy-end-arrow')?.textContent).toBe('＞')
  })

  it('日をまたぐ予定（2日目から）: 「‹ 」のカード（丸なし）、最終日は終わりの時刻に●（D39・ITEMS-143・145）', async () => {
    const m = mkItem({ id: 'm', title: '資料づくり', start: '2026-11-09', due: D, startTime: '10:00', endTime: '18:00' })
    await renderDay(itemsOf(m))
    const card = screen.getByTestId(testIds.dayEvent('m'))
    expect(card.querySelector('.cp-title-received')?.textContent).toBe('‹ ')
    expect(within(card).queryByTestId(testIds.done('m'))).toBeNull()
    const piece = card.parentElement as HTMLElement
    expect(boxStyle(piece)).toMatchObject({ top: '0px', height: '864px' })
    expect(piece.querySelector('.dy-span-end .cp-dot')).not.toBeNull()
  })

  it('部分がカードより短い時は線を引かず、●はカードの右端の中に（AMB-ITEMS-11）', async () => {
    await renderDay(itemsOf(mkItem({ id: 'n', start: '2026-11-09', due: D, startTime: '22:00', endTime: '00:20' })))
    const card = screen.getByTestId(testIds.dayEvent('n'))
    expect(card.style.height).toBe('24px')
    expect(card.parentElement?.querySelector('.dy-span-line')).toBeNull()
    expect(card.querySelector('.dy-ev-marks .cp-dot')).not.toBeNull()
  })

  it('予定（丸と札の外）を押すと詳細（ITEMS-141）', async () => {
    const user = userEvent.setup()
    const { router } = await renderDay(itemsOf(timed('a', '10:00', '11:00', { title: '定例' })))
    await user.click(within(screen.getByTestId(testIds.dayEvent('a'))).getByText('定例'))
    expect((router.state.location.state as SheetLocationState).sheet).toEqual({ kind: 'detail', id: 'a' })
  })
})

describe('今の時刻の線（今日だけ。60秒ごと。CALENDAR-074・ITEMS-131）', () => {
  it('ほかの日には出さない', async () => {
    await renderDay({}, { viewed: '2026-11-11' })
    expect(screen.queryByTestId(testIds.dayNow)).toBeNull()
  })

  it('今日は今の時刻の所に出し、1分たつと動く', async () => {
    const r = await renderDay({}, { viewed: '2026-11-09' })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(T0)
    r.setProps(dayProps())
    const now = screen.getByTestId(testIds.dayNow)
    expect(now.style.top).toBe(`${9 * 48}px`)
    expect(now.dataset.minute).toBe('540')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(now.style.top).toBe(`${(9 * 60 + 1) * 0.8}px`)
    expect(now.dataset.minute).toBe('541')
  })
})

describe('開いた時の位置（ITEMS-132・AMB-ITEMS-31）', () => {
  const scroller = () => screen.getByTestId(testIds.dayTimeline).querySelector('.dy-tl-scroll') as HTMLElement

  it('今日は今の時刻の 60分前（9:00 → 8:00）、ほかの日は 7:00。日が替わった時だけ当て直す', async () => {
    const r = await renderDay(itemsOf(timed('a', '10:00', '11:00')))
    expect(scroller().scrollTop).toBe(8 * 48)
    // 中で動かした後、予定が変わっても位置はそのまま
    scroller().scrollTop = 100
    r.setProps(dayProps({ area: { width: 1000, height: 600 } }))
    expect(scroller().scrollTop).toBe(100)
    r.setProps(dayProps({ viewed: '2026-11-11' }))
    expect(scroller().scrollTop).toBe(7 * 48)
  })

  it('S は 1時間 44px で同じ', async () => {
    await renderDay({}, { width: 'S', viewed: '2026-11-12' })
    expect(scroller().scrollTop).toBe(7 * 44)
  })
})

describe('並べ方（11.1）', () => {
  it('L・M は左右（is-stacked なし）、S は上下に積む（is-stacked）', async () => {
    const l = await renderDay({}, { width: 'M' })
    expect(screen.getByTestId(testIds.view('day')).classList.contains('is-stacked')).toBe(false)
    l.unmount()
    await renderDay({}, { width: 'S' })
    expect(screen.getByTestId(testIds.view('day')).classList.contains('is-stacked')).toBe(true)
  })
})
