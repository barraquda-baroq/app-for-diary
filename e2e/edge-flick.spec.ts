// iPhone・iPad の画面の端からのフリックの E2E（docs/SPEC.md の 3.1・3.7・3.8・12.1・12.2。22. の ■31〜■33。
// src/history/singleEntryHistory.ts・src/history/edgeFlick.ts）。iPhone・iPad ではブラウザの履歴をいつも1つのままにする（積む・戻る・
// 進むは使わず、今の物の置き換えだけ）ので、iPhone の「戻る」「進む」の身振り（ページがめくれる動き）は始まらず、画面の端から払った
// 指はページに来る。アプリはそれを受け取り、動き無しで切り替える: カレンダーでは左の端から（指を左から右へ）年→月→週→日→年、右の
// 端から（右から左へ）日→週→月→年→日（2026-11-14 の作者の答え）。登録・詳細の画面は左右どちらでも閉じ（登録は書きかけでも聞かずに
// 捨てる。■27）、確かめのダイアログはそれだけを閉じ、設定・MIM はカレンダーの方へ1つ戻る（スクロールの位置も戻る）。
// 身振りそのものは Chromium にも CI の WebKit にも無いので、ここで確かめるのは、ブラウザの履歴が増えない（history.length が開いた時の
// まま。Chromium のタブは初めの about:blank の分がある）こと・アプリが積む・戻る・進む（pushState・go・back・forward）を一度も呼ばない
// こと（開く前に置く物で控える）と、端の指でアプリがすること。指は e2e/helpers.ts の edgeFlick（初めは画面の左右の端から 3px の所から
// 払う）。端の幅は初め 44px（前は 36px）で、設定の「開発」の「端の幅」で 20・28・36・44px から選ぶ（22. の「端からのフリックの3回目の
// 直した版（788e842）を試した答え」「端からのフリックの4回目の直した版（5e521a7）を試した答え」）。すばやく足すに字を打ったまま払うと、足さずに閉じて打った字も捨てる。フォーカスの無い入力欄の上から
// 払っても端からのフリック（フォーカスのある欄の上からは数えない）。@ios の印の物は CI の WebKit（本物の WebKit の履歴）でも流す。
// 今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）
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

/**
 * 描く時ごと（requestAnimationFrame）に、出ている画面（S = 設定・M = MIM・C = カレンダー）とページのスクロールの位置を控え始める
 * （stopFrames まで）。設定・MIM から払って戻る時、スクロールの位置を戻すのはカレンダーを描いてから（出ている設定の画面を送らない）
 */
async function recordFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames?: string[]; __framesOn?: boolean }
    const frames: string[] = []
    w.__frames = frames
    w.__framesOn = true
    const step = () => {
      if (!w.__framesOn) return
      const tag = document.querySelector('[data-testid="app-settings"]')
        ? 'S'
        : document.querySelector('[data-testid="mim-placeholder"]')
          ? 'M'
          : 'C'
      frames.push(`${tag}:${Math.round(window.scrollY)}`)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

/** 控えるのをやめて、控えた物を返す */
const stopFrames = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames?: string[]; __framesOn?: boolean }
    w.__framesOn = false
    return w.__frames ?? []
  })

/** 「『定例ミーティング』を削除しますか？」 */
const deleteConfirm = (page: Page) => page.getByRole('dialog', { name: '『定例ミーティング』を削除しますか？' })

