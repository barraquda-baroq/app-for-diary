// 打っている間の端からのフリック（docs/SPEC.md の 3.1・12.1・22. の ■36 の作者の答え）の E2E: iPhone・iPad で、カレンダー・MIM の画面の
// 3つのリストの入力欄・行の中で直している欄で打っている時と、すばやく足すを開いている時に画面の端から払うと、打っていた物をやめて
// 欄（とキーボード）を閉じるだけ: 打ちかけ・チップ・端末の書きかけは消え、欄からフォーカスが外れ、行き先・モード・ページの位置・
// ブラウザの履歴の数は替わらず、リストは開いたまま（作者「入力中の払いは、入力画面のキャンセルのみで、モード移行はなしでいいです」
// 「画面の上下移動もなし、入力のキャンセルと入力ボックスを閉じるだけでいいです」）。打っていない時の次のフリックは今までどおり
// （■34 で見ている開いたリストを畳む・モードを回す）。打っている欄が見える所の上の外にあって、やめて縮んでも、見えている物は動かない
// （WebKit と同じくスクロールの錨を止めて確かめる。錨のある Chromium のままでも、ブラウザが保った分に足して送らない）。
// Android（Pixel 7）・PC の［戻る］は今までどおり（打っていても畳む・閉じるかを聞く）。iPhone は Chromium に iPhone の UA（ブラウザの
// 履歴は1つのまま）、iPad は縦向き（M）・横向き（L）の UA。指は e2e/helpers.ts の
// edgeFlick（iPhone と同じく 12px で pointer を取り消す合成した指）で、打っている欄の上から始めない高さ（欄の上からはフリックに
// しない。3.1）で払う。データは作り物（e2e/fixtures/listData.ts）
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { LIST_IDS, LONG_FAVORITE_ID, longFavorites } from './fixtures/listData'
import {
  collectDiagnosticsOnFailure,
  edgeFlick,
  goBack,
  historyCalls,
  historySettled,
  iosCancelledTouch,
  spyHistory,
} from './helpers'
import {
  expectCollapsed,
  listInput,
  listSection,
  listTestIds,
  openLists,
  openStackedList,
  pageScrollStill,
  storedDraft,
  type ListName,
} from './listHelpers'

collectDiagnosticsOnFailure()

const IPHONE_UA = devices['iPhone 14'].userAgent
const IPAD_UA = devices['iPad Pro 11'].userAgent
const MONTH = '/month/2026-11'
const WEEK = '/week/2026-11-08'
const DAY = '/day/2026-11-10'

const hashOf = (page: Page) => page.evaluate(() => window.location.hash.slice(1))
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))
const historyLength = (page: Page) => page.evaluate(() => history.length)
const focused = (target: Locator) => target.evaluate((el) => el === document.activeElement)
const countByTitle = (page: Page, title: string) =>
  page.evaluate((t) => Object.values(window.__ds.getData().items).filter((i) => i.title === t).length, title)

/** 打った字が端末の書きかけに控えられるまで待つ */
async function draftStored(page: Page, list: ListName, text: string) {
  await expect.poll(() => storedDraft(page, list)).toContain(text)
}

/** 払う高さ: 打っている欄（target）の上から始めない所（欄が画面の下の半分なら上の 1/4、上の半分なら下の 3/4） */
async function flickY(page: Page, target: Locator): Promise<number> {
  const box = await target.boundingBox()
  const h = page.viewportSize()?.height ?? 800
  if (!box) return Math.round(h * 0.5)
  return box.y + box.height / 2 > h / 2 ? Math.round(h * 0.25) : Math.round(h * 0.75)
}

/** 払った後、落ち着くまで（離した所の click を打ち消す間は edgeFlick が待つ） */
async function settled(page: Page) {
  await historySettled(page)
  await pageScrollStill(page)
}

/**
 * 打っている間のフリックが入力をやめるだけだったこと: 欄は空・フォーカスは外れ・端末の書きかけは無く、行き先・ページの位置
 * （±1px）・ブラウザの履歴の数は同じ、リストは開いたまま
 */
async function onlyCancelled(page: Page, list: ListName, before: { hash: string; y: number; length: number }): Promise<void> {
  await expect(listInput(page, list)).toHaveValue('')
  expect(await focused(listInput(page, list))).toBe(false)
  await expect.poll(() => storedDraft(page, list)).toBeNull()
  await settled(page)
  expect(await hashOf(page)).toBe(before.hash)
  expect(Math.abs((await scrollY(page)) - before.y)).toBeLessThanOrEqual(1)
  expect(await historyLength(page)).toBe(before.length)
  await expectCollapsed(page, list, false)
}

