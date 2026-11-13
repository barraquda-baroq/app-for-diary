// 履歴と「戻る」「進む」の E2E（docs/SPEC.md の 3.1・3.8。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・■22・■23。
// src/history/appHistory.ts）。iPhone の画面の端からのフリックは、ブラウザの「戻る」「進む」の身振りそのもの（ページには popstate だけが
// 来る）なので、page.goBack・page.goForward で同じ所を通す。iPhone は Chromium に iPhone の UA を付けた物（@s）と、CI の WebKit（@ios）。
// Android は Pixel 7（mobile。UA が Android）、PC は Desktop Chrome。今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）
import { devices, expect, test, type Page } from '@playwright/test'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import {
  collectDiagnosticsOnFailure,
  goBack,
  goForward,
  historySettled,
  historyShape,
  openCalendar,
  recordTurns,
  touchSwipe,
  turnDone,
  turnsOf,
} from './helpers'

collectDiagnosticsOnFailure()

const IPHONE_UA = devices['iPhone 14'].userAgent

const DAY = '/day/2026-11-10'
const WEEK = '/week/2026-11-08'
const MONTH = '/month/2026-11'
const YEAR = '/year/2026'

/** 今の行き先（# の後ろ） */
const hashOf = (page: Page) => page.evaluate(() => window.location.hash.slice(1))

/** 行き先が path になるまで待つ */
async function at(page: Page, path: string) {
  await expect.poll(() => hashOf(page)).toBe(path)
}

/** 行き先のモードの画面が出ている */
async function showing(page: Page, path: string) {
  await at(page, path)
  await expect(page.getByTestId(`view-${path.split('/')[1]}`)).toBeVisible()
}

const historyLength = (page: Page) => page.evaluate(() => history.length)

/** 「Diary Studio を閉じますか？」 */
const closeDialog = (page: Page) => page.getByRole('dialog', { name: 'Diary Studio を閉じますか？' })

/** 詳細の画面を開く（デイリーの「定例ミーティング」。指なら tap） */
async function openDetail(page: Page, finger: boolean) {
  const open = page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open')
  if (finger) await open.tap()
  else await open.click()
  await expect(page.getByTestId('item-sheet')).toBeVisible()
  await expect(page.getByTestId('item-title')).toHaveValue('定例ミーティング')
  await historySettled(page)
}

