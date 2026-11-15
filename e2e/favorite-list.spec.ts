// 段階3の Favorite List の E2E（docs/SPEC.md の 15.・3.6・3.8・6.15・12.2・3.1）: PC は Enter で足す・Shift+Enter で改行、リンクは
// 新しいタブで開き押しても直さない、3行を超えた物だけ「続き」、済み → 「済み n件」→［済みを片付ける］→［元に戻す］、
// ［Task List へ移す］と［元に戻す］、［予定にする］の登録の画面（件名・メモ・今日で開き、履歴に1つ積む。何も直さずに戻ると聞かずに
// 閉じ、直してから戻ると「書きかけを捨てますか？」）、自動で伸びる欄は6行ほどで中でスクロール。スマホは Enter が改行で［足す］で
// 足し、書きかけは読み込み直しても残り、360px でもはみ出さない。データは作り物（e2e/fixtures/listData.ts）
import { expect, test, type Page } from '@playwright/test'
import { LIST_IDS } from './fixtures/listData'
import { goBack, historySettled, historyShape, noHorizontalScroll, tapSize } from './helpers'
import { listAdd, listInput, listTestIds, openLists, openStackedList, storedDraft } from './listHelpers'

const I = LIST_IDS
const row = (page: Page, id: string) => page.getByTestId(listTestIds.row('favorite', id))
const title = (page: Page, id: string) => page.getByTestId(listTestIds.rowTitle('favorite', id))
/** 並んだ行の中身（「済み n件」を開いていれば済んだ行も） */
const texts = (page: Page) => page.getByTestId(listTestIds.body('favorite')).locator('[data-testid^="list-favorite-title-"]')
/** 表示用のデータのやりたいこと・予定 */
const favoriteText = (page: Page, id: string) => page.evaluate((i) => window.__ds.getData().favorites[i]?.text ?? null, id)
const itemByTitle = (page: Page, t: string) =>
  page.evaluate((x) => Object.values(window.__ds.getData().items).find((it) => it.title === x) ?? null, t)
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text })
async function menuItem(page: Page, id: string, name: string): Promise<void> {
  await row(page, id).hover()
  await page.getByTestId(listTestIds.rowMore('favorite', id)).click()
  await page.getByTestId(listTestIds.rowMenu('favorite')).getByRole('menuitem', { name }).click()
}

