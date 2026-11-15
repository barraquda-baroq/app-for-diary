// 段階3のリストと履歴の E2E（docs/SPEC.md の 3.1・3.5・3.6・3.8・22. の ■25・■27・■34 の作者の答え）: S・M で開いているリストを
// 見ている時は、iPhone・iPad の端からのフリック（左右どちらでも）と Android・PC の OS の［戻る］で、そのリストをその場で畳み
// （いちばん上のカレンダーへスクロールで戻さない・フォーカスはそのリストの中にあった時だけそのリストの畳む・開くボタンへ）、そのリストの
// 入力欄の打ちかけを捨てる（変換の途中でも決めずに。ほかのリストの打ちかけと、ほかの畳み方の打ちかけは残る）。履歴は動かさず、
// 「進む」は何もせず、■25（もう一度［戻る］で閉じる）も構えない。畳んだ後・カレンダーを見ている時は今までどおり（モードを回す・
// 閉じるかを聞く）。リストの［詳しく］は L では右の列の上のパネル、S・M では下からのシートで、「戻る」・フリック・Esc・外を押す・［×］で
// 閉じ、読み込み直すと開き直し、幅を替えても閉じない。
// iPhone は Chromium に iPhone の UA（ブラウザの履歴は1つのまま: history.length が開いた時のまま・積む・戻る・進むを一度も呼ばない）。
// 端の幅はいちばん狭い選べる幅と初めの幅の両方で払う（どちらも定数は src から読む）。Android は Pixel 7（ブラウザのタブと、表示の形を
// standalone にしたホーム画面のアプリ）、PC は Desktop Chrome。データは作り物（e2e/fixtures/listData.ts）。
// リストの行・「…」の［詳しく］・［予定にする］が要るテストは、先にその行が出ていることを確かめる（出ていなければ失敗にする。行は
// 各リストの中身が出す）
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { EDGE_ZONE_CHOICES, EDGE_ZONE_PX } from '../src/features/calendar/common/swipe'
import { FOLD_MS } from '../src/features/lists/listInfo'
import { EDGE_ZONE_KEY } from '../src/history/edgeZone'
import { LIST_IDS, listData } from './fixtures/listData'
import {
  armHistory,
  collectDiagnosticsOnFailure,
  E2E_NOW,
  edgeFlick,
  goBack,
  goForward,
  historyCalls,
  historySettled,
  historyShape,
  iosCancelledTouch,
  seedData,
  spyHistory,
} from './helpers'
import {
  expectCollapsed,
  listFold,
  listInput,
  listSection,
  listTestIds,
  openLists,
  openStackedList,
  storedDraft,
  type ListName,
} from './listHelpers'

collectDiagnosticsOnFailure()

const IPHONE_UA = devices['iPhone 14'].userAgent
const MONTH = '/month/2026-11'
/** 端の幅: いちばん狭い選べる幅と、初めの幅 */
const ZONES = [Math.min(...EDGE_ZONE_CHOICES), EDGE_ZONE_PX] as const

const historyLength = (page: Page) => page.evaluate(() => history.length)

/** 「Diary Studio を閉じますか？」 */
const closeDialog = (page: Page) => page.getByRole('dialog', { name: 'Diary Studio を閉じますか？' })
/** 「もう一度［戻る］を押すと閉じます」（ホーム画面の Android の1回目の「戻る」。■25） */
const armedToast = (page: Page) => page.locator('.toast', { hasText: 'もう一度［戻る］を押すと閉じます' })

/** 今の行き先（# の後ろ） */
const hashOf = (page: Page) => page.evaluate(() => window.location.hash.slice(1))

/** 端の幅を決めて開く（null は覚えた幅を消して初めの幅） */
async function useEdgeZone(page: Page, px: number | null) {
  await page.addInitScript(
    ({ key, px }) => {
      if (px === null) localStorage.removeItem(key)
      else localStorage.setItem(key, String(px))
    },
    { key: EDGE_ZONE_KEY, px },
  )
}