test.describe('iPhone の画面の端からのフリック（Chromium に iPhone の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPHONE_UA })

  test('カレンダー: 左の端から（戻る）で 日→週→月→年→日、右の端から（進む）で 年→月→週→日→年。見ている日を保ち、ページはめくらず、履歴は増えない', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-12')
    expect((await historyShape(page))?.source).toBe('edge-flick')
    await recordTurns(page)
    const length = await historyLength(page)
    for (const next of ['/week/2026-11-08', '/month/2026-11', '/year/2026', '/day/2026-11-12']) {
      await goBack(page)
      await showing(page, next)
    }
    for (const next of ['/year/2026', '/month/2026-11', '/week/2026-11-08', '/day/2026-11-12']) {
      await goForward(page)
      await showing(page, next)
    }
    expect(await turnsOf(page)).toEqual([])
    expect(await historyLength(page)).toBe(length)
    // 閉じるかは聞かない（iPhone には OS の戻るボタンが無い）
    await expect(closeDialog(page)).toHaveCount(0)
  })

  test('20回払っても、モードのボタン・‹ ›・なぞりで替えても履歴は増えず、なぞり・‹ › はページをめくる', async ({ page }) => {
    await openCalendar(page, WEEK, { data: demoData() })
    const length = await historyLength(page)
    for (let i = 0; i < 10; i++) {
      await goBack(page)
      await goForward(page)
    }
    await showing(page, WEEK)
    await page.getByTestId('cal-mode-month').click()
    await page.getByTestId('cal-mode-day').click()
    await showing(page, DAY)
    await recordTurns(page)
    await page.getByTestId('cal-next').click()
    await at(page, '/day/2026-11-11')
    await turnDone(page)
    await touchSwipe(page, page.getByTestId('calendar-body'), 140, 0)
    await at(page, DAY)
    await expect.poll(() => turnsOf(page)).toEqual(['next', 'prev'])
    expect(await historyLength(page)).toBe(length)
    // 替えた後も、端からのフリックはモードを回す
    await goForward(page)
    await showing(page, YEAR)
  })

  test('登録の画面: 左右どちらのフリックでも閉じない（開いたまま。書きかけの確かめも出さない）', async ({ page }) => {
    await openCalendar(page, DAY)
    await page.getByTestId('cal-add').click()
    const sheet = page.getByTestId('item-sheet')
    await expect(sheet).toBeVisible()
    await page.getByTestId('item-title').fill('書きかけの予定')
    await historySettled(page)
    await goBack(page)
    await expect(sheet).toBeVisible()
    await goForward(page)
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('item-discard')).toHaveCount(0)
    await expect(page.getByTestId('item-title')).toHaveValue('書きかけの予定')
    await at(page, DAY)
    // ［やめる］は今までどおり書きかけを確かめて閉じる
    await page.getByTestId('item-cancel').click()
    await page.getByTestId('item-discard').click()
    await expect(sheet).toHaveCount(0)
    await showing(page, DAY)
  })

  test('詳細の画面: 左の端からでも右の端からでも閉じ（モード・期間はそのまま）、［×］でも閉じる。閉じた後に払うとモードを回す（開き直さない）', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { data: demoData() })
    const sheet = page.getByTestId('item-sheet')
    await openDetail(page, true)
    await goBack(page)
    await expect(sheet).toHaveCount(0)
    await showing(page, DAY)
    await openDetail(page, true)
    await goForward(page)
    await expect(sheet).toHaveCount(0)
    await showing(page, DAY)
    await openDetail(page, true)
    await page.getByTestId('modal-close').click()
    await expect(sheet).toHaveCount(0)
    await historySettled(page)
    await goForward(page)
    await expect(sheet).toHaveCount(0)
    await showing(page, YEAR)
  })

  test('設定・MIM: どちらへ払ってもカレンダーの方へ1つ戻る', async ({ page }) => {
    await openCalendar(page, MONTH)
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await historySettled(page)
    await goForward(page)
    await showing(page, MONTH)
    await page.getByTestId('open-mim').click()
    await at(page, '/mim')
    await historySettled(page)
    await goBack(page)
    await showing(page, MONTH)
  })

  test('読み込み直しても印を作り直さず（履歴は増えない）、フリックでモードを回せる', async ({ page }) => {
    await openCalendar(page, WEEK)
    const length = await historyLength(page)
    await page.reload()
    await expect(page.getByTestId('view-week')).toBeVisible()
    await historySettled(page)
    expect(await historyLength(page)).toBe(length)
    await goForward(page)
    await showing(page, '/day/2026-11-10')
    await goBack(page)
    await showing(page, WEEK)
    expect(await historyLength(page)).toBe(length)
  })
})

test.describe('Android の戻るボタン（Pixel 7）', { tag: ['@s'] }, () => {
  test('カレンダーで「戻る」を押すと「Diary Studio を閉じますか？」。［キャンセル］で残り、もう一度押すとまた聞く。モードを替えても前のモードへは戻らない', async ({
    page,
  }) => {
    await openCalendar(page, MONTH)
    expect((await historyShape(page))?.source).toBe('os-back')
    await page.getByTestId('cal-mode-week').click()
    await showing(page, WEEK)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await expect(page.getByTestId('app-close')).toHaveText('閉じる')
    await page.getByTestId('app-close-cancel').click()
    await expect(closeDialog(page)).toHaveCount(0)
    await showing(page, WEEK)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    // 聞いている間の「戻る」は、聞くのをやめる
    await goBack(page)
    await expect(closeDialog(page)).toHaveCount(0)
    await showing(page, WEEK)
  })

  test('［閉じる］でアプリの前のページへ戻る（アプリを離れる）', async ({ page }) => {
    await page.goto('data:text/html,<title>before</title><p>before</p>')
    await openCalendar(page, MONTH)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close').click()
    await expect.poll(() => page.url()).toMatch(/^data:/)
  })

  test('シートが開いている時の「戻る」はシートを閉じ、次の「戻る」で閉じるかを聞く。書きかけの登録の画面は「書きかけを捨てますか？」', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { data: demoData() })
    const sheet = page.getByTestId('item-sheet')
    await openDetail(page, true)
    await goBack(page)
    await expect(sheet).toHaveCount(0)
    await expect(closeDialog(page)).toHaveCount(0)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    // 登録の画面（書きかけ）
    await page.getByTestId('cal-add').click()
    await expect(sheet).toBeVisible()
    await page.getByTestId('item-title').fill('書きかけ')
    await historySettled(page)
    await goBack(page)
    await page.getByTestId('item-discard-keep').click()
    await expect(sheet).toBeVisible()
    await goBack(page)
    await page.getByTestId('item-discard').click()
    await expect(sheet).toHaveCount(0)
    await historySettled(page)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
  })

  test('詳細の画面は、シートの外を押しても閉じ、下にあった物（ヘッダーの［MIM］）は押されない（■23）', async ({ page }) => {
    await openCalendar(page, DAY, { data: demoData() })
    await openDetail(page, true)
    const mim = await page.getByTestId('open-mim').boundingBox()
    if (!mim) throw new Error('［MIM］が見えていません')
    await page.touchscreen.tap(mim.x + mim.width / 2, mim.y + mim.height / 2)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await page.waitForTimeout(300)
    await showing(page, DAY)
  })

  test('読み込み直しても、モード・期間はそのままで、「戻る」は閉じるかを聞く（履歴は増えない）', async ({ page }) => {
    await openCalendar(page, MONTH)
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2026-12')
    const length = await historyLength(page)
    await page.reload()
    await showing(page, '/month/2026-12')
    await historySettled(page)
    expect(await historyLength(page)).toBe(length)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
  })
})

