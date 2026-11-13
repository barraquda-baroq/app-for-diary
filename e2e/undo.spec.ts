// ウィークリー・デイリーの元に戻す・やり直す（docs/SPEC.md の 7.13・3.7・3.9・3.10。22. の段階2の終わりの確かめ）の E2E。
// 操作の列の右の端のボタン（週・日だけ）で、ドラッグ・完了・すばやく足す・削除・詳細で直した所（開いてから閉じるまでを1つ）を
// 戻し・やり直す。新しい操作でやり直せる物は消え、月へ替えて戻っても並びは残る。お知らせの［元に戻す］は同じ並びの1つを使う。
// PC は Ctrl+Z・Ctrl+Shift+Z も。ボタン・キーで戻した・やり直した時は「元に戻しました：…」のお知らせを出し、当てた予定・休みの日を
// 目立たせる（見えていない時は［見る］。■26 の今の決め方。作者の手順のとおり、週で動かして戻し、日に替えてもう一度）。
// データは作り物の e2e/fixtures/demoData.ts（今日は 2026年11月10日（火）9:00。週 11/8〜11/14）
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Item } from '../src/domain/types'
import { DEMO_IDS, DEMO_WEEKS, demoData } from './fixtures/demoData'
import {
  collectDiagnosticsOnFailure,
  historySettled,
  noHorizontalScroll,
  openCalendar,
  openItemMore,
  rawItem,
  sheetReady,
  startLongPress,
  startMouseDrag,
  tapSize,
} from './helpers'

collectDiagnosticsOnFailure()

const WEEK = `/week/${DEMO_WEEKS.main}`
const I = DEMO_IDS
type Point = { x: number; y: number }

const undoBtn = (page: Page) => page.getByTestId('cal-undo')
const redoBtn = (page: Page) => page.getByTestId('cal-redo')
const card = (page: Page, id: string) => page.locator(`[data-testid="week-card-${id}"]:not([data-dnd-placeholder])`)
const cellL = (page: Page, date: string) => page.locator(`[data-tier="work"] .wk-cell[data-date="${date}"]`)
const halfS = (page: Page, date: string) => page.locator(`.wk-half[data-tier="work"][data-date="${date}"]`)
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text })
const itemOf = (page: Page, id: string) =>
  page.evaluate((i) => window.__ds.getData().items[i] ?? null, id) as Promise<Item | null>

async function openWeek(page: Page) {
  await openCalendar(page, WEEK, { data: demoData() })
  await expect(page.getByTestId('view-week')).toBeVisible()
}

/** 要素の見えている所の真ん中（週・段の中はスクロールする） */
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

/** 落とす所がその上にある日（data-drop="hover"）になるまで待つ */
const overDropDay = (to: Locator) =>
  expect(to.locator('xpath=ancestor-or-self::*[@data-drop][1]')).toHaveAttribute('data-drop', 'hover')

/** マウスで打ち合わせ（11/10）を date の仕事の段へ落とす */
async function mouseMoveMeeting(page: Page, date: string) {
  const drag = await startMouseDrag(page, await visiblePoint(card(page, I.meeting)))
  const to = cellL(page, date)
  await drag.moveTo(await visiblePoint(to))
  await overDropDay(to)
  await drag.drop()
  await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe(date)
}

/** ボタンの読み上げ（押せない時は aria-disabled） */
async function expectLabel(btn: Locator, label: string, enabled = true) {
  await expect(btn).toHaveAttribute('aria-label', label)
  if (enabled) await expect(btn).not.toHaveAttribute('aria-disabled', 'true')
  else await expect(btn).toHaveAttribute('aria-disabled', 'true')
}

