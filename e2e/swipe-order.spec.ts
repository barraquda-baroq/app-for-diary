// iPhone の端からのフリックの後に、アプリが履歴を書く・動かす順番の E2E（docs/SPEC.md の 3.1 の「端からのフリックの間に見える絵」・
// ■27・12.1。22. の「端からのフリックの直した版（a228a81）を試した答え」。src/history/appHistory.ts）。
// iPhone の WebKit は、払いの後に最初に知らせた同じページの中の動きが積む（pushState）だと、身振りの絵を3秒外さない（その間はページを
// 押せない。左の端から詳細を閉じた後に固まった）。なのでアプリは、払いの popstate で最初に今の履歴を同じ物で置き換え、popstate の中と
// その後のマイクロタスクでは積まない。モードを回した後は、土台へ戻る1回のほかは履歴を動かさない（絵を写し直さない）。ここでは、
// popstate と、アプリが呼んだ history の物（積む・置き換える・動く）を順に控えて、その順番を確かめる。
// 身振りそのもの（絵・行き先）は Chromium にも CI の WebKit にも無いので、端からのフリックは page.goBack・page.goForward（同じ
// popstate）で、その popstate だけ hasUAVisualTransition を true にする（PopStateEvent.prototype を差し替える。ブラウザのままでは
// false で、アプリが自分で戻る・進む popstate も false のまま）。iPhone の describe は、Chromium に iPhone の UA（@s）と CI の WebKit
// （@ios）の両方で流すので、CDP などの Chromium だけの物は使わない（指は locator.tap だけ）。今は 2026年11月10日（火）9:00
// （e2e/helpers.ts の E2E_NOW）
import { devices, expect, test, type Page } from '@playwright/test'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, E2E_NOW, historySettled, historyShape, openCalendar, seedData } from './helpers'

collectDiagnosticsOnFailure()

const WEEK = '/week/2026-11-08'
const DAY = '/day/2026-11-10'
const MONTH = '/month/2026-11'
const YEAR = '/year/2026'

/** 控えた物の1つ: popstate か、アプリが呼んだ history の物 */
interface Entry {
  ev: 'pop' | 'pushState' | 'replaceState' | 'go' | 'back' | 'forward'
  /** pop: 払い（hasUAVisualTransition が true）の popstate か */
  ua?: boolean
  /** pop: 着いた履歴の state（JSON）。pushState・replaceState: 書く state（JSON） */
  state?: string
  /** pushState・replaceState: 書く URL（渡さない時は null。今のまま） */
  url?: string | null
  /** go の数 */
  delta?: number
  /** pushState・replaceState: 書く履歴の印（back・fwd。無ければ null） */
  mark?: string | null
  /** popstate を送っている途中に呼んだ（window.event が popstate） */
  inPop?: boolean
  /** popstate を送ってから次の処理（setTimeout 0）までの間に呼んだ（popstate の後のマイクロタスクも） */
  inPopTask?: boolean
  /** 呼んだ時に画面に出ていた物（sheet・quick・page（カレンダーでない画面）・toast・launch（起動アニメーション）。無ければ空） */
  over?: string
}