/** そのリストの入力欄に打つ（Task List は［締め切り日］も「明日」にして、入力欄へ戻る） */
async function typeInto(page: Page, list: ListName, text: string) {
  const input = listInput(page, list)
  await input.click()
  await page.keyboard.type(text)
  if (list === 'task') {
    await page.getByTestId(listTestIds.taskChip('due')).click()
    await page.getByRole('menuitem', { name: '明日', exact: true }).click()
    await expect(page.getByTestId(listTestIds.taskChip('due'))).not.toHaveText('締め切り日')
    await input.click()
  }
  await expect(input).toBeFocused()
  await draftStored(page, list, text)
}

/** そのリストを切り替えの列で開いて先頭へ（scroll の時は、続けて見出しを画面の真ん中まで手で動かす） */
async function showList(page: Page, list: ListName, how: 'switch' | 'scroll') {
  await openStackedList(page, list)
  if (how === 'scroll') {
    await page.evaluate((id) => {
      const head = document.querySelector(`[data-testid="${id}"] .list-head`)!.getBoundingClientRect()
      window.scrollBy(0, Math.round(head.top - window.innerHeight / 2))
    }, listTestIds.section(list))
  }
  await pageScrollStill(page)
}

/** 端の幅（初めの 44px）の中で、target の上の点（右の端から 40px。target の右の端の 2px 内）。入らなければ落とす */
async function rightEdgePointOn(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  const vw = page.viewportSize()?.width ?? 412
  const box = await target.boundingBox()
  if (!box) throw new Error('押す物が見えません')
  const x = Math.max(box.x + 2, vw - 40)
  expect(x, `右の端の幅（${vw - 44}px から）の中に押す物がある`).toBeLessThanOrEqual(box.x + box.width - 2)
  return { x, y: Math.round(box.y + box.height / 2) }
}

/** その点から左へ 160px 払う（e2e/helpers.ts の iosCancelledTouch。iPhone と同じく少し動いた所で pointer を取り消す。pointer が先の順） */
async function flickLeftFrom(page: Page, from: { x: number; y: number }, stepMs = 12) {
  const points = Array.from({ length: 11 }, (_, i) => ({ x: from.x - 16 * i, y: from.y - i }))
  await iosCancelledTouch(page, points, { stepMs })
  await page.waitForTimeout(320)
}

/** Chromium の変換（IME）で、変換の途中の字を置く（決めていない字） */
async function composeText(page: Page, text: string) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
}

