// 履歴と「戻る」「進む」の E2E（docs/SPEC.md の 3.1・3.8。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・■22・■23・■25。
// src/history/appHistory.ts）。iPhone の画面の端からのフリックは、ブラウザの「戻る」「進む」の身振りそのもの（ページには popstate だけが
// 来る）なので、page.goBack・page.goForward で同じ所を通す。iPhone は Chromium に iPhone の UA を付けた物（@s）と、CI の WebKit（@ios）。
// Android は Pixel 7（mobile。UA が Android）、PC は Desktop Chrome。ホーム画面から開いた Android のアプリは、Pixel 7 の表示の形を
// standalone にして（openAlone の standalone）まねる。今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）。
// Playwright の page.evaluate・locator は、それだけでブラウザに「押した」と数えさせる（Chromium では 5秒。navigator.userActivation）ので、
// ここの多くのテストでは、印の履歴を作る時の「押した直後か」はいつも真になる。押した物の分だけで作ることは、5秒あまり何もせずに待って
// から指で押す1つ（Android の「開いて最初に指で軽く押した…」）と、単体テスト（src/history/appHistory.test.ts）で確かめる
import { devices, expect, test, type Page } from '@playwright/test'
import { DEMO_IDS, DEMO_WEEKS, demoData } from './fixtures/demoData'
import {
  armHistory,
  centerOf,
  collectDiagnosticsOnFailure,
  pressEvents,
  E2E_NOW,
  seedData,
  goBack,
  goForward,
  historySettled,
  historyShape,
  openCalendar,
  openItemMore,
  recordTurns,
  startLongPress,
  startMouseDrag,
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

/** 「『定例ミーティング』を削除しますか？」 */
const deleteConfirm = (page: Page) => page.getByRole('dialog', { name: '『定例ミーティング』を削除しますか？' })

/** 詳細の画面で削除の確かめを出す（「…」→［削除］） */
async function askDelete(page: Page, finger: boolean) {
  await openItemMore(page)
  if (finger) await page.getByTestId('item-delete').tap()
  else await page.getByTestId('item-delete').click()
  await expect(deleteConfirm(page)).toBeVisible()
}

/** 予定がまだある（消していない） */
const itemExists = (page: Page, id: string) => page.evaluate((i) => Boolean(window.__ds.getData().items[i]), id)

/**
 * 掴んだ物を離して、浮いたカードが元の所へ戻る動き（dnd-kit がその間 data-dnd-dropping を付ける。掴んだ印 data-dnd-dragging もまだ残る）が
 * 始まった時に「戻る」（ブラウザの戻ると同じ popstate）。離す前に呼び、離した後に返す関数を待つ（「戻る」の時に掴んだ印が残っていた数。
 * 時間で待たないので、重い時にも動きの間に「戻る」が来る）
 */
async function backWhenSettling(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __backOnSettle?: Promise<number> }
    w.__backOnSettle = new Promise<number>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-dnd-dropping]')) return
        observer.disconnect()
        const marked = document.querySelectorAll('[data-dnd-dragging]').length
        history.back()
        resolve(marked)
      })
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-dnd-dropping'] })
    })
  })
  return async () => {
    const marked = await page.evaluate(() => (window as unknown as { __backOnSettle: Promise<number> }).__backOnSettle)
    await historySettled(page)
    return marked
  }
}

interface OpenAloneOptions {
  /** Navigation API の無いブラウザにする（読み込み直した後に、タブの履歴がどれもアプリの物か分からない） */
  noNavigationApi?: boolean
  /**
   * ホーム画面から開いたアプリにする（表示の形を standalone にする。Playwright・CDP の media の決め方では決められないので、
   * matchMedia の「(display-mode: standalone)」に当たると答える）。最初の押し方は指
   */
  standalone?: boolean
  /** アプリの前に、ほかのページ（data:）を1つ置く（もう一度の「戻る」でアプリを離れることを見る。本物のホーム画面のアプリには無い） */
  before?: boolean
  /** 開く行き先（既定はマンスリー）と、開いた後に置くデータ */
  path?: string
  data?: Parameters<typeof seedData>[1]
}

/**
 * ホーム画面から開いた時と同じく、タブの履歴をアプリの分だけにして開き（前に履歴が無い。before の時は data: のページの後ろ）、押して
 * 印を作る
 */
