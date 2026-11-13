// iPhone の端からのフリックの間に見える絵（docs/SPEC.md の 3.1。22. の「端からのフリックの間に見える絵」。src/history/appHistory.ts・
// src/history/swipePicture.ts）の E2E。iPhone の WebKit は、身振りの間に行き先の履歴の絵（その履歴を最後に離れた時に描かれていた画面）を
// 出す。その絵はここでは見られない（Chromium にも CI の WebKit にも、身振りの絵は無い）ので、アプリが自分で履歴を積む・動かす時ごとに、
// その時の画面（小さな画面・確かめ・すばやく足すの入力欄が出ているか）と、ブラウザが身振りの絵を出しているとみなす間かを控え、
// 絵を写す時に画面がカレンダーだけであることを確かめる。端からのフリックは page.goBack・page.goForward（ブラウザの「戻る」「進む」と
// 同じ popstate）。iPhone は Chromium に iPhone の UA を付けた物。今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）
import { devices, expect, test, type Page } from '@playwright/test'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import { armHistory, collectDiagnosticsOnFailure, goBack, goForward, historySettled, historyShape, openCalendar } from './helpers'

collectDiagnosticsOnFailure()

const WEEK = '/week/2026-11-08'
const DAY = '/day/2026-11-10'
const YEAR = '/year/2026'
const MONTH = '/month/2026-11'

/** アプリが呼んだ履歴の1つ */
interface HistoryCall {
  op: 'pushState' | 'replaceState' | 'go' | 'back' | 'forward'
  delta?: number
  /** 積む・置き換える履歴の印（back・fwd。無ければ null） */
  mark?: string | null
  /** 積む履歴が小さな画面か */
  sheet?: boolean
  /** その時と、前に描いた時に画面に出ていた物（sheet・quick。無ければ空） */
  over: string
  /** その時、ブラウザが身振りの絵を出しているとみなす間だった（その間は WebKit は絵を写さない） */
  swipe: boolean
}