/** 打った字が端末の書きかけに控えられるまで待つ */
async function draftStored(page: Page, list: ListName, text: string) {
  await expect.poll(() => storedDraft(page, list)).toContain(text)
}

/** 見出しの位置・ページの位置・フォーカス */
const measure = (page: Page, list: ListName) =>
  page.evaluate((id) => {
    const head = document.querySelector(`[data-testid="${id}"] .list-head`)!.getBoundingClientRect()
    const active = document.activeElement as HTMLElement | null
    return {
      scrollY: Math.round(window.scrollY),
      max: Math.round(document.documentElement.scrollHeight - window.innerHeight),
      headTop: Math.round(head.top),
      headBottom: Math.round(head.bottom),
      innerHeight: window.innerHeight,
      active: active?.dataset.testid ?? null,
      calendarHeadingFocused: Boolean(active?.id?.endsWith('-head-calendar')),
    }
  }, listTestIds.section(list))

/** 畳む動き（180ms）が終わるまで */
const afterFold = (page: Page) => page.waitForTimeout(FOLD_MS + 120)

/** ページのスクロールが止まるまで（10コマ続けて同じ位置） */
const scrollSettled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY
        let still = 0
        const tick = () => {
          if (window.scrollY === last) still += 1
          else {
            still = 0
            last = window.scrollY
          }
          if (still >= 10) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )

/**
 * S・M: 切り替えの列でそのリストを開いてその先頭へ移り、スクロールが止まるまで待つ（なめらかなスクロールの途中で指を下ろすと、
 * 見ている所はその時の位置で決め直す）。見ている所がそのリスト
 */
async function showList(page: Page, list: ListName) {
  await openStackedList(page, list)
  await afterFold(page)
  await scrollSettled(page)
  await expect(page.getByTestId(`top-jump-${list}`)).toHaveAttribute('aria-current', 'true')
}

/** 中身（.fold）の高さ */
const bodyHeight = (page: Page, list: ListName) =>
  listSection(page, list)
    .locator('.fold')
    .first()
    .evaluate((e) => e.getBoundingClientRect().height)

/** その物が出ていること（リストの行・「…」は各リストの中身が出す。出ていなければ飛ばさずに失敗にする） */
async function needs(target: Locator, what: string) {
  await expect(target, `${what}が出ていない`).not.toHaveCount(0)
}

/** 行の「…」→［詳しく］ */
async function openDetailFromRow(page: Page, list: ListName, id: string) {
  const more = page.getByTestId(listTestIds.rowMore(list, id))
  await needs(more, `${list} の行の「…」`)
  await more.scrollIntoViewIfNeeded()
  await more.click()
  await page.getByTestId(listTestIds.rowMenu(list)).getByRole('menuitem', { name: '詳しく' }).click()
  await expect(page.getByTestId('item-sheet').or(page.getByTestId(listTestIds.routinePanel)).first()).toBeVisible()
  await historySettled(page)
}

/**
 * ページの終わりで畳んでも位置が上へ跳ばない（■34）: 切り替えの列で最後の Favorite List を開いて先頭へ（ページの終わり）、trigger で
 * 畳み、ページの位置と見出しの所が替わらず、見出しが見えたままで、フォーカスがカレンダーの見出しへ移らない
 */
async function foldAtPageEnd(page: Page, trigger: () => Promise<void>) {
  await showList(page, 'favorite')
  const height = await bodyHeight(page, 'favorite')
  expect(height).toBeGreaterThan(0)
  const pre = await measure(page, 'favorite')
  expect(pre.scrollY).toBeGreaterThan(0)
  expect(pre.scrollY).toBeGreaterThanOrEqual(pre.max - 2)
  await trigger()
  await expectCollapsed(page, 'favorite', true)
  await afterFold(page)
  const after = await measure(page, 'favorite')
  expect(Math.abs(after.scrollY - pre.scrollY), JSON.stringify({ pre, after })).toBeLessThanOrEqual(1)
  expect(Math.abs(after.headTop - pre.headTop), JSON.stringify({ pre, after })).toBeLessThanOrEqual(1)
  expect(after.headTop).toBeGreaterThanOrEqual(0)
  expect(after.headBottom).toBeLessThanOrEqual(after.innerHeight)
  expect(after.calendarHeadingFocused).toBe(false)
}

