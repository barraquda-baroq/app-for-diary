// ウィークリーのドラッグの E2E（docs/SPEC.md の 7.10・7.11・10.4・3.9・4.9・13.6・18.4）。PC はマウス（5px を超えて動かすと掴む）、
// Pixel 7・タブレット（M）は CDP の本物の指（0.4秒の長押しで掴む）、iPhone（WebKit）は合成した指の PointerEvent（pointerId 1）。
// 掴んでいる間、dnd-kit は元の場所に同じ data-testid の写し（data-dnd-placeholder。見えない）を置くので、本物のカードは
// :not([data-dnd-placeholder]) で探す（WP11s の G6）。データは作り物の e2e/fixtures/demoData.ts（今日は 2026年11月10日（火）9:00。
// いつもの週 11/8〜11/14。休みは 11/11・11/14）
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Item } from '../src/domain/types'
import { DEMO_IDS, DEMO_WEEKS, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, openCalendar, rawItem, startLongPress, startMouseDrag, touchSwipe } from './helpers'

collectDiagnosticsOnFailure()

const WEEK = `/week/${DEMO_WEEKS.main}`
const I = DEMO_IDS
const DAYS = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
type Kind = 'work' | 'private'
type Point = { x: number; y: number }
type DemoData = ReturnType<typeof demoData>

/** 本物の要素（掴んでいる間の写しを除く） */
const real = (page: Page, testId: string) => page.locator(`[data-testid="${testId}"]:not([data-dnd-placeholder])`)
const card = (page: Page, id: string) => real(page, `week-card-${id}`)
const startCard = (page: Page, id: string) => real(page, `week-start-${id}`)
const endDot = (page: Page, id: string) => real(page, `week-end-${id}`)

/** 落とす所（L・M はその段のその日の列、S は日のかたまりのその半分） */
const cellL = (page: Page, kind: Kind, date: string) => page.locator(`[data-tier="${kind}"] .wk-cell[data-date="${date}"]`)
const halfS = (page: Page, kind: Kind, date: string) => page.locator(`.wk-half[data-tier="${kind}"][data-date="${date}"]`)

/** その様子（data-drop）の落とす所の日付（日付の順） */
async function dropDates(page: Page, kind: Kind, state: 'ok' | 'hover' | 'none', layout: 'L' | 'S' = 'L'): Promise<string[]> {
  const sel =
    layout === 'L'
      ? `[data-tier="${kind}"] .wk-cell[data-drop="${state}"]`
      : `.wk-half[data-tier="${kind}"][data-drop="${state}"]`
  return page.locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('data-date') ?? ''))
}