/** 開く前に、popstate とアプリが呼んだ history の物を順に控える物と、払いの popstate の印を入れる */
async function recordOrder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __order: unknown[]; __ua?: boolean }
    const log: unknown[] = []
    w.__order = log
    // 払いの popstate（テストが __ua を立ててから最初に来た物）だけ true
    const swipes = new WeakSet<Event>()
    Object.defineProperty(PopStateEvent.prototype, 'hasUAVisualTransition', {
      configurable: true,
      get(this: Event) {
        return swipes.has(this)
      },
    })
    const shown = (selector: string) =>
      [...document.querySelectorAll(selector)].some(
        (el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0,
      )
    const over = () =>
      [
        shown('.modal-backdrop, [role="dialog"]') && 'sheet',
        shown('.cp-quick') && 'quick',
        !shown('[data-testid^="view-"]') && 'page',
        shown('.toast') && 'toast',
        document.getElementById('ds-launch') !== null && 'launch',
      ]
        .filter(Boolean)
        .join('+')
    let popTask = 0
    // window の捕まえる段で、アプリの聞き手より先に聞く
    window.addEventListener(
      'popstate',
      (e) => {
        const ua = w.__ua === true
        if (ua) {
          swipes.add(e)
          w.__ua = false
        }
        popTask++
        // popstate の後の最初の処理で終わり（アプリが popstate の中で置く setTimeout 0 より先に置く）
        setTimeout(() => popTask--, 0)
        log.push({ ev: 'pop', ua, state: JSON.stringify(history.state) })
      },
      { capture: true },
    )
    // 失敗した時の控え（e2e/helpers.ts）も history の物を包むので、その外側を包む
    const target = history as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const op of ['pushState', 'replaceState', 'go', 'back', 'forward']) {
      const original = target[op].bind(history)
      Object.defineProperty(history, op, {
        configurable: true,
        value: (...args: unknown[]) => {
          const writes = op.endsWith('State')
          const data = args[0] as { ds?: { mark?: string } } | null
          log.push({
            ev: op,
            state: writes ? JSON.stringify(args[0]) : undefined,
            url: writes ? ((args[2] as string | undefined) ?? null) : undefined,
            delta: op === 'go' ? args[0] : undefined,
            mark: writes ? (data?.ds?.mark ?? null) : undefined,
            inPop: (window as unknown as { event?: Event }).event?.type === 'popstate',
            inPopTask: popTask > 0,
            over: over(),
          })
          return original(...args)
        },
      })
    }
  })
}

const orderOf = (page: Page) => page.evaluate(() => (window as unknown as { __order: Entry[] }).__order.slice())

/**
 * 端からのフリック（左の端から = back・右の端から = forward）: 次の popstate を払いの物にして「戻る」「進む」をし、アプリの履歴が
 * 落ち着くまで待つ（身振りの絵を出しているとみなす間・閉じた後に「進む」の印の絵を写す間も待つ）
 */
async function flick(page: Page, dir: 'back' | 'forward') {
  await page.evaluate(() => {
    ;(window as unknown as { __ua?: boolean }).__ua = true
  })
  if (dir === 'back') await page.goBack()
  else await page.goForward()
  // 払いの印は、その「戻る」「進む」の popstate が受け取る（来るまで待つ）
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ua?: boolean }).__ua)).toBe(false)
  await historySettled(page)
}

/** 払い（hasUAVisualTransition が true の popstate）ごとに、その後（次の払いまで）にアプリが呼んだ history の物 */
function bySwipe(log: Entry[]): { pop: Entry; ops: Entry[] }[] {
  const out: { pop: Entry; ops: Entry[] }[] = []
  for (const e of log) {
    if (e.ev === 'pop' && e.ua) out.push({ pop: e, ops: [] })
    else if (e.ev !== 'pop') out.at(-1)?.ops.push(e)
  }
  return out
}

/** 呼び方の短い形（replaceState・pushState:fwd・go-1 など。積む物だけ印を付ける） */
const brief = (e: Entry) => (e.ev === 'go' ? `go${e.delta}` : e.ev === 'pushState' && e.mark ? `${e.ev}:${e.mark}` : e.ev)

/**
 * どの払いの後も（E1・E2）: popstate の中とその後のマイクロタスクでは積まない。払いの popstate で最初に呼ぶのは、今の履歴を同じ物
 * （同じ state・URL を渡さない）で置き換える物
 */
function expectGuarded(log: Entry[], swipes: number) {
  expect(log.filter((e) => e.ev === 'pushState' && (e.inPop || e.inPopTask))).toEqual([])
  const all = bySwipe(log)
  expect(all).toHaveLength(swipes)
  for (const { pop, ops } of all) expect(ops[0]).toMatchObject({ ev: 'replaceState', state: pop.state, url: null, inPop: true })
}

