// トップの画面の1つのドラッグの入れ物（src/features/dnd/TopDnd.tsx。docs/SPEC.md の 7.11）の E2E。ドラッグの入れ物はトップの画面を
// 包むので、掴んだまま幅が替わって（窓の大きさを替えた・iPad を回した）L の画面と S・M の画面が入れ替わっても、入れ物は残る。
// その時は、外れたウィークリーの予定のドラッグを、やめたこととして終える（動かさず、知らせも出さない。掴んだまま別の週へ移って
// いたら掴んだ週へ戻す。ウィークリーが自分で入れ物を持っていた時と同じ）。その後も、どの幅でも、すぐ掴んで落とせる
// （S3-FRAME-200・222・S3-TASK-184）。ウィークリーのドラッグの決まりそのものは e2e/week-drag.spec.ts。
// データは作り物の e2e/fixtures/demoData.ts（今日は 2026年11月10日（火）9:00。いつもの週 11/8〜11/14）
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Item } from '../src/domain/types'
import { DEMO_IDS, DEMO_WEEKS, demoData } from './fixtures/demoData'
import {
  collectDiagnosticsOnFailure,
  openCalendar,
  recordTurns,
  startLongPress,
  startMouseDrag,
  turnsOf,
  type DragSession,
} from './helpers'

collectDiagnosticsOnFailure()

const WEEK = `/week/${DEMO_WEEKS.main}`
const I = DEMO_IDS
type Point = { x: number; y: number }

/** 本物のカード（掴んでいる間の写しを除く） */
const card = (page: Page, id: string) => page.locator(`[data-testid="week-card-${id}"]:not([data-dnd-placeholder])`)
/** L・M の、その段のその日の列（落とす所） */
const cell = (page: Page, kind: 'work' | 'private', date: string) =>
  page.locator(`.wk-slot:not(.is-frozen) [data-tier="${kind}"] .wk-cell[data-date="${date}"]`)
/** 今の週（掴んだまま別の週へ移った間に残している、見えない掴んだ週を除く） */
const liveWeek = (page: Page) => page.locator('.wk-slot:not(.is-frozen) > [data-testid="view-week"]')
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text })
const lifted = (page: Page) => expect(page.locator('[data-dnd-dragging]')).toHaveCount(1)
/** 掴んだ物の印も、掴んでいる間の写しも無い */
const notDragging = (page: Page) => expect(page.locator('[data-dnd-dragging], [data-dnd-placeholder]')).toHaveCount(0)

const itemOf = (page: Page, id: string) =>
  page.evaluate((i) => window.__ds.getData().items[i] ?? null, id) as Promise<Item | null>