/** 開く前に、履歴を呼ぶたびにその時の画面を控える物を入れる */
async function recordHistoryCalls(page: Page) {
  await page.addInitScript(() => {
    const calls: unknown[] = []
    ;(window as unknown as { __historyCalls: unknown[] }).__historyCalls = calls
    const shown = (selector: string) =>
      [...document.querySelectorAll(selector)].some(
        (el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0,
      )
    const over = () =>
      [shown('.modal-backdrop, [role="dialog"]') && 'sheet', shown('.cp-quick') && 'quick'].filter(Boolean).join('+')
    // 描いた画面（WebKit が写すのは描き終えた画面）: 描く時ごとに、その時の画面を控える（今の DOM と、前に描いた時のどちらかに出て
    // いれば、出ていたとみなす）
    let drawn = ''
    const frame = () => {
      drawn = over()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    // 失敗した時の控え（e2e/helpers.ts）も history の物を包むので、その外側を包む
    const target = history as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const op of ['pushState', 'replaceState', 'go', 'back', 'forward']) {
      const original = target[op].bind(history)
      Object.defineProperty(history, op, {
        configurable: true,
        value: (...args: unknown[]) => {
          const shape = (
            window as unknown as { __ds?: { historyShape?: () => { swipePicture?: boolean } | null } }
          ).__ds?.historyShape?.()
          const data = args[0] as { ds?: { mark?: string }; usr?: { sheet?: unknown } } | null
          calls.push({
            op,
            delta: op === 'go' ? args[0] : undefined,
            mark: op.endsWith('State') ? (data?.ds?.mark ?? null) : undefined,
            sheet: op === 'pushState' ? Boolean(data?.usr?.sheet) : undefined,
            over: [...new Set([over(), drawn].filter(Boolean))].join('|'),
            swipe: Boolean(shape?.swipePicture),
          })
          return original(...args)
        },
      })
    }
  })
}

const callsOf = (page: Page) => page.evaluate(() => (window as unknown as { __historyCalls: HistoryCall[] }).__historyCalls)

/** 絵を写す呼び方（積む・動かす。置き換えは絵を写さない）のうち、身振りの絵を出しているとみなす間でない物 */
const recording = (calls: HistoryCall[]) => calls.filter((c) => c.op !== 'replaceState' && !c.swipe)

const historyLength = (page: Page) => page.evaluate(() => history.length)

/** 行き先のモードの画面が出ている */
async function showing(page: Page, path: string) {
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
  await expect(page.getByTestId(`view-${path.split('/')[1]}`)).toBeVisible()
}

test.describe('iPhone の端からのフリックの間に見える絵（Chromium に iPhone の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: devices['iPhone 14'].userAgent })

  test('作者の報告の流れ（詳細を開いて右の端から閉じ、払ってモードを回す・登録の画面を［×］で閉じてすばやく足すを開いて払う・すばやく足すを開いたまま詳細を開く・登録の画面で払う）で、アプリが履歴を積む・動かす時は、画面がカレンダーだけ。閉じた画面の履歴は切り捨て、履歴は増えない', async ({
    page,
  }) => {
    await recordHistoryCalls(page)
    await openCalendar(page, WEEK, { data: demoData() })
    const length = await historyLength(page)
    const sheet = page.getByTestId('item-sheet')

    // 報告3: ウィークリーで詳細を開き、右の端から閉じる。その後、右の端から払うたびにモードを回す
    await page.locator(`[data-testid="week-card-${DEMO_IDS.meeting}"]:not([data-dnd-placeholder])`).tap()
    await expect(sheet).toBeVisible()
    await historySettled(page)
    const closed = (await callsOf(page)).length
    await goForward(page)
    await expect(sheet).toHaveCount(0)
    await showing(page, WEEK)
    for (const next of [DAY, YEAR, MONTH, WEEK]) {
      await goForward(page)
      await showing(page, next)
    }
    // 閉じた詳細の画面の履歴（土台の後ろ）は、閉じてすぐ「進む」の印を積み直して切り捨てた（押した直後。押してから時間がたっていれば、
    // 落ち着いてから「進む」の印に替える）
    expect(
      (await callsOf(page)).slice(closed).some((c) => (c.op === 'pushState' || c.op === 'replaceState') && c.mark === 'fwd'),
    ).toBe(true)

    // 報告2: 登録の画面を［×］で閉じ、すばやく足すを開いたまま右の端から払う
    await page.getByTestId('cal-add').tap()
    await expect(sheet).toBeVisible()
    await historySettled(page)
    await page.getByTestId('modal-close').tap()
    await expect(sheet).toHaveCount(0)
    await historySettled(page)
    await page.getByTestId('week-add-2026-11-12-work').tap()
    await expect(page.getByTestId('quick-add-input')).toBeFocused()
    await historySettled(page)
    await goForward(page)
    await showing(page, DAY)
    await expect(page.getByTestId('quick-add-input')).toHaveCount(0)
    // すばやく足すを開いたまま予定を押して詳細を開く（入力欄が消えた画面を描いてから積む）
    await page.getByTestId('day-add-work').tap()
    await expect(page.getByTestId('quick-add-input')).toBeFocused()
    await page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open').tap()
    await expect(sheet).toBeVisible()
    await historySettled(page)
    await page.getByTestId('modal-close').tap()
    await expect(sheet).toHaveCount(0)
    await historySettled(page)

    // 報告1・■27: 登録の画面で左の端から払うと、詳細の画面と同じく閉じる
    await page.getByTestId('cal-add').tap()
    await expect(sheet).toBeVisible()
    await historySettled(page)
    await goBack(page)
    await expect(sheet).toHaveCount(0)
    await historySettled(page)

    const calls = await callsOf(page)
    // 履歴を積む・動かした時（身振りの絵を出しているとみなす間を除く）は、どれもカレンダーだけの画面
    expect(recording(calls).filter((c) => c.over !== '')).toEqual([])
    // 小さな画面を開いた時（4回）・閉じた時・閉じた後に「進む」の印の絵を写した時の、どれも
    expect(recording(calls).filter((c) => c.op === 'pushState' && c.sheet).length).toBe(4)
    expect(recording(calls).filter((c) => c.op === 'go').length).toBeGreaterThan(4)
    // 履歴は増えない（払って閉じた登録の画面の履歴は、切り捨てて「進む」の印を積み直した）
    expect(await historyLength(page)).toBe(length)
  })

  test('詳細を右の端から閉じた後は、1度だけ「進む」の印へ行って戻る（その印の絵を今のカレンダーにする）。すぐすばやく足すを開いた時は、行くのは閉じてから押し終えた時。どれも画面はカレンダーだけ', async ({
    page,
  }) => {
    await recordHistoryCalls(page)
    await openCalendar(page, WEEK, { data: demoData() })
    const sheet = page.getByTestId('item-sheet')
    const input = page.getByTestId('quick-add-input')
    const card = page.locator(`[data-testid="week-card-${DEMO_IDS.meeting}"]:not([data-dnd-placeholder])`)
    const gos = (calls: HistoryCall[]) => recording(calls).filter((c) => c.op === 'go')
    // そのまま待つ
    await card.tap()
    await expect(sheet).toBeVisible()
    await historySettled(page)
    let before = (await callsOf(page)).length
    await goForward(page)
    await expect(sheet).toHaveCount(0)
    await historySettled(page)
    let after = (await callsOf(page)).slice(before)
    expect(gos(after).map((c) => c.delta)).toEqual([1, -1])
    expect(recording(after).filter((c) => c.over !== '')).toEqual([])
    expect((await historyShape(page))?.forwardDirty).toBe(false)
    // 閉じてすぐ（動きの後を待たずに）すばやく足すを開き、Esc で閉じてから押す
    await card.tap()
    await expect(sheet).toBeVisible()
    await historySettled(page)
    before = (await callsOf(page)).length
    await page.goForward()
    await page.getByTestId('week-add-2026-11-12-work').tap()
    await expect(input).toBeFocused()
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await page.waitForTimeout(300)
    await armHistory(page, { finger: true })
    await expect.poll(async () => (await historyShape(page))?.forwardDirty).toBe(false)
    await historySettled(page)
    after = (await callsOf(page)).slice(before)
    expect(gos(after).map((c) => c.delta)).toEqual([1, -1])
    expect(recording(after).filter((c) => c.over !== '')).toEqual([])
  })

  test('すばやく足すに字を打ったまま払うと、モードのボタンを押した時と同じく、足してから閉じてモードを回す（「『件名』を足しました［元に戻す］」）', async ({
    page,
  }) => {
    await openCalendar(page, WEEK, { data: demoData() })
    await page.getByTestId('week-add-2026-11-12-work').tap()
    const input = page.getByTestId('quick-add-input')
    await input.fill('資料の確認')
    await historySettled(page)
    await goForward(page)
    await showing(page, DAY)
    await expect(input).toHaveCount(0)
    await expect(page.locator('.toast', { hasText: '『資料の確認』を足しました' })).toBeVisible()
    const added = await page.evaluate(() =>
      Object.values(window.__ds.getData().items).filter((i) => i.title === '資料の確認' && i.start === '2026-11-12'),
    )
    expect(added).toHaveLength(1)
    // 空の時は足さずに閉じる（左の端から: 日→週）
    await page.getByTestId('day-add-work').tap()
    await expect(input).toBeFocused()
    await historySettled(page)
    await goBack(page)
    await showing(page, WEEK)
    await expect(input).toHaveCount(0)
  })

  test('イヤーから月へ回した時は、見えない描く物を置いて（イヤーの絵の描く物の半分を超えさせ、WebKit に身振りの絵をすぐ外させる）、少し後に外す。月から週へも置く（「進む」の印の絵は作った時のイヤーのまま）', async ({
    page,
  }) => {
    await openCalendar(page, YEAR)
    await page.evaluate(() => {
      const w = window as unknown as { __ballast: number[] }
      w.__ballast = []
      new MutationObserver(() => w.__ballast.push(document.getElementById('ds-ballast')?.childElementCount ?? 0)).observe(
        document.body,
        { childList: true },
      )
    })
    const ballast = () => page.evaluate(() => (window as unknown as { __ballast: number[] }).__ballast)
    const weight = () =>
      page.evaluate(() => {
        let n = document.body.getElementsByTagName('*').length
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) if (walker.currentNode.nodeValue?.trim()) n++
        const box = document.getElementById('ds-ballast')
        return box ? n - box.childElementCount - 1 : n
      })
    const year = await weight()
    await goForward(page)
    await showing(page, MONTH)
    const month = await weight()
    expect(year / month).toBeGreaterThan(2)
    const placed = await ballast()
    expect(Math.max(...placed)).toBeGreaterThan(year / 2 - month)
    expect(placed.at(-1)).toBe(0)
    await expect(page.locator('#ds-ballast')).toHaveCount(0)
    await goForward(page)
    await showing(page, WEEK)
    const week = await weight()
    const more = (await ballast()).slice(placed.length)
    expect(Math.max(...more)).toBeGreaterThan(year / 2 - week)
    expect(more.at(-1)).toBe(0)
    await expect(page.locator('#ds-ballast')).toHaveCount(0)
  })
})