// ---------- iPhone（Chromium に iPhone の UA。ブラウザの履歴は1つのまま） ----------
test.describe('■36 iPhone: 打っている間の端からのフリックは入力をやめるだけ（Chromium に iPhone の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPHONE_UA })

  for (const list of ['routine', 'task', 'favorite'] as const) {
    for (const how of ['switch', 'scroll'] as const) {
      test(`${list}（${how === 'switch' ? '切り替えの列で開いた' : '見出しを画面の真ん中まで手で動かした'}）: 打って左の端から・右の端から払うと、打ちかけ・チップ・書きかけを消して欄から外すだけ（行き先・モード・ページの位置・履歴の数はそのまま、リストは開いたまま）。打っていない次のフリックは今までどおり`, async ({
        page,
      }) => {
        await spyHistory(page)
        await openLists(page, MONTH)
        const length = await historyLength(page)
        await showList(page, list, how)
        for (const side of ['left', 'right'] as const) {
          await typeInto(page, list, `${side}から払う前の字`)
          const before = { hash: await hashOf(page), y: await scrollY(page), length }
          await edgeFlick(page, side, { y: await flickY(page, listInput(page, list)) })
          await onlyCancelled(page, list, before)
          await expect(page.getByTestId('view-month')).toBeVisible()
          if (list === 'task') await expect(page.getByTestId(listTestIds.taskChip('due'))).toHaveText('締め切り日')
        }
        // 打っていない時のフリック: 見ている所がこのリストなら畳み（■34）、ほかならモードを回す（リストは開いたまま）
        const shownHere = (await page.getByTestId(`top-jump-${list}`).getAttribute('aria-current')) === 'true'
        await edgeFlick(page, 'left', { y: await flickY(page, listInput(page, list)) })
        if (shownHere) {
          await expectCollapsed(page, list, true)
          await expect(page.getByTestId('view-month')).toBeVisible()
        } else {
          await expect(page.getByTestId('view-week')).toBeVisible()
          await expectCollapsed(page, list, false)
        }
        await historySettled(page)
        expect(await historyLength(page)).toBe(length)
        expect(await historyCalls(page)).toEqual([])
      })
    }
  }

  test('Task List の行の件名をその場で直している時に払うと、Esc と同じく保存せずにやめて欄から外す（件名はそのまま・モードも位置もそのまま・リストは開いたまま）', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, MONTH)
    const length = await historyLength(page)
    await showList(page, 'task', 'switch')
    const title = page.getByTestId(listTestIds.rowTitle('task', LIST_IDS.quoteReply))
    await title.click()
    const edit = page.getByTestId(listTestIds.rowEdit('task', LIST_IDS.quoteReply))
    await expect(edit).toBeFocused()
    await edit.fill('見積もりの返事を今日送る')
    const before = { hash: await hashOf(page), y: await scrollY(page) }
    await edgeFlick(page, 'left', { y: await flickY(page, edit) })
    await expect(edit).toHaveCount(0)
    await expect(title).toBeVisible()
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toMatch(/INPUT|TEXTAREA/)
    expect(await page.evaluate((id) => window.__ds.getData().items[id]?.title, LIST_IDS.quoteReply)).toBe('見積もりの返事')
    await settled(page)
    expect(await hashOf(page)).toBe(before.hash)
    expect(Math.abs((await scrollY(page)) - before.y)).toBeLessThanOrEqual(1)
    await expect(page.getByTestId('view-month')).toBeVisible()
    await expectCollapsed(page, 'task', false)
    expect(await historyLength(page)).toBe(length)
    expect(await historyCalls(page)).toEqual([])
  })

  for (const mode of [
    { name: '週', path: WEEK, plus: 'week-add-2026-11-12-work', key: 'diary-studio:draft:quick:2026-11-12:work', next: DAY },
    { name: '日', path: DAY, plus: 'day-add-work', key: 'diary-studio:draft:quick:2026-11-10:work', next: '/year/2026' },
  ]) {
    test(`すばやく足す（${mode.name}）に字を打ったまま左の端から・右の端から払うと、足さずに閉じ、書きかけも消すだけ（モード・行き先・ページの位置はそのまま）。次のフリックでモードを回す`, async ({
      page,
    }) => {
      await spyHistory(page)
      await openLists(page, mode.path)
      const length = await historyLength(page)
      const input = page.getByTestId('quick-add-input')
      const plus = page.getByTestId(mode.plus)
      for (const side of ['left', 'right'] as const) {
        await plus.tap()
        await input.fill(`${side}で捨てる字`)
        await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), mode.key)).toBe(`${side}で捨てる字`)
        const before = { hash: await hashOf(page), y: await scrollY(page) }
        await edgeFlick(page, side, { y: await flickY(page, input) })
        await expect(input).toHaveCount(0)
        expect(await countByTitle(page, `${side}で捨てる字`)).toBe(0)
        await expect(page.locator('.toast', { hasText: '足しました' })).toHaveCount(0)
        expect(await page.evaluate((k) => localStorage.getItem(k), mode.key)).toBeNull()
        await settled(page)
        expect(await hashOf(page)).toBe(before.hash)
        expect(Math.abs((await scrollY(page)) - before.y)).toBeLessThanOrEqual(1)
      }
      // 開き直すと空
      await plus.tap()
      await expect(input).toHaveValue('')
      await page.keyboard.press('Escape')
      await expect(input).toHaveCount(0)
      // 打っていない時のフリックはモードを回す（左の端から: 週→日・日→年）
      await edgeFlick(page, 'left')
      await expect.poll(() => hashOf(page)).toBe(mode.next)
      await historySettled(page)
      expect(await historyLength(page)).toBe(length)
      expect(await historyCalls(page)).toEqual([])
    })
  }

  test('Task List の入力欄で変換の途中に、右の端の幅の中の［足す］から払っても、打ちかけ（変換の途中の字も）を捨てて欄から外すだけ（［足す］が押した時に変換を決めるため欄から外していても。畳まない・ページも動かない）', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, MONTH)
    const length = await historyLength(page)
    await showList(page, 'task', 'switch')
    const input = listInput(page, 'task')
    await input.click()
    await page.keyboard.type('会議室')
    await draftStored(page, 'task', '会議室')
    await composeText(page, 'よやく')
    await expect(input).toHaveValue('会議室よやく')
    const before = { hash: await hashOf(page), y: await scrollY(page), length }
    await flickLeftFrom(page, await rightEdgePointOn(page, page.getByTestId(listTestIds.add('task'))))
    await onlyCancelled(page, 'task', before)
    expect(await countByTitle(page, '会議室よやく')).toBe(0)
    expect(await historyCalls(page)).toEqual([])
  })

  test('すばやく足すで変換の途中に、右の端の幅の中の［足す］（✓）から払っても、足さずに閉じて書きかけも消すだけ（指を取られてから離すまでが長くても。モードは回さない）', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, WEEK)
    const length = await historyLength(page)
    // いちばん右の「＋」（その✓が右の端の幅に入る）
    const plusId = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[data-testid^="week-add-"]')]
      all.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      return all[0]?.getAttribute('data-testid') ?? ''
    })
    const [, date, kind] = /^week-add-(\d{4}-\d{2}-\d{2})-(\w+)$/.exec(plusId) ?? []
    expect(date).toBeTruthy()
    const key = `diary-studio:draft:quick:${date}:${kind}`
    const plus = page.getByTestId(plusId)
    await plus.scrollIntoViewIfNeeded()
    await plus.tap()
    const input = page.getByTestId('quick-add-input')
    await expect(input).toBeFocused()
    await page.keyboard.type('かい')
    await composeText(page, 'ぎ')
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), key)).toBe('かいぎ')
    const before = { hash: await hashOf(page), y: await scrollY(page) }
    await flickLeftFrom(page, await rightEdgePointOn(page, page.getByTestId('quick-add-button')), 30)
    await expect(input).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await countByTitle(page, 'かいぎ')).toBe(0)
    await expect(page.locator('.toast', { hasText: '足しました' })).toHaveCount(0)
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull()
    await settled(page)
    expect(await hashOf(page)).toBe(before.hash)
    expect(Math.abs((await scrollY(page)) - before.y)).toBeLessThanOrEqual(1)
    expect(await historyLength(page)).toBe(length)
    expect(await historyCalls(page)).toEqual([])
  })
})

