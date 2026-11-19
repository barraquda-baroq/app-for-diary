// 段階3の Favorite List の E2E（docs/SPEC.md の 15.・3.6・3.8・6.15・12.2・3.1）: PC は Enter で足す・Shift+Enter で改行、リンクは
// 新しいタブで開き押しても直さない、3行を超えた物だけ「続き」（開くと「畳む」で3行に戻す）、済み → 「済み n件」→［済みを片付ける］→［元に戻す］、
// ［Task List へ移す］と［元に戻す］、［予定にする］の登録の画面（件名・メモ・今日で開き、履歴に1つ積む。何も直さずに戻ると聞かずに
// 閉じ、直してから戻ると「書きかけを捨てますか？」）、自動で伸びる欄は6行ほどで中でスクロール。スマホは Enter が改行で［足す］で
// 足し、書きかけは読み込み直しても残り、360px でもはみ出さない。データは作り物（e2e/fixtures/listData.ts）
import { expect, test, type Page } from '@playwright/test'
import { LIST_IDS, listData, LONG_FAVORITE_ID, longFavorites } from './fixtures/listData'
import { goBack, historySettled, historyShape, noHorizontalScroll, tapSize } from './helpers'
import { listAdd, listInput, listTestIds, openLists, openStackedList, pageScrollStill, storedDraft } from './listHelpers'

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
/** 「続き」「畳む」（同じボタン） */
const more = (page: Page, id: string) => page.getByTestId(listTestIds.favoriteMore(id))

/** 長い物（61行。いちばん上）の id（その下に短い物を30件足した Favorite List は fixtures/listData の longFavorites。長い物を開いて下まで
 * 読み進めてから畳む確かめ。作り物） */
const LONG = LONG_FAVORITE_ID

/** 幅で行の数が替わる物（スマホの幅では3行を超え、M の 700px では3行に収まる。いちばん上。作り物） */
const WIDE = 'list-f-wide-shop'
function wideFavorites(): Pick<ReturnType<typeof listData>, 'favorites'> {
  const base = listData()
  const text =
    '散歩の途中で見つけた小さな古本屋に、もう一度ゆっくり寄ってみたい。店の奥の棚も、二階の画集の棚も、時間をかけて見たい'
  return { favorites: { ...base.favorites, [WIDE]: { ...base.favorites[I.bakery], id: WIDE, text, order: -100 } } }
}

/** 中身の字の行の数（折り返しも数える） */
const lineCount = (page: Page, id: string) =>
  title(page, id)
    .locator('.fv-text')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight)))

/**
 * 「続き」「畳む」の上下の端と、それを入れた所の見える所（PC は右の列 .top-side の中、スマホはヘッダーと切り替えの列の下から画面の
 * 下の端まで。画面の上からの位置）、その所のスクロールの位置
 */
async function toggleEdge(page: Page, id: string, where: 'side' | 'page') {
  return more(page, id).evaluate((el, w) => {
    const r = el.getBoundingClientRect()
    if (w === 'side') {
      const side = document.querySelector('.top-side')!
      const b = side.getBoundingClientRect()
      const lo = b.top + side.clientTop
      return { top: r.top, bottom: r.bottom, lo, hi: lo + side.clientHeight, scroll: side.scrollTop }
    }
    const lo = document.querySelector('[data-testid="top-switcher"]')!.getBoundingClientRect().bottom
    return { top: r.top, bottom: r.bottom, lo, hi: window.innerHeight, scroll: window.scrollY }
  }, where)
}

/** 開いた長い物を下まで読み進めた所（「畳む」の下の端を見える所の下の端の 8px 上に）までスクロールする（なめらかにせず） */
async function readToEnd(page: Page, id: string, where: 'side' | 'page'): Promise<void> {
  const e = await toggleEdge(page, id, where)
  const by = Math.round(e.bottom - (e.hi - 8))
  await page.evaluate(
    ({ w, by }) => {
      if (w === 'side') document.querySelector('.top-side')!.scrollBy({ top: by, behavior: 'instant' })
      else window.scrollBy({ top: by, behavior: 'instant' })
    },
    { w: where, by },
  )
  await expect.poll(async () => (await toggleEdge(page, id, where)).bottom).toBeLessThanOrEqual(e.hi - 7)
  await expect(more(page, id)).toBeInViewport()
}