test.describe('PC（マウス・キー）', { tag: ['@pc'] }, () => {
  test('カードを動かして［元に戻す］で元の日、［やり直す］でまた動かした日。Ctrl+Z・Ctrl+Shift+Z でも同じ。保存される', async ({
    page,
  }) => {
    await openWeek(page)
    await expectLabel(undoBtn(page), '元に戻す', false)
    await expectLabel(redoBtn(page), 'やり直す', false)
    await mouseMoveMeeting(page, '2026-11-12')
    await expectLabel(undoBtn(page), '元に戻す（『打ち合わせ』を移した）')
    await expect(undoBtn(page)).toHaveAttribute('title', '元に戻す（『打ち合わせ』を移した）')
    await undoBtn(page).click()
    await expect(cellL(page, '2026-11-10').getByTestId(`week-card-${I.meeting}`)).toBeVisible()
    await expect.poll(async () => (await rawItem(page, I.meeting))?.start).toBe('2026-11-10')
    // 戻した操作の「〜へ移しました［元に戻す］」は消える
    await expect(toast(page, '11/12（木）へ移しました')).toHaveCount(0)
    await expectLabel(undoBtn(page), '元に戻す', false)
    await expectLabel(redoBtn(page), 'やり直す（『打ち合わせ』を移した）')
    await redoBtn(page).click()
    await expect(cellL(page, '2026-11-12').getByTestId(`week-card-${I.meeting}`)).toBeVisible()
    await expect.poll(async () => (await rawItem(page, I.meeting))?.start).toBe('2026-11-12')
    // キー（文字を打っていない所で）
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-12')
  })

  test('完了・すばやく足す・休みを戻す。新しい操作をするとやり直せる物は消える', async ({ page }) => {
    await openWeek(page)
    // 完了
    await page.getByTestId(`done-${I.mail}`).click()
    expect((await itemOf(page, I.mail))?.done).toBe(true)
    await expectLabel(undoBtn(page), '元に戻す（『メールの返信』を完了にした）')
    await undoBtn(page).click()
    await expect.poll(async () => (await itemOf(page, I.mail))?.done).toBe(false)
    await expectLabel(redoBtn(page), 'やり直す（『メールの返信』を完了にした）')
    // すばやく足す（Enter で足す）: やり直せる物は消える
    await page.getByTestId('week-add-2026-11-12-work').click()
    const input = page.getByTestId('quick-add-input')
    await input.fill('備品の注文')
    await input.press('Enter')
    await expect
      .poll(() => page.evaluate(() => Object.values(window.__ds.getData().items).some((i) => i.title === '備品の注文')))
      .toBe(true)
    await expectLabel(redoBtn(page), 'やり直す', false)
    await expectLabel(undoBtn(page), '元に戻す（『備品の注文』を足した）')
    await input.press('Escape')
    // 戻すとゴミ箱へ（カードが消える）
    await undoBtn(page).click()
    await expect(page.locator('.wk-card', { hasText: '備品の注文' })).toHaveCount(0)
    await expect
      .poll(() => page.evaluate(() => Object.values(window.__ds.getRaw().items).some((i) => i.title === '備品の注文')))
      .toBe(false)
    await expectLabel(redoBtn(page), 'やり直す（『備品の注文』を足した）')
    await redoBtn(page).click()
    await expect(page.locator('.wk-card', { hasText: '備品の注文' })).toHaveCount(1)
    // 休み（11/12）
    await page.getByTestId('week-off-2026-11-12').click()
    await expectLabel(undoBtn(page), '元に戻す（11/12（木）を休みにした）')
    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('week-off-2026-11-12')).not.toBeChecked()
  })

  test('詳細で2つの欄を直して閉じると1つの操作。元に戻すで両方戻る。削除（ゴミ箱へ）も戻せる', async ({ page }) => {
    await openWeek(page)
    await card(page, I.meeting).locator('.wk-open').click()
    await sheetReady(page)
    const title = page.getByTestId('item-title')
    await title.fill('打ち合わせ（本社）')
    await page.getByTestId('item-requester').fill('営業部')
    await page.getByTestId('item-kind-private').click()
    // 開いている間は積まない
    await page.getByRole('dialog').getByRole('button', { name: '閉じる' }).click()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await expectLabel(undoBtn(page), '元に戻す（『打ち合わせ（本社）』を直した）')
    expect(await itemOf(page, I.meeting)).toMatchObject({ title: '打ち合わせ（本社）', requester: '営業部', kind: 'private' })
    await undoBtn(page).click()
    await expect.poll(() => itemOf(page, I.meeting)).toMatchObject({ title: '打ち合わせ', requester: '', kind: 'work' })
    await expect.poll(async () => (await rawItem(page, I.meeting))?.title).toBe('打ち合わせ')
    await expectLabel(undoBtn(page), '元に戻す', false)

    // 削除（確かめてゴミ箱へ）→ 元に戻すで戻る
    await card(page, I.meeting).locator('.wk-open').click()
    await sheetReady(page)
    await openItemMore(page)
    await page.getByTestId('item-delete').click()
    await page.getByRole('dialog', { name: '『打ち合わせ』を削除しますか？' }).getByRole('button', { name: '削除' }).click()
    await expect(card(page, I.meeting)).toHaveCount(0)
    await expectLabel(undoBtn(page), '元に戻す（『打ち合わせ』を削除した）')
    await undoBtn(page).click()
    await expect(card(page, I.meeting)).toHaveCount(1)
    await expect.poll(async () => (await rawItem(page, I.meeting))?.title).toBe('打ち合わせ')
    await expect.poll(() => page.evaluate(() => Object.keys(window.__ds.getRaw().trashEntries).length)).toBe(0)
  })

  test('詳細で直してから中で削除すると、直した所が先に1つ、削除が別の1つ。戻すと直した所のまま戻り、もう一度で直す前へ。やり直すも順に', async ({
    page,
  }) => {
    await openWeek(page)
    await card(page, I.meeting).locator('.wk-open').click()
    await sheetReady(page)
    await page.getByTestId('item-title').fill('打ち合わせ（本社）')
    await page.getByTestId('item-title').press('Tab')
    await expect.poll(async () => (await itemOf(page, I.meeting))?.title).toBe('打ち合わせ（本社）')
    await openItemMore(page)
    await page.getByTestId('item-delete').click()
    await page
      .getByRole('dialog', { name: '『打ち合わせ（本社）』を削除しますか？' })
      .getByRole('button', { name: '削除' })
      .click()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await expect(card(page, I.meeting)).toHaveCount(0)
    await expectLabel(undoBtn(page), '元に戻す（『打ち合わせ（本社）』を削除した）')
    await undoBtn(page).click()
    await expect(card(page, I.meeting)).toHaveCount(1)
    await expect.poll(async () => (await itemOf(page, I.meeting))?.title).toBe('打ち合わせ（本社）')
    await expectLabel(undoBtn(page), '元に戻す（『打ち合わせ（本社）』を直した）')
    await undoBtn(page).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.title).toBe('打ち合わせ')
    await expectLabel(undoBtn(page), '元に戻す', false)
    // やり直すは古い方から: 直した所、それから削除
    await expectLabel(redoBtn(page), 'やり直す（『打ち合わせ（本社）』を直した）')
    await redoBtn(page).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.title).toBe('打ち合わせ（本社）')
    await expectLabel(redoBtn(page), 'やり直す（『打ち合わせ（本社）』を削除した）')
    await redoBtn(page).click()
    await expect(card(page, I.meeting)).toHaveCount(0)
    await expect.poll(() => itemOf(page, I.meeting)).toBeNull()
    await expect(toast(page, 'ほかの所で直されたので戻せません')).toHaveCount(0)
  })

  test('月・年では出さない（場所は残す）。月へ替えて戻っても並びは残り、日でも同じ並びを使う', async ({ page }) => {
    await openWeek(page)
    await mouseMoveMeeting(page, '2026-11-11')
    await page.getByTestId('cal-mode-month').click()
    await expect(page.getByTestId('view-month')).toBeVisible()
    await expect(undoBtn(page)).toBeHidden()
    await expect(page.getByTestId('cal-taskview')).toBeVisible()
    await page.getByTestId('cal-mode-year').click()
    await expect(undoBtn(page)).toBeHidden()
    await page.getByTestId('cal-mode-day').click()
    await expect(page.getByTestId('view-day')).toBeVisible()
    await expect(undoBtn(page)).toBeVisible()
    await expect(page.getByTestId('cal-taskview')).toBeHidden()
    await expectLabel(undoBtn(page), '元に戻す（『打ち合わせ』を移した）')
    await undoBtn(page).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
  })

  test('お知らせの［元に戻す］で戻した操作は、ボタンの元に戻すではもう出さず、やり直すで戻せる', async ({ page }) => {
    await openWeek(page)
    await page.getByTestId('week-off-2026-11-12').click()
    await mouseMoveMeeting(page, '2026-11-13')
    await toast(page, '11/13（金）へ移しました').getByRole('button', { name: '元に戻す' }).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    await expectLabel(undoBtn(page), '元に戻す（11/12（木）を休みにした）')
    await expectLabel(redoBtn(page), 'やり直す（『打ち合わせ』を移した）')
  })

  test('動かした後に同じカードを完了・また動かしてから、前の「〜へ移しました」の［元に戻す］: 後の操作も戻して動かす前へ（断らない）', async ({
    page,
  }) => {
    await openWeek(page)
    await mouseMoveMeeting(page, '2026-11-12')
    await page.getByTestId(`done-${I.meeting}`).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.done).toBe(true)
    await toast(page, '11/12（木）へ移しました').getByRole('button', { name: '元に戻す' }).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    expect((await itemOf(page, I.meeting))?.done).toBe(false)
    await expect.poll(async () => (await rawItem(page, I.meeting))?.done).toBe(false)
    await expect(toast(page, 'ほかの所で直されたので戻せません')).toHaveCount(0)
    // 完了のお知らせも戻したので消える。やり直すは古い方から
    await expect(toast(page, '完了にしました')).toHaveCount(0)
    await expectLabel(undoBtn(page), '元に戻す', false)
    await expectLabel(redoBtn(page), 'やり直す（『打ち合わせ』を移した）')
    await redoBtn(page).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-12')
    await expectLabel(redoBtn(page), 'やり直す（『打ち合わせ』を完了にした）')
    // 2回動かしてから1回目のお知らせ: 1回目の前の日（11/12）へ
    await mouseMoveMeeting(page, '2026-11-11')
    await mouseMoveMeeting(page, '2026-11-13')
    await toast(page, '11/11（水）へ移しました').getByRole('button', { name: '元に戻す' }).click()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-12')
    await expect(toast(page, 'ほかの所で直されたので戻せません')).toHaveCount(0)
    await expectLabel(redoBtn(page), 'やり直す（『打ち合わせ』を移した）')
  })
})