// ---------- iPad の縦向き（M。リストは画面の下へ並ぶ） ----------
test.describe('■36 iPad の縦向き（820×1180・M。Chromium に iPad の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPAD_UA, viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true })

  test('Favorite List の入力欄に打ったまま払うと入力をやめるだけ。すばやく足す（週）も足さずに閉じるだけ（モードは回さない）。MIM の横のリストで打っている時も、MIM のまま入力をやめるだけ', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, MONTH)
    const length = await historyLength(page)
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'M')
    await showList(page, 'favorite', 'switch')
    await typeInto(page, 'favorite', 'iPad の縦で打つ')
    const before = { hash: await hashOf(page), y: await scrollY(page), length }
    await edgeFlick(page, 'left', { y: await flickY(page, listInput(page, 'favorite')) })
    await onlyCancelled(page, 'favorite', before)

    await openLists(page, WEEK)
    const plus = page.getByTestId('week-add-2026-11-12-work')
    await plus.tap()
    const quick = page.getByTestId('quick-add-input')
    await quick.fill('縦で捨てる字')
    await edgeFlick(page, 'right', { y: await flickY(page, quick) })
    await expect(quick).toHaveCount(0)
    expect(await countByTitle(page, '縦で捨てる字')).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('diary-studio:draft:quick:2026-11-12:work'))).toBeNull()
    await settled(page)
    expect(await hashOf(page)).toBe(WEEK)

    await openLists(page, '/mim')
    await showList(page, 'task', 'switch')
    const task = listInput(page, 'task')
    await task.click()
    await page.keyboard.type('MIM の横で打つ')
    await draftStored(page, 'task', 'MIM の横で打つ')
    await edgeFlick(page, 'left', { y: await flickY(page, task) })
    await expect(task).toHaveValue('')
    expect(await focused(task)).toBe(false)
    await expect.poll(() => storedDraft(page, 'task')).toBeNull()
    await settled(page)
    expect(await hashOf(page)).toBe('/mim')
    expect(await historyCalls(page)).toEqual([])
  })
})