// ---------- iPhone（Chromium に iPhone の UA。ブラウザの履歴は1つのまま） ----------
test.describe('S3 iPhone の端からのフリックで開いているリストを畳む（Chromium に iPhone の UA。■34）', { tag: ['@s'] }, () => {
  test.use({ userAgent: IPHONE_UA })

  for (const zone of ZONES) {
    test(`端の幅 ${zone}px: 見ている開いたリストを左右どちらのフリックでも畳み（カレンダーへスクロールで戻さない・モードは回さない）、畳んだ後とカレンダーを見ている時はモードを回す。ブラウザの履歴は増えず、積む・戻る・進むは呼ばない（S3-FRAME-005・007・010・021・027）`, async ({
      page,
    }) => {
      await spyHistory(page)
      await useEdgeZone(page, zone === EDGE_ZONE_PX ? null : zone)
      await openLists(page, MONTH)
      expect(await page.evaluate((key) => localStorage.getItem(key), EDGE_ZONE_KEY)).toBe(
        zone === EDGE_ZONE_PX ? null : String(zone),
      )
      const length = await historyLength(page)
      expect(await historyShape(page)).toMatchObject({ kind: 'single' })

      await showList(page, 'task')
      await edgeFlick(page, 'left')
      await expectCollapsed(page, 'task', true)
      await expect(page.getByTestId('view-month')).toBeVisible()
      expect(await hashOf(page)).toBe(MONTH)
      const after = await measure(page, 'task')
      expect(after.scrollY).toBeGreaterThan(0)
      expect(after.headTop).toBeGreaterThanOrEqual(0)
      expect(after.headBottom).toBeLessThanOrEqual(after.innerHeight)
      expect(after.calendarHeadingFocused).toBe(false)

      // 畳んだ後のフリックはモードを回す（右の端から: 日→週→月→年→日。リストは畳んだまま）
      await edgeFlick(page, 'right')
      await expect(page.getByTestId('view-year')).toBeVisible()
      await expectCollapsed(page, 'task', true)

      // 右の端からでも畳む（Routine List）
      await showList(page, 'routine')
      await edgeFlick(page, 'right')
      await expectCollapsed(page, 'routine', true)
      await expect(page.getByTestId('view-year')).toBeVisible()

      // カレンダーを見ている時は、開いているリストが下にあってもモードを回す（リストは開いたまま）
      await showList(page, 'favorite')
      await page.getByTestId('top-jump-calendar').click()
      await scrollSettled(page)
      await expect(page.getByTestId('top-jump-calendar')).toHaveAttribute('aria-current', 'true')
      await edgeFlick(page, 'left')
      await expect(page.getByTestId('view-month')).toBeVisible()
      await expectCollapsed(page, 'favorite', false)

      await historySettled(page)
      expect(await historyLength(page)).toBe(length)
      expect(await historyCalls(page)).toEqual([])
    })
  }

  test('打っている途中（変換の途中も）に払うと、そのリストの打ちかけを決めずに捨てて畳み（足さない）、フォーカスはそのリストの畳む・開くボタンへ。ほかのリストの打ちかけと、見出しの［▾］で畳んだ時の打ちかけは残る（■34。S3-FRAME-024）', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, MONTH)
    const length = await historyLength(page)
    const tasks = await page.evaluate(() => Object.keys(window.__ds.getData().items).length)
    // Favorite List に打って、見出しの［▾］で畳む（打ちかけは残る）
    await showList(page, 'favorite')
    await listInput(page, 'favorite').click()
    await page.keyboard.type('あとで読む本')
    await draftStored(page, 'favorite', 'あとで読む本')
    await listFold(page, 'favorite').click()
    await expectCollapsed(page, 'favorite', true)
    // Task List に打ち、続けて変換の途中の字を置いたまま、入力欄の外（左の端）から払う
    await showList(page, 'task')
    const input = listInput(page, 'task')
    await input.click()
    await page.keyboard.type('会議室')
    await draftStored(page, 'task', '会議室')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'よやく', selectionStart: 3, selectionEnd: 3 })
    await expect(input).toHaveValue('会議室よやく')
    await edgeFlick(page, 'left')
    await expectCollapsed(page, 'task', true)
    await expect.poll(() => storedDraft(page, 'task')).toBeNull()
    expect((await measure(page, 'task')).active).toBe(listTestIds.fold('task'))
    // 開き直しても空で、何も足していない
    await listFold(page, 'task').click()
    await expect(listInput(page, 'task')).toHaveValue('')
    expect(await page.evaluate(() => Object.keys(window.__ds.getData().items).length)).toBe(tasks)
    // Favorite List の打ちかけは残る
    expect(await storedDraft(page, 'favorite')).toContain('あとで読む本')
    await showList(page, 'favorite')
    await expect(listInput(page, 'favorite')).toHaveValue('あとで読む本')
    await historySettled(page)
    expect(await historyLength(page)).toBe(length)
    expect(await historyCalls(page)).toEqual([])
  })

  test('ページの終わりで払って畳んでも、ページの位置と見出しの所は上へ跳ばない（中身のあるリスト。■34）。もう一度払うとモードを回す', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await foldAtPageEnd(page, () => edgeFlick(page, 'left'))
    await edgeFlick(page, 'left')
    await expect(page.getByTestId('view-week')).toBeVisible()
  })

  test('払った指を離した所のチェックは、すぐ後に押されても済みにしない（離した所の押す操作は1つ打ち消す。S3-FRAME-026・TASK-236）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await showList(page, 'task')
    const check = page.getByTestId(listTestIds.rowCheck('task', LIST_IDS.quoteReply))
    await needs(check, 'Task List の行のチェック')
    await check.scrollIntoViewIfNeeded()
    const box = await check.boundingBox()
    if (!box) throw new Error('チェックが見えていません')
    const lift = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
    // 右の端から、左寄りのチェックの上まで払って離す（edgeFlick と同じ合成した指。払い終えた直後に、離した所を指で押す）
    const width = page.viewportSize()?.width ?? 412
    const from = { x: width - 3, y: lift.y + 6 }
    const points = Array.from({ length: 11 }, (_, i) => ({
      x: from.x + ((lift.x - from.x) * i) / 10,
      y: from.y + ((lift.y - from.y) * i) / 10,
    }))
    await iosCancelledTouch(page, points)
    await page.touchscreen.tap(lift.x, lift.y)
    await expectCollapsed(page, 'task', true)
    await page.waitForTimeout(400)
    expect(await page.evaluate((id) => window.__ds.getData().items[id]?.done, LIST_IDS.quoteReply)).toBe(false)
    await expectCollapsed(page, 'routine', true)
    await expectCollapsed(page, 'favorite', true)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
  })

  test('リストの［詳しく］は左右どちらのフリックでも閉じ、開いているリストは次のフリックで畳む。ブラウザの履歴は増えない（S3-FRAME-013・TASK-148・150）', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, MONTH)
    const length = await historyLength(page)
    await showList(page, 'task')
    await openDetailFromRow(page, 'task', LIST_IDS.quoteReply)
    await edgeFlick(page, 'right')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await expectCollapsed(page, 'task', false)
    await edgeFlick(page, 'left')
    await expectCollapsed(page, 'task', true)
    await historySettled(page)
    expect(await historyLength(page)).toBe(length)
    expect(await historyCalls(page)).toEqual([])
  })

  test('ルーチンの［詳しく］を開いたまま読み込み直すと開き直し、払うと閉じてカレンダーへ（S3-FRAME-019・020・ROUTINE-126）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await showList(page, 'routine')
    await openDetailFromRow(page, 'routine', LIST_IDS.stretch)
    await page.reload()
    await expect(page.getByTestId(listTestIds.routinePanel)).toBeVisible()
    await historySettled(page)
    await edgeFlick(page, 'left')
    await expect(page.getByTestId(listTestIds.routinePanel)).toHaveCount(0)
    await expect(page.getByTestId('view-month')).toBeVisible()
  })

  test('Favorite List の［予定にする］の登録の画面は、書きかけでも払うと聞かずに捨てて閉じる（■27。S3-FRAME-011・TASK-239）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await showList(page, 'favorite')
    const more = page.getByTestId(listTestIds.rowMore('favorite', LIST_IDS.bakery))
    await needs(more, 'Favorite List の行の「…」')
    await more.click()
    await page.getByTestId(listTestIds.rowMenu('favorite')).getByRole('menuitem', { name: '予定にする' }).click()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await page.getByTestId('item-title').fill('近所のパン屋に寄る')
    const before = await page.evaluate(() => Object.keys(window.__ds.getData().items).length)
    await edgeFlick(page, 'left')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '書きかけを捨てますか？' })).toHaveCount(0)
    expect(await page.evaluate(() => Object.keys(window.__ds.getData().items).length)).toBe(before)
  })
})