test.describe('S（Pixel 7・指）', { tag: ['@s'] }, () => {
  test('［年｜月｜週｜日］［＋］の列の右の端に2つ（34px 四方）。長押しで動かして［元に戻す］・［やり直す］。横にはみ出さない', async ({
    page,
  }) => {
    await openWeek(page)
    const row = page.locator('.cal-toolbar-right')
    const rowBox = (await row.boundingBox())!
    const redo = (await redoBtn(page).boundingBox())!
    const undo = (await undoBtn(page).boundingBox())!
    const add = (await page.getByTestId('cal-add').boundingBox())!
    // 右の端に寄せ、［＋］と同じ行
    expect(Math.abs(redo.x + redo.width - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(1)
    expect(undo.x).toBeGreaterThan(add.x + add.width)
    expect(Math.abs(undo.y - redo.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(undo.y + undo.height / 2 - (add.y + add.height / 2))).toBeLessThanOrEqual(1)
    await tapSize(undoBtn(page), '元に戻す')
    await tapSize(redoBtn(page), 'やり直す')
    await noHorizontalScroll(page)

    const drag = await startLongPress(page, await visiblePoint(card(page, I.meeting)))
    await expect(page.locator('[data-dnd-dragging]')).toHaveCount(1)
    const to = halfS(page, '2026-11-12')
    await drag.moveTo(await visiblePoint(to))
    await overDropDay(to)
    await drag.drop()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-12')
    await undoBtn(page).tap()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-10')
    await redoBtn(page).tap()
    await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe('2026-11-12')
  })

  test('360px の幅でも、週・日の列に収まる（月の［休み］の場所は詰める）。月・年では出さない', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openWeek(page)
    for (const mode of ['week', 'day'] as const) {
      await page.getByTestId(`cal-mode-${mode}`).click()
      await expect(redoBtn(page)).toBeVisible()
      const tb = (await page.getByTestId('calendar-toolbar').boundingBox())!
      const redo = (await redoBtn(page).boundingBox())!
      expect(redo.x + redo.width).toBeLessThanOrEqual(tb.x + tb.width)
      await noHorizontalScroll(page)
    }
    for (const mode of ['month', 'year'] as const) {
      await page.getByTestId(`cal-mode-${mode}`).click()
      await expect(undoBtn(page)).toBeHidden()
      await noHorizontalScroll(page)
    }
  })

  test('すばやく足すを開いたまま［元に戻す］を押しても閉じず、打っている字はそのまま（戻るのはその前の操作）', async ({
    page,
  }) => {
    await openWeek(page)
    await page.getByTestId(`done-${I.mail}`).tap()
    await page.getByTestId('week-add-2026-11-12-work').tap()
    const input = page.getByTestId('quick-add-input')
    await input.fill('打ちかけ')
    await undoBtn(page).tap()
    await expect.poll(async () => (await itemOf(page, I.mail))?.done).toBe(false)
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('打ちかけ')
    await expect(input).toBeFocused()
    expect(await page.evaluate(() => Object.values(window.__ds.getData().items).some((i) => i.title === '打ちかけ'))).toBe(false)
  })
})

test.describe('M（タブレット・指）', { tag: ['@m'] }, () => {
  test('デイリーで●を押して完了 → ［元に戻す］・［やり直す］。お知らせの［元に戻す］で戻すと、ボタンではもう出さない', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    await expect(page.getByTestId('view-day')).toBeVisible()
    await tapSize(undoBtn(page), '元に戻す')
    await page.getByTestId(`done-${I.mail}`).first().tap()
    await expect.poll(async () => (await itemOf(page, I.mail))?.done).toBe(true)
    await undoBtn(page).tap()
    await expect.poll(async () => (await itemOf(page, I.mail))?.done).toBe(false)
    await redoBtn(page).tap()
    await expect.poll(async () => (await itemOf(page, I.mail))?.done).toBe(true)
    // もう一度外して付け直し、お知らせの［元に戻す］で戻す
    await page.getByTestId(`done-${I.mail}`).first().tap()
    await page.getByTestId(`done-${I.mail}`).first().tap()
    await toast(page, '『メールの返信』を完了にしました').last().getByRole('button', { name: '元に戻す' }).tap()
    await expect.poll(async () => (await itemOf(page, I.mail))?.done).toBe(false)
    await expectLabel(undoBtn(page), '元に戻す（『メールの返信』の完了を外した）')
    await expectLabel(redoBtn(page), 'やり直す（『メールの返信』を完了にした）')
  })
})

// ---------- 戻した・やり直した時のお知らせと目立たせ（7.13・3.9・4.9。■26 の今の決め方） ----------
// 作者の手順（2026-11-13）: 「週の画面でカードを動かし、［元に戻す］と［やり直す］を押す。日の画面に替えて、もう一度押す。」
// 作者の言葉: 「切り替え先のモードで、元に戻すとやり直すボタンはエフェクトとしては反応しているようだが、画面が何も変わらないので
// 何が起きているかわからない」

/** 戻した・やり直したお知らせ（画面の下の aria-live の所の role="status"） */
const feedback = (page: Page) =>
  page.locator('.toasts[aria-live="assertive"] [role="status"]', { hasText: /^(元に戻しました|やり直しました)：/ })
const lookBtn = (page: Page) => feedback(page).getByRole('button', { name: '見る' })

/** 目立たせた（.flash を付けた）要素の data-testid を控え始める（1.2秒で外れるので、付いた時に控える） */
async function recordFlashes(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __e2eFlashes?: string[] }
    w.__e2eFlashes = []
    new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target as HTMLElement
        if (el.classList?.contains('flash')) w.__e2eFlashes!.push(el.dataset.testid ?? el.className)
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
  })
}
const flashes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __e2eFlashes?: string[] }).__e2eFlashes ?? []) as Promise<string[]>
/** 控えを空にする（前の操作の目立たせ（1.2秒）が終わってから。落とした先のカードは、その間に出た所でも目立つ） */
async function clearFlashes(page: Page) {
  await expect(page.locator('.flash')).toHaveCount(0)
  await page.evaluate(() => void ((window as unknown as { __e2eFlashes?: string[] }).__e2eFlashes = []))
}