// ---------- iPad の横向き（L。右の列） ----------
test.describe('■36 iPad の横向き（1180×820・L の右の列。Chromium に iPad の UA）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPAD_UA, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('右の列の Task List の入力欄に打ったまま払うと、入力をやめるだけ（モードは回さない）。次のフリックでモードを回す', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, WEEK)
    const length = await historyLength(page)
    await expectCollapsed(page, 'task', false)
    const input = listInput(page, 'task')
    await input.click()
    await page.keyboard.type('右の列で打つ')
    await draftStored(page, 'task', '右の列で打つ')
    // 右の列は右の端の近くなので、左の端から払う
    await edgeFlick(page, 'left', { y: await flickY(page, input) })
    await expect(input).toHaveValue('')
    expect(await focused(input)).toBe(false)
    await expect.poll(() => storedDraft(page, 'task')).toBeNull()
    await historySettled(page)
    expect(await hashOf(page)).toBe(WEEK)
    await expect(page.getByTestId('view-week')).toBeVisible()
    await edgeFlick(page, 'left')
    await expect.poll(() => hashOf(page)).toBe(DAY)
    expect(await historyLength(page)).toBe(length)
    expect(await historyCalls(page)).toEqual([])
  })
})

// ---------- 打っている欄が見える所の上にはみ出している時（iPhone・iPad の WebKit にはスクロールの錨が無い） ----------

/** リストの入る所: S・M はページ、L は右の列（.top-side） */
type Where = 'page' | 'side'

/** 見える所の上下の端（画面の上から。S・M はヘッダーと切り替えの列の下から画面の下の端まで、L は右の列の中） */
function visibleBox(page: Page, where: Where): Promise<{ lo: number; hi: number }> {
  return page.evaluate((w) => {
    if (w === 'side') {
      const side = document.querySelector('.top-side')!
      const lo = side.getBoundingClientRect().top + side.clientTop
      return { lo, hi: lo + side.clientHeight }
    }
    return { lo: document.querySelector('[data-testid="top-switcher"]')!.getBoundingClientRect().bottom, hi: window.innerHeight }
  }, where)
}

/** リストの入る所のスクロールの位置 */
const listScroll = (page: Page, where: Where) =>
  page.evaluate((w) => (w === 'side' ? document.querySelector('.top-side')!.scrollTop : window.scrollY), where)

/** リストの入る所を dy だけすぐ（なめらかにせず）スクロールする */
async function scrollListBy(page: Page, where: Where, dy: number): Promise<void> {
  await page.evaluate(
    ({ w, dy }) => {
      if (w === 'side') document.querySelector('.top-side')!.scrollBy({ top: dy, behavior: 'instant' })
      else window.scrollBy({ top: dy, behavior: 'instant' })
    },
    { w: where, dy },
  )
}

/** リストの入る所のスクロールの位置が、続けて読んで2回同じになるまで待つ */
async function listScrollStill(page: Page, where: Where): Promise<void> {
  let last = Number.NaN
  let still = 0
  await expect
    .poll(
      async () => {
        const y = await listScroll(page, where)
        still = y === last ? still + 1 : 0
        last = y
        return still
      },
      { intervals: [60] },
    )
    .toBeGreaterThanOrEqual(2)
}

/** その物の上下の端（画面の上から）と高さ */
const rectOf = (target: Locator) =>
  target.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, height: r.height }
  })

/**
 * WebKit（iPhone・iPad の Safari・Chrome）と同じく、スクロールの錨（中身の高さが替わった時に、ブラウザがページの位置を替えて見えて
 * いる物を保つ。Chromium にはあり、WebKit には無い）を止める
 */
const stopScrollAnchoring = (page: Page) =>
  page.addStyleTag({ content: 'html, body, .top-side { overflow-anchor: none !important; }' })

/** 端からのフリックの記録を取る（設定の「開発」と同じ。開く前に） */
const keepSwipeLog = (page: Page) => page.addInitScript(() => localStorage.setItem('diary-studio:swipe-log', '1'))
/** 記録（1行に1つ） */
const swipeLogOf = (page: Page) => page.evaluate(() => window.__ds.swipeLog())

/** 長い物（61行）の「続き」「畳む」 */
const longMore = (page: Page) => page.getByTestId(listTestIds.favoriteMore(LONG_FAVORITE_ID))

/**
 * 長い Favorite List（fixtures/listData の longFavorites）を出し、いちばん上の長い物を「続き」で全部見せ、入力欄に4行の書きかけを打って
 * から、開いた物を下まで読み進めて（「畳む」を見える所の下の端の 40px 上に）、打っている入力欄を見える所の上の外へ出す（anchoring が
 * false の時は、開いてすぐ WebKit と同じくスクロールの錨を止める）
 */