/** 要素の見えている所（スクロールする要素・画面の中に入っている所）の真ん中 */
async function visiblePoint(target: Locator): Promise<Point> {
  await target.scrollIntoViewIfNeeded()
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

/** その日の列が「今その上にある日」になるまで待つ（離す前に必ず待つ。重い時に通り道の日に落ちないように） */
const overDropDay = (to: Locator) => expect(to).toHaveAttribute('data-drop', 'hover')

/** 見ている週がその週になって描き終えるまで待つ */
async function onWeek(page: Page, sunday: string) {
  await expect(page).toHaveURL(new RegExp(`#/week/${sunday}$`))
  await expect(liveWeek(page).getByTestId(`week-col-${sunday}`)).toHaveCount(1)
}

/** 落とした後の知らせが出ていない（出るなら落とした直後に出るので、少し待ってから確かめる） */
async function noToast(page: Page) {
  await page.waitForTimeout(300)
  await expect(page.locator('.toast')).toHaveCount(0)
}

/**
 * 掴んで to の日へ動かし、そこが上にある日になってから離す。「〜へ移しました」が出る。落とした日のカードは、掴んでいる間の写し
 * （data-dnd-placeholder。知らせが出た後の1〜2描画は残る）が消えてから、本物だけを見る
 */
async function dropOn(page: Page, start: (from: Point) => Promise<DragSession>, id: string, to: Locator, done: string) {
  const drag = await start(await visiblePoint(card(page, id)))
  await lifted(page)
  await drag.moveTo(await visiblePoint(to))
  await overDropDay(to)
  await drag.drop()
  await expect(toast(page, done)).toBeVisible()
  await notDragging(page)
  await expect(to.locator(`[data-testid="week-card-${id}"]:not([data-dnd-placeholder])`)).toBeVisible()
}

test.describe('PC（マウス）', { tag: ['@pc'] }, () => {
  test('掴んだまま幅が M に替わると（ウィークリーが外れる）、やめたこととして終える: 動かさず、知らせも出さない。替わった後も、M と L でそのまま掴んで落とせ、［›］ではめくる', async ({
    page,
  }) => {
    await openCalendar(page, WEEK, { data: demoData() })
    await expect(page.getByTestId('view-week')).toBeVisible()
    const drag = await startMouseDrag(page, await visiblePoint(card(page, I.meeting)))
    await lifted(page)
    const target = cell(page, 'work', '2026-11-12')
    await drag.moveTo(await visiblePoint(target))
    await overDropDay(target)
    // 窓を狭める（L → M。カレンダーの領域が入れ替わる）
    await page.setViewportSize({ width: 800, height: 900 })
    await expect(page.getByTestId('side-column')).toHaveCount(0)
    await expect(page.getByTestId('view-week')).toBeVisible()
    await notDragging(page)
    await drag.drop()
    await noToast(page)
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    await onWeek(page, DEMO_WEEKS.main)
    // 掴んでいる印（画面の状態 dragging）も残らない: ［›］ではめくる（掴んでいる間はめくらない。3.7・7.11）
    await recordTurns(page)
    await page.getByTestId('cal-next').click()
    await onWeek(page, '2026-11-15')
    await expect.poll(() => turnsOf(page)).toEqual(['next'])
    await page.getByTestId('cal-prev').click()
    await onWeek(page, DEMO_WEEKS.main)
    // M でもすぐ掴んで落とせる
    await dropOn(page, (p) => startMouseDrag(page, p), I.meeting, cell(page, 'work', '2026-11-12'), '11/12（木）へ移しました')
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-12')
    // L へ戻しても同じ
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(page.getByTestId('side-column')).toBeVisible()
    await page.locator('.toast').getByRole('button', { name: '閉じる' }).click()
    await expect(page.locator('.toast')).toHaveCount(0)
    await dropOn(page, (p) => startMouseDrag(page, p), I.meeting, cell(page, 'work', '2026-11-13'), '11/13（金）へ移しました')
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-13')
  })

  test('掴んだまま右の端に留まって次の週へ移ってから幅が M に替わると、落とさずにやめた時と同じく掴んだ週へ戻る', async ({
    page,
  }) => {
    await openCalendar(page, WEEK, { data: demoData() })
    await expect(page.getByTestId('view-week')).toBeVisible()
    const drag = await startMouseDrag(page, await visiblePoint(card(page, I.meeting)))
    await lifted(page)
    const y = (await visiblePoint(cell(page, 'work', '2026-11-13'))).y
    const week = (await liveWeek(page).boundingBox())!
    // 右の端の帯（週の内側）に留まり、次の週へ移ったらすぐ帯から出る（帯に留まったままだと、さらに次の週へ移る）
    await drag.moveTo({ x: week.x + week.width - 10, y })
    await page.waitForFunction(() => location.hash.endsWith('/week/2026-11-15'), null, { polling: 'raf', timeout: 10_000 })
    await drag.moveTo({ x: week.x + week.width * 0.5, y }, { steps: 1, stepMs: 0 })
    await onWeek(page, '2026-11-15')
    await lifted(page)
    await page.setViewportSize({ width: 800, height: 900 })
    await expect(page.getByTestId('side-column')).toHaveCount(0)
    await onWeek(page, DEMO_WEEKS.main)
    await notDragging(page)
    await drag.drop()
    await noToast(page)
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    await expect(cell(page, 'work', '2026-11-10').getByTestId(`week-card-${I.meeting}`)).toBeVisible()
  })
})

test.describe('タブレット（指）', { tag: ['@m'] }, () => {
  test('長押しで掴んだまま横向き（L）になると、やめたこととして終える（動かさない）。横向きでも縦向きに戻しても、長押しで掴んで落とせる', async ({
    page,
  }) => {
    await openCalendar(page, WEEK, { data: demoData() })
    await expect(page.getByTestId('view-week')).toBeVisible()
    const drag = await startLongPress(page, await visiblePoint(card(page, I.meeting)))
    await lifted(page)
    const target = cell(page, 'work', '2026-11-12')
    await drag.moveTo(await visiblePoint(target))
    await overDropDay(target)
    // 横向きにする（M → L。右の列が出る）
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(page.getByTestId('side-column')).toBeVisible()
    await notDragging(page)
    await drag.drop()
    await noToast(page)
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    await dropOn(page, (p) => startLongPress(page, p), I.meeting, cell(page, 'work', '2026-11-12'), '11/12（木）へ移しました')
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-12')
    await page.setViewportSize({ width: 768, height: 1024 })
    await expect(page.getByTestId('side-column')).toHaveCount(0)
    await page.locator('.toast').getByRole('button', { name: '閉じる' }).click()
    await expect(page.locator('.toast')).toHaveCount(0)
    await dropOn(page, (p) => startLongPress(page, p), I.meeting, cell(page, 'work', '2026-11-13'), '11/13（金）へ移しました')
    expect((await itemOf(page, I.meeting))?.start).toBe('2026-11-13')
  })
})