/** target が画面の下のお知らせと重なっていない（お知らせの下に隠れていない。4.9） */
async function notUnderToast(page: Page, target: Locator) {
  await expect
    .poll(async () => {
      const t = await page.locator('.toasts').boundingBox()
      const r = await target.boundingBox()
      if (!t || !r || t.height === 0) return true
      return !(r.x < t.x + t.width && r.x + r.width > t.x && r.y < t.y + t.height && r.y + r.height > t.y)
    })
    .toBe(true)
}

/** 押す（PC はマウス、S・M は指） */
const press = (target: Locator, touch: boolean) => (touch ? target.tap() : target.click())

/** 打ち合わせ（11/10）を date の仕事の日へ動かす（PC はマウス、S・M は長押し。S は7日を縦、M・L は7日を横） */
async function moveMeetingBy(page: Page, date: string, how: 'mouse' | 'touch-h' | 'touch-v') {
  if (how === 'mouse') return mouseMoveMeeting(page, date)
  const drag = await startLongPress(page, await visiblePoint(card(page, I.meeting)))
  await expect(page.locator('[data-dnd-dragging]')).toHaveCount(1)
  const to = how === 'touch-v' ? halfS(page, date) : cellL(page, date)
  await drag.moveTo(await visiblePoint(to))
  await overDropDay(to)
  await drag.drop()
  await expect.poll(async () => (await itemOf(page, I.meeting))?.start).toBe(date)
}