async function openAlone(
  page: Page,
  baseURL: string | undefined,
  { noNavigationApi = false, standalone = false, before = false, path = MONTH, data }: OpenAloneOptions = {},
) {
  // data: のページでは localStorage を使えないので、置く物（addInitScript）より先に開く
  if (before) await page.goto('data:text/html,<title>before</title><p>before</p>')
  await page.clock.setFixedTime(new Date(E2E_NOW))
  await page.addInitScript(() => {
    if (location.protocol !== 'data:') localStorage.setItem('diary-studio:test-auth', '1')
  })
  if (noNavigationApi) await page.addInitScript(() => Object.defineProperty(window, 'navigation', { value: undefined }))
  if (standalone) {
    await page.addInitScript(() => {
      const match = window.matchMedia.bind(window)
      window.matchMedia = (query: string) => match(query.replace(/\(\s*display-mode\s*:\s*standalone\s*\)/g, 'all'))
    })
  }
  const url = new URL(`/#${path}`, baseURL).href
  if (before) await page.goto(url)
  else await page.evaluate((u) => location.replace(u), url)
  await page.waitForFunction(() => Boolean(window.__ds))
  await expect(page.getByTestId('top-page')).toBeVisible()
  if (data) await seedData(page, data)
  const length = await historyLength(page)
  await armHistory(page, { finger: standalone })
  expect(await historyLength(page)).toBe(before ? length + 2 : 3)
}

/** 押さずに読み込み直す（土台のまま） */
async function reloadOnBase(page: Page) {
  await page.reload()
  await expect(page.getByTestId('view-month')).toBeVisible()
  await historySettled(page)
}

/** 「もう一度［戻る］を押すと閉じます」（ホーム画面の Android の1回目の「戻る」・前が無くて閉じられなかった Android）・PC の「閉じられませんでした」のお知らせ */
const armedToast = (page: Page) => page.locator('.toast', { hasText: 'もう一度［戻る］を押すと閉じます' })
const cannotCloseToast = (page: Page) => page.locator('.toast', { hasText: 'この画面からは閉じられませんでした' })

/**
 * アプリの前にほかのページ（タブの初めの about:blank）が1つだけある所で、アドレス欄で # を書き換え（新しいカレンダーの履歴が最後の
 * 履歴になる）、押さずに読み込み直してから、「戻る」→［閉じる］。前のページへ戻る（読み込み直した後は、カレンダーの後ろの数が
 * 分からないので、前が無いと決めない）
 */
async function reloadThenClose(page: Page) {
  await openCalendar(page, MONTH)
  expect(await historyLength(page)).toBe(4)
  await page.goto(page.url().replace(`#${MONTH}`, '#/month/2026-12'))
  await at(page, '/month/2026-12')
  await historySettled(page)
  await page.reload()
  await showing(page, '/month/2026-12')
  await historySettled(page)
  await goBack(page)
  await expect(closeDialog(page)).toBeVisible()
  expect(await historyLength(page)).toBe(4)
  await page.getByTestId('app-close').click()
  await expect.poll(() => page.url()).toBe('about:blank')
}

