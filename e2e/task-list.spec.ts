// 段階3 Task List（docs/SPEC.md の 13.・6.3・6.4・12.1・12.5・12.8・3.1・3.6・4.3）の E2E。
// - @pc: 入力欄とチップで4通りを足す → 並び → ウィークリー・マンスリーの出方（〆・数・①④は出ない）→ 両方向の連動（件名・完了・
//   カレンダーの詳細で直した件名）→［日付を決める］・日付のメニューの「なし」・［Task List から外す］・［カレンダーで見る］（履歴は
//   増えない）→ 削除（12.8）。作り物のデータの日付の列（期限切れ・今日・168時間で隠す）。「タスク」の詳細。変換中の［足す］。
//   すばやく足すを開いたまま右の列を押す（すばやく足すの決まりのまま足して閉じ、リストの操作もそのまま効く。12.1）
// - @s: 2行の行の上の行、「…」の［日付…］、書きかけ（字とチップ）が読み込み直しても残る、足してもページを動かさず入力欄が見えたまま、
//   長押ししても行は持ち上がらずメニューも出ない、360px で横にはみ出さない
// - @m: 2行の行・押せる所の大きさ・横にはみ出さない
// データは作り物だけ（e2e/fixtures/listData.ts と、ここで足す物）
import { expect, test, type Page } from '@playwright/test'
import { testIds } from '../src/features/calendar/common/testIds'
import { taskTestIds } from '../src/features/lists/task/taskTestIds'
import { LIST_IDS } from './fixtures/listData'
import {
  collectDiagnosticsOnFailure,
  E2E_NOW,
  historyCalls,
  historyGrowth,
  noHorizontalScroll,
  spyHistory,
  startLongPress,
  tapSize,
} from './helpers'
import { listAdd, listInput, listTestIds, openLists, openRowMenu, openStackedList, storedDraft } from './listHelpers'

collectDiagnosticsOnFailure()

const row = (page: Page, id: string) => page.getByTestId(listTestIds.row('task', id))
const rowTitle = (page: Page, id: string) => page.getByTestId(listTestIds.rowTitle('task', id))
const itemByTitle = (page: Page, title: string) =>
  page.evaluate((t) => Object.values(window.__ds.getData().items).find((it) => it.title === t) ?? null, title)
/** まだの行の id（上から） */
const openRowIds = (page: Page) =>
  page
    .locator('[data-testid^="list-task-row-"]:not([data-done="true"])')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid?.replace('list-task-row-', '')))