/**
 * 作者の手順: 週でカードを動かし、［元に戻す］［やり直す］（カードが見えていれば目立たせ、［見る］は無い）。日に替えてカードの無い日
 * （11/11）で［元に戻す］→「元に戻しました：…（11/12（木）→ 11/10（火））［見る］」→ 押すとその日（11/10）のデイリー（置き換える）で
 * 予定を目立たせる。S（7日を縦）は木曜へ落とす時に週を木曜まで送っているので、戻した火曜のカードは週の中の見えていない所にあり、
 * ［見る］で週の中を送って目立たせる（行き先は替えない）
 */
async function authorSteps(page: Page, how: 'mouse' | 'touch-h' | 'touch-v') {
  const touch = how !== 'mouse'
  await openWeek(page)
  await recordFlashes(page)
  await moveMeetingBy(page, '2026-11-12', how)
  await clearFlashes(page)
  await press(undoBtn(page), touch)
  const undone = '元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））'
  // 動かした時の「〜へ移しました［元に戻す］」は消え、戻したお知らせだけ（［元に戻す］は無い。読み上げは role="status"）
  await expect(feedback(page)).toContainText(undone)
  await expect(page.locator('.toast')).toHaveCount(1)
  await expect(feedback(page).getByRole('button', { name: '元に戻す' })).toHaveCount(0)
  if (how === 'touch-v') {
    await expect(feedback(page)).toHaveText(`${undone}見る`)
    expect(await flashes(page)).toEqual([])
    await press(lookBtn(page), touch)
    await expect(page).toHaveURL(/#\/week\/2026-11-08$/)
    await expect(card(page, I.meeting)).toBeInViewport({ ratio: 1 })
  } else {
    await expect(feedback(page)).toHaveText(undone)
  }
  await expect.poll(() => flashes(page)).toContain(`week-card-${I.meeting}`)
  await notUnderToast(page, card(page, I.meeting))
  await clearFlashes(page)
  await press(redoBtn(page), touch)
  await expect(feedback(page)).toHaveText('やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））')
  // 前のお知らせは置き換える（重ねない）
  await expect(page.locator('.toast')).toHaveCount(1)
  await expect.poll(() => flashes(page)).toContain(`week-card-${I.meeting}`)
  // 見えている時も、画面の下のお知らせの下に隠さない（4.9）
  await notUnderToast(page, card(page, I.meeting))

  // 日の画面に替えて、カードの無い日（11/11）で［元に戻す］
  await press(page.getByTestId('cal-mode-day'), touch)
  await expect(page.getByTestId('view-day')).toBeVisible()
  await press(page.getByTestId('cal-next'), touch)
  await expect(page).toHaveURL(/#\/day\/2026-11-11$/)
  await expect(page.getByTestId(`day-event-${I.meeting}`)).toHaveCount(0)
  await clearFlashes(page)
  await press(undoBtn(page), touch)
  await expect(feedback(page)).toHaveText('元に戻しました：『打ち合わせ』を移した（11/12（木）→ 11/10（火））見る')
  await expect(lookBtn(page)).toBeVisible()
  expect(await flashes(page)).toEqual([])
  await historySettled(page)
  const length = await page.evaluate(() => history.length)
  await press(lookBtn(page), touch)
  // その日のデイリーへ（置き換える: 履歴は増えない）。押したお知らせは消える
  await expect(page).toHaveURL(/#\/day\/2026-11-10$/)
  await expect(feedback(page)).toHaveCount(0)
  const event = page.getByTestId(`day-event-${I.meeting}`)
  await expect(event).toBeVisible()
  await expect.poll(() => flashes(page)).toContain(`day-event-${I.meeting}`)
  await expect(event).toBeInViewport({ ratio: 1 })
  await historySettled(page)
  expect(await page.evaluate(() => history.length)).toBe(length)
  // ［やり直す］: 予定はこの日から 11/12 へ移る（見えない）ので［見る］
  await press(redoBtn(page), touch)
  await expect(feedback(page)).toHaveText('やり直しました：『打ち合わせ』を移した（11/10（火）→ 11/12（木））見る')
}

test.describe('戻した・やり直したお知らせ（PC）', { tag: ['@pc'] }, () => {
  test('作者の手順: 週で動かして戻す・やり直す（目立たせる）、日に替えてカードの無い日で戻す →［見る］でその日へ移って目立たせる', async ({
    page,
  }) => {
    await authorSteps(page, 'mouse')
  })

  test('キーでも同じお知らせ（Ctrl+Z・Ctrl+Shift+Z・Ctrl+Y）。休みを戻すと日の見出しを目立たせる', async ({ page }) => {
    await openWeek(page)
    await recordFlashes(page)
    await page.getByTestId('week-off-2026-11-12').click()
    await page.keyboard.press('Control+z')
    await expect(feedback(page)).toHaveText('元に戻しました：11/12（木）を休みにした')
    await expect(page.getByTestId('week-off-2026-11-12')).not.toBeChecked()
    await expect.poll(() => flashes(page)).toContain('week-head-2026-11-12')
    await page.keyboard.press('Control+Shift+z')
    await expect(feedback(page)).toHaveText('やり直しました：11/12（木）を休みにした')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+y')
    await expect(feedback(page)).toHaveText('やり直しました：11/12（木）を休みにした')
    await expect(page.locator('.toast')).toHaveCount(1)
    await expect(page.getByTestId('week-off-2026-11-12')).toBeChecked()
  })

  test('デイリーで休みを戻す: その日なら見出しを目立たせ、別の日なら［見る］でその日へ移って見出しを目立たせる', async ({
    page,
  }) => {
    await openWeek(page)
    await recordFlashes(page)
    await page.getByTestId('week-off-2026-11-12').click()
    // 日付の見出しから、その日のデイリーへ
    await page
      .getByTestId('week-head-2026-11-12')
      .getByRole('button', { name: /デイリーを開く/ })
      .click()
    await expect(page).toHaveURL(/#\/day\/2026-11-12$/)
    await expect(page.getByTestId('day-head')).toHaveAttribute('data-off', 'true')
    await clearFlashes(page)
    await undoBtn(page).click()
    await expect(feedback(page)).toHaveText('元に戻しました：11/12（木）を休みにした')
    await expect(lookBtn(page)).toHaveCount(0)
    await expect(page.getByTestId('day-head')).not.toHaveAttribute('data-off', 'true')
    await expect.poll(() => flashes(page)).toContain('day-head')
    // 次の日（11/13）で［やり直す］:［見る］で 11/12 へ
    await page.getByTestId('cal-next').click()
    await expect(page).toHaveURL(/#\/day\/2026-11-13$/)
    await clearFlashes(page)
    await redoBtn(page).click()
    await expect(feedback(page)).toHaveText('やり直しました：11/12（木）を休みにした見る')
    expect(await flashes(page)).toEqual([])
    await lookBtn(page).click()
    await expect(page).toHaveURL(/#\/day\/2026-11-12$/)
    await expect(page.getByTestId('day-head')).toHaveAttribute('data-off', 'true')
    await expect.poll(() => flashes(page)).toContain('day-head')
  })

  test('削除をやり直すと（予定はゴミ箱へ）［見る］も目立たせも無い。戻すと（ゴミ箱から）カードを目立たせる', async ({ page }) => {
    await openWeek(page)
    await recordFlashes(page)
    await card(page, I.meeting).locator('.wk-open').click()
    await sheetReady(page)
    await openItemMore(page)
    await page.getByTestId('item-delete').click()
    await page.getByRole('dialog', { name: '『打ち合わせ』を削除しますか？' }).getByRole('button', { name: '削除' }).click()
    await expect(card(page, I.meeting)).toHaveCount(0)
    await clearFlashes(page)
    await undoBtn(page).click()
    await expect(feedback(page)).toHaveText('元に戻しました：『打ち合わせ』を削除した（ゴミ箱から戻した）')
    await expect.poll(() => flashes(page)).toContain(`week-card-${I.meeting}`)
    await clearFlashes(page)
    await redoBtn(page).click()
    await expect(feedback(page)).toHaveText('やり直しました：『打ち合わせ』を削除した（ゴミ箱へ）')
    await expect(lookBtn(page)).toHaveCount(0)
    await expect(card(page, I.meeting)).toHaveCount(0)
    expect(await flashes(page)).toEqual([])
  })
})

test.describe('戻した・やり直したお知らせ（S）', { tag: ['@s'] }, () => {
  test('作者の手順（指）: 週で長押しで動かして戻す・やり直す、日に替えてカードの無い日で戻す →［見る］', async ({ page }) => {
    await authorSteps(page, 'touch-v')
  })

  test('週の中の見えていない所（スクロールの外）で戻した時は［見る］。押すと週の中を送って目立たせる（お知らせの下に隠さない）', async ({
    page,
  }) => {
    await openWeek(page)
    await recordFlashes(page)
    await page.getByTestId('week-off-2026-11-13').tap()
    // 週のいちばん上（日曜）へ送る: 金曜の見出しは見えない
    await page.getByTestId('view-week').evaluate((el) => el.scrollTo({ top: 0 }))
    await expect(page.getByTestId('week-head-2026-11-13')).not.toBeInViewport()
    await clearFlashes(page)
    await undoBtn(page).tap()
    await expect(feedback(page)).toHaveText('元に戻しました：11/13（金）を休みにした見る')
    expect(await flashes(page)).toEqual([])
    await lookBtn(page).tap()
    await expect(page).toHaveURL(/#\/week\/2026-11-08$/)
    await expect.poll(() => flashes(page)).toContain('week-head-2026-11-13')
    await expect(page.getByTestId('week-head-2026-11-13')).toBeInViewport({ ratio: 1 })
  })
})

test.describe('戻した・やり直したお知らせ（M）', { tag: ['@m'] }, () => {
  test('作者の手順（指）: 週で長押しで動かして戻す・やり直す、日に替えてカードの無い日で戻す →［見る］', async ({ page }) => {
    await authorSteps(page, 'touch-h')
  })
})