// ---------- Android（Pixel 7。ブラウザのタブと、ホーム画面のアプリ） ----------
test.describe('S3 Android の［戻る］で開いているリストを畳む（Pixel 7 のタブ。■34・■22）', { tag: ['@s'] }, () => {
  test('Task List を見ている時の［戻る］は、聞かずに Task List を畳み、打ちかけを捨てる（履歴の形は同じ）。次の［戻る］は閉じるかを聞く（S3-FRAME-008・017）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    const length = await historyLength(page)
    const shape = await historyShape(page)
    await showList(page, 'task')
    await listInput(page, 'task').click()
    await page.keyboard.type('見積もり')
    await draftStored(page, 'task', '見積もり')
    await goBack(page)
    await expectCollapsed(page, 'task', true)
    await expect(closeDialog(page)).toHaveCount(0)
    await expect.poll(() => storedDraft(page, 'task')).toBeNull()
    expect(await historyLength(page)).toBe(length)
    expect(await historyShape(page)).toEqual(shape)
    expect(await hashOf(page)).toBe(MONTH)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    await expect(closeDialog(page)).toHaveCount(0)
    expect(await historyLength(page)).toBe(length)
  })

  test('ページの終わりで［戻る］で畳んでも、ページの位置と見出しの所は上へ跳ばない（■34）', async ({ page }) => {
    await openLists(page, MONTH)
    await foldAtPageEnd(page, () => goBack(page))
    await expect(closeDialog(page)).toHaveCount(0)
  })

  test('カレンダーを見ている時の［戻る］は、開いているリストが下にあっても今までどおり閉じるかを聞く（リストは開いたまま）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await showList(page, 'routine')
    await page.getByTestId('top-jump-calendar').click()
    await scrollSettled(page)
    await expect(page.getByTestId('top-jump-calendar')).toHaveAttribute('aria-current', 'true')
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await expectCollapsed(page, 'routine', false)
    await page.getByTestId('app-close-cancel').click()
  })

  test('リストの［詳しく］を開いている時の［戻る］は、それだけを閉じ（1つ戻る）、次の［戻る］でリストを畳む（S3-TASK-238）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    const length = await historyLength(page)
    await showList(page, 'task')
    await openDetailFromRow(page, 'task', LIST_IDS.roomBooking)
    await goBack(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await expectCollapsed(page, 'task', false)
    await goBack(page)
    await expectCollapsed(page, 'task', true)
    await expect(closeDialog(page)).toHaveCount(0)
    expect(await historyLength(page)).toBe(length)
  })
})