test.describe('PC のブラウザの戻る・進む（■22）', { tag: ['@pc'] }, () => {
  test('カレンダーで「戻る」は閉じるかを聞き、「進む」は何もしない。詳細の画面は「戻る」で閉じ、「進む」で開き直さない', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { data: demoData() })
    await goForward(page)
    await showing(page, DAY)
    await expect(closeDialog(page)).toHaveCount(0)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    await openDetail(page, false)
    await goBack(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await goForward(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await showing(page, DAY)
  })

  test('詳細の画面は外を押すと閉じ、下にあった物（ヘッダーの設定の歯車）は押されない（■23）', async ({ page }) => {
    await openCalendar(page, DAY, { data: demoData() })
    await openDetail(page, false)
    const gear = await page.getByTestId('open-settings').boundingBox()
    const sheet = await page.getByTestId('item-sheet').boundingBox()
    if (!gear || !sheet) throw new Error('歯車・詳細の画面が見えていません')
    const point = { x: gear.x + gear.width / 2, y: gear.y + gear.height / 2 }
    // 押す所は、真ん中の小さな画面の外（後ろの暗い所）
    expect(point.x < sheet.x || point.x > sheet.x + sheet.width || point.y < sheet.y || point.y > sheet.y + sheet.height).toBe(
      true,
    )
    await page.mouse.click(point.x, point.y)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await page.waitForTimeout(300)
    await showing(page, DAY)
  })

  test('開いた直後（まだ押していない）は履歴に積まず、最初に押した時に「戻る」「進む」の印を作る。‹ › を20回押しても増えない', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { arm: false })
    const length = await historyLength(page)
    expect(await historyShape(page)).toMatchObject({ base: null, buildPending: true })
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2026-12')
    await historySettled(page)
    expect(await historyLength(page)).toBe(length + 2)
    for (let i = 0; i < 10; i++) await page.getByTestId('cal-next').click()
    for (let i = 0; i < 10; i++) await page.getByTestId('cal-prev').click()
    await at(page, '/month/2026-12')
    await historySettled(page)
    expect(await historyLength(page)).toBe(length + 2)
  })
})

test.describe('iPhone（WebKit）', { tag: ['@ios'] }, () => {
  test('カレンダー: 左の端から（戻る）で 日→週→月→年→日、右の端から（進む）で 年→月→週→日→年（iPhone と見分ける）。履歴は増えない', async ({
    page,
  }) => {
    await openCalendar(page, DAY)
    expect((await historyShape(page))?.source).toBe('edge-flick')
    const length = await historyLength(page)
    for (const next of [WEEK, MONTH, YEAR, DAY]) {
      await goBack(page)
      await showing(page, next)
    }
    for (const next of [YEAR, MONTH, WEEK, DAY]) {
      await goForward(page)
      await showing(page, next)
    }
    expect(await historyLength(page)).toBe(length)
  })

  test('登録の画面はフリックで閉じず、詳細の画面は左右どちらのフリックでも閉じる（■23）', async ({ page }) => {
    await openCalendar(page, DAY, { data: demoData() })
    const sheet = page.getByTestId('item-sheet')
    await page.getByTestId('cal-add').click()
    await expect(sheet).toBeVisible()
    await historySettled(page)
    await goBack(page)
    await expect(sheet).toBeVisible()
    await page.getByTestId('modal-close').click()
    await expect(sheet).toHaveCount(0)
    await historySettled(page)
    await openDetail(page, true)
    await goBack(page)
    await expect(sheet).toHaveCount(0)
    await openDetail(page, true)
    await goForward(page)
    await expect(sheet).toHaveCount(0)
    await showing(page, DAY)
  })
})