/** 入力欄の下のチップのメニューから選ぶ */
async function chip(page: Page, which: 'start' | 'due', label: string) {
  await page.getByTestId(listTestIds.taskChip(which)).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

/** 件名を打って Enter で足し、足した物の id */
async function addTask(page: Page, title: string): Promise<string> {
  const input = listInput(page, 'task')
  await input.click()
  await input.fill(title)
  await input.press('Enter')
  await expect(input).toHaveValue('')
  const it = await itemByTitle(page, title)
  expect(it, title).not.toBeNull()
  return it?.id ?? ''
}

test.describe('S3 Task List（13.・6.3。PC）', { tag: ['@pc'] }, () => {
  test('4通りを入力欄とチップで足す → 並び → ウィークリー・マンスリーの出方 → 連動（件名・完了・カレンダーの詳細）（S3-TASK-008〜012・110・170〜172・S3-FRAME-129）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08', { lists: false })
    // ① 日付なし（時計は止めてあるので、足すたびに 1分進めて「新しい順」を見分けられるようにする）
    let minute = 0
    const tick = () => page.clock.setFixedTime(Date.parse(E2E_NOW) + ++minute * 60_000)
    const none = await addTask(page, '資料を印刷する')
    await tick()
    // ② 締め切り日だけ（明日 11/11）
    await chip(page, 'due', '明日')
    await expect(page.getByTestId(listTestIds.taskChip('due'))).toHaveText('〆 11/11')
    const due = await addTask(page, '見積もりの返事')
    await tick()
    // ③ 開始日（今日）と締め切り日（今週金曜 11/13）
    await chip(page, 'start', '今日')
    await chip(page, 'due', '今週金曜')
    const span = await addTask(page, '会議室の予約')
    await tick()
    // ④ 開始日だけ（明日）
    await chip(page, 'start', '明日')
    const start = await addTask(page, '本を返す')
    // 足すとチップは空に戻り、フォーカスは入力欄に残る
    await expect(page.getByTestId(listTestIds.taskChip('start'))).toHaveText('開始日')
    await expect(listInput(page, 'task')).toBeFocused()
    await expect(page.locator('.toast')).toHaveCount(0)
    // 並び: カレンダーに出ている物を to の近い順、その下に①④を新しい順
    expect(await openRowIds(page)).toEqual([due, span, start, none])
    await expect(page.getByTestId(listTestIds.taskDate(span))).toHaveText('11/10〜11/13')
    await expect(page.getByTestId(listTestIds.taskDate(start))).toHaveText('11/11〜')
    await expect(page.getByTestId(listTestIds.taskDate(none))).toHaveText('—')
    // ウィークリー: ②は〆付きのカード、③は〆付きの複数日の始め（11/10〜11/13）、①④は出ない
    await expect(page.getByTestId(testIds.weekCard(due)).locator('[data-mark="due"]')).toHaveText('〆')
    await expect(page.getByTestId(testIds.weekStart(span)).locator('[data-mark="due"]')).toHaveText('〆')
    for (const id of [none, start]) {
      await expect(page.getByTestId(testIds.weekCard(id))).toHaveCount(0)
      await expect(page.getByTestId(testIds.weekStart(id))).toHaveCount(0)
    }
    // 連動: Task List で件名を直すとカードの件名も、チェックするとカードが完了の見た目
    await rowTitle(page, due).click()
    const edit = page.getByTestId(listTestIds.rowEdit('task', due))
    await expect(edit).toBeFocused()
    await edit.fill('見積もりの返事を出す')
    await edit.press('Enter')
    await expect(page.getByTestId(testIds.weekCard(due))).toContainText('見積もりの返事を出す')
    await page.getByTestId(listTestIds.rowCheck('task', due)).click()
    await expect(page.getByTestId(testIds.weekCard(due))).toHaveClass(/is-done/)
    await expect(row(page, due)).toHaveCount(0)
    await expect(page.getByTestId(listTestIds.done('task'))).toContainText('済み 1件')
    // カレンダーの詳細で直した件名が Task List に出る
    await page.getByTestId(testIds.weekStart(span)).locator('.wk-open').click()
    const title = page.getByTestId(testIds.itemTitle)
    await expect(title).toBeVisible()
    await title.fill('会議室の予約を見直す')
    await title.press('Enter')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
    await expect(rowTitle(page, span)).toHaveText('会議室の予約を見直す')
    // マンスリー: ③は期間の毎日に数え、①④は数えない。Task List でチェックすると数が減る
    await page.getByTestId(testIds.calMode('month')).click()
    await expect(page.getByTestId(testIds.monthCount('2026-11-12', 'work'))).toHaveText('1')
    await page.getByTestId(listTestIds.rowCheck('task', span)).click()
    await expect(page.getByTestId(testIds.monthCount('2026-11-12', 'work'))).toHaveCount(0)
  })

  test('［日付を決める］・日付のメニューの「なし」・［Task List から外す］・［カレンダーで見る］（履歴は増えない）（S3-TASK-121・122・129・131・S3-FRAME-029）', async ({
    page,
  }) => {
    await spyHistory(page)
    await openLists(page, '/week/2026-11-08')
    const { printDocs, quoteReply, roomBooking } = LIST_IDS
    // ［日付を決める］: ①の締め切り日を 11/12 にするとカレンダーに出る
    await openRowMenu(page, 'task', printDocs)
    await page.getByRole('menuitem', { name: '日付を決める' }).click()
    await page
      .getByTestId('item-date-picker')
      .getByRole('button', { name: /11月12日/ })
      .click()
    await expect(page.getByTestId(listTestIds.taskDate(printDocs))).toHaveText('11/12')
    await expect(page.getByTestId(testIds.weekCard(printDocs))).toBeVisible()
    // 日付のメニューの「なし」: ②はカレンダーから外れて Task List に残る
    await page.getByTestId(listTestIds.taskDate(quoteReply)).click()
    await expect(page.getByTestId(listTestIds.taskDateMenu)).toBeVisible()
    await page.getByRole('menuitem', { name: '締め切り日を消す' }).click()
    await expect(page.getByTestId(testIds.weekCard(quoteReply))).toHaveCount(0)
    await expect(page.getByTestId(listTestIds.taskDate(quoteReply))).toHaveText('—')
    // ［Task List から外す］: ③は行が消え、カードは残る
    await openRowMenu(page, 'task', roomBooking)
    await page.getByRole('menuitem', { name: 'Task List から外す' }).click()
    await expect(row(page, roomBooking)).toHaveCount(0)
    await expect(page.getByTestId(testIds.weekStart(roomBooking))).toBeVisible()
    // ［カレンダーで見る］: to の日のデイリーへ、履歴を置き換えて移る（積まない）
    const before = await historyGrowth(page)
    const calls = (await historyCalls(page)).length
    await page.getByTestId(listTestIds.taskDate(printDocs)).click()
    await page.getByRole('menuitem', { name: 'カレンダーで見る' }).click()
    await expect(page).toHaveURL(/#\/day\/2026-11-12$/)
    await expect(page.getByTestId(testIds.view('day'))).toBeVisible()
    expect(await historyGrowth(page)).toBe(before)
    expect((await historyCalls(page)).slice(calls)).not.toContain('pushState')
  })

  test('削除: カレンダーに出ていない物は確かめずに消して［元に戻す］で戻る。出ている物は確かめてから消し、お知らせは出さない（12.8・S3-TASK-123〜127）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    const { libraryBooks, quoteReply } = LIST_IDS
    await openRowMenu(page, 'task', libraryBooks)
    await page.getByRole('menuitem', { name: '削除' }).click()
    await expect(row(page, libraryBooks)).toHaveCount(0)
    const toast = page.locator('.toast').filter({ hasText: '『図書館の本を返す』を削除しました' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: '元に戻す' }).click()
    await expect(row(page, libraryBooks)).toBeVisible()
    // カレンダーに出ている物
    await openRowMenu(page, 'task', quoteReply)
    await page.getByRole('menuitem', { name: '削除' }).click()
    const dialog = page.getByRole('dialog', { name: '『見積もりの返事』を削除しますか？' })
    await expect(dialog).toContainText('Task List からも消えます。')
    await dialog.getByRole('button', { name: '削除' }).click()
    await expect(row(page, quoteReply)).toHaveCount(0)
    await expect(page.getByTestId(testIds.weekCard(quoteReply))).toHaveCount(0)
    await expect(page.locator('.toast').filter({ hasText: '見積もりの返事' })).toHaveCount(0)
  })

  test('作り物のデータ: 日付の列（期限切れは --overdue・今日は太字）、済んで 168時間を過ぎた物は出さない、［詳しく］は「タスク」の題（S3-TASK-013・078・141）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    const { invoiceCheck, tonerOrder, oldPapers, shelfTidy, dentist } = LIST_IDS
    const overdue = await page
      .getByTestId(listTestIds.taskDate(invoiceCheck))
      .locator('.task-date-main')
      .evaluate((e) => getComputedStyle(e).color)
    const plain = await page
      .getByTestId(listTestIds.taskDate(LIST_IDS.quoteReply))
      .locator('.task-date-main')
      .evaluate((e) => getComputedStyle(e).color)
    expect(overdue).not.toBe(plain)
    expect(
      await page
        .getByTestId(listTestIds.taskDate(tonerOrder))
        .locator('.task-date-main')
        .evaluate((e) => getComputedStyle(e).fontWeight),
    ).toBe('600')
    // 済み: 2日前の物は出て、8日前の物は出ない
    await page.getByTestId(listTestIds.done('task')).getByRole('button').click()
    await expect(row(page, shelfTidy)).toBeVisible()
    await expect(row(page, oldPapers)).toHaveCount(0)
    // カレンダー生まれの物の［詳しく］も「タスク」の題
    await openRowMenu(page, 'task', dentist)
    await page.getByRole('menuitem', { name: '詳しく' }).click()
    await expect(page.getByRole('dialog', { name: 'タスク' })).toBeVisible()
  })

  test('依頼者: 入力欄の下の［依頼者］は候補付きの小さな欄、行の依頼者はその場で直す（S3-TASK-060・081・133）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await page.getByTestId(listTestIds.taskChip('requester')).click()
    const req = page.getByTestId(taskTestIds.chipRequesterInput)
    await expect(req).toBeFocused()
    await req.fill('営')
    await page.getByRole('option', { name: '営業部' }).click()
    await expect(page.getByTestId(listTestIds.taskChip('requester'))).toHaveText('営業部')
    await expect(listInput(page, 'task')).toBeFocused()
    const id = await addTask(page, '契約書の控え')
    await expect(page.getByTestId(listTestIds.taskRequester(id))).toHaveText('営業部')
    // 行の依頼者をその場で直す（空にすると列を詰める）
    await page.getByTestId(listTestIds.taskRequester(id)).click()
    const edit = page.getByTestId(taskTestIds.requesterEdit(id))
    await expect(edit).toBeFocused()
    await edit.fill('')
    await edit.press('Enter')
    await expect(page.getByTestId(listTestIds.taskRequester(id))).toHaveCount(0)
    expect((await itemByTitle(page, '契約書の控え'))?.requester).toBe('')
  })

  test('変換中に［足す］を押しても、変換を決めて1回だけ足す（12.1・S3-TASK-038）', async ({ page }) => {
    await openLists(page, '/week/2026-11-08', { lists: false })
    const input = listInput(page, 'task')
    await input.click()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'みつもり', selectionStart: 4, selectionEnd: 4 })
    await listAdd(page, 'task').click()
    await expect(input).toHaveValue('')
    await expect
      .poll(() => page.evaluate(() => Object.values(window.__ds.getData().items).map((it) => it.title)))
      .toEqual(['みつもり'])
    await expect(input).toBeFocused()
    await cdp.detach()
  })

  test('すばやく足すを開いたまま右の列を押しても、すばやく足すの決まりのまま足して閉じ、Task List の操作もそのまま効く（12.1・P19）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08', { lists: false })
    // Task List の入力欄に字を置いておく
    await listInput(page, 'task').fill('資料をそろえる')
    // ウィークリーのすばやく足すを開いて打つ
    await page.locator('[data-tier="work"] .wk-cell[data-date="2026-11-12"]').hover()
    await page.getByTestId(testIds.weekAdd('2026-11-12', 'work')).click()
    const quick = page.getByTestId(testIds.quickAddInput)
    await expect(quick).toBeFocused()
    await quick.fill('電話をかける')
    // 右の列の［足す］を押す: すばやく足すは足して閉じ、Task List にも足す
    await listAdd(page, 'task').click()
    await expect(quick).toHaveCount(0)
    await expect.poll(async () => (await itemByTitle(page, '電話をかける'))?.origin).toBe('calendar')
    await expect.poll(async () => (await itemByTitle(page, '資料をそろえる'))?.origin).toBe('list')
    await expect(listInput(page, 'task')).toHaveValue('')
    // もう一度開いて、今度は Task List の入力欄を押して打つ: すばやく足すは足して閉じ、Task List の欄で打てる
    await page.locator('[data-tier="work"] .wk-cell[data-date="2026-11-12"]').hover()
    await page.getByTestId(testIds.weekAdd('2026-11-12', 'work')).click()
    await page.getByTestId(testIds.quickAddInput).fill('会議の準備')
    await listInput(page, 'task').click()
    await expect(page.getByTestId(testIds.quickAddInput)).toHaveCount(0)
    await expect.poll(async () => (await itemByTitle(page, '会議の準備'))?.origin).toBe('calendar')
    await expect(listInput(page, 'task')).toBeFocused()
    await page.keyboard.type('名刺を頼む')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await itemByTitle(page, '名刺を頼む'))?.origin).toBe('list')
  })
})

