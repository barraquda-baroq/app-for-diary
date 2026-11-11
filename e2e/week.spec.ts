// ウィークリーの E2E（docs/SPEC.md の 10.・7.7〜7.9・4.3〜4.8・12.3）: 7日を横（L・M）の見出し・段・レーン・線・●・＞・
// ラベルの一辺・1日のカードのそろい・段の中のスクロール・「＋」の出方・狭い領域の横のスクロール、7日を縦（S）の日のかたまり・
// レール・4本目のレーンからの「● 件名」の行、予定を押すと詳細。データは作り物の e2e/fixtures/demoData.ts
// （今日は 2026年11月10日（火）9:00。いつもの週 11/8〜11/14、混んだ週 11/22〜11/28。休みは 11/11・11/14・11/23）
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEMO_IDS, DEMO_WEEKS, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar } from './helpers'

collectDiagnosticsOnFailure()

const WEEK = `/week/${DEMO_WEEKS.main}`
const DENSE = `/week/${DEMO_WEEKS.dense}`
const I = DEMO_IDS

const col = (page: Page, date: string) => page.getByTestId(`week-col-${date}`)
const head = (page: Page, date: string) => page.getByTestId(`week-head-${date}`)

async function box(target: Locator) {
  const b = await target.boundingBox()
  if (!b) throw new Error('要素が見えていません')
  return b
}

/** 色の変数の値（rgb(…) の形。要素の色と比べる） */
async function token(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const el = document.createElement('span')
    el.style.color = `var(${n})`
    document.body.appendChild(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)
}

/** 2つの位置が 1px 以内（列の帯の 1px の線の分のずれは許す） */
const near = (a: number, b: number, label?: string) => expect(Math.abs(a - b), label).toBeLessThanOrEqual(1)

const style = (target: Locator, prop: string) => target.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)

async function openWeek(page: Page, hash = WEEK, appearance?: 'white' | 'dark' | 'deep-dark') {
  await openCalendar(page, hash, { data: demoData(), appearance })
  await expect(page.getByTestId('view-week')).toBeVisible()
}