test.describe(
  'S3 ホーム画面から開いた Android のアプリの［戻る］（Pixel 7 の表示の形を standalone に。■25・■34）',
  { tag: ['@s'] },
  () => {
    /** ホーム画面から開いた時と同じく、タブの履歴をアプリの分だけにして（表示の形は standalone）作り物のデータで開き、指で押して印を作る */
    async function openStandalone(page: Page, baseURL: string | undefined) {
      await page.clock.setFixedTime(new Date(E2E_NOW))
      await page.addInitScript(() => {
        localStorage.setItem('diary-studio:test-auth', '1')
        const match = window.matchMedia.bind(window)
        window.matchMedia = (query: string) => match(query.replace(/\(\s*display-mode\s*:\s*standalone\s*\)/g, 'all'))
      })
      await page.evaluate((u) => location.replace(u), new URL(`/#${MONTH}`, baseURL).href)
      await page.waitForFunction(() => Boolean(window.__ds))
      await expect(page.getByTestId('top-page')).toBeVisible()
      await seedData(page, listData())
      await armHistory(page, { finger: true })
      expect(await historyShape(page)).toMatchObject({ source: 'os-back', exit: 'press-again' })
    }

    test('Task List を見ている時の［戻る］は畳むだけで「もう一度［戻る］を押すと閉じます」を出さない（構えない）。次の［戻る］で出す', async ({
      page,
      baseURL,
    }) => {
      await openStandalone(page, baseURL)
      const length = await historyLength(page)
      await page.getByTestId('top-jump-task').tap()
      await expectCollapsed(page, 'task', false)
      await afterFold(page)
      await scrollSettled(page)
      await expect(page.getByTestId('top-jump-task')).toHaveAttribute('aria-current', 'true')
      await historySettled(page)
      await goBack(page)
      await expectCollapsed(page, 'task', true)
      await expect(armedToast(page)).toHaveCount(0)
      expect(await historyShape(page)).toMatchObject({ exitArmed: false })
      expect(await historyLength(page)).toBe(length)
      await goBack(page)
      await expect(armedToast(page)).toBeVisible()
      await expect.poll(async () => (await historyShape(page))?.exitArmed).toBe(true)
      await expect(closeDialog(page)).toHaveCount(0)
    })
  },
)