async function draftAboveView(page: Page, where: Where, anchoring: boolean): Promise<void> {
  await keepSwipeLog(page)
  await openLists(page, MONTH, { extra: longFavorites() })
  if (!anchoring) await stopScrollAnchoring(page)
  if (where === 'page') await openStackedList(page, 'favorite')
  await longMore(page).tap()
  await expect(longMore(page)).toHaveText('畳む')
  const input = listInput(page, 'favorite')
  await input.click()
  const one = (await rectOf(input)).height
  await input.fill(['1行目の書きかけ', '2行目の書きかけ', '3行目の書きかけ', '4行目の書きかけ'].join('\n'))
  await draftStored(page, 'favorite', '4行目の書きかけ')
  expect((await rectOf(input)).height, '書きかけで入力欄が伸びた').toBeGreaterThan(one + 40)
  const view = await visibleBox(page, where)
  await scrollListBy(page, where, Math.round((await rectOf(longMore(page))).bottom - (view.hi - 40)))
  await listScrollStill(page, where)
  await expect(input).toBeFocused()
  expect((await rectOf(input)).bottom, '入力欄は見える所の上の外').toBeLessThan(view.lo)
}

/**
 * 払った後: 入力をやめただけ（欄は空・フォーカスは外れ・書きかけは無く・行き先はそのまま・リストは開いたまま）で、欄が縮んでも
 * 見えている物（mark。払う前の上の端 top）は動かない（±1px）
 */
async function keptInView(page: Page, where: Where, mark: Locator, top: number, hash: string): Promise<void> {
  await historySettled(page)
  await listScrollStill(page, where)
  await expect(listInput(page, 'favorite')).toHaveValue('')
  expect(await focused(listInput(page, 'favorite'))).toBe(false)
  await expect.poll(() => storedDraft(page, 'favorite')).toBeNull()
  expect(Math.abs((await rectOf(mark)).top - top), '見えている物が動いた（px）').toBeLessThanOrEqual(1)
  expect(await hashOf(page)).toBe(hash)
  await expectCollapsed(page, 'favorite', false)
}

/**
 * 4行の書きかけの入力欄を見える所の上の外へ出して払う（anchoring が false の時は、WebKit と同じくスクロールの錨を止めて。その時は
 * アプリが縮んだ分だけ送って戻し、記録の type-cancel-keep に控える。打った字は控えない）
 */
