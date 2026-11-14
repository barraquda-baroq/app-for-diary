// iPhone・iPad の画面の端からのフリックの E2E（docs/SPEC.md の 3.1・3.7・3.8・12.1・12.2。22. の ■31〜■33。
// src/history/singleEntryHistory.ts・src/history/edgeFlick.ts）。iPhone・iPad ではブラウザの履歴をいつも1つのままにする（積む・戻る・
// 進むは使わず、今の物の置き換えだけ）ので、iPhone の「戻る」「進む」の身振り（ページがめくれる動き）は始まらず、画面の端から払った
// 指はページに来る。アプリはそれを受け取り、動き無しで切り替える: カレンダーでは左の端から（指を左から右へ）年→月→週→日→年、右の
// 端から（右から左へ）日→週→月→年→日（2026-11-14 の作者の答え）。登録・詳細の画面は左右どちらでも閉じ（登録は書きかけでも聞かずに
// 捨てる。■27）、確かめのダイアログはそれだけを閉じ、設定・MIM はカレンダーの方へ1つ戻る（スクロールの位置も戻る）。
// 身振りそのものは Chromium にも CI の WebKit にも無いので、ここで確かめるのは、ブラウザの履歴が増えない（history.length が開いた時の
// まま。Chromium のタブは初めの about:blank の分がある）こと・アプリが積む・戻る・進む（pushState・go・back・forward）を一度も呼ばない
// こと（開く前に置く物で控える）と、端の指でアプリがすること。指は e2e/helpers.ts の edgeFlick（画面の左右の端から 3px の所から払う）。
// @ios の印の物は CI の WebKit（本物の WebKit の履歴）でも流す。今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）
import { devices, expect, test, type Page } from '@playwright/test'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import {
  collectDiagnosticsOnFailure,
  edgeFlick,
  historyCalls,
  historySettled,
  historyShape,
  iosCancelledTouch,
  openCalendar,
  openItemMore,
  recordTurns,
  spyHistory,
  thumbArc,
  touchPath,
  turnDone,
  turnsOf,
} from './helpers'

collectDiagnosticsOnFailure()

const IPHONE_UA = devices['iPhone 14'].userAgent
const IPAD_UA = devices['iPad Pro 11'].userAgent

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

/** ブラウザの履歴が開いた時のまま（length）で、積む・戻る・進むを一度も呼んでいない */
async function noGrowth(page: Page, length: number) {
  await historySettled(page)
  expect(await historyLength(page)).toBe(length)
  expect(await historyCalls(page)).toEqual([])
}

/** 予定の件数（件名で） */
const countByTitle = (page: Page, title: string) =>
  page.evaluate((t) => Object.values(window.__ds.getData().items).filter((i) => i.title === t).length, title)

/** デイリーの「定例ミーティング」の詳細の画面を指で開く */
async function openDetail(page: Page) {
  await page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open').tap()
  await expect(page.getByTestId('item-sheet')).toBeVisible()
  await expect(page.getByTestId('item-title')).toHaveValue('定例ミーティング')
  await historySettled(page)
}

/** 「『定例ミーティング』を削除しますか？」 */
const deleteConfirm = (page: Page) => page.getByRole('dialog', { name: '『定例ミーティング』を削除しますか？' })