// ---------- M（タブレットの縦向き。768×1024・指） ----------
test.describe('S3 M の積んだ所の［戻る］（タブレット。■34）', { tag: ['@m'] }, () => {
  test('ページの終わりで［戻る］で畳んでも、ページの位置と見出しの所は上へ跳ばない。次の［戻る］は閉じるかを聞く', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'M')
    await foldAtPageEnd(page, () => goBack(page))
    await expect(closeDialog(page)).toHaveCount(0)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
  })
})

// ---------- PC（Desktop Chrome） ----------
test.describe('S3 PC のブラウザの戻る・進む（M の幅の積んだ所。■34）', { tag: ['@pc'] }, () => {
  test('M の幅で Task List を見ている時、「進む」は何もせず（開いたまま）、「戻る」で畳み、次の「戻る」で閉じるかを聞く（S3-FRAME-008・009）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await openLists(page, MONTH)
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'M')
    const length = await historyLength(page)
    await showList(page, 'task')
    await goForward(page)
    await expectCollapsed(page, 'task', false)
    await expect(closeDialog(page)).toHaveCount(0)
    await goBack(page)
    await expectCollapsed(page, 'task', true)
    await expect(closeDialog(page)).toHaveCount(0)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    expect(await historyLength(page)).toBe(length)
  })

  test('L は開いているリストが無い（右の列はいつも出ている）: 「戻る」は今までどおり閉じるかを聞き、右の列のリストは畳まない（S3-FRAME-010）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await goBack(page)
    await expect(closeDialog(page)).toBeVisible()
    await page.getByTestId('app-close-cancel').click()
    for (const list of ['routine', 'task', 'favorite'] as const) await expectCollapsed(page, list, false)
  })
})