/** 印の付いた（ok か hover の）落とす所の日付（一度に読む。上にある日は動かす間に替わることがある） */
async function markedDates(page: Page, kind: Kind, layout: 'L' | 'S' = 'L'): Promise<string[]> {
  const base = layout === 'L' ? `[data-tier="${kind}"] .wk-cell` : `.wk-half[data-tier="${kind}"]`
  return page
    .locator(`${base}[data-drop="ok"], ${base}[data-drop="hover"]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-date') ?? '').sort())
}

const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text })
const sheet = (page: Page) => page.getByTestId('item-sheet')

/** 表示用のデータの予定 */
const itemOf = (page: Page, id: string) =>
  page.evaluate((i) => window.__ds.getData().items[i] ?? null, id) as Promise<Item | null>

async function openWeek(page: Page, opts: { appearance?: 'white' | 'deep-dark'; data?: DemoData } = {}) {
  await openCalendar(page, WEEK, { data: opts.data ?? demoData(), appearance: opts.appearance })
  await expect(page.getByTestId('view-week')).toBeVisible()
}

/** 小さな画面（詳細）が開き終わるまで待つ（day.spec.ts と同じ） */
async function sheetReady(page: Page) {
  await expect(sheet(page)).toBeVisible()
  await expect.poll(() => sheet(page).evaluate((el) => el.contains(document.activeElement))).toBe(true)
}

/**
 * 要素の見えている所（スクロールする要素・画面の中に入っている所）の真ん中。段の中・週の中はスクロールするので、列やかたまりの
 * 箱の真ん中は見えていない所にあることがある
 */
async function visiblePoint(target: Locator): Promise<Point> {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    let [top, bottom, left, right] = [r.top, r.bottom, r.left, r.right]
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) {
        const q = p.getBoundingClientRect()
        ;[top, bottom, left, right] = [
          Math.max(top, q.top),
          Math.min(bottom, q.bottom),
          Math.max(left, q.left),
          Math.min(right, q.right),
        ]
      }
    }
    ;[top, bottom] = [Math.max(top, 0), Math.min(bottom, window.innerHeight)]
    return { x: (left + right) / 2, y: (top + bottom) / 2 }
  })
}

/** 掴む所（見える所までスクロールしてから、その真ん中） */
async function grabPoint(target: Locator): Promise<Point> {
  await target.scrollIntoViewIfNeeded()
  return visiblePoint(target)
}

/** マウスで掴んで to へ動かして離す */
async function mouseDrop(page: Page, from: Locator, to: Locator | Point) {
  const drag = await startMouseDrag(page, await grabPoint(from))
  await drag.moveTo('x' in to ? to : await visiblePoint(to))
  await drag.drop()
}

/**
 * 揺れ（.shake）・ロックの印の --accent（.lock-accent）が付いた要素を控える（どちらも 240ms・600ms で外れるので、付いた時に控える）。
 * 控えは recordedPulses で読む
 */
async function recordPulses(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __pulses: string[] }
    w.__pulses = []
    new MutationObserver((recs) => {
      for (const r of recs) {
        const el = r.target as Element
        for (const name of ['shake', 'lock-accent'])
          if (el.classList.contains(name) && !(r.oldValue ?? '').split(/\s+/).includes(name)) {
            const id = el.closest('[data-testid]')?.getAttribute('data-testid') ?? '?'
            w.__pulses.push(`${name}:${el.hasAttribute('data-lock') ? 'lock-icon' : id}`)
          }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
  })
}
const recordedPulses = (page: Page) => page.evaluate(() => (window as unknown as { __pulses: string[] }).__pulses)

/**
 * ページ（document）のスクロールを控える（一瞬だけ動いて戻った時も残るように、動くたびに scrollY を控える）。控えは pageScrolls で
 * 読む。週・段の中のスクロールは数えない（要素のスクロールの出来事は window へ伝わらない）
 */
async function recordPageScroll(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __pageScrolls: number[] }
    w.__pageScrolls = []
    window.addEventListener('scroll', () => w.__pageScrolls.push(window.scrollY))
  })
}
const pageScrolls = (page: Page) => page.evaluate(() => (window as unknown as { __pageScrolls: number[] }).__pageScrolls)

/** 動かした予定（夜 23:00〜次の日 01:00。始点を次の日へ落とすと、1日の予定で終了 < 開始になる。CALENDAR-175 の例） */
function withLateWork(): DemoData {
  const data = demoData()
  const base = data.items[I.mail]
  const late: Item = {
    ...base,
    id: 'e2e-late',
    title: '夜の作業',
    start: '2026-11-10',
    due: '2026-11-11',
    startTime: '23:00',
    endTime: '01:00',
    label: null,
  }
  return { ...data, items: { ...data.items, [late.id]: late } }
}

/**
 * 指で掴めた（浮いた）まで待つ。掴むのはページの中のタイマーで押してから 0.4秒後なので、押してから 0.45秒（startLongPress）では
 * 込んでいる時に足りないことがある。掴む前に動かすと 8px を超えてスクロールになる
 */
const lifted = (page: Page) => expect(page.locator('[data-dnd-dragging]')).toHaveCount(1)

/** ［元に戻す］・完了などの知らせが出ていない（出るなら落とした直後に出るので、少し待ってから確かめる） */
async function noToast(page: Page) {
  // 出ないことを確かめるため、落とした後に知らせが出るまでの間（数十 ms）より長く待つ
  await page.waitForTimeout(300)
  await expect(page.locator('.toast')).toHaveCount(0)
}

test.describe('PC（マウス）', { tag: ['@pc'] }, () => {
  test('1日のカードを別の日へ: 落とせる日の印・浮いた見た目、「11/12（木）へ移しました」と［元に戻す］、移った先のカードを目立たせる', async ({
    page,
  }) => {
    await openWeek(page)
    const from = cellL(page, 'work', '2026-11-10')
    await expect(from.getByTestId(`week-card-${I.meeting}`)).toBeVisible()
    const drag = await startMouseDrag(page, await grabPoint(card(page, I.meeting)))
    const target = cellL(page, 'work', '2026-11-12')
    await drag.moveTo(await visiblePoint(target))
    // 掴んでいる間: 仕事の段の7日（元の日も）に印、上にある日は線の枠。プライベートの段には付かない（CALENDAR-165・166・D25）
    await expect(target).toHaveAttribute('data-drop', 'hover')
    expect(await dropDates(page, 'work', 'ok')).toEqual(DAYS.filter((d) => d !== '2026-11-12'))
    expect(await dropDates(page, 'private', 'none')).toEqual(DAYS)
    const lifted = await card(page, I.meeting).evaluate((e) => {
      const cs = getComputedStyle(e)
      return { dragging: e.getAttribute('data-dnd-dragging'), scale: cs.scale, opacity: cs.opacity, shadow: cs.boxShadow }
    })
    // 浮く: 1.03倍・不透明度 0.95・--shadow-lift（0 6px 20px）（FRAME-229・CALENDAR-162）
    expect(lifted).toMatchObject({ dragging: 'true', scale: '1.03', opacity: '0.95' })
    expect(lifted.shadow).toMatch(/0px 6px 20px/)
    // 落とせる日の地は --accent-soft・1px の --accent の線（上にある日は実線、ほかは点線）
    const outline = (l: Locator) => l.evaluate((e) => `${getComputedStyle(e).outlineStyle} ${getComputedStyle(e).outlineWidth}`)
    expect(await outline(target)).toBe('solid 1px')
    expect(await outline(cellL(page, 'work', '2026-11-13'))).toBe('dashed 1px')
    expect(await outline(cellL(page, 'private', '2026-11-13'))).toMatch(/^none/)
    await drag.drop()

    await expect(target.getByTestId(`week-card-${I.meeting}`)).toBeVisible()
    await expect(card(page, I.meeting)).toHaveClass(/\bflash\b/)
    const moved = toast(page, '11/12（木）へ移しました')
    await expect(moved).toBeVisible()
    expect(await markedDates(page, 'work')).toEqual([])
    expect(await itemOf(page, I.meeting)).toMatchObject({ start: '2026-11-12', due: null, startTime: '13:00' })
    // ［元に戻す］で元の日へ（CALENDAR-180）
    await moved.getByRole('button', { name: '元に戻す' }).click()
    await expect(from.getByTestId(`week-card-${I.meeting}`)).toBeVisible()
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    // 掴んでいる間の写しも、浮いた見た目も残らない
    await expect(page.locator('[data-dnd-placeholder], [data-dnd-dragging]')).toHaveCount(0)
  })

  test('始点のカードを前の日へ・終点の●を後の日へ（落とせるのは締め切り日まで・開始日から。期間の長さが変わる）', async ({
    page,
  }) => {
    await openWeek(page)
    // 展示会の手配（11/10〜11/13）の始点: 落とせるのは 11/13 まで（CALENDAR-170）
    let drag = await startMouseDrag(page, await grabPoint(startCard(page, I.expo)))
    await drag.moveTo(await visiblePoint(cellL(page, 'work', '2026-11-09')))
    await expect(cellL(page, 'work', '2026-11-09')).toHaveAttribute('data-drop', 'hover')
    expect(await markedDates(page, 'work')).toEqual(DAYS.slice(0, 6))
    await drag.drop()
    await expect(toast(page, '開始日を 11/9（月）にしました')).toBeVisible()
    expect(await itemOf(page, I.expo)).toMatchObject({ start: '2026-11-09', due: '2026-11-13' })
    await expect(cellL(page, 'work', '2026-11-09').getByTestId(`week-start-${I.expo}`)).toBeVisible()

    // 資料づくり（11/9 10:00〜11/12 18:00）の終点の●: 落とせるのは 11/9 から（CALENDAR-171）。時刻は変えない（CALENDAR-172）
    drag = await startMouseDrag(page, await grabPoint(endDot(page, I.materials)))
    await drag.moveTo(await visiblePoint(cellL(page, 'work', '2026-11-14')))
    expect(await markedDates(page, 'work')).toEqual(DAYS.slice(1))
    await drag.drop()
    await expect(toast(page, '締め切り日を 11/14（土）にしました')).toBeVisible()
    expect(await itemOf(page, I.materials)).toMatchObject({
      start: '2026-11-09',
      due: '2026-11-14',
      startTime: '10:00',
      endTime: '18:00',
    })
    await expect(cellL(page, 'work', '2026-11-14').getByTestId(`week-end-${I.materials}`)).toBeVisible()
  })

  test('始点のカードを締め切り日へ落とすと1日の予定になり、移った先のカードが段の下の方でも見える所まで出て目立つ', async ({
    page,
  }) => {
    await openWeek(page)
    // 展示会の手配（11/10〜11/13）の始点を 11/13 へ: 1日の予定のカードになり、時刻の無いカードは混んだ 11/13 のいちばん下へ
    await mouseDrop(page, startCard(page, I.expo), cellL(page, 'work', '2026-11-13'))
    await expect(toast(page, '開始日を 11/13（金）にしました')).toBeVisible()
    expect(await itemOf(page, I.expo)).toMatchObject({ start: '2026-11-13', due: '2026-11-13' })
    const moved = cellL(page, 'work', '2026-11-13').getByTestId(`week-card-${I.expo}`)
    await expect(moved).toHaveClass(/\bflash\b/)
    // 段の中をスクロールして、目立たせているカードを見える所まで出す（CALENDAR-181）
    await expect(moved).toBeInViewport({ ratio: 1 })
  })

  test('落とせない所: 違う区分の段・週の外・1日にすると終了 < 開始になる日（23:00〜01:00 の始点を 11/11 へ）。受けた表示は掴めない', async ({
    page,
  }) => {
    await openWeek(page, { data: withLateWork() })
    // 仕事のカードをプライベートの段へ（CALENDAR-165・ITEMS-098）
    let drag = await startMouseDrag(page, await grabPoint(card(page, I.meeting)))
    await drag.moveTo(await visiblePoint(cellL(page, 'private', '2026-11-12')))
    await expect(cellL(page, 'private', '2026-11-12')).toHaveAttribute('data-drop', 'none')
    expect(await markedDates(page, 'private')).toEqual([])
    await drag.drop()
    // 週の外（右の列のリスト）へ（CALENDAR-178）
    drag = await startMouseDrag(page, await grabPoint(card(page, I.meeting)))
    await drag.moveTo(await visiblePoint(page.getByText('Routine List')))
    // 週の外では、上にある日の線の枠が消える（途中で通った日の枠が残っている間に離すと、その日へ落ちる。負荷の高い時は、動かした後の
    // 当たりの計算が離すのに間に合わないことがあった）
    await expect(page.locator('[data-drop="hover"]')).toHaveCount(0)
    await drag.drop()
    await noToast(page)
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    await expect(cellL(page, 'work', '2026-11-10').getByTestId(`week-card-${I.meeting}`)).toBeVisible()

    // 11/10 23:00〜11/11 01:00 の始点: 11/11 にすると 1日の予定で 01:00 < 23:00 になるので、落とせる日にしない（CALENDAR-042・175）
    drag = await startMouseDrag(page, await grabPoint(startCard(page, 'e2e-late')))
    await drag.moveTo(await visiblePoint(cellL(page, 'work', '2026-11-11')))
    expect(await markedDates(page, 'work')).toEqual(['2026-11-08', '2026-11-09', '2026-11-10'])
    await expect(cellL(page, 'work', '2026-11-11')).toHaveAttribute('data-drop', 'none')
    await drag.drop()
    await noToast(page)
    expect(await itemOf(page, 'e2e-late')).toMatchObject({ start: '2026-11-10', due: '2026-11-11' })

    // 前の週から続く物の受けた表示（研修）は掴めない（押して動かしても浮かず、揺れず、印も出ない。CALENDAR-176）
    await recordPulses(page)
    drag = await startMouseDrag(page, await grabPoint(real(page, `week-received-${I.training}`)), { grabPx: 30 })
    await expect(page.locator('[data-dnd-dragging]')).toHaveCount(0)
    expect(await markedDates(page, 'work')).toEqual([])
    await drag.drop()
    expect(await recordedPulses(page)).toEqual([])
  })

  test('ロック中のカードは掴めない: 揺れて、掴もうとしている間だけカーソルが not-allowed。知らせは出さず、詳細も開かない', async ({
    page,
  }) => {
    await openWeek(page)
    await recordPulses(page)
    const review = card(page, I.review)
    const cursor = () => review.evaluate((e) => getComputedStyle(e).cursor)
    expect(await cursor()).toBe('pointer')
    // 5px 以内では掴もうとしていない（クリックのまま）
    const drag = await startMouseDrag(page, await grabPoint(review), { grabPx: 3 })
    expect(await recordedPulses(page)).toEqual([])
    expect(await cursor()).toBe('pointer')
    await drag.moveTo(await visiblePoint(cellL(page, 'work', '2026-11-12')))
    // 掴もうとした: 揺れる（240ms）。浮かない・落とせる日の印も出ない（CALENDAR-150・ITEMS-249）。カーソルは離すまで not-allowed
    expect(await recordedPulses(page)).toEqual([`shake:week-card-${I.review}`])
    expect(await cursor()).toBe('not-allowed')
    await expect(page.locator('[data-dnd-dragging]')).toHaveCount(0)
    expect(await markedDates(page, 'work')).toEqual([])
    await drag.drop()
    expect(await cursor()).toBe('pointer')
    await noToast(page)
    await expect(sheet(page)).toHaveCount(0)
    expect((await itemOf(page, I.review))?.start).toBe('2026-11-10')
    // 押すだけなら詳細が開く（ロックはドラッグだけを止める。CALENDAR-148）
    await review.click()
    await sheetReady(page)
    await expect(sheet(page)).toContainText('レビュー')
  })

  test('視差効果を減らす設定では、ロック中の物を掴もうとすると揺らさず、ロックの印を --accent にする', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openWeek(page)
    await recordPulses(page)
    const drag = await startMouseDrag(page, await grabPoint(card(page, I.review)), { grabPx: 20 })
    expect(await recordedPulses(page)).toEqual(['lock-accent:lock-icon'])
    const lock = card(page, I.review).locator('[data-lock]')
    const [accent, color] = await lock.evaluate((e) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--accent)'
      document.body.appendChild(probe)
      const a = getComputedStyle(probe).color
      probe.remove()
      return [a, getComputedStyle(e).color]
    })
    expect(color).toBe(accent)
    await drag.drop()
    await noToast(page)
  })

  test('〆のカード（Task List 生まれ）を動かすと締め切り日が変わる。完了した予定も動かせる。すばやく足すを開いたままでも動かせる', async ({
    page,
  }) => {
    await openWeek(page)
    // すばやく足すを開いている間に掴んでも、離すまで入力欄は閉じない（並びが動かない。QuickAdd）。離した後に閉じる
    await page.getByTestId('week-add-2026-11-12-work').click()
    const input = page.getByTestId('quick-add-input')
    await expect(input).toBeVisible()
    const drag = await startMouseDrag(page, await grabPoint(card(page, I.quote)))
    await drag.moveTo(await visiblePoint(cellL(page, 'work', '2026-11-13')))
    await expect(input).toBeVisible()
    await drag.drop()
    await expect(input).toHaveCount(0)
    await expect(toast(page, '締め切り日を 11/13（金）にしました')).toBeVisible()
    await page.evaluate(() => window.__ds.flushNow())
    expect(await rawItem(page, I.quote)).toMatchObject({ origin: 'list', start: null, due: '2026-11-13' })
    await expect(cellL(page, 'work', '2026-11-13').getByTestId(`week-card-${I.quote}`)).toBeVisible()
    // 完了した経費の精算（CALENDAR-174）
    await mouseDrop(page, card(page, I.expenses), cellL(page, 'work', '2026-11-09'))
    await expect(toast(page, '11/9（月）へ移しました')).toBeVisible()
    expect(await itemOf(page, I.expenses)).toMatchObject({ start: '2026-11-09', done: true })
  })

  test('5px 以内の動きはクリック（詳細）。同じ日の中へ落としても並びは変わらず、別のカードの上へ落としてもその日へ移るだけ', async ({
    page,
  }) => {
    await openWeek(page)
    const cell = cellL(page, 'work', '2026-11-10')
    const order = () =>
      cell.locator('.wk-singles > [data-testid]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    const before = await order()
    const raw = await rawItem(page, I.meeting)
    // 同じ日の、下のカード（メールの返信）の上へ（CALENDAR-094・D25）
    await mouseDrop(page, card(page, I.meeting), card(page, I.mail))
    await noToast(page)
    expect(await order()).toEqual(before)
    expect(await rawItem(page, I.meeting)).toEqual(raw)
    await expect(sheet(page)).toHaveCount(0)

    // 次の日の別のカード（打ち合わせの候補日を返す）の上へ: その日へ移るだけ（入れ替えない。CALENDAR-173）
    await mouseDrop(page, card(page, I.meeting), card(page, I.claude))
    await expect(toast(page, '11/11（水）へ移しました')).toBeVisible()
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-11')
    expect((await itemOf(page, I.claude))?.start).toBe('2026-11-11')

    // 3px だけ動かして離す: クリック（詳細を開く。CALENDAR-158）
    const drag = await startMouseDrag(page, await grabPoint(card(page, I.mail)), { grabPx: 3 })
    await drag.drop()
    await sheetReady(page)
    await expect(sheet(page)).toContainText('メールの返信')
  })

  test('電波が無くてもドラッグでき、端末に保存される（読み込み直しても残る。FRAME-275）', async ({ page, context }) => {
    await openWeek(page)
    await context.setOffline(true)
    await mouseDrop(page, card(page, I.book), cellL(page, 'private', '2026-11-13'))
    await expect(toast(page, '11/13（金）へ移しました')).toBeVisible()
    await page.evaluate(() => window.__ds.flushNow())
    expect((await rawItem(page, I.book))?.start).toBe('2026-11-13')
    // 開発サーバーから読み込み直すので、つないでから読み込み直す（端末の中に保存した物が出る）
    await context.setOffline(false)
    await page.reload()
    await expect(cellL(page, 'private', '2026-11-13').getByTestId(`week-card-${I.book}`)).toBeVisible()
    expect((await itemOf(page, I.book))?.start).toBe('2026-11-13')
  })
})

test.describe('スマホ（Pixel 7・指）', { tag: ['@s'] }, () => {
  test.beforeEach(async ({ page }) => {
    // 振動を控える（Android は掴んだ時に 15ms。CALENDAR-163）
    await page.addInitScript(() => {
      const w = window as unknown as { __vibrate: unknown[] }
      w.__vibrate = []
      Object.defineProperty(navigator, 'vibrate', {
        configurable: true,
        value: (p: unknown) => {
          w.__vibrate.push(p)
          return true
        },
      })
    })
  })
  const vibrations = (page: Page) => page.evaluate(() => (window as unknown as { __vibrate: unknown[] }).__vibrate)

  test('0.45秒押してから動かすと掴んで動かせる（15ms 振動）。落とせるのは同じ半分（仕事）だけ', async ({ page }) => {
    await openWeek(page)
    const drag = await startLongPress(page, await grabPoint(card(page, I.meeting)))
    await expect(card(page, I.meeting)).toHaveAttribute('data-dnd-dragging', 'true')
    expect(await vibrations(page)).toEqual([15])
    // プライベートの半分の上: 印は無く、落とせない（ITEMS-098）
    await drag.moveTo(await visiblePoint(halfS(page, 'private', '2026-11-09')))
    expect(await markedDates(page, 'private', 'S')).toEqual([])
    expect(await markedDates(page, 'work', 'S')).toEqual(DAYS)
    await drag.moveTo(await visiblePoint(halfS(page, 'work', '2026-11-09')))
    await expect(halfS(page, 'work', '2026-11-09')).toHaveAttribute('data-drop', 'hover')
    await drag.drop()
    await expect(toast(page, '11/9（月）へ移しました')).toBeVisible()
    await expect(halfS(page, 'work', '2026-11-09').getByTestId(`week-card-${I.meeting}`)).toBeVisible()
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-09')
  })

  test('すぐ動かした指はスクロールになり、掴まない。軽く押すと詳細が開く', async ({ page }) => {
    await openWeek(page)
    const week = page.getByTestId('view-week')
    const p = await grabPoint(card(page, I.meeting))
    const top = await week.evaluate((e) => e.scrollTop)
    await touchSwipe(page, p, 0, -240, { steps: 10, durationMs: 200 })
    await expect.poll(() => week.evaluate((e) => e.scrollTop)).toBeGreaterThan(top + 100)
    expect(await vibrations(page)).toEqual([])
    await noToast(page)
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-10')

    await card(page, I.mail).tap()
    await sheetReady(page)
    await expect(sheet(page)).toContainText('メールの返信')
  })

  test('掴んだまま画面の下の 60px に入ると、週の中だけが自動でスクロールする（ページは動かない）。見えていなかった日へ落とせる', async ({
    page,
  }) => {
    await openWeek(page)
    const week = page.getByTestId('view-week')
    const grab = await grabPoint(card(page, I.meeting))
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await recordPageScroll(page)
    const drag = await startLongPress(page, grab)
    await lifted(page)
    const box = await week.evaluate((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.left + r.width / 4, bottom: Math.min(r.bottom, window.innerHeight), max: e.scrollHeight - e.clientHeight }
    })
    // 下の端から 100px（60px より外）ではスクロールしない
    await drag.moveTo({ x: box.x, y: box.bottom - 100 })
    const still = await week.evaluate((e) => e.scrollTop)
    await page.waitForTimeout(300) // 動かないことを確かめる（自動のスクロールは 10ms ごとに進む）
    expect(await week.evaluate((e) => e.scrollTop)).toBe(still)
    // 下の端から 30px: いちばん下までスクロールし、ページはスクロールしない（WP11s の G4）
    await drag.moveTo({ x: box.x, y: box.bottom - 30 }, { steps: 3 })
    await expect.poll(() => week.evaluate((e) => e.scrollTop), { timeout: 5000 }).toBe(box.max)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    await drag.moveTo(await visiblePoint(halfS(page, 'work', '2026-11-14')))
    await drag.drop()
    await expect(toast(page, '11/14（土）へ移しました')).toBeVisible()
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-14')
    // 落とした後: 移った先のカードは週の中だけをスクロールして、画面の中に全部見える所まで出る（CALENDAR-181）。ページのいちばん上
    // では週の下の端が画面の下に少し出ている（3.5・D15）が、そこへ出すためにページを動かさない（G4。CI で scrollY が 4 になった）
    const moved = halfS(page, 'work', '2026-11-14').getByTestId(`week-card-${I.meeting}`)
    await expect(moved).toBeInViewport({ ratio: 1 })
    await page.waitForTimeout(400) // なめらかなスクロールが終わるまで
    await expect(moved).toBeInViewport({ ratio: 1 })
    expect(await pageScrolls(page)).toEqual([])
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })

  test('すばやく足すを開いたまま長押しで動かしても、週がずれない（入力欄のフォーカスを外す）。離した後に閉じる', async ({
    page,
  }) => {
    await openWeek(page)
    const week = page.getByTestId('view-week')
    await page.getByTestId('week-add-2026-11-12-work').click()
    const input = page.getByTestId('quick-add-input')
    await expect(input).toBeFocused()
    // スマホでは入力欄がキーボードの下に隠れることがある。ここでは押さずに（閉じずに）入力欄を見えない所へずらしておく
    await week.evaluate((e) => {
      e.scrollTop = 0
    })
    const drag = await startLongPress(page, await grabPoint(card(page, I.meeting)))
    await expect(card(page, I.meeting)).toHaveAttribute('data-dnd-dragging', 'true')
    await expect(input).not.toBeFocused()
    // 指を動かしても、週は入力欄の所まで飛ばない（Chromium は指で動かし始めた時に、フォーカスのある入力欄を見える所へ出す）。
    // 落とす所（11/9）は週の上下の端から 60px より離れている（自動のスクロールは起きない）
    const top = await week.evaluate((e) => e.scrollTop)
    await drag.moveTo(await visiblePoint(halfS(page, 'work', '2026-11-09')))
    expect(await week.evaluate((e) => e.scrollTop)).toBe(top)
    await expect(halfS(page, 'work', '2026-11-09')).toHaveAttribute('data-drop', 'hover')
    await expect(input).toBeVisible()
    await drag.drop()
    await expect(toast(page, '11/9（月）へ移しました')).toBeVisible()
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-09')
    await expect(input).toHaveCount(0)
  })

  test('ロック中のカードを長押しすると揺れるだけ（浮かず、振動せず、知らせも詳細も出ない）', async ({ page }) => {
    await openWeek(page)
    await recordPulses(page)
    const gym = card(page, I.gym)
    const drag = await startLongPress(page, await grabPoint(gym))
    await expect.poll(() => recordedPulses(page)).toEqual([`shake:week-card-${I.gym}`])
    await drag.moveTo(await visiblePoint(halfS(page, 'private', '2026-11-13')))
    await expect(page.locator('[data-dnd-dragging]')).toHaveCount(0)
    await drag.drop()
    expect(await vibrations(page)).toEqual([])
    await noToast(page)
    await expect(sheet(page)).toHaveCount(0)
    expect((await itemOf(page, I.gym))?.start).toBe('2026-11-12')
  })
})

test.describe('タブレット（M・指）', { tag: ['@m'] }, () => {
  test('7日を横でも、長押しで掴んで別の日の列へ動かせる', async ({ page }) => {
    await openWeek(page)
    const drag = await startLongPress(page, await grabPoint(card(page, I.meeting)))
    await lifted(page)
    await drag.moveTo(await visiblePoint(cellL(page, 'work', '2026-11-12')))
    await expect(cellL(page, 'work', '2026-11-12')).toHaveAttribute('data-drop', 'hover')
    await drag.drop()
    await expect(toast(page, '11/12（木）へ移しました')).toBeVisible()
    await expect(cellL(page, 'work', '2026-11-12').getByTestId(`week-card-${I.meeting}`)).toBeVisible()
  })
})

test.describe('iPhone（WebKit・合成した指）', { tag: ['@ios'] }, () => {
  test('長押しで1日のカードと終点の●を動かせる', async ({ page }) => {
    await openWeek(page)
    let drag = await startLongPress(page, await grabPoint(card(page, I.meeting)), { via: 'synthetic' })
    await lifted(page)
    await drag.moveTo(await visiblePoint(halfS(page, 'work', '2026-11-09')))
    await drag.drop()
    await expect(toast(page, '11/9（月）へ移しました')).toBeVisible()
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-09')

    // 夜行バス（11/11〜11/12）の終点の●（レールの中）を 11/13 へ
    drag = await startLongPress(page, await grabPoint(endDot(page, I.nightBus)), { via: 'synthetic' })
    await lifted(page)
    await drag.moveTo(await visiblePoint(halfS(page, 'private', '2026-11-13')))
    await drag.drop()
    await expect(toast(page, '締め切り日を 11/13（金）にしました')).toBeVisible()
    expect(await itemOf(page, I.nightBus)).toMatchObject({ start: '2026-11-11', due: '2026-11-13' })
  })

  test('ロック中のカードは長押しで揺れるだけ。カードは文字の選択と長押しのメニューを止めている', async ({ page }) => {
    await openWeek(page)
    await recordPulses(page)
    const gym = card(page, I.gym)
    const css = await gym.evaluate((e) => {
      const cs = getComputedStyle(e)
      return {
        select: cs.getPropertyValue('-webkit-user-select') || cs.userSelect,
        callout: cs.getPropertyValue('-webkit-touch-callout'),
        touchAction: cs.touchAction,
      }
    })
    expect(css.select).toBe('none')
    // -webkit-touch-callout は iOS の WebKit だけが持つ（持たない WebKit では空。CALENDAR-164）
    if (css.callout) expect(css.callout).toBe('none')
    // すぐ動かした指はスクロールにするので、touch-action はそのまま
    expect(css.touchAction).toBe('auto')
    const drag = await startLongPress(page, await grabPoint(gym), { via: 'synthetic' })
    await expect.poll(() => recordedPulses(page)).toEqual([`shake:week-card-${I.gym}`])
    await drag.moveTo(await visiblePoint(halfS(page, 'private', '2026-11-13')))
    await drag.drop()
    expect(await recordedPulses(page)).toEqual([`shake:week-card-${I.gym}`])
    await noToast(page)
    await expect(sheet(page)).toHaveCount(0)
    expect((await itemOf(page, I.gym))?.start).toBe('2026-11-12')
  })
})