test.describe('S3 Task List（M・S の2行の行。スマホ）', { tag: ['@s'] }, () => {
  test('上の行（〆・依頼者・期間・④）と、「…」の［日付…］から日付のメニュー（S3-TASK-090）', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'task')
    const line = (id: string) => page.getByTestId(listTestIds.taskLine(id))
    await expect(line(LIST_IDS.quoteReply)).toHaveText('〆11/11・営業部')
    await expect(line(LIST_IDS.roomBooking)).toHaveText('11/10〜11/13・総務')
    await expect(line(LIST_IDS.libraryBooks)).toHaveText('11/12〜')
    await expect(line(LIST_IDS.dentist)).toHaveText('11/12')
    await expect(line(LIST_IDS.printDocs)).toHaveCount(0)
    await expect(page.getByTestId(listTestIds.taskDate(LIST_IDS.quoteReply))).toHaveCount(0)
    // 日付のメニューは「…」の［日付…］から
    await openRowMenu(page, 'task', LIST_IDS.printDocs)
    await page.getByRole('menuitem', { name: '日付を直す' }).click()
    await expect(page.getByTestId(listTestIds.taskDateMenu)).toBeVisible()
    await page.getByRole('menuitem', { name: '締め切り日を明日にする' }).click()
    await expect(line(LIST_IDS.printDocs)).toHaveText('〆11/11')
  })

  test('件名を押せる所は、上の行（〆11/11・営業部）を含む真ん中の欄の全部（高さ 40px 以上。4.11）。上の行を押しても件名をその場で直し始める', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'task')
    const id = LIST_IDS.quoteReply
    const title = rowTitle(page, id)
    // 真ん中の欄の上の端の近く・下の端の近く・上の行の真ん中は、どれも件名のボタン
    const hits = await row(page, id)
      .locator('.task-main')
      .evaluate(
        (main, titleId) => {
          const r = main.getBoundingClientRect()
          const line = main.querySelector('.task-line')!.getBoundingClientRect()
          const at = (x: number, y: number) =>
            document.elementFromPoint(x, y)?.closest('button')?.getAttribute('data-testid') === titleId
          const x = r.left + r.width / 2
          return {
            height: r.height,
            top: at(x, r.top + 2),
            bottom: at(x, r.bottom - 2),
            line: at(line.left + 4, line.top + line.height / 2),
          }
        },
        listTestIds.rowTitle('task', id),
      )
    expect(hits.height).toBeGreaterThanOrEqual(40)
    expect(hits).toMatchObject({ top: true, bottom: true, line: true })
    // 上の行の字の所を指で押す（上の行の上には件名の押せる所が重なっているので、要素ではなく位置を押す）
    const line = await page.getByTestId(listTestIds.taskLine(id)).boundingBox()
    if (!line) throw new Error('上の行が見えていません')
    await page.touchscreen.tap(line.x + 4, line.y + line.height / 2)
    await expect(page.getByTestId(listTestIds.rowEdit('task', id))).toBeFocused()
    await expect(title).toHaveCount(0)
  })

  test('書きかけ（字とチップ）は読み込み直しても残る。足してもページを動かさず、入力欄は見えたまま（S3-TASK-042）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'task')
    const input = listInput(page, 'task')
    await input.click()
    await input.fill('名刺を頼む')
    await chip(page, 'due', '明日')
    await expect.poll(() => storedDraft(page, 'task')).toContain('名刺を頼む')
    await page.reload()
    await expect(page.getByTestId('top-page')).toBeVisible()
    await openStackedList(page, 'task')
    await expect(listInput(page, 'task')).toHaveValue('名刺を頼む')
    await expect(page.getByTestId(listTestIds.taskChip('due'))).toHaveText('〆 11/11')
    // 足す（［足す］）: ページの位置は動かず、入力欄は見えたままで、フォーカスも残る
    await listInput(page, 'task').click()
    const y = await page.evaluate(() => window.scrollY)
    await listAdd(page, 'task').click()
    await expect(listInput(page, 'task')).toHaveValue('')
    await expect(listInput(page, 'task')).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(y)
    await expect(listInput(page, 'task')).toBeInViewport()
    const added = await itemByTitle(page, '名刺を頼む')
    expect(added).toMatchObject({ due: '2026-11-11', origin: 'list' })
  })

  test('行を長押ししても持ち上がらず、メニューも出ない（行の長押しのメニューは無い。ドラッグは L のマウスだけ）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'task')
    const target = row(page, LIST_IDS.printDocs).locator('.task-main')
    const press = await startLongPress(page, target, { holdMs: 700 })
    expect(await page.locator('[data-dnd-dragging]').count()).toBe(0)
    await press.drop()
    await expect(page.getByTestId(listTestIds.rowMenu('task'))).toHaveCount(0)
    await expect(page.getByTestId('popup-menu')).toHaveCount(0)
    expect(await page.locator('[data-dnd-dragging]').count()).toBe(0)
  })

  test('360px: チップを全部決めても横にはみ出さない（S3-TASK-094）', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 760 })
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'task')
    await chip(page, 'start', '今日')
    await chip(page, 'due', '今週金曜')
    await page.getByTestId(listTestIds.taskChip('requester')).click()
    await page.getByTestId(taskTestIds.chipRequesterInput).fill('営業部の担当の人')
    await page.getByTestId(taskTestIds.chipRequesterInput).press('Enter')
    await expect(page.getByTestId(listTestIds.taskChip('requester'))).toHaveText('営業部の担当の人')
    await noHorizontalScroll(page)
  })
})

test.describe('S3 Task List（M。タブレット）', { tag: ['@m'] }, () => {
  test('2行の行で、区分の印・チェック・「…」・チップの［×］は 34px 以上。横にはみ出さない（4.11・S3-TASK-064・093）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'task')
    const id = LIST_IDS.quoteReply
    await expect(row(page, id)).toHaveClass(/is-stacked/)
    await tapSize(page.getByTestId(listTestIds.taskKind(id)), '区分の印')
    await tapSize(page.getByTestId(listTestIds.rowCheck('task', id)), 'チェック')
    await tapSize(page.getByTestId(listTestIds.rowMore('task', id)), '「…」')
    await chip(page, 'due', '明日')
    await tapSize(page.getByTestId(taskTestIds.chipClear('due')), 'チップの［×］')
    await tapSize(page.getByTestId(listTestIds.taskChip('due')), 'チップ', false)
    await noHorizontalScroll(page)
  })
})