test.describe('S3 L の右の列の上のパネル（3.6・3.8。PC）', { tag: ['@pc'] }, () => {
  /** パネルが右の列と同じ所・大きさ（幅 300px）にある */
  /** 出る動き（パネルは右から 180ms・シートは下から）が終わるまで */
  const shown = (page: Page) =>
    page.getByTestId('item-sheet').evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)))

  async function overSideColumn(page: Page) {
    // 幅を替えた直後は、L の形に描き直して出る動きが始まるまでに少しかかる（その前に終わりを待つと、動いている途中を測る）ので、
    // 揃うまで読み直す
    await expect(async () => {
      await shown(page)
      const panel = await page.getByTestId('item-sheet').boundingBox()
      const column = await page.getByTestId('side-column').boundingBox()
      if (!panel || !column) throw new Error('パネル・右の列が見えていません')
      expect(Math.round(panel.width)).toBe(300)
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(panel[k] - column[k]), k).toBeLessThanOrEqual(1)
    }).toPass({ timeout: 5000 })
  }

  test('「…」の［詳しく］で「タスク」のパネルが右の列の上に出て（履歴に1つ）、Esc・［×］・ブラウザの戻るで閉じる。「進む」で開き直さない（S3-FRAME-075・103・TASK-140・148・150）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    const length = await historyLength(page)
    const base = (await historyShape(page))?.base
    await openDetailFromRow(page, 'task', LIST_IDS.quoteReply)
    await overSideColumn(page)
    await expect(page.getByTestId('item-sheet').getByRole('heading')).toHaveText('タスク')
    // 土台の後ろに1つ積む（「進む」の印の代わりなので、タブの履歴の数は同じ）
    expect(await historyShape(page)).toMatchObject({ base, cur: (base ?? 0) + 1, shownIdx: (base ?? 0) + 1 })
    expect(await historyLength(page)).toBe(length)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await historySettled(page)
    await openDetailFromRow(page, 'task', LIST_IDS.quoteReply)
    await page.getByTestId('modal-close').click()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await historySettled(page)
    await openDetailFromRow(page, 'task', LIST_IDS.quoteReply)
    await goBack(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await goForward(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await expect(closeDialog(page)).toHaveCount(0)
  })

  test('パネルの外（カレンダーのマス）を押したまま少し置いて離すと閉じ、押した所の下の物は押されない（S3-FRAME-104）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await openDetailFromRow(page, 'task', LIST_IDS.quoteReply)
    const cell = await page.getByTestId('month-cell-2026-11-18').boundingBox()
    if (!cell) throw new Error('マンスリーのマスが見えていません')
    await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(300)
    await page.mouse.up()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await page.waitForTimeout(300)
    await historySettled(page)
    expect(await hashOf(page)).toBe(MONTH)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
  })

  test('開いたまま読み込み直すと同じパネルで開き直し、幅を S にすると閉じずに下からのシートになる（S3-FRAME-019・106・TASK-149・151）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await openDetailFromRow(page, 'task', LIST_IDS.quoteReply)
    await page.reload()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await expect(page.getByTestId('item-sheet').getByRole('heading')).toHaveText('タスク')
    await overSideColumn(page)
    await page.setViewportSize({ width: 412, height: 860 })
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'S')
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await shown(page)
    const sheet = await page.getByTestId('item-sheet').boundingBox()
    if (!sheet) throw new Error('シートが見えていません')
    expect(Math.round(sheet.x)).toBe(0)
    expect(Math.round(sheet.width)).toBe(412)
    expect(Math.abs(sheet.y + sheet.height - 860)).toBeLessThanOrEqual(1)
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'L')
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await overSideColumn(page)
  })

  test('L の MIM（#/mim）の横の右の列から開いたパネルも右の列の上に出て、閉じると MIM へ戻る（S3-FRAME-041）', async ({
    page,
  }) => {
    await openLists(page, MONTH)
    await page.getByTestId('open-mim').click()
    await expect.poll(() => hashOf(page)).toBe('/mim')
    await historySettled(page)
    await openDetailFromRow(page, 'task', LIST_IDS.quoteReply)
    await overSideColumn(page)
    await goBack(page)
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    expect(await hashOf(page)).toBe('/mim')
  })
})