// CI の WebKit（本物の WebKit の履歴）でも流す物。CI の WebKit は重く、開く数を増やすと不安定になるので、開く数を2つに抑える
test.describe('iPhone の画面の端からのフリック（Chromium に iPhone の UA と CI の WebKit）', { tag: ['@s', '@ios'] }, () => {
  test.use({ userAgent: IPHONE_UA })

  test('カレンダー: 左の端から 年→月→週→日→年、右の端から 日→週→月→年→日（見ている日を保ち、ページはめくらない）。すばやく足すに字を打ったまま払うと、足さずに閉じてモードを回し、打った字は書きかけに残る（12.1）。ブラウザの履歴は増えず、積む・戻る・進むは呼ばない', async ({
    page,
    browserName,
  }) => {
    test.slow(browserName === 'webkit', 'CI の WebKit はソフトウェアの描画で重い')
    await spyHistory(page)
    await openCalendar(page, WEEK, { data: demoData() })
    expect(await historyShape(page)).toMatchObject({ kind: 'single', source: 'edge-flick', depth: 1, index: 0 })
    const length = await historyLength(page)
    await recordTurns(page)
    // すばやく足すに字を打ったまま左の端から払う: 週 → 日。足さずに閉じる（作者「入力確定前の内容で払ったものは登録しない」）
    const input = page.getByTestId('quick-add-input')
    const plus = page.getByTestId('week-add-2026-11-12-work')
    await plus.tap()
    await input.fill('資料を送る')
    await edgeFlick(page, 'left')
    await showing(page, DAY)
    await expect(input).toHaveCount(0)
    expect(await countByTitle(page, '資料を送る')).toBe(0)
    await expect(page.locator('.toast', { hasText: '足しました' })).toHaveCount(0)
    // 右の端から: 日 → 週。同じ＋を開き直すと、打った字が出る（書きかけに残った）。開いたまま払っても、また足さずに閉じる
    await edgeFlick(page, 'right')
    await showing(page, WEEK)
    await plus.tap()
    await expect(input).toHaveValue('資料を送る')
    // 1周（CI の WebKit は重いので、右の端から1回・左の端から1回だけ）
    const rounds: ['left' | 'right', string][] =
      browserName === 'webkit'
        ? [
            ['right', MONTH],
            ['left', WEEK],
          ]
        : [
            ['right', MONTH],
            ['right', YEAR],
            ['right', DAY],
            ['right', WEEK],
            ['left', DAY],
            ['left', YEAR],
            ['left', MONTH],
            ['left', WEEK],
          ]
    for (const [side, path] of rounds) {
      await edgeFlick(page, side)
      await showing(page, path)
    }
    await expect(input).toHaveCount(0)
    expect(await countByTitle(page, '資料を送る')).toBe(0)
    expect(await turnsOf(page)).toEqual([])
    await noGrowth(page, length)
    // 閉じるかは聞かない（iPhone には OS の戻るボタンが無い）
    await expect(page.getByRole('dialog', { name: 'Diary Studio を閉じますか？' })).toHaveCount(0)
  })

  test('詳細・登録の画面・設定・MIM: 開いてもブラウザの履歴は増えない。左右どちらの端から払っても閉じ（登録の画面は書きかけでも聞かずに捨てる。■27）、閉じた後のカレンダーで払うとモードを回す（閉じた画面を開き直さない）。設定・MIM はカレンダーの方へ1つ戻り、開く前のページのスクロールの位置へ戻る', async ({
    page,
    browserName,
  }) => {
    test.slow(browserName === 'webkit', 'CI の WebKit はソフトウェアの描画で重い')
    await spyHistory(page)
    await openCalendar(page, DAY, { data: demoData() })
    const length = await historyLength(page)
    const sheet = page.getByTestId('item-sheet')
    // 詳細の画面: 開いても増えない。左の端から閉じる
    await openDetail(page)
    expect(await historyLength(page)).toBe(length)
    expect(await historyShape(page)).toMatchObject({ kind: 'single', depth: 2, index: 1 })
    await edgeFlick(page, 'left')
    await expect(sheet).toHaveCount(0)
    await showing(page, DAY)
    // 閉じた後のカレンダーで右の端から払う: モードを回し（日 → 週）、詳細の画面は開き直さない
    await edgeFlick(page, 'right')
    await showing(page, WEEK)
    await expect(sheet).toHaveCount(0)
    await edgeFlick(page, 'left')
    await showing(page, DAY)
    // 右の端からも閉じる
    await openDetail(page)
    await edgeFlick(page, 'right')
    await expect(sheet).toHaveCount(0)
    await showing(page, DAY)
    // 登録の画面（書きかけ）: 左右どちらでも、「書きかけを捨てますか？」を出さずに捨てて閉じる
    for (const side of ['right', 'left'] as const) {
      await page.getByTestId('cal-add').tap()
      await expect(sheet).toBeVisible()
      await page.getByTestId('item-title').fill('書きかけの予定')
      await historySettled(page)
      await edgeFlick(page, side)
      await expect(sheet).toHaveCount(0)
      await expect(page.getByTestId('item-discard')).toHaveCount(0)
      await showing(page, DAY)
    }
    expect(await countByTitle(page, '書きかけの予定')).toBe(0)
    // 設定・MIM: イヤー（ページがスクロールする）を下へ送ってから開く（ヘッダーは上に固定なので、押してもスクロールしない）
    await page.getByTestId('cal-mode-year').tap()
    await showing(page, YEAR)
    const scrollY = () => page.evaluate(() => Math.round(window.scrollY))
    for (const [open, side] of [
      ['open-settings', 'left'],
      ['open-mim', 'right'],
    ] as const) {
      // モードを替えた直後は、アプリが先頭へ戻すのが少し後に来ることがあるので、届くまで送り直す
      await expect
        .poll(async () => {
          await page.evaluate(() => window.scrollTo(0, 400))
          return scrollY()
        })
        .toBe(400)
      await page.getByTestId(open).tap()
      if (open === 'open-settings') await expect(page.getByTestId('app-settings')).toBeVisible()
      else {
        await at(page, '/mim')
        await expect(page.getByTestId('mim-placeholder')).toBeVisible()
      }
      await historySettled(page)
      await edgeFlick(page, side)
      await showing(page, YEAR)
      await historySettled(page)
      await expect.poll(scrollY).toBe(400)
    }
    await noGrowth(page, length)
  })
})