/** 畳んだ後の「続き」が、見える所の上の端にちょうど見えている（隠れた分だけ送った。次の描画でも動かない） */
async function expectToggleAtTop(page: Page, id: string, where: 'side' | 'page'): Promise<void> {
  const e = await toggleEdge(page, id, where)
  expect(e.top).toBeGreaterThanOrEqual(e.lo - 0.5)
  expect(e.top).toBeLessThanOrEqual(e.lo + 1.5)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  expect((await toggleEdge(page, id, where)).top).toBeCloseTo(e.top, 0)
  await expect(more(page, id)).toBeInViewport()
}

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

  test('3行を超える物だけ「続き」（折り返しも数える）。押すと全部見せて「畳む」に、押すと3行の高さに戻って「続き」（右の列は動かない）', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await expect(more(page, I.trips)).toBeVisible()
    await expect(more(page, I.recipes)).toBeVisible()
    await expect(more(page, I.bakery)).toHaveCount(0)
    await expect(more(page, I.article)).toHaveCount(0)
    await expect(more(page, I.trips)).toHaveText('続き')
    await expect(more(page, I.trips)).toHaveAttribute('aria-expanded', 'false')
    const before = (await title(page, I.trips).boundingBox())!.height
    await more(page, I.trips).click()
    await expect(more(page, I.trips)).toHaveText('畳む')
    await expect(more(page, I.trips)).toHaveAttribute('aria-expanded', 'true')
    expect((await title(page, I.trips).boundingBox())!.height).toBeGreaterThan(before + 40)
    await expect(more(page, I.trips)).toBeFocused()
    const scroll = (await toggleEdge(page, I.trips, 'side')).scroll
    await more(page, I.trips).click()
    await expect(more(page, I.trips)).toHaveText('続き')
    await expect(more(page, I.trips)).toHaveAttribute('aria-expanded', 'false')
    expect((await title(page, I.trips).boundingBox())!.height).toBeCloseTo(before, 0)
    await expect(more(page, I.trips)).toBeFocused()
    // 「続き」が見えたままなら送らない
    expect((await toggleEdge(page, I.trips, 'side')).scroll).toBe(scroll)
    // 押しても直し始めない
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', I.trips))).toHaveCount(0)
  })

  test('長い物を開いて下まで読み進めてから「畳む」と、「続き」が右の列の上に隠れないよう、隠れた分だけすぐ送る', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08', { extra: longFavorites() })
    await more(page, LONG).click()
    await expect(more(page, LONG)).toHaveText('畳む')
    await readToEnd(page, LONG, 'side')
    await more(page, LONG).click()
    await expect(more(page, LONG)).toHaveText('続き')
    await expectToggleAtTop(page, LONG, 'side')
    await expect(more(page, LONG)).toBeFocused()
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', LONG))).toHaveCount(0)
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

  test('「続き」で「畳む」に、押すと3行に戻って「続き」（ページは動かない。直し始めない）', { tag: '@m' }, async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'favorite')
    const before = (await title(page, I.trips).boundingBox())!.height
    await more(page, I.trips).tap()
    await expect(more(page, I.trips)).toHaveText('畳む')
    await expect(more(page, I.trips)).toHaveAttribute('aria-expanded', 'true')
    expect((await title(page, I.trips).boundingBox())!.height).toBeGreaterThan(before + 40)
    await tapSize(more(page, I.trips), '「畳む」')
    await pageScrollStill(page)
    const scroll = (await toggleEdge(page, I.trips, 'page')).scroll
    await more(page, I.trips).tap()
    await expect(more(page, I.trips)).toHaveText('続き')
    await expect(more(page, I.trips)).toHaveAttribute('aria-expanded', 'false')
    expect((await title(page, I.trips).boundingBox())!.height).toBeCloseTo(before, 0)
    expect((await toggleEdge(page, I.trips, 'page')).scroll).toBe(scroll)
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', I.trips))).toHaveCount(0)
  })

  test('長い物を下まで読んで「畳む」と、「続き」が切り替えの列の下に隠れた分だけすぐ送る', { tag: '@m' }, async ({ page }) => {
    await openLists(page, '/week/2026-11-08', { extra: longFavorites() })
    await openStackedList(page, 'favorite')
    await more(page, LONG).tap()
    await expect(more(page, LONG)).toHaveText('畳む')
    await pageScrollStill(page)
    await readToEnd(page, LONG, 'page')
    await more(page, LONG).tap()
    await expect(more(page, LONG)).toHaveText('続き')
    await expectToggleAtTop(page, LONG, 'page')
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', LONG))).toHaveCount(0)
  })

  test('全部見せている間に幅が広がって3行に収まると「畳む」は消え、フォーカスは行の字へ移る。また狭まると開いたまま「畳む」', async ({
    page,
  }) => {
    const size = page.viewportSize()!
    await openLists(page, '/week/2026-11-08', { extra: wideFavorites() })
    await openStackedList(page, 'favorite')
    await expect(more(page, WIDE)).toHaveText('続き')
    await more(page, WIDE).tap()
    await expect(more(page, WIDE)).toHaveText('畳む')
    await expect(more(page, WIDE)).toBeFocused()
    expect(await lineCount(page, WIDE)).toBeGreaterThan(3)
    // M の幅（切り替えの列のまま）へ広げると3行に収まる: 「畳む」は消え、フォーカスはページの外へ落とさず行の字へ
    await page.setViewportSize({ width: 700, height: size.height })
    await expect.poll(() => lineCount(page, WIDE)).toBeLessThanOrEqual(3)
    await expect(more(page, WIDE)).toHaveCount(0)
    await expect(title(page, WIDE)).toBeFocused()
    // 元の幅へ戻すと、開いたまま「畳む」が出る。押すと3行に戻って「続き」（フォーカスはボタンに）
    await page.setViewportSize(size)
    await expect(more(page, WIDE)).toHaveText('畳む')
    await expect(more(page, WIDE)).toHaveAttribute('aria-expanded', 'true')
    expect(await lineCount(page, WIDE)).toBeGreaterThan(3)
    await more(page, WIDE).tap()
    await expect(more(page, WIDE)).toHaveText('続き')
    await expect(more(page, WIDE)).toBeFocused()
    await expect(page.getByTestId(listTestIds.rowEdit('favorite', WIDE))).toHaveCount(0)
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