async function flickDraftAboveView(page: Page, where: Where, anchoring: boolean): Promise<void> {
  await draftAboveView(page, where, anchoring)
  const top = (await rectOf(longMore(page))).top
  const hash = await hashOf(page)
  await edgeFlick(page, 'left', { y: Math.round((page.viewportSize()?.height ?? 800) * 0.5) })
  await keptInView(page, where, longMore(page), top, hash)
  await expect(longMore(page)).toHaveText('畳む')
  const log = await swipeLogOf(page)
  if (!anchoring) expect(log).toMatch(/ type-cancel-keep \{"kind":"list-input","list":"favorite","moved":-\d/)
  expect(log).not.toContain('書きかけ')
}

const ABOVE_TITLE =
  '入力欄に4行の書きかけを打ったまま、開いた長い物を下まで読み進めて入力欄が見える所の上に隠れている時に払うと、入力をやめるだけで、欄が縮んでも見えている物は動かない（「画面の上下移動もなし」）'

test.describe(
  '■36 打っている欄が見える所の上にはみ出している時のフリック（Chromium に iPhone・iPad の UA）',
  { tag: ['@s'] },
  () => {
    test.describe('iPhone（S）', () => {
      test.use({ userAgent: IPHONE_UA })

      test(`Favorite List: ${ABOVE_TITLE}（スクロールの錨なし: WebKit と同じ）`, async ({ page }) => {
        await flickDraftAboveView(page, 'page', false)
      })

      test(`Favorite List: ${ABOVE_TITLE}（Chromium のスクロールの錨あり: ブラウザが保った分に足して送らない）`, async ({
        page,
      }) => {
        await flickDraftAboveView(page, 'page', true)
      })

      test('行の中で直している Favorite List の本文（開いた長い物）が見える所の上の外にある時に払うと、保存せずにやめるだけで、欄が縮んで3行に戻っても見えている物は動かない（スクロールの錨なし）', async ({
        page,
      }) => {
        await keepSwipeLog(page)
        await openLists(page, MONTH, { extra: longFavorites() })
        await stopScrollAnchoring(page)
        await openStackedList(page, 'favorite')
        await longMore(page).tap()
        await expect(longMore(page)).toHaveText('畳む')
        const title = (await page.getByTestId(listTestIds.rowTitle('favorite', LONG_FAVORITE_ID)).boundingBox())!
        await page.touchscreen.tap(title.x + 30, title.y + 20)
        const edit = page.getByTestId(listTestIds.rowEdit('favorite', LONG_FAVORITE_ID))
        await expect(edit).toBeFocused()
        // 下の短い物（11件目）を見える所の真ん中へ: 直している欄は見える所の上の外
        const mark = page.getByTestId(listTestIds.row('favorite', 'list-f-short-10'))
        const view = await visibleBox(page, 'page')
        await scrollListBy(page, 'page', Math.round((await rectOf(mark)).top - (view.lo + view.hi) / 2))
        await listScrollStill(page, 'page')
        await expect(edit).toBeFocused()
        expect((await rectOf(edit)).bottom, '直している欄は見える所の上の外').toBeLessThan(view.lo)
        const top = (await rectOf(mark)).top
        const hash = await hashOf(page)
        const text = await page.evaluate((id) => window.__ds.getData().favorites[id]?.text, LONG_FAVORITE_ID)
        await edgeFlick(page, 'left', { y: Math.round((page.viewportSize()?.height ?? 800) * 0.5) })
        await historySettled(page)
        await listScrollStill(page, 'page')
        await expect(edit).toHaveCount(0)
        await expect(longMore(page)).toHaveText('続き')
        expect(await page.evaluate((id) => window.__ds.getData().favorites[id]?.text, LONG_FAVORITE_ID)).toBe(text)
        expect(Math.abs((await rectOf(mark)).top - top), '見えている物が動いた（px）').toBeLessThanOrEqual(1)
        expect(await hashOf(page)).toBe(hash)
        await expectCollapsed(page, 'favorite', false)
        expect(await swipeLogOf(page)).toMatch(/ type-cancel-keep \{"kind":"inline-edit","list":"favorite","moved":-\d/)
      })
    })

    test.describe('iPad の縦向き（820×1180・M）', () => {
      test.use({ userAgent: IPAD_UA, viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true })

      test(`Favorite List: ${ABOVE_TITLE}（スクロールの錨なし）`, async ({ page }) => {
        await flickDraftAboveView(page, 'page', false)
      })
    })

    test.describe('iPad の横向き（1180×820・L の右の列）', () => {
      test.use({ userAgent: IPAD_UA, viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

      test(`右の列の Favorite List: ${ABOVE_TITLE}（スクロールの錨なし）`, async ({ page }) => {
        await flickDraftAboveView(page, 'side', false)
      })
    })
  },
)

// ---------- キーボード（作り物の visualViewport。src/ui/keyboardInset.ts） ----------

/**
 * 画面キーボードが出た時と同じく、見えている範囲（visualViewport）の高さを縮め（by px）、上の端を top px 下げて知らせる（iOS は
 * キーボードが出たまま見えている所が縦に動くと、高さはそのままで offsetTop を替えて scroll を送る。--kb は by − top になる）。
 * --kb の値を返す
 */
function fakeKeyboard(page: Page, by: number, top = 0, type: 'resize' | 'scroll' = 'resize'): Promise<string> {
  return page.evaluate(
    async ({ by, top, type }) => {
      const vv = window.visualViewport!
      const full = window.innerHeight
      Object.defineProperty(vv, 'height', { configurable: true, get: () => full - by })
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => top })
      vv.dispatchEvent(new Event(type))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return getComputedStyle(document.documentElement).getPropertyValue('--kb').trim()
    },
    { by, top, type },
  )
}

/** 欄の下の端（見えている所の上から） */
const bottomOf = (target: Locator) => target.evaluate((e) => e.getBoundingClientRect().bottom)

test.describe('■36 キーボードが出た時の送り方（作り物の visualViewport。■36 の報告の直し）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPHONE_UA })

  test('キーボードが出た時は、打っているリストの入力欄・すばやく足すの入力欄をキーボードの上 16px まで送る。出たまま指で動かして見えている所も動いた時は、欄へ送り直さない（--kb は替わる）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await showList(page, 'routine', 'switch')
    // 送れる所を残すため、見出しを 250px 下へ（ページを上へ）
    await page.evaluate(() => window.scrollBy(0, -250))
    await pageScrollStill(page)
    const vh = await page.evaluate(() => window.innerHeight)
    const input = listInput(page, 'routine')
    await input.click()
    // キーボードが出る: 欄の下の端より 40px 上まで隠す高さ
    const by = Math.round(vh - (await bottomOf(input)) + 40)
    const y0 = await scrollY(page)
    await expect.poll(() => fakeKeyboard(page, by)).toBe(`${by}px`)
    await pageScrollStill(page)
    expect(await scrollY(page)).toBeGreaterThan(y0)
    expect(await bottomOf(input)).toBeLessThanOrEqual(vh - by - 16 + 1)
    // 出たまま指でページを上へ戻し（欄はキーボードの下へ隠れる）、見えている所も動いた（何度か）: --kb は替わるが、欄へ送り直さない
    await page.evaluate(() => window.scrollBy(0, -200))
    await pageScrollStill(page)
    const y1 = await scrollY(page)
    for (const top of [60, 140, 30]) {
      expect(await fakeKeyboard(page, by, top, 'scroll')).toBe(`${by - top}px`)
      await pageScrollStill(page)
      expect(Math.abs((await scrollY(page)) - y1)).toBeLessThanOrEqual(1)
    }
    // キーボードを閉じる
    expect(await fakeKeyboard(page, 0)).toBe('0px')

    // すばやく足す（週の火曜）: 開いた欄が隠れる高さのキーボードが出ると、欄をキーボードの上まで送る（週の中）。出たまま週の中を
    // 指で戻して見えている所も動いた時は、送り直さない
    await openLists(page, WEEK)
    await page.getByTestId('week-add-2026-11-10-work').tap()
    const quick = page.getByTestId('quick-add-input')
    await expect(quick).toBeFocused()
    const qby = Math.round(vh - (await bottomOf(quick)) + 40)
    await expect.poll(() => fakeKeyboard(page, qby)).toBe(`${qby}px`)
    await expect.poll(() => bottomOf(quick)).toBeLessThanOrEqual(vh - qby - 16 + 1)
    // 欄の入っている、いちばん近いスクロールする所（無ければページ）を指で戻す
    const back = () =>
      quick.evaluate((el) => {
        let p = el.parentElement
        while (p) {
          const { overflowY } = getComputedStyle(p)
          if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) break
          p = p.parentElement
        }
        const box = p ?? document.scrollingElement!
        box.scrollBy({ top: -120, behavior: 'instant' })
        return Math.round(box.scrollTop)
      })
    await back()
    await page.waitForTimeout(100)
    const placed = await bottomOf(quick)
    for (const top of [50, 120]) {
      await fakeKeyboard(page, qby, top, 'scroll')
      await page.waitForTimeout(250)
      expect(Math.abs((await bottomOf(quick)) - placed)).toBeLessThanOrEqual(1)
    }
  })
})