/** ウィークリーの打ち合わせ（11/10）のカード */
const meetingCard = (page: Page) => page.locator(`[data-testid="week-card-${DEMO_IDS.meeting}"]:not([data-dnd-placeholder])`)

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

  test('開いて最初に指で軽く押した（離した）後の、左の端からのフリックはモードを回す（印の履歴は指を離した時に作る）', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { arm: false })
    const length = await historyLength(page)
    expect(await historyShape(page)).toMatchObject({ base: null, buildPending: true })
    await armHistory(page, { finger: true })
    expect(await historyLength(page)).toBe(length + 2)
    await goBack(page)
    await showing(page, WEEK)
    await goForward(page)
    await showing(page, DAY)
    expect(await historyLength(page)).toBe(length + 2)
  })

  test('端の身振りで離す出来事が来なかった指が残っても、次に指で押せば、詳細の画面は［×］ですぐ閉じ、右の端からのフリックでも閉じる（残った指は捨てる）', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { data: demoData() })
    // 端末が身振りに取った指（docs/SPEC.md の 3.7）: 下ろした出来事だけが来て、離した出来事は来ない
    await page.evaluate(() => {
      const at = { clientX: 2, clientY: 400 }
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { ...at, pointerId: 77, pointerType: 'touch', isPrimary: true, bubbles: true }),
      )
      const finger = new Touch({ ...at, identifier: 77, target: document.body })
      document.body.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [finger], changedTouches: [finger] }))
    })
    expect((await historyShape(page))?.held).toBe(true)
    await goBack(page)
    await showing(page, WEEK)
    await goForward(page)
    await showing(page, DAY)
    const sheet = page.getByTestId('item-sheet')
    await openDetail(page, true)
    expect((await historyShape(page))?.held).toBe(false)
    await page.getByTestId('modal-close').tap()
    await expect(sheet).toHaveCount(0, { timeout: 2000 })
    await historySettled(page)
    await openDetail(page, true)
    await goForward(page)
    await expect(sheet).toHaveCount(0)
    await showing(page, DAY)
  })

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

  test('詳細の画面で削除の確かめを出している時に払うと、確かめだけを閉じる（詳細の画面は開いたまま・消さない）。次に払うと詳細の画面を閉じる', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { data: demoData() })
    await openDetail(page, true)
    await askDelete(page, true)
    await goBack(page)
    await expect(deleteConfirm(page)).toHaveCount(0)
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    expect(await itemExists(page, DEMO_IDS.weekly)).toBe(true)
    await askDelete(page, true)
    await goForward(page)
    await expect(deleteConfirm(page)).toHaveCount(0)
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await goBack(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await showing(page, DAY)
    expect(await itemExists(page, DEMO_IDS.weekly)).toBe(true)
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
  test('開いて最初に指で軽く押した（離した）後の「戻る」は、閉じるかを聞く（印の履歴は、指を離した時に、ブラウザがその指で「押した」と数えている間に作る）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { arm: false })
    expect(await historyShape(page)).toMatchObject({ base: null, buildPending: true })
    // テストの page.evaluate が付けた「押した」が切れてから押す（ファイルの初めの説明）
    await armHistory(page, { finger: true, idleMs: 5300 })
    // 指を下ろした時はまだ「押した」でなく（! が無い）、離した時に「押した」になって（!）、その後に印の履歴を作った
    const events = await pressEvents(page)
    expect(events.find((e) => / down/.test(e))).toMatch(/ down\d+t\(\d+,\d+\)h\d+\/0$/)
    expect(events.find((e) => / up/.test(e))).toMatch(/!$/)
    expect(events.findIndex((e) => / push/.test(e))).toBeGreaterThan(events.findIndex((e) => / up/.test(e)))
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    await showing(page, MONTH)
  })

  test('開いて最初に押し終えた時に印の履歴を作っても、ページのスクロールの位置を戻さない（押し終えた時に続いているスクロールを、印を積んだ時の位置へ戻さない）', async ({
    page,
  }) => {
    await openCalendar(page, YEAR, { arm: false })
    // 押し終えた時に、まだスクロールが続いている（払った指の惰性）のを、離した後に 40px 動かして作る（印を積んだ後・土台へ戻る前）
    await page.evaluate(() => {
      window.scrollTo(0, 200)
      window.addEventListener('touchend', () => window.scrollBy(0, 40), { once: true })
    })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200)
    await armHistory(page, { finger: true })
    expect(await historyShape(page)).toMatchObject({ base: 1, cur: 1 })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(240)
    // 印を作った後も、設定から「戻る」で戻った時は、ブラウザが離れた時の位置へ戻す（土台は auto に戻してある）。Chromium は位置を
    // スクロールした時に今の履歴へ控えるので、土台に着いてからもう一度スクロールする（ふつうは惰性が続いている）
    await page.evaluate(() => window.scrollTo(0, 260))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(260)
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await historySettled(page)
    await goBack(page)
    await showing(page, YEAR)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(260)
  })

  test('カレンダーで「戻る」を押すと「Diary Studio を閉じますか？」。［キャンセル］で残り、もう一度押すとまた聞く。モードを替えても前のモードへは戻らない', async ({
    page,
  }) => {
    await openCalendar(page, MONTH)
    // ブラウザのタブ（表示の形が standalone でない）の Android は、今までどおり聞く（■22・■25）
    expect(await historyShape(page)).toMatchObject({ source: 'os-back', exit: 'ask' })
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

  test('アドレス欄で # を書き換えて押さずに読み込み直した後でも、［閉じる］でアプリの前のページへ戻る', async ({ page }) => {
    await reloadThenClose(page)
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

  test('詳細の画面で削除の確かめを出している時の「戻る」は、確かめだけを閉じる（詳細の画面は開いたまま）。次の「戻る」で詳細の画面を閉じる', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { data: demoData() })
    await openDetail(page, true)
    await askDelete(page, true)
    await goBack(page)
    await expect(deleteConfirm(page)).toHaveCount(0)
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await expect(closeDialog(page)).toHaveCount(0)
    await goBack(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    expect(await itemExists(page, DEMO_IDS.weekly)).toBe(true)
  })

  test('ブラウザのタブでも前に履歴が無い時（ほかのアプリから開いたタブなど）は、［閉じる］の後すぐ「もう一度［戻る］を押すと閉じます」（待たない）', async ({
    page,
    baseURL,
  }) => {
    await openAlone(page, baseURL)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await expect(page.getByTestId('app-close-cancel')).toBeFocused()
    await page.getByTestId('app-close').click()
    await expect(armedToast(page)).toBeVisible({ timeout: 800 })
    await historySettled(page)
    expect(await historyShape(page)).toMatchObject({ cur: 0, exitArmed: true })
  })

  test('前に履歴が無いタブを読み込み直した後も、タブの履歴がどれもアプリの物と分かるので、［閉じる］の後すぐ「もう一度［戻る］を押すと閉じます」', async ({
    page,
    baseURL,
  }) => {
    await openAlone(page, baseURL)
    await reloadOnBase(page)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close').click()
    await expect(armedToast(page)).toBeVisible({ timeout: 800 })
    await historySettled(page)
    expect(await historyShape(page)).toMatchObject({ cur: 0, exitArmed: true })
  })

  for (const during of ['前へ戻って待つ間', 'window.close() の後に待つ間'] as const) {
    test(`読み込み直した後で前が分からず、${during}にもう一度「戻る」を押しても、「もう一度［戻る］を押すと閉じます」にする（PC のお知らせ・閉じるかの確かめを出さない）`, async ({
      page,
      baseURL,
    }) => {
      await openAlone(page, baseURL, { noNavigationApi: true })
      await reloadOnBase(page)
      await goBack(page)
      await expect(closeDialog(page)).toBeVisible()
      // ［閉じる］が前へ戻る（何も起きない）・window.close() を試す所で、少し後に「戻る」
      await page.evaluate((closing) => {
        if (closing) {
          const close = window.close.bind(window)
          window.close = () => {
            close()
            setTimeout(() => history.back(), 100)
          }
          return
        }
        const go = history.go.bind(history)
        history.go = (delta?: number) => {
          go(delta)
          if ((delta ?? 0) < -1) setTimeout(() => history.back(), 200)
        }
      }, during !== '前へ戻って待つ間')
      await page.getByTestId('app-close').click()
      await expect(armedToast(page)).toBeVisible()
      await historySettled(page)
      expect(await historyShape(page)).toMatchObject({ cur: 0, exitArmed: true })
      await expect(cannotCloseToast(page)).toHaveCount(0)
      await expect(closeDialog(page)).toHaveCount(0)
    })
  }

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

  test('長押しで掴んでいる間の「戻る」は何もしない。動かさずに離した直後（元の所へ戻る動きの間）の「戻る」は閉じるかを聞く', async ({
    page,
  }) => {
    await openCalendar(page, WEEK, { data: demoData() })
    await meetingCard(page).scrollIntoViewIfNeeded()
    const start = await centerOf(meetingCard(page))
    const drag = await startLongPress(page, start)
    await expect(page.locator('[data-dnd-dragging]')).toHaveCount(1)
    await drag.moveTo({ x: start.x + 4, y: start.y + 60 })
    await goBack(page)
    await page.waitForTimeout(200)
    await expect(closeDialog(page)).toHaveCount(0)
    await drag.moveTo(start)
    const settled = await backWhenSettling(page)
    await drag.drop()
    expect(await settled()).toBeGreaterThan(0)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    expect(await page.evaluate((i) => window.__ds.getData().items[i]?.start, DEMO_IDS.meeting)).toBe('2026-11-10')
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

test.describe('ホーム画面から開いた Android のアプリ（Pixel 7 の表示の形を standalone に。■25）', { tag: ['@s'] }, () => {
  /** 「戻る」の後、聞かずに「もう一度［戻る］を押すと閉じます」が出て、最初の履歴へ移った（もう一度［戻る］で閉じる所） */
  async function backArms(page: Page) {
    await goBack(page)
    await expect(armedToast(page)).toBeVisible()
    await expect(closeDialog(page)).toHaveCount(0)
    await expect.poll(async () => (await historyShape(page))?.exitArmed).toBe(true)
    expect(await historyShape(page)).toMatchObject({ cur: 0, exitArmed: true })
  }

  test('開いて最初に指で押した後の「戻る」は、聞かずに「もう一度［戻る］を押すと閉じます」を出し、出ている間のもう一度の「戻る」でアプリを離れる', async ({
    page,
    baseURL,
  }) => {
    await openAlone(page, baseURL, { standalone: true, before: true })
    expect(await historyShape(page)).toMatchObject({ source: 'os-back', exit: 'press-again' })
    await backArms(page)
    await page.goBack()
    await expect.poll(() => page.url()).toMatch(/^data:/)
  })

  test('出ている間に「戻る」を押さないと、お知らせが消えて元の所へ戻り、カレンダーはそのまま使え、次の「戻る」でまた出す。押した時も元の所へ戻る（履歴は増えない）', async ({
    page,
    baseURL,
  }) => {
    await openAlone(page, baseURL, { standalone: true })
    const length = await historyLength(page)
    await backArms(page)
    // 3秒で消える（その所も終わる）
    await expect(armedToast(page)).toHaveCount(0, { timeout: 5000 })
    await historySettled(page)
    expect(await historyShape(page)).toMatchObject({ cur: 1, base: 1, shownIdx: 1, exitArmed: false })
    await page.getByTestId('cal-next').tap()
    await showing(page, '/month/2026-12')
    await historySettled(page)
    await backArms(page)
    // 出ている間に押した: お知らせを消して元の所へ戻ってから、押した物が動く
    await page.getByTestId('cal-prev').tap()
    await expect(armedToast(page)).toHaveCount(0)
    await showing(page, MONTH)
    await historySettled(page)
    expect(await historyShape(page)).toMatchObject({ cur: 1, base: 1, shownIdx: 1, exitArmed: false })
    await backArms(page)
    expect(await historyLength(page)).toBe(length)
    await expect(closeDialog(page)).toHaveCount(0)
  })

  test('出ている間に予定を長押しで掴むと、掴む前に元の所へ戻り（お知らせも消える）、掴んでいる間の「戻る」は何もしない（アプリを離れない）', async ({
    page,
    baseURL,
  }) => {
    await openAlone(page, baseURL, { standalone: true, before: true, path: WEEK, data: demoData() })
    await meetingCard(page).scrollIntoViewIfNeeded()
    await historySettled(page)
    const start = await centerOf(meetingCard(page))
    await backArms(page)
    const drag = await startLongPress(page, start)
    await expect(page.locator('[data-dnd-dragging]')).toHaveCount(1)
    await expect(armedToast(page)).toHaveCount(0)
    expect(await historyShape(page)).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false })
    await drag.moveTo({ x: start.x + 4, y: start.y + 60 })
    await goBack(page)
    await page.waitForTimeout(300)
    expect(page.url()).not.toMatch(/^data:/)
    await expect(closeDialog(page)).toHaveCount(0)
    await expect(armedToast(page)).toHaveCount(0)
    await expect(page.locator('[data-dnd-dragging]')).toHaveCount(1)
    await drag.moveTo(start)
    await drag.drop()
    await historySettled(page)
    expect(await historyShape(page)).toMatchObject({ cur: 1, shownIdx: 1, exitArmed: false })
    expect(await page.evaluate((i) => window.__ds.getData().items[i]?.start, DEMO_IDS.meeting)).toBe('2026-11-10')
    await backArms(page)
  })

  test('詳細のシートが開いている時の「戻る」はシートを閉じるだけ（お知らせは出さない）。次の「戻る」で出す', async ({
    page,
    baseURL,
  }) => {
    await openAlone(page, baseURL, { standalone: true, path: DAY, data: demoData() })
    await openDetail(page, true)
    await goBack(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await page.waitForTimeout(300)
    await expect(armedToast(page)).toHaveCount(0)
    expect(await historyShape(page)).toMatchObject({ exitArmed: false })
    await showing(page, DAY)
    await backArms(page)
  })

  test('同期していない変更がある時だけ、お知らせの次の行に「同期していない変更（n件）は…次に開いた時に送ります。」を添える', async ({
    page,
    baseURL,
  }) => {
    const line = '同期していない変更（2件）は、この端末に保存してあり、次に開いた時に送ります。'
    await openAlone(page, baseURL, { standalone: true })
    await backArms(page)
    await expect(armedToast(page)).not.toContainText('同期していない変更')
    await expect(armedToast(page)).toHaveCount(0, { timeout: 5000 })
    await historySettled(page)
    await page.evaluate(() => window.__ds.fakeSyncPending(2))
    await backArms(page)
    await expect(armedToast(page)).toContainText(line)
    // 2行に分けて出す
    expect(
      await armedToast(page)
        .locator('p')
        .evaluate((p) => (p as HTMLElement).innerText),
    ).toBe(`もう一度［戻る］を押すと閉じます\n${line}`)
  })
})

test.describe('PC のブラウザの戻る・進む（■22）', { tag: ['@pc'] }, () => {
  test('カレンダーで「戻る」は閉じるかを聞き、「進む」は何もしない。詳細の画面は「戻る」で閉じ、「進む」で開き直さない', async ({
    page,
  }) => {
    await openCalendar(page, DAY, { data: demoData() })
    expect(await historyShape(page)).toMatchObject({ source: 'os-back', exit: 'ask' })
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

  test('［閉じる］でアプリの前のページへ戻る。アドレス欄で # を書き換えて押さずに読み込み直した後でも同じ', async ({ page }) => {
    await reloadThenClose(page)
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

  test('ドラッグの途中の「戻る」は何もしない（閉じるかを聞かず、離すとふつうに落とす）', async ({ page }) => {
    await openCalendar(page, `/week/${DEMO_WEEKS.main}`, { data: demoData() })
    const card = page.locator(`[data-testid="week-card-${DEMO_IDS.meeting}"]:not([data-dnd-placeholder])`)
    const box = await card.boundingBox()
    if (!box) throw new Error('カードが見えていません')
    const drag = await startMouseDrag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    const to = page.locator('[data-tier="work"] .wk-cell[data-date="2026-11-12"]')
    const target = await to.boundingBox()
    if (!target) throw new Error('日のマスが見えていません')
    await drag.moveTo({ x: target.x + target.width / 2, y: target.y + 20 })
    await expect(to.locator('xpath=ancestor-or-self::*[@data-drop][1]')).toHaveAttribute('data-drop', 'hover')
    await goBack(page)
    await page.waitForTimeout(200)
    await expect(closeDialog(page)).toHaveCount(0)
    await drag.drop()
    await expect.poll(() => page.evaluate((i) => window.__ds.getData().items[i]?.start, DEMO_IDS.meeting)).toBe('2026-11-12')
    await expect(closeDialog(page)).toHaveCount(0)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
  })

  test('動かさずに離した直後（浮いたカードが元の所へ戻る動きの間）の「戻る」は、もう掴んでいないので閉じるかを聞く', async ({
    page,
  }) => {
    await openCalendar(page, `/week/${DEMO_WEEKS.main}`, { data: demoData() })
    const start = await centerOf(meetingCard(page))
    const drag = await startMouseDrag(page, start)
    await drag.moveTo({ x: start.x + 4, y: start.y + 60 })
    await drag.moveTo(start)
    const settled = await backWhenSettling(page)
    await drag.drop()
    expect(await settled()).toBeGreaterThan(0)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    expect(await page.evaluate((i) => window.__ds.getData().items[i]?.start, DEMO_IDS.meeting)).toBe('2026-11-10')
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