test.describe('iPhone の画面の端からのフリック（Chromium に iPhone の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPHONE_UA })

  test('詳細の画面で削除の確かめを出している時に払うと、確かめだけを閉じる（詳細の画面は開いたまま・消さない）。次に払うと詳細の画面を閉じる', async ({
    page,
  }) => {
    await spyHistory(page)
    await openCalendar(page, DAY, { data: demoData() })
    const length = await historyLength(page)
    await openDetail(page)
    await openItemMore(page)
    await page.getByTestId('item-delete').tap()
    await expect(deleteConfirm(page)).toBeVisible()
    await edgeFlick(page, 'left')
    await expect(deleteConfirm(page)).toHaveCount(0)
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await edgeFlick(page, 'right')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await showing(page, DAY)
    expect(await page.evaluate((i) => Boolean(window.__ds.getData().items[i]), DEMO_IDS.weekly)).toBe(true)
    await noGrowth(page, length)
  })

  test('画面の端から 20px より内側（30px）からの払いは、今までどおり前後の期間へ（モードはそのまま・ページをめくる）。端の指でモードと期間の両方は替わらない', async ({
    page,
  }) => {
    await spyHistory(page)
    await openCalendar(page, WEEK, { data: demoData() })
    const length = await historyLength(page)
    const vw = page.viewportSize()?.width ?? 412
    const box = await page.getByTestId('calendar-body').boundingBox()
    if (!box) throw new Error('カレンダーが見えていません')
    const y = Math.round(box.y + Math.min(box.height / 2, 200))
    await recordTurns(page)
    // 右の端の 30px 内側から左へ大きく払う: 次の週（モードはそのまま）
    await touchPath(page, thumbArc({ x: vw - 30, y }, { x: 30, y: y - 120 }, 12))
    await showing(page, '/week/2026-11-15')
    await turnDone(page)
    // iPhone の本物の指のように、12px 動いた所で pointer を取り消し、その後は touch の出来事だけの払い（左の 30px 内側から右へ）
    await iosCancelledTouch(page, thumbArc({ x: 30, y }, { x: 330, y: y - 200 }, 25))
    await showing(page, WEEK)
    await turnDone(page)
    expect(await turnsOf(page)).toEqual(['next', 'prev'])
    // 画面の端（3px）からの同じ払いは、モードだけを回す（期間はそのまま。ページはめくらない。Chromium の本物のタッチ: pointer の
    // 出来事も来るが、なぞりの所は端の指を数えない）
    await edgeFlick(page, 'left', { via: 'cdp' })
    await showing(page, DAY)
    expect(await turnsOf(page)).toEqual(['next', 'prev'])
    await noGrowth(page, length)
  })

  test('設定を開いたまま読み込み直しても、払うと読み込み直す前に見ていたカレンダー（同じ月）へ戻る（下の行き先は今の履歴に置いてある）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    const length = await historyLength(page)
    await page.getByTestId('cal-prev').tap()
    await showing(page, '/month/2026-10')
    await page.getByTestId('open-settings').tap()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await historySettled(page)
    await page.reload()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await historySettled(page)
    expect(await historyShape(page)).toMatchObject({ kind: 'single', depth: 2, index: 1 })
    await edgeFlick(page, 'left')
    await showing(page, '/month/2026-10')
    await historySettled(page)
    expect(await historyLength(page)).toBe(length)
  })

  test('前の版・ほかのページが残した履歴（アドレス欄で # を書き換えて読み込み直した）へブラウザの「戻る」「進む」で来ても、古い行き先は出さず、端からのフリックと同じく1回だけモードを回す', async ({
    page,
  }) => {
    await openCalendar(page, WEEK, { data: demoData() })
    // アドレス欄で # を書き換える: ブラウザが積む（アプリは、今の次に積まれた物として受け取る）
    await page.goto(page.url().replace(`#${WEEK}`, `#${DAY}`))
    await showing(page, DAY)
    await historySettled(page)
    await page.reload()
    await showing(page, DAY)
    await historySettled(page)
    const length = await historyLength(page)
    expect(await historyShape(page)).toMatchObject({ kind: 'single', inherited: true })
    // 「戻る」: 古い行き先（週）は出さず、左の端からのフリックと同じく 日 → 年
    await page.goBack()
    await showing(page, YEAR)
    await historySettled(page)
    // 「進む」: 右の端からと同じく 年 → 日
    await page.goForward()
    await showing(page, DAY)
    await historySettled(page)
    expect(await historyLength(page)).toBe(length)
    // その後の端からのフリックも1回ずつ（身振りの popstate の直後 0.4秒の間の払いは、同じ払いとして数えないので、それを過ぎてから）
    await page.waitForTimeout(450)
    await edgeFlick(page, 'right')
    await showing(page, WEEK)
  })
})

test.describe('iPad（横向き 1180×820・指。Chromium に iPad の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPAD_UA, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('L でも画面の端から払うとモードを回し、詳細の画面は閉じる。ブラウザの履歴は増えない', async ({ page }) => {
    await spyHistory(page)
    await openCalendar(page, WEEK, { data: demoData() })
    expect(await historyShape(page)).toMatchObject({ kind: 'single', source: 'edge-flick' })
    const length = await historyLength(page)
    // カレンダーでは Chromium の本物のタッチで
    for (const [side, path] of [
      ['left', DAY],
      ['right', WEEK],
      ['right', MONTH],
      ['left', WEEK],
      ['left', DAY],
    ] as const) {
      await edgeFlick(page, side, { via: 'cdp' })
      await showing(page, path)
    }
    await openDetail(page)
    await edgeFlick(page, 'left')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await showing(page, DAY)
    await noGrowth(page, length)
  })
})