test.describe('S3 Favorite List（PC。15.・3.6。S3-FRAME-272〜288・S3-ROUTINE-176〜195・S3-TASK-260）', { tag: '@pc' }, () => {
  test('Enter でいちばん上に足し、Shift+Enter は改行。足すと欄と書きかけは空になり、フォーカスは欄に残る', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    const input = listInput(page, 'favorite')
    await input.click()
    await input.pressSequentially('帽子を買う')
    await input.press('Shift+Enter')
    await input.pressSequentially('黒い物')
    await expect.poll(() => storedDraft(page, 'favorite')).toBe('帽子を買う\n黒い物')
    await input.press('Enter')
    await expect(texts(page).first()).toHaveText('帽子を買う\n黒い物')
    await expect(texts(page).first().locator('.fv-first')).toHaveText('帽子を買う')
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await expect.poll(() => storedDraft(page, 'favorite')).toBeNull()
  })

  test('URL は新しいタブで開くリンク（rel="noopener noreferrer"）。押しても直し始めない', async ({ page, context }) => {
    await openLists(page, '/week/2026-11-08')
    const link = title(page, I.article).getByRole('link', { name: 'https://example.com/article' })
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // 外へはつながないので、開いたタブには空のページを返す（開いた所と、元の画面を辿れないことだけを見る）
    await context.route('https://example.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>ok</p>' }))
    const popup = page.waitForEvent('popup')
    await link.click()
    const tab = await popup
    await tab.waitForLoadState()
    expect(tab.url()).toBe('https://example.com/article')
    expect(await tab.evaluate(() => window.opener)).toBeNull()
    await tab.close()
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', I.article))).toHaveCount(0)
    expect(await page.evaluate(() => location.hash)).toBe('#/week/2026-11-08')
  })

  test('3行を超える物だけ「続き」（折り返しも数える）。押すと全部見せる', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await expect(page.getByTestId(listTestIds.favoriteMore(I.trips))).toBeVisible()
    await expect(page.getByTestId(listTestIds.favoriteMore(I.recipes))).toBeVisible()
    await expect(page.getByTestId(listTestIds.favoriteMore(I.bakery))).toHaveCount(0)
    await expect(page.getByTestId(listTestIds.favoriteMore(I.article))).toHaveCount(0)
    const before = (await title(page, I.trips).boundingBox())!.height
    await page.getByTestId(listTestIds.favoriteMore(I.trips)).click()
    await expect(page.getByTestId(listTestIds.favoriteMore(I.trips))).toHaveCount(0)
    expect((await title(page, I.trips).boundingBox())!.height).toBeGreaterThan(before + 40)
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', I.trips))).toHaveCount(0)
  })

  test('済みにすると「済み n件」へ沈み、開くと［済みを片付ける］。押すとまとめてゴミ箱へ、［元に戻す］で戻る', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await page.getByTestId(listTestIds.rowCheck('favorite', I.bakery)).click()
    await expect(row(page, I.bakery)).toHaveCount(0)
    const done = page.getByTestId(listTestIds.done('favorite'))
    await expect(done).toContainText('済み 2件')
    await expect(page.getByTestId(listTestIds.favoriteClearDone)).toHaveCount(0)
    await expect(page.locator('.toast')).toHaveCount(0)
    await done.getByRole('button', { name: /済み 2件/ }).click()
    await expect(row(page, I.bakery)).toHaveAttribute('data-done', 'true')
    await page.getByTestId(listTestIds.favoriteClearDone).click()
    await expect(done).toHaveCount(0)
    await expect.poll(() => favoriteText(page, I.bakery)).toBeNull()
    await toast(page, '済みの 2件をゴミ箱へ移しました').getByRole('button', { name: '元に戻す' }).click()
    await expect(page.getByTestId(listTestIds.done('favorite'))).toContainText('済み 2件')
    await expect.poll(() => favoriteText(page, I.notebook)).toBe('新しいノートを買う')
  })

  test('［Task List へ移す］: 1行目を件名・残りをメモにしたタスクを作り、元の項目はゴミ箱へ。［元に戻す］で両方戻る', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await menuItem(page, I.recipes, 'Task List へ移す')
    await expect(row(page, I.recipes)).toHaveCount(0)
    await expect
      .poll(() => itemByTitle(page, '週末に作りたい料理'))
      .toMatchObject({
        origin: 'list',
        kind: 'work',
        listed: true,
        memo: 'カレー\n親子丼\nポトフ',
      })
    await toast(page, 'Task List へ移しました').getByRole('button', { name: '元に戻す' }).click()
    await expect(row(page, I.recipes)).toBeVisible()
    await expect.poll(() => itemByTitle(page, '週末に作りたい料理')).toBeNull()
  })

  test('［予定にする］: 登録の画面を件名・メモ・今日・仕事で開き（履歴に1つ）、何も直さずに戻ると聞かずに閉じ、直してから戻ると聞く', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    const before = (await historyShape(page))!.cur
    await menuItem(page, I.recipes, '予定にする')
    const sheet = page.getByTestId('item-sheet')
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('item-title')).toHaveValue('週末に作りたい料理')
    await expect(page.getByTestId('item-memo')).toHaveValue('カレー\n親子丼\nポトフ')
    await expect(page.getByTestId('item-kind-work')).toHaveAttribute('aria-pressed', 'true')
    // 開始日は今日（作り物のデータの今日 2026-11-10）
    await expect(page.getByTestId('item-start')).toHaveText('11月10日（火）')
    // 履歴に1つ積む（アプリの履歴の今いる所が1つ進む。「戻る」で閉じる）
    await historySettled(page)
    expect((await historyShape(page))!.cur).toBe(before + 1)
    // 何も直していなければ、戻ると聞かずに閉じる（元の項目は残る）
    await goBack(page)
    await expect(sheet).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '書きかけを捨てますか？' })).toHaveCount(0)
    await expect(row(page, I.recipes)).toBeVisible()
    // 直してから戻ると聞く
    await menuItem(page, I.recipes, '予定にする')
    await page.getByTestId('item-title').fill('料理の日')
    await page.goBack()
    const ask = page.getByRole('dialog', { name: '書きかけを捨てますか？' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: '捨てる' }).click()
    await expect(sheet).toHaveCount(0)
  })

  test('［削除］は確かめずに消し、［元に戻す］で戻る。その場で直すと Enter で保存', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await menuItem(page, I.trips, '削除')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(row(page, I.trips)).toHaveCount(0)
    await toast(page, '『旅行で行きたい所』を削除しました').getByRole('button', { name: '元に戻す' }).click()
    await expect(row(page, I.trips)).toBeVisible()
    await title(page, I.bakery).click()
    const edit = page.getByTestId(listTestIds.rowEdit('favorite', I.bakery))
    await expect(edit).toBeFocused()
    await edit.press('End')
    await edit.pressSequentially('！')
    await edit.press('Enter')
    await expect(edit).toHaveCount(0)
    await expect.poll(() => favoriteText(page, I.bakery)).toBe('近所のパン屋に行ってみる！')
  })

  test('自動で伸びる入力欄は6行ほどで止まり、その先は欄の中でスクロールする（［足す］とカーソルの所が見える）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    const input = listInput(page, 'favorite')
    await input.click()
    await input.fill(Array.from({ length: 12 }, (_, i) => `${i + 1}行目`).join('\n'))
    const size = await input.evaluate((el) => ({
      h: el.getBoundingClientRect().height,
      scroll: el.scrollHeight,
      client: el.clientHeight,
      overflow: getComputedStyle(el).overflowY,
    }))
    expect(size.h).toBeLessThanOrEqual(148)
    expect(size.h).toBeGreaterThan(120)
    expect(size.scroll).toBeGreaterThan(size.client)
    expect(size.overflow).toBe('auto')
    await expect(listAdd(page, 'favorite')).toBeInViewport()
    // 消して1行に戻すと、高さも戻りスクロールの棒も出さない
    await input.fill('1行')
    const small = await input.evaluate((el) => ({
      h: el.getBoundingClientRect().height,
      overflow: getComputedStyle(el).overflowY,
    }))
    expect(small.h).toBeLessThan(48)
    expect(small.overflow).toBe('hidden')
  })
})