/** モードを回す払いの後（E3）: 上の置き換え・土台へ戻る1回（左の端からは +1、右の端からは -1）・ルーターの置き換え（回した先）だけ */
function expectRingOnly(ops: Entry[], dir: 'back' | 'forward', path: string) {
  expect(ops.map(brief)).toEqual(['replaceState', dir === 'back' ? 'go1' : 'go-1', 'replaceState'])
  expect(ops[2].url).toContain(`#${path}`)
}

const historyLength = (page: Page) => page.evaluate(() => history.length)

const countByTitle = (page: Page, title: string) =>
  page.evaluate((t) => Object.values(window.__ds.getData().items).filter((i) => i.title === t).length, title)

/** 行き先が path になるまで待つ */
async function at(page: Page, path: string) {
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
}

/** 行き先のモードの画面が出ている */
async function showing(page: Page, path: string) {
  await at(page, path)
  await expect(page.getByTestId(`view-${path.split('/')[1]}`)).toBeVisible()
}

/** デイリーの「定例ミーティング」の詳細の画面を指で開く */
async function openDetail(page: Page) {
  await page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open').tap()
  await expect(page.getByTestId('item-sheet')).toBeVisible()
  await historySettled(page)
}

test.describe('iPhone の払いの後の履歴の順番（Chromium に iPhone の UA と CI の WebKit）', { tag: ['@s', '@ios'] }, () => {
  test.use({ userAgent: devices['iPhone 14'].userAgent })

  test('モードを回す払い: 払いの popstate で最初に今の履歴を同じ物で置き換え、その後は土台へ戻る1回とルーターの置き換えだけ（1秒待っても動かさない）。すばやく足すに字を打ったまま払うと足さずに閉じ、同じ＋を開き直すと字が出る。履歴は増えない', async ({
    page,
    browserName,
  }) => {
    test.slow(browserName === 'webkit', 'CI の WebKit はソフトウェアの描画で重い')
    await recordOrder(page)
    await openCalendar(page, WEEK, { data: demoData() })
    expect((await historyShape(page))?.source).toBe('edge-flick')
    const length = await historyLength(page)
    const input = page.getByTestId('quick-add-input')
    const plus = page.getByTestId('week-add-2026-11-12-work')

    // すばやく足すに字を打ったまま右の端から払う: 週 → 日。足さずに閉じる（12.1。作者「入力確定前の内容で払ったものは登録しない」）
    await plus.tap()
    await input.fill('資料を送る')
    await historySettled(page)
    let start = (await orderOf(page)).length
    await flick(page, 'forward')
    await showing(page, DAY)
    await expect(input).toHaveCount(0)
    // 1秒待っても、アプリは履歴を動かさない（絵を写し直さない）
    await page.waitForTimeout(1000)
    const first = bySwipe((await orderOf(page)).slice(start))
    expect(first).toHaveLength(1)
    expectRingOnly(first[0].ops, 'forward', DAY)
    expect(await countByTitle(page, '資料を送る')).toBe(0)
    await expect(page.locator('.toast', { hasText: '足しました' })).toHaveCount(0)

    // 左の端から払う: 日 → 週。同じ＋を開き直すと、打った字が出る（書きかけに残った）
    start = (await orderOf(page)).length
    await flick(page, 'back')
    await showing(page, WEEK)
    await plus.tap()
    await expect(input).toHaveValue('資料を送る')

    // 開いたまま左の端から1周（週 → 月 → 年 → 日 → 週）、右の端から1周（週 → 日 → 年 → 月 → 週）。CI の WebKit は重いので、
    // 左の端からの1周だけにし、1秒待つのも初めの1回だけ（どの払いの後も、払いの物のほかに呼んでいないのは下で確かめる）
    const light = browserName === 'webkit'
    const rounds: ['back' | 'forward', string][] = [
      ['back', MONTH],
      ['back', YEAR],
      ['back', DAY],
      ['back', WEEK],
      ...(light
        ? []
        : ([
            ['forward', DAY],
            ['forward', YEAR],
            ['forward', MONTH],
            ['forward', WEEK],
          ] as ['back' | 'forward', string][])),
    ]
    for (const [dir, path] of rounds) {
      await flick(page, dir)
      await showing(page, path)
    }
    await expect(input).toHaveCount(0)
    const done = (await orderOf(page)).length
    if (!light) await page.waitForTimeout(1000)
    const log = await orderOf(page)
    expect(log.length).toBe(done)
    const swipes = bySwipe(log.slice(start))
    expectRingOnly(swipes[0].ops, 'back', WEEK)
    rounds.forEach(([dir, path], i) => expectRingOnly(swipes[i + 1].ops, dir, path))
    expectGuarded(log, rounds.length + 2)
    expect(await countByTitle(page, '資料を送る')).toBe(0)
    expect(await historyLength(page)).toBe(length)
  })

  test('払って閉じる（詳細・登録・設定・MIM）: 払いの popstate で最初に今の履歴を同じ物で置き換え、popstate の中とその後のマイクロタスクでは積まない。登録の画面は書きかけがあっても聞かずに捨てて閉じる（■27）。履歴は増えない', async ({
    page,
    browserName,
  }) => {
    test.slow(browserName === 'webkit', 'CI の WebKit はソフトウェアの描画で重い')
    await recordOrder(page)
    await openCalendar(page, DAY, { data: demoData() })
    const length = await historyLength(page)
    const sheet = page.getByTestId('item-sheet')
    // 詳細の画面: 左の端から・右の端から
    for (const dir of ['back', 'forward'] as const) {
      await openDetail(page)
      await flick(page, dir)
      await expect(sheet).toHaveCount(0)
      await showing(page, DAY)
    }
    // 登録の画面（書きかけ）: 左の端から・右の端から。「書きかけを捨てますか？」を出さずに捨てる
    for (const dir of ['back', 'forward'] as const) {
      await page.getByTestId('cal-add').tap()
      await expect(sheet).toBeVisible()
      await page.getByTestId('item-title').fill('書きかけの予定')
      await historySettled(page)
      await flick(page, dir)
      await expect(sheet).toHaveCount(0)
      await expect(page.getByTestId('item-discard')).toHaveCount(0)
      await showing(page, DAY)
    }
    expect(await countByTitle(page, '書きかけの予定')).toBe(0)
    // 設定（右の端から）・MIM（左の端から）: カレンダーの方へ1つ戻る
    await page.getByTestId('open-settings').tap()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await historySettled(page)
    await flick(page, 'forward')
    await showing(page, DAY)
    await page.getByTestId('open-mim').tap()
    await at(page, '/mim')
    await historySettled(page)
    await flick(page, 'back')
    await showing(page, DAY)
    expectGuarded(await orderOf(page), 6)
    expect(await historyLength(page)).toBe(length)
  })
})