// CI の WebKit（本物の WebKit の履歴）でも流す物。CI の WebKit は重く、開く数を増やすと不安定になるので、開く数を2つに抑える
test.describe('iPhone の画面の端からのフリック（Chromium に iPhone の UA と CI の WebKit）', { tag: ['@s', '@ios'] }, () => {
  test.use({ userAgent: IPHONE_UA })

  test('カレンダー: 左の端から 年→月→週→日→年、右の端から 日→週→月→年→日（見ている日を保ち、ページはめくらない）。すばやく足すに字を打ったまま払うと、足さずに閉じてモードを回し、打った字も捨てる（同じ＋を開き直すと空。Esc で閉じた時は残る。12.1）。ブラウザの履歴は増えず、積む・戻る・進むは呼ばない', async ({
    page,
    browserName,
  }) => {
    test.slow(browserName === 'webkit', 'CI の WebKit はソフトウェアの描画で重い')
    await spyHistory(page)
    await openCalendar(page, WEEK, { data: demoData() })
    expect(await historyShape(page)).toMatchObject({ kind: 'single', source: 'edge-flick', depth: 1, index: 0 })
    const length = await historyLength(page)
    await recordTurns(page)
    // すばやく足すに字を打ったまま左の端から払う: 週 → 日。足さずに閉じ、打った字も捨てる（作者「入力確定前の内容で払ったものは
    // 登録しない」「文字残しは必要ないです」）
    const input = page.getByTestId('quick-add-input')
    const plus = page.getByTestId('week-add-2026-11-12-work')
    await plus.tap()
    await input.fill('資料を送る')
    await edgeFlick(page, 'left')
    await showing(page, DAY)
    await expect(input).toHaveCount(0)
    expect(await countByTitle(page, '資料を送る')).toBe(0)
    await expect(page.locator('.toast', { hasText: '足しました' })).toHaveCount(0)
    // 右の端から: 日 → 週。同じ＋を開き直すと空（打った字は捨てた）。Esc で閉じた時は今までどおり書きかけに残り、開き直すと出る
    await edgeFlick(page, 'right')
    await showing(page, WEEK)
    await plus.tap()
    await expect(input).toHaveValue('')
    await input.fill('書きかけ')
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)
    await plus.tap()
    await expect(input).toHaveValue('書きかけ')
    // 開いたまま払うと、また足さずに閉じて字を捨てる
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
    expect(await countByTitle(page, '書きかけ')).toBe(0)
    await plus.tap()
    await expect(input).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)
    expect(await turnsOf(page)).toEqual([])
    await noGrowth(page, length)
    // 閉じるかは聞かない（iPhone には OS の戻るボタンが無い）
    await expect(page.getByRole('dialog', { name: 'Diary Studio を閉じますか？' })).toHaveCount(0)
  })

  test('詳細・登録の画面・設定・MIM: 開いてもブラウザの履歴は増えない。左右どちらの端から払っても閉じ（登録の画面は書きかけでも聞かずに捨てる。■27。フォーカスの無い件名の欄の上から払っても閉じ、フォーカスのある欄の上からは閉じない）、閉じた後のカレンダーで払うとモードを回す（閉じた画面を開き直さない）。設定・MIM はカレンダーの方へ1つ戻り、開く前のページのスクロールの位置へ戻る', async ({
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
      const title = page.getByTestId('item-title')
      await title.fill('書きかけの予定')
      await historySettled(page)
      if (side === 'left') {
        // 件名の欄（画面の端から 16px ほどまで届く）の上、端から 24px の所から払う: フォーカスのある欄の上からは数えない（閉じない。
        // カーソル・字を選ぶつまみがある）。フォーカスを外すと、同じ所からの払いで閉じる（開発。端を甘くする）
        const box = await title.boundingBox()
        if (!box) throw new Error('件名の欄が見えていません')
        expect(box.x).toBeLessThan(24)
        const y = Math.round(box.y + box.height / 2)
        await expect(title).toBeFocused()
        await edgeFlick(page, side, { inset: 24, y })
        await expect(sheet).toBeVisible()
        await expect(title).toHaveValue('書きかけの予定')
        await title.evaluate((el) => (el as HTMLElement).blur())
        await expect(title).not.toBeFocused()
        await edgeFlick(page, side, { inset: 24, y })
      } else await edgeFlick(page, side)
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
      // 払う前の設定・MIM のスクロールの位置。戻ってカレンダーを描くまでの間、設定・MIM の画面はこのまま（送らない）
      const before = await scrollY()
      await recordFrames(page)
      await edgeFlick(page, side)
      await showing(page, YEAR)
      await historySettled(page)
      await expect.poll(scrollY).toBe(400)
      const frames = await stopFrames(page)
      const tag = open === 'open-settings' ? 'S' : 'M'
      expect(frames.filter((f) => !f.startsWith('C:') && f !== `${tag}:${before}`)).toEqual([])
      // カレンダーは初めの絵から、戻した位置（描いた直後・絵にする前に戻すので、先頭から跳ばない）
      expect(frames.find((f) => f.startsWith('C:'))).toBe('C:400')
      expect(frames.at(-1)).toBe('C:400')
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

  test('端の幅（初めは 44px）: 画面の端から 60px 内側からの払いは、今までどおり前後の期間へ（モードはそのまま・ページをめくる）。40px の所からはモードだけを回す。設定の「開発」の「端の幅」で 36（前の幅）を選ぶと、読み込み直した後も、40px の所からの払いは前後の期間へ。端の指でモードと期間の両方は替わらない', async ({
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
    // 右の端の 60px 内側から左へ大きく払う: 次の週（モードはそのまま）
    await touchPath(page, thumbArc({ x: vw - 60, y }, { x: 30, y: y - 120 }, 12))
    await showing(page, '/week/2026-11-15')
    await turnDone(page)
    // iPhone の本物の指のように、12px 動いた所で pointer を取り消し、その後は touch の出来事だけの払い（左の 60px 内側から右へ）
    await iosCancelledTouch(page, thumbArc({ x: 60, y }, { x: 360, y: y - 200 }, 25))
    await showing(page, WEEK)
    await turnDone(page)
    await expect.poll(() => turnsOf(page)).toEqual(['next', 'prev'])
    // 端から 40px（初めの端の幅 44px の中。前の 36px の外）からの同じ払いは、モードだけを回す（右の端から: 週 → 月、左の端から:
    // 月 → 週。期間はそのまま。ページはめくらない）
    await iosCancelledTouch(page, thumbArc({ x: vw - 40, y }, { x: vw - 340, y: y - 120 }, 25))
    await showing(page, MONTH)
    await page.waitForTimeout(320)
    await iosCancelledTouch(page, thumbArc({ x: 40, y }, { x: 340, y: y - 120 }, 25))
    await showing(page, WEEK)
    await page.waitForTimeout(320)
    expect(await turnsOf(page)).toEqual(['next', 'prev'])
    // 設定の「開発」の「端の幅」で 36（前の幅）を選ぶ（初めは 44 が選ばれている）。読み込み直しても 36 のまま
    await page.getByTestId('open-settings').tap()
    await expect(page.getByTestId('dev-settings')).toBeVisible()
    await expect(page.getByTestId('edge-zone-44')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('edge-zone-36').tap()
    await expect(page.getByTestId('edge-zone-36')).toHaveAttribute('aria-pressed', 'true')
    await historySettled(page)
    await page.reload()
    await expect(page.getByTestId('edge-zone-36')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('edge-zone-44')).toHaveAttribute('aria-pressed', 'false')
    await historySettled(page)
    // 左の端（3px）から払って、カレンダーへ戻る
    await edgeFlick(page, 'left')
    await showing(page, WEEK)
    await historySettled(page)
    await recordTurns(page)
    // 端から 40px（端の幅 36px の外）からの払いは、前後の期間へ（前の週。モードはそのまま）
    await iosCancelledTouch(page, thumbArc({ x: 40, y }, { x: 340, y: y - 200 }, 25))
    await showing(page, '/week/2026-11-01')
    await turnDone(page)
    await expect.poll(() => turnsOf(page)).toEqual(['prev'])
    // 画面の端（3px）からの払いは、モードだけを回す（左の端から: 週 → 日。Chromium の本物のタッチ: pointer の出来事も来るが、なぞりの
    // 所は端の指を数えない。本物のタッチの払いの後の Chromium の動きが残っている間は、次の指で押しても click にならないことがあるので
    // いちばん後に）
    await page.waitForTimeout(320)
    await edgeFlick(page, 'left', { via: 'cdp' })
    await showing(page, '/day/2026-11-03')
    expect(await turnsOf(page)).toEqual(['prev'])
    expect(await historyLength(page)).toBe(length)
    expect(await historyCalls(page)).toEqual([])
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