test.describe('S3 Favorite List（スマホ。15.1・3.6・4.11。S3-FRAME-273・S3-ROUTINE-176）', { tag: '@s' }, () => {
  test('Enter は改行で足さず、［足す］で足す。足した後も入力欄にフォーカスがあり、画面の中にある', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'favorite')
    const input = listInput(page, 'favorite')
    await input.tap()
    await input.pressSequentially('公園を歩く')
    await input.press('Enter')
    await input.pressSequentially('朝に')
    await expect(input).toHaveValue('公園を歩く\n朝に')
    expect(await page.evaluate(() => Object.keys(window.__ds.getData().favorites).length)).toBe(5)
    await listAdd(page, 'favorite').tap()
    await expect(texts(page).first()).toHaveText('公園を歩く\n朝に')
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await expect(input).toBeInViewport()
  })

  test('書きかけは読み込み直しても残る（diary-studio:draft:favorite）', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'favorite')
    await listInput(page, 'favorite').tap()
    await listInput(page, 'favorite').pressSequentially('あとで調べる')
    await expect.poll(() => storedDraft(page, 'favorite')).toBe('あとで調べる')
    await page.reload()
    await expect(page.getByTestId('top-page')).toBeVisible()
    await openStackedList(page, 'favorite')
    await expect(listInput(page, 'favorite')).toHaveValue('あとで調べる')
  })

  test('360px でも横にはみ出さず、「…」「続き」・点線の丸は指で押せる大きさ。字を押すとすぐ直す欄にフォーカスする', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'favorite')
    await noHorizontalScroll(page)
    await tapSize(page.getByTestId(listTestIds.rowMore('favorite', I.trips)), '「…」')
    await tapSize(page.getByTestId(listTestIds.favoriteMore(I.trips)), '「続き」', false)
    await tapSize(page.getByTestId(listTestIds.rowCheck('favorite', I.trips)), '点線の丸')
    await title(page, I.bakery).tap()
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', I.bakery))).toBeFocused()
    await noHorizontalScroll(page)
  })
})