test.describe('iPhone の払って閉じた後（Chromium に iPhone の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: devices['iPhone 14'].userAgent })

  test('左の端から詳細を閉じた時は、押した直後なら、払いの popstate の後の処理で「進む」の印を積み直し（閉じた画面の履歴を切り捨てる）、身振りの絵が消えた頃に1度だけ、その印へ行って戻る（画面はカレンダーだけ）', async ({
    page,
  }) => {
    await recordOrder(page)
    await openCalendar(page, DAY, { data: demoData() })
    await openDetail(page)
    const start = (await orderOf(page)).length
    // Playwright の page.evaluate は、それだけでブラウザに「押した」と数えさせる（Chromium で 5秒）ので、押した直後に閉じた形
    await flick(page, 'back')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    const swipes = bySwipe((await orderOf(page)).slice(start))
    expect(swipes).toHaveLength(1)
    const { ops } = swipes[0]
    expect(ops.map(brief)).toEqual(['replaceState', 'pushState:fwd', 'go-1', 'go1', 'go-1'])
    // 積むのは popstate の後の処理（popstate の中・その後のマイクロタスクではない）
    expect(ops[1]).toMatchObject({ inPop: false, inPopTask: false })
    // 印の絵を写す（離れる時に WebKit が写す）時は、閉じた画面が消えている
    expect(ops.slice(3).map((o) => o.over)).toEqual(['', ''])
    expect((await historyShape(page))?.forwardDirty).toBe(false)
  })
})

