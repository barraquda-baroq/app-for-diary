// 登録・詳細の画面の E2E（docs/SPEC.md の 3.8・4.3・4.7・12.2・12.3）: L は真ん中の小さな画面（幅 520px・角丸 14px）、S は下からの
// シート（最大 92dvh・上の角丸 16px）。画面の地は区分の色（--work-sheet／--private-sheet。ディープダークは --surface と題の左の
// 区分のアイコン）、上の辺はラベルの色の帯で、選び替えるとその場で替わる。入力欄の字はスマホで 16px。「戻る」で閉じる。
// 今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）。データは作り物（e2e/fixtures/demoData.ts）
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar } from './helpers'

collectDiagnosticsOnFailure()

const sheetOf = (page: Page) => page.getByTestId('item-sheet')

/** CSS の変数の色を、背景の色として読んだ値（'rgb(…)'。計算済みの色と比べる） */
function tokenColor(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement('div')
    probe.style.background = `var(${n})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    return c
  }, name)
}

/** 小さな画面が出る動き（pop-in 140ms。少し小さく下から）が終わるまで待つ（終わる前の箱は小さく測れる） */
async function settled(sheet: Locator): Promise<void> {
  await sheet.evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished)))
}

const background = (el: Locator) => el.evaluate((e) => getComputedStyle(e).backgroundColor)
const shadow = (el: Locator) => el.evaluate((e) => getComputedStyle(e).boxShadow)

/** 詳細を開いた時と同じ履歴（同じ行き先に state.sheet を積む）を作って読み込み直す（読み込み直すと、予定があれば開き直す。D03） */
async function openDetailByHistory(page: Page, id: string): Promise<void> {
  await page.evaluate((itemId) => {
    const cur = (window.history.state ?? {}) as { idx?: number }
    window.history.pushState(
      { usr: { sheet: { kind: 'detail', id: itemId } }, key: 'e2e-item', idx: (cur.idx ?? 0) + 1 },
      '',
      window.location.href,
    )
  }, id)
  await page.reload()
  await expect(sheetOf(page)).toBeVisible()
}

test.describe('登録の画面（PC）', { tag: ['@pc'] }, () => {
  test('［＋ 登録］で真ん中の小さな画面（幅 520px・角丸 14px）を開き、件名にフォーカス。プライベート・ラベルを選ぶとその場で地と上の辺の帯が替わる', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { prefs: { detailsOpen: true } })
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading')).toHaveText('予定を登録')
    await settled(sheet)
    const box = await sheet.boundingBox()
    expect(box?.width).toBe(520)
    expect(await sheet.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe('14px')
    const title = page.getByTestId('item-title')
    await expect(title).toBeFocused()
    // 仕事の地・帯なし
    expect(await background(sheet)).toBe(await tokenColor(page, '--work-sheet'))
    await expect(sheet).not.toHaveAttribute('data-label')
    // プライベートを選ぶと地がプライベートの色に
    await page.getByTestId('item-kind-private').click()
    await expect(sheet).toHaveAttribute('data-kind', 'private')
    expect(await background(sheet)).toBe(await tokenColor(page, '--private-sheet'))
    // ラベルを選ぶと上の辺にその色の 6px の帯
    await page.getByTestId('item-label-rose-l').click()
    await expect(sheet).toHaveAttribute('data-label', 'rose-l')
    const rose = await tokenColor(page, '--label-rose-l')
    expect(await shadow(sheet)).toContain(`${rose} 0px 6px 0px 0px inset`)
    // 件名を打てる。打つと［登録］を押せる
    await expect(page.getByTestId('item-register')).toBeDisabled()
    await title.fill('友だちと映画を見に行く')
    await expect(title).toHaveValue('友だちと映画を見に行く')
    await expect(page.getByTestId('item-register')).toBeEnabled()
    await noHorizontalScroll(page)
  })

  test('ディープダーク: 地は区分で変えず --surface、題の左に区分のアイコン（14px）を出す（FRAME-143・144）', async ({ page }) => {
    await openCalendar(page, '/week/2026-11-08', { appearance: 'deep-dark' })
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    const surface = await tokenColor(page, '--surface')
    expect(await background(sheet)).toBe(surface)
    const icon = sheet.locator('.modal-title-icon svg')
    await expect(icon).toBeVisible()
    await settled(sheet)
    expect((await icon.boundingBox())?.width).toBe(14)
    const work = await icon.innerHTML()
    await page.getByTestId('item-kind-private').click()
    expect(await background(sheet)).toBe(surface)
    expect(await icon.innerHTML()).not.toBe(work)
  })
})

test.describe('詳細の画面（PC）', { tag: ['@pc'] }, () => {
  test('予定の中身（件名は書き換えられる欄・区分の地・ラベルの帯と呼び名・詳しく・下の行）を出し、［×］で閉じる', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await openDetailByHistory(page, DEMO_IDS.materials)
    const sheet = sheetOf(page)
    await expect(sheet.getByRole('heading')).toHaveText('予定')
    await expect(page.getByTestId('item-title')).toHaveValue('資料づくり')
    await expect(sheet).toHaveAttribute('data-kind', 'work')
    await expect(sheet).toHaveAttribute('data-label', 'sky-l')
    expect(await background(sheet)).toBe(await tokenColor(page, '--work-sheet'))
    // ラベルが入っているので「詳しく」は開いて出し、付けた呼び名を出す（D11・ITEMS-021）
    await expect(page.getByTestId('item-details')).toHaveAttribute('aria-expanded', 'true')
    await expect(sheet.locator('.it-label-name')).toHaveText('社内')
    await expect(page.getByTestId('item-requester')).toHaveValue('総務')
    await expect(page.getByTestId('item-start')).toHaveText('11月9日（月）')
    await expect(page.getByTestId('item-start-time')).toHaveValue('10:00')
    await expect(page.getByTestId('item-footer')).toContainText('作った 2026/10/01')
    // 区分を選び替えると、その場で地が替わる
    await page.getByTestId('item-kind-private').click()
    expect(await background(sheet)).toBe(await tokenColor(page, '--private-sheet'))
    await page.getByTestId('modal-close').click()
    await expect(sheet).toHaveCount(0)
  })
})

test.describe('登録の画面（スマホ）', { tag: ['@s'] }, () => {
  test('下からのシート（最大 92dvh・上の角丸 16px）。件名の欄は 16px、横にはみ出さず、「戻る」で閉じる', async ({ page }) => {
    await openCalendar(page, '/month/2026-11', { prefs: { detailsOpen: true } })
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    await expect(sheet).toBeVisible()
    await settled(sheet)
    const [vw, vh] = await page.evaluate(() => [window.innerWidth, window.innerHeight])
    const box = await sheet.boundingBox()
    expect(box?.width).toBe(vw)
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(vh)
    expect(box?.height ?? 0).toBeLessThanOrEqual(vh * 0.92 + 1)
    const radius = await sheet.evaluate((e) => {
      const s = getComputedStyle(e)
      return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius]
    })
    expect(radius).toEqual(['16px', '16px', '0px'])
    expect(await page.getByTestId('item-title').evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px')
    // ラベルの丸は 24px で12個が1行に入る（「なし」は別の行。D35）
    const first = await page.getByTestId('item-label-rose-l').boundingBox()
    const last = await page.getByTestId('item-label-peony-l').boundingBox()
    expect(first?.width).toBe(24)
    expect(last?.y).toBe(first?.y)
    await noHorizontalScroll(page)
    await page.goBack()
    await expect(sheet).toHaveCount(0)
  })
})

test.describe('登録の画面（iPhone）', { tag: ['@ios'] }, () => {
  test('件名の欄の字は 16px 以上（iOS のズームを防ぐ）で、「戻る」で閉じる（FRAME-199・ITEMS-190・192）', async ({ page }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-add').click()
    const title = page.getByTestId('item-title')
    await expect(title).toBeVisible()
    const size = await title.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
    await page.goBack()
    await expect(sheetOf(page)).toHaveCount(0)
  })
})