test.describe('7日を横（PC）', { tag: ['@pc'] }, () => {
  test('見出し（52px・上に 2px の線・休みの列）・レーン（受けた表示・始点のカード・線・●・＞・縮むカード）・ラベルの一辺・1日のカードの上の端がそろう', async ({
    page,
  }) => {
    await openWeek(page)
    // 7列が横に並び、見出しは 52px、列の帯の上に 2px の --rule-strong
    const xs: number[] = []
    for (const d of ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'])
      xs.push((await box(col(page, d))).x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect((await box(head(page, '2026-11-10'))).height).toBeCloseTo(52, 0)
    expect(await style(col(page, '2026-11-08'), 'border-top-width')).toBe('2px')
    expect(await style(col(page, '2026-11-08'), 'border-top-color')).toBe(await token(page, '--rule-strong'))
    // 休みの日（11/11）の列は --off-fill
    expect(await style(col(page, '2026-11-11'), 'background-color')).toBe(await token(page, '--off-fill'))
    expect(await page.getByTestId('week-off-2026-11-11').isChecked()).toBe(true)

    // 前の週から続く研修: 日曜に受けた表示、線は火曜（締め切り日）の真ん中の●まで
    await expect(page.getByTestId(`week-received-${I.training}`)).toHaveText('‹ 研修')
    const end = await box(page.getByTestId(`week-end-${I.training}`))
    const tue = await box(col(page, '2026-11-10'))
    near(end.x + end.width / 2, tue.x + tue.width / 2, '●は締め切り日の列の真ん中')
    // 資料づくり: 始点のカードの高さの真ん中（18px）に線
    const start = await box(page.getByTestId(`week-start-${I.materials}`))
    expect(start.height).toBeCloseTo(36, 0)
    const line = await box(page.getByTestId(`week-start-${I.materials}`).locator('xpath=..').locator('.wk-line'))
    near(line.y + line.height / 2, start.y + 18, '線はカードの高さの真ん中')
    expect(line.height).toBeCloseTo(2, 0)
    // 出張の準備: 土曜の右の端に＞
    const sat = await box(col(page, '2026-11-14'))
    const edge = await box(page.getByTestId(`week-edge-${I.tripPrep}`))
    near(edge.x + edge.width, sat.x + sat.width, '＞は土曜の右の端')
    // 棚卸し: 土曜に始まって次の週へ続くので 14px 縮める（カードの幅は列 − 8px − 14px）
    const stock = await box(page.getByTestId(`week-start-${I.stock}`))
    near(stock.width, sat.width - 1 - 8 - 14, '縮めたカードの幅（帯の線の 1px を除く）')
    await expect(page.getByTestId(`week-edge-${I.stock}`)).toBeVisible()

    // ラベルの左の一辺は inset 4px の box-shadow（ラベルの色。FRAME-125）。ラベルなしは一辺なし
    const weekly = page.getByTestId(`week-card-${I.weekly}`)
    const sky = await token(page, '--label-sky-d')
    expect(await style(weekly, 'box-shadow')).toBe(`${sky} 4px 0px 0px 0px inset`)
    expect(await style(page.getByTestId(`week-card-${I.mail}`), 'box-shadow')).toBe('none')
    expect(await style(weekly, 'background-color')).toBe(await token(page, '--work-soft'))
    expect(await style(page.getByTestId(`week-card-${I.dinner}`), 'background-color')).toBe(await token(page, '--private-soft'))

    // 1日のカードは、どの列もレーン（3本 × 40px）の下からそろって始まる（ITEMS-067）
    const first10 = await box(page.getByTestId(`week-card-${I.weekly}`))
    const first11 = await box(page.getByTestId(`week-card-${I.quote}`))
    near(first10.y, first11.y, 'レーンの下の1日のカードの上の端')
    await noHorizontalScroll(page)
  })

  test('段の中身が多い時は、その段の中だけでスクロールし、見出しは動かない（10.2・10.3）。カードを押すと詳細', async ({
    page,
  }) => {
    await openWeek(page)
    const body = page.locator('[data-tier="work"] .wk-tier-body')
    const m = await body.evaluate((e) => ({
      scroll: e.scrollHeight,
      client: e.clientHeight,
      overflow: getComputedStyle(e).overflowY,
    }))
    expect(m.overflow).toBe('auto')
    expect(m.scroll).toBeGreaterThan(m.client)
    const headY = (await box(head(page, '2026-11-10'))).y
    await body.evaluate((e) => e.scrollTo(0, e.scrollHeight))
    await expect(page.getByTestId(`week-card-${I.expenses}`)).toBeInViewport()
    expect((await box(head(page, '2026-11-10'))).y).toBe(headY)
    // ページはスクロールしない（L）
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)

    await page.getByTestId(`week-start-${I.materials}`).click()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await expect(page.getByTestId('item-sheet')).toContainText('資料づくり')
  })

  test('「＋」の行は PC では列に乗せた時だけ出る（D43）', async ({ page }) => {
    await openWeek(page)
    const add = page.getByTestId('week-add-2026-11-12-work')
    await expect(add).toHaveCSS('opacity', '0')
    await page.getByTestId(`week-card-${I.longWork}`).hover()
    await expect(add).toHaveCSS('opacity', '1')
    await expect(page.getByTestId('week-add-2026-11-13-work')).toHaveCSS('opacity', '0')
  })

  test('ディープダーク: 仕事とプライベートのカードの地は同じで、1px の枠が付く（4.5・FRAME-119・182）', async ({ page }) => {
    await openWeek(page, WEEK, 'deep-dark')
    const work = page.getByTestId(`week-card-${I.mail}`)
    const priv = page.getByTestId(`week-card-${I.book}`)
    expect(await style(work, 'background-color')).toBe(await style(priv, 'background-color'))
    const border = await token(page, '--border')
    expect(await style(work, 'box-shadow')).toBe(`${border} 0px 0px 0px 1px inset`)
    // ラベルのあるカードは一辺の下に枠
    expect(await style(page.getByTestId(`week-card-${I.weekly}`), 'box-shadow')).toContain(`${border} 0px 0px 0px 1px inset`)
  })

  test('960px のウインドウでも7日を横（領域は 600px を切る）。列が 120px より狭いので見出しは2行（64px。10.1・10.2）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 900 })
    await openWeek(page)
    const a = await box(col(page, '2026-11-08'))
    const b = await box(col(page, '2026-11-14'))
    expect(a.y).toBe(b.y)
    expect(b.x).toBeGreaterThan(a.x)
    expect(a.width).toBeLessThan(120)
    expect((await box(head(page, '2026-11-10'))).height).toBeCloseTo(64, 0)
    await noHorizontalScroll(page)
  })

  test('領域が 504px（72px × 7）より狭い時は、ウィークリーの中だけで横にスクロールする（10.1）', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 })
    await openWeek(page)
    const view = page.getByTestId('view-week')
    const m = await view.evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }))
    expect(m.client).toBeLessThan(504)
    expect(m.scroll).toBeGreaterThan(m.client)
    expect((await box(col(page, '2026-11-08'))).width).toBeGreaterThanOrEqual(72 - 0.5)
    await noHorizontalScroll(page)
  })
})