test.describe('iPhone の開いて最初の押し方（Chromium に iPhone の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: devices['iPhone 14'].userAgent })

  /** 印の履歴を作った書き込み（今の履歴を「戻る」の印に替える・土台を積む・「進む」の印を積む） */
  function buildOps(log: Entry[]): Entry[] {
    const i = log.findIndex((e) => e.ev === 'replaceState' && e.mark === 'back')
    return i === -1 ? [] : log.slice(i, i + 3)
  }

  test('開いて最初の押し方で登録の画面を開いた時も、押し終えた時（開く前。画面はカレンダーだけ）に印の履歴を作る。書きかけのまま払うと聞かずに捨てて閉じる（■27）', async ({
    page,
  }) => {
    await recordOrder(page)
    await openCalendar(page, DAY, { data: demoData(), arm: false })
    expect((await historyShape(page))?.base).toBe(null)
    const sheet = page.getByTestId('item-sheet')
    await page.getByTestId('cal-add').tap()
    await expect(sheet).toBeVisible()
    await page.getByTestId('item-title').fill('書きかけの予定')
    await historySettled(page)
    const ops = buildOps(await orderOf(page))
    expect(ops.map(brief)).toEqual(['replaceState', 'pushState', 'pushState:fwd'])
    expect(ops.map((o) => o.over)).toEqual(['', '', ''])
    await flick(page, 'back')
    await expect(sheet).toHaveCount(0)
    await expect(page.getByTestId('item-discard')).toHaveCount(0)
    await showing(page, DAY)
    expect(await countByTitle(page, '書きかけの予定')).toBe(0)
  })

  test('開いて最初の押し方で詳細の画面・設定・MIM を開いた時、予定を完了にした時（お知らせが出る）も、印の履歴はその前（画面はカレンダーだけ）に作る。払って閉じた詳細の画面は、次の右の端からの払いで開き直さない', async ({
    page,
  }) => {
    await recordOrder(page)
    const firstTaps: [string, () => Promise<void>][] = [
      ['detail', () => page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open').tap()],
      ['settings', () => page.getByTestId('open-settings').tap()],
      ['mim', () => page.getByTestId('open-mim').tap()],
      ['done', () => page.getByTestId(`done-${DEMO_IDS.mail}`).first().tap()],
    ]
    for (const [name, tap] of firstTaps) {
      await openCalendar(page, DAY, { data: demoData(), arm: false })
      expect((await historyShape(page))?.base, name).toBe(null)
      await tap()
      if (name === 'detail') await expect(page.getByTestId('item-sheet')).toBeVisible()
      if (name === 'settings') await expect(page.getByTestId('app-settings')).toBeVisible()
      if (name === 'mim') await at(page, '/mim')
      if (name === 'done') await expect(page.locator('.toast').first()).toBeVisible()
      await historySettled(page)
      const ops = buildOps(await orderOf(page))
      expect(ops.map(brief), name).toEqual(['replaceState', 'pushState', 'pushState:fwd'])
      expect(
        ops.map((o) => o.over),
        name,
      ).toEqual(['', '', ''])
    }
    // 開いて最初の押し方で開いた詳細の画面を左の端から払って閉じ、右の端から払う: モードを回す（閉じた詳細の画面を開き直さない）
    await openCalendar(page, DAY, { data: demoData(), arm: false })
    await page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open').tap()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await historySettled(page)
    await flick(page, 'back')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await flick(page, 'forward')
    await showing(page, YEAR)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
  })

  test('起動アニメーションが消える途中（下のアプリを押せる）に予定を押して開いた詳細の画面も、消えてから、その下に印の履歴を作ってから積む。払って閉じた後の右の端からの払いは、閉じた画面を開き直さずモードを回す', async ({
    page,
  }) => {
    await recordOrder(page)
    await page.clock.setFixedTime(new Date(E2E_NOW))
    await page.addInitScript(() => {
      localStorage.setItem('diary-studio:test-auth', '1')
      // 消える動き（ふだんは 0.25秒）を長くして、その間に押せるようにする（src/launch/launch.js の TIMING）
      let api: { TIMING: { fadeMs: number } } | undefined
      Object.defineProperty(window, 'DiaryStudioLaunch', {
        configurable: true,
        get: () => api,
        set(v: { TIMING: { fadeMs: number } }) {
          v.TIMING.fadeMs = 600
          api = v
        },
      })
    })
    await page.goto(`/?launch=1#${DAY}`)
    await page.waitForFunction(() => Boolean(window.__ds))
    await seedData(page, demoData())
    const open = page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open')
    await expect(open).toHaveCount(1)
    // 消え始めた（下のアプリを押せる）所で押す
    await page.waitForFunction(() => document.querySelector('#ds-launch[data-launch-end]') !== null, undefined, {
      timeout: 15_000,
      polling: 5,
    })
    expect((await historyShape(page))?.base).toBe(null)
    const box = (await open.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    expect(await page.evaluate(() => document.getElementById('ds-launch')?.style.pointerEvents ?? 'gone')).toBe('none')
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await historySettled(page)
    const log = await orderOf(page)
    const i = log.findIndex((e) => e.ev === 'replaceState' && e.mark === 'back')
    expect(i).toBeGreaterThan(-1)
    const ops = log.slice(i, i + 5)
    expect(ops.map(brief)).toEqual(['replaceState', 'pushState', 'pushState', 'pushState:fwd', 'go-1'])
    // 印の絵を写す時（今の履歴を離れる時）は、起動アニメーションも詳細の画面も無い
    expect(ops.slice(0, 3).map((o) => o.over)).toEqual(['', '', ''])
    expect(await historyShape(page)).toMatchObject({ base: 1, cur: 2 })
    await flick(page, 'back')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await flick(page, 'forward')
    await showing(page, YEAR)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
  })
})

test.describe('Android の戻る（Pixel 7）', { tag: ['@s'] }, () => {
  test('書きかけの登録の画面の「戻る」は、今までどおり「書きかけを捨てますか？」と聞く（■27 は iPhone の端からのフリックだけ）。払いの置き換えはしない', async ({
    page,
  }) => {
    await recordOrder(page)
    await openCalendar(page, DAY)
    const sheet = page.getByTestId('item-sheet')
    await page.getByTestId('cal-add').tap()
    await expect(sheet).toBeVisible()
    await page.getByTestId('item-title').fill('書きかけの予定')
    await historySettled(page)
    const start = (await orderOf(page)).length
    await flick(page, 'back')
    await expect(page.getByTestId('item-discard')).toBeVisible()
    await page.getByTestId('item-discard-keep').tap()
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('item-title')).toHaveValue('書きかけの予定')
    const swipes = bySwipe((await orderOf(page)).slice(start))
    expect(swipes).toHaveLength(1)
    expect(swipes[0].ops.filter((o) => o.ev === 'replaceState' && o.url === null)).toEqual([])
    expect(await countByTitle(page, '書きかけの予定')).toBe(0)
  })
})