// ---------- Android（Pixel 7）・PC: 今までどおり ----------
test.describe('■36 Android の［戻る］は打っていても今までどおり（Pixel 7 のタブ）', { tag: ['@s'] }, () => {
  test('Routine List の入力欄に打ったまま［戻る］を押すと、今までどおり Routine List を畳んで打ちかけを捨てる（閉じるかは聞かない。■34）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await showList(page, 'routine', 'switch')
    const input = listInput(page, 'routine')
    await input.click()
    await page.keyboard.type('朝の体操')
    await draftStored(page, 'routine', '朝の体操')
    await expect(input).toBeFocused()
    await goBack(page)
    await expectCollapsed(page, 'routine', true)
    await expect.poll(() => storedDraft(page, 'routine')).toBeNull()
    await expect(page.getByRole('dialog', { name: 'Diary Studio を閉じますか？' })).toHaveCount(0)
    expect(await hashOf(page)).toBe(MONTH)
  })
})

test.describe('■36 PC の戻るは打っていても今までどおり（L の右の列）', { tag: ['@pc'] }, () => {
  test('右の列の Task List の入力欄に打ったまま戻ると、今までどおり閉じるかを聞き（打ちかけも欄のフォーカスも残る）、［キャンセル］でそのまま', async ({
    page,
  }) => {
    await openLists(page, WEEK)
    const input = listInput(page, 'task')
    await input.click()
    await page.keyboard.type('PC で打つ')
    await draftStored(page, 'task', 'PC で打つ')
    await goBack(page)
    const dialog = page.getByRole('dialog', { name: 'Diary Studio を閉じますか？' })
    await expect(dialog).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(input).toHaveValue('PC で打つ')
    expect(await storedDraft(page, 'task')).toContain('PC で打つ')
    await expect(listSection(page, 'task')).toBeVisible()
    expect(await hashOf(page)).toBe(WEEK)
  })
})