test.describe('7日を横（M）', { tag: ['@m'] }, () => {
  test('768px: 7日を横・見出しは2行（64px）・「＋」はいつも出る（指の端末）', async ({ page }) => {
    await openWeek(page)
    await expect(page.getByTestId('view-week')).toHaveClass(/wk-h/)
    expect((await box(head(page, '2026-11-10'))).height).toBeCloseTo(64, 0)
    // 2行目に休みのチェック（丸いラベルより下）
    const pill = await box(head(page, '2026-11-10').locator('.pill'))
    const off = await box(head(page, '2026-11-10').locator('.wk-off-box'))
    expect(off.y).toBeGreaterThan(pill.y + pill.height - 1)
    await expect(page.getByTestId('week-add-2026-11-12-work')).toHaveCSS('opacity', '1')
    await noHorizontalScroll(page)
  })
})

test.describe('7日を縦（S）', () => {
  test(
    '日のかたまり（左が仕事・右がプライベート）・上に固定した段の名札・受けた表示とレール・押すと詳細',
    { tag: ['@s', '@ios'] },
    async ({ page }) => {
      await openWeek(page)
      const view = page.getByTestId('view-week')
      await expect(view).toHaveClass(/wk-v/)
      // 日曜から土曜が上から順に
      const ys: number[] = []
      for (const d of ['2026-11-08', '2026-11-09', '2026-11-10']) ys.push((await box(col(page, d))).y)
      expect(ys).toEqual([...ys].sort((a, b) => a - b))
      expect((await box(head(page, '2026-11-08'))).height).toBeCloseTo(32, 0)
      // 左が仕事・右がプライベート
      const work = await box(col(page, '2026-11-10').locator('[data-tier="work"]'))
      const priv = await box(col(page, '2026-11-10').locator('[data-tier="private"]'))
      expect(work.x).toBeLessThan(priv.x)
      expect(Math.abs(work.width - priv.width)).toBeLessThanOrEqual(1)
      // 前の週から続く研修は日曜のいちばん上に受けた表示
      await expect(col(page, '2026-11-08').getByTestId(`week-received-${I.training}`)).toBeVisible()
      // 段の名札の行は、週を下へスクロールしても上に残る
      const tags = view.locator('.wk-vtags')
      const top = (await box(tags)).y
      await view.evaluate((e) => e.scrollTo(0, 600))
      expect((await box(tags)).y).toBeCloseTo(top, 0)
      await view.evaluate((e) => e.scrollTo(0, 0))
      await noHorizontalScroll(page)

      await page.getByTestId(`week-card-${I.dinner}`).click()
      await expect(page.getByTestId('item-sheet')).toBeVisible()
      await expect(page.getByTestId('item-sheet')).toContainText('夕食')
    },
  )

  test(
    '混んだ週: レールは3本まで、4本目のレーンからは期間付きの始点のカードと締め切り日の「● 件名」の行（10.4・D41）',
    { tag: ['@s'] },
    async ({ page }) => {
      await openWeek(page, DENSE)
      const tue = col(page, '2026-11-24').locator('[data-tier="work"]')
      await expect(tue.locator('.wk-rail')).toHaveCount(3)
      const lefts = await tue.locator('.wk-rail').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.left))
      expect(lefts).toEqual(['4px', '14px', '24px'])
      const [, , , delivery, invoice] = I.dense
      await expect(page.getByTestId(`week-start-${invoice}`)).toContainText('〜11/27')
      const row = page.getByTestId(`week-overflow-2026-11-26-${delivery}`)
      await row.scrollIntoViewIfNeeded()
      await expect(row).toHaveText('納品の準備')
      expect((await box(row)).height).toBeCloseTo(20, 0)
      await noHorizontalScroll(page)
    },
  )
})
