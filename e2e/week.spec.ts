// ウィークリーの E2E（docs/SPEC.md の 10.・7.7〜7.9・4.3〜4.8・12.1・12.3・12.5）: 7日を横（L・M）の見出し・段・レーン・線・●・＞・
// ラベルの一辺・1日のカードのそろい・段の中のスクロール・「＋」の出方・狭い領域の横のスクロール、7日を縦（S）の日のかたまり・
// レール・4本目のレーンからの「● 件名」の行、予定を押すと詳細。動き: 「＋」→ すばやく足す（Enter で続けて足す・Esc・書きかけ）、
// 休みのチェック、完了の丸（お知らせと［元に戻す］）、日付の見出し → デイリー、幅を替えると並べ直す、列が狭い時の始点のカードの件名、
// 指でなぞっても週は移らない。データは作り物の e2e/fixtures/demoData.ts
// （今日は 2026年11月10日（火）9:00。いつもの週 11/8〜11/14、混んだ週 11/22〜11/28。休みは 11/11・11/14・11/23）
import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEMO_IDS, DEMO_WEEKS, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar, touchSwipe } from './helpers'

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

/** その段のその日の列（L・M。落とせる所。中に1日のカードと「＋」の行） */
const cell = (page: Page, kind: 'work' | 'private', date: string) =>
  page.locator(`[data-tier="${kind}"] .wk-cell[data-date="${date}"]`)

/** 表示用のデータの、その件名の予定（無ければ null） */
const itemByTitle = (page: Page, title: string) =>
  page.evaluate((t) => Object.values(window.__ds.getData().items).find((it) => it.title === t) ?? null, title)

/** 保存の途中の変更を書いてから読み込み直す */
async function reloadWeek(page: Page) {
  await page.evaluate(() => window.__ds.flushNow())
  await page.reload()
  await expect(page.getByTestId('view-week')).toBeVisible()
}

/** 件名が切れずに全部見えている（2行までに収まり、はみ出していない） */
async function titleFits(target: Locator) {
  const t = await target
    .locator('.cp-title')
    .evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight, width: e.scrollWidth, cw: e.clientWidth }))
  expect(t.scroll, '件名が下へはみ出していない').toBeLessThanOrEqual(t.client + 1)
  expect(t.width, '件名が横へはみ出していない').toBeLessThanOrEqual(t.cw + 1)
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

    // 件名は 13px・行の高さ 1.35 で2行まで（3行になる件名も2行で切る。FRAME-204）
    const longTitle = page.getByTestId(`week-card-${I.longWork}`).locator('.cp-title')
    const lines = await longTitle.evaluate((e) => ({ client: e.clientHeight, scroll: e.scrollHeight }))
    expect(lines.client).toBeLessThanOrEqual(Math.ceil(2 * 13 * 1.35))
    expect(lines.scroll).toBeGreaterThan(lines.client)

    // 段の名札は日曜の列より広い（「PRIVATE プライベート」）。列の縦の線が字を横切らないよう、字の幅だけ --surface の地
    const privTag = page.locator('[data-tier="private"] > .wk-tag')
    expect((await box(privTag)).width).toBeGreaterThan((await box(col(page, '2026-11-08'))).width)
    expect(await style(privTag, 'background-color')).toBe(await token(page, '--surface'))
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

  test('960px のウインドウでも7日を横（領域は 600px を切る）。列が 120px より狭いので見出しは2行（64px。10.1・10.2）。始点のカードの件名は2行で全部読める（開発）', async ({
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
    // 列 79px: 丸の横には2字ほどしか入らないので、件名を2行に（1行目は丸の右、2行目は丸の下へ回り込む）。どれも切れずに全部見える
    for (const id of [I.materials, I.expo, I.tripPrep, I.stock, I.nightBus]) {
      const start = page.getByTestId(`week-start-${id}`)
      await expect(start).toHaveClass(/is-two-lines/)
      await titleFits(start)
      // 高さ 36px・線は高さの真ん中（18px）のまま
      expect((await box(start)).height).toBeCloseTo(36, 0)
    }
    const materials = page.getByTestId(`week-start-${I.materials}`)
    const line = await box(materials.locator('xpath=..').locator('.wk-line'))
    near(line.y + line.height / 2, (await box(materials)).y + 18, '線はカードの高さの真ん中')
    // 2行目は丸の下へ回り込む（2行目の左の端は丸の左の端とほぼ同じ）。丸は1行目の高さ
    const ring = await box(materials.getByTestId(`done-${I.materials}`).locator('svg'))
    const title = await box(materials.locator('.cp-title'))
    expect(Math.abs(title.x - ring.x)).toBeLessThanOrEqual(2)
    expect(ring.y + ring.height).toBeLessThanOrEqual(title.y + title.height / 2 + 2)
    // 短い件名（旅行）は1行目に入るので、2行目に期間
    await expect(page.getByTestId(`week-start-${I.trip}`).locator('.wk-period')).toHaveText('〜11/15')
    // 受けた表示も「‹ 件名」を2行に
    const intake = page.getByTestId(`week-received-${I.intake}`)
    await expect(intake).toHaveClass(/is-two-lines/)
    await titleFits(intake)
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

test.describe('始点のカードの印（PC）', { tag: ['@pc'] }, () => {
  test('印（〆・ロック・Claude）を2行目の右に置く始点のカードでも、件名は1行目に置いて印と重ねず、印は丸の下に入らない（1400・1180px。開発）', async ({
    page,
  }) => {
    const base = demoData().items[I.materials]
    const item = {
      ...base,
      id: 'e2e-marks',
      title: '見積もりの確認と返送',
      origin: 'list' as const,
      start: '2026-12-08',
      due: '2026-12-10',
      startTime: null,
      endTime: null,
      label: null,
      locked: true,
      by: 'connector' as const,
      ai: 'claude' as const,
      via: 'メール: 見積もりについて',
    }
    await openCalendar(page, '/week/2026-12-06', { data: { items: { [item.id]: item }, offDays: {}, labelNames: {} } })
    const card = page.getByTestId('week-start-e2e-marks')
    // 1400px（列 142px）: 丸の右に件名・期間の行の右に印（期間は読み上げだけ）。1180px（列 110px）: 印が丸の横に入らないので2行の並べ方
    for (const [width, twoLines] of [
      [1400, false],
      [1180, true],
    ] as const) {
      await page.setViewportSize({ width, height: 900 })
      await expect(card).toHaveClass(/is-marks-low/)
      await expect(card).toHaveClass(twoLines ? /is-two-lines/ : /is-period-hidden/)
      const title = await box(card.locator('.cp-title'))
      const marks = await box(card.locator('.wk-marks'))
      const ring = await box(card.getByTestId('done-e2e-marks').locator('svg'))
      expect(title.y + title.height / 2, `${width}px: 件名は印より上の行`).toBeLessThan(marks.y - 2)
      expect(marks.x, `${width}px: 印はカードの中`).toBeGreaterThanOrEqual((await box(card)).x)
      const underRing = marks.x < ring.x + ring.width && marks.y < ring.y + ring.height - 1.5
      expect(underRing, `${width}px: 印は丸に重ならない`).toBe(false)
    }
  })
})

test.describe('ウィークリーの動き（PC）', { tag: ['@pc'] }, () => {
  test('「＋」→ すばやく足す: その場で入力欄に替わり、Enter で2件続けて足し、Esc で閉じて「＋」に戻る（12.1・ITEMS-068・153〜156・161・D44）', async ({
    page,
  }) => {
    await openWeek(page)
    const target = cell(page, 'work', '2026-11-12')
    await target.hover()
    await page.getByTestId('week-add-2026-11-12-work').click()
    const input = page.getByTestId('quick-add-input')
    await expect(input).toBeFocused()
    // 「＋」の行の所（列のいちばん下）に開く
    await expect(page.getByTestId('week-add-2026-11-12-work')).toHaveCount(0)
    expect(await target.evaluate((e, el) => e.lastElementChild?.contains(el) ?? false, await input.elementHandle())).toBe(true)
    await input.fill('電話をかける')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await input.fill('資料を送る')
    await input.press('Enter')
    // 足した2件は、その日・その段のカードに（入力欄の上。日付は押した日、区分は押した段、時刻なし・Task List には出さない）
    for (const title of ['電話をかける', '資料を送る']) {
      const it = await itemByTitle(page, title)
      expect(it).toMatchObject({
        start: '2026-11-12',
        due: null,
        kind: 'work',
        origin: 'calendar',
        startTime: null,
        listed: false,
      })
      const card = page.getByTestId(`week-card-${it?.id}`)
      await expect(card).toBeVisible()
      expect(await target.evaluate((e, c) => e.contains(c), await card.elementHandle())).toBe(true)
    }
    await expect(input).toBeVisible()
    await input.press('Escape')
    await expect(page.getByTestId('quick-add-input')).toHaveCount(0)
    await expect(page.getByTestId('week-add-2026-11-12-work')).toBeFocused()
    // 足した物は目立たせない（D44）
    expect(await page.locator('.flash').count()).toBe(0)
  })

  test('すばやく足すの書きかけは、閉じても読み込み直しても残り、同じ日・同じ段で開き直すと戻る（ITEMS-159）', async ({
    page,
  }) => {
    await openWeek(page)
    await cell(page, 'private', '2026-11-13').hover()
    await page.getByTestId('week-add-2026-11-13-private').click()
    await page.getByTestId('quick-add-input').fill('書きかけの予定')
    await page.getByTestId('quick-add-input').press('Escape')
    await reloadWeek(page)
    await cell(page, 'private', '2026-11-13').hover()
    await page.getByTestId('week-add-2026-11-13-private').click()
    await expect(page.getByTestId('quick-add-input')).toHaveValue('書きかけの予定')
    // ほかの日・段の「＋」は空のまま
    await page.getByTestId('quick-add-input').press('Escape')
    await cell(page, 'work', '2026-11-13').hover()
    await page.getByTestId('week-add-2026-11-13-work').click()
    await expect(page.getByTestId('quick-add-input')).toHaveValue('')
  })

  test('休みのチェックを押すと、その日の見出しと列が --off-fill になり、読み込み直しても残る。もう一度押すと外れる（ITEMS-056・059・CALENDAR-046・080）', async ({
    page,
  }) => {
    await openWeek(page)
    const check = page.getByTestId('week-off-2026-11-12')
    await expect(check).not.toBeChecked()
    await check.check()
    await expect(check).toBeChecked()
    await expect.poll(() => style(col(page, '2026-11-12'), 'background-color')).toBe(await token(page, '--off-fill'))
    await reloadWeek(page)
    await expect(page.getByTestId('week-off-2026-11-12')).toBeChecked()
    expect(await page.evaluate(() => window.__ds.getRaw().offDays['2026-11-12']?.off)).toBe(true)
    await page.getByTestId('week-off-2026-11-12').uncheck()
    await expect(page.getByTestId('week-off-2026-11-12')).not.toBeChecked()
    // 外しても記録は消さない（off: false。6.5）
    await page.evaluate(() => window.__ds.flushNow())
    expect(await page.evaluate(() => window.__ds.getRaw().offDays['2026-11-12']?.off)).toBe(false)
  })

  test('完了の丸: 1日のカードは完了の見え方とお知らせ［元に戻す］、始点のカードは期間全体（●も）を完了に（ITEMS-075・CALENDAR-116・12.5）', async ({
    page,
  }) => {
    await openWeek(page)
    const mail = page.getByTestId(`week-card-${I.mail}`)
    await mail.getByTestId(`done-${I.mail}`).click()
    await expect(mail).toHaveClass(/is-done/)
    const toast = page.locator('.toast', { hasText: '『メールの返信』を完了にしました' })
    await expect(toast).toBeVisible()
    // 丸だけを押したので詳細は開かない
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await toast.getByRole('button', { name: '元に戻す' }).click()
    await expect(mail).not.toHaveClass(/is-done/)
    expect((await itemByTitle(page, 'メールの返信'))?.done).toBe(false)

    // 始点のカード（資料づくり 11/9〜11/12）の丸: 期間全体が完了（締め切り日の●・線も完了の色）
    const start = page.getByTestId(`week-start-${I.materials}`)
    await start.getByTestId(`done-${I.materials}`).click()
    await expect(start).toHaveClass(/is-done/)
    await expect(page.getByTestId(`week-end-${I.materials}`)).toHaveClass(/is-done/)
    const done = await token(page, '--done-text')
    expect(await style(start.locator('xpath=..').locator('.wk-line'), 'background-color')).toBe(done)
    const toast2 = page.locator('.toast', { hasText: '『資料づくり』を完了にしました' })
    await toast2.getByRole('button', { name: '元に戻す' }).click()
    await expect(start).not.toHaveClass(/is-done/)
    // 完了を外した時はお知らせを出さない
    await page.getByTestId(`week-card-${I.expenses}`).getByTestId(`done-${I.expenses}`).click()
    await expect(page.getByTestId(`week-card-${I.expenses}`)).not.toHaveClass(/is-done/)
    await expect(page.locator('.toast', { hasText: '経費の精算' })).toHaveCount(0)
  })

  test('日付の見出しを押すと、その日のデイリーへ（積む。「戻る」で週へ。ITEMS-055・CALENDAR-192）', async ({ page }) => {
    await openWeek(page)
    await head(page, '2026-11-12')
      .getByRole('button', { name: /デイリーを開く/ })
      .click()
    await expect(page.getByTestId('view-day')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/day/2026-11-12')
    await page.goBack()
    await expect(page.getByTestId('view-week')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/week/2026-11-08')
  })

  test('ウインドウの幅を替えると、すぐに並べ直す（1400 → 960 → 700 → 390 → 1400。FRAME-021・ITEMS-052）', async ({ page }) => {
    await openWeek(page)
    const view = page.getByTestId('view-week')
    const start = page.getByTestId(`week-start-${I.materials}`)
    await expect(view).toHaveClass(/wk-h/)
    await expect(view).toHaveAttribute('data-head-rows', '1')
    await expect(start).not.toHaveClass(/is-two-lines/)
    await page.setViewportSize({ width: 960, height: 900 })
    await expect(view).toHaveAttribute('data-head-rows', '2')
    await expect(start).toHaveClass(/is-two-lines/)
    await page.setViewportSize({ width: 700, height: 900 })
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'M')
    await expect(view).toHaveClass(/wk-h/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'S')
    await expect(page.getByTestId('view-week')).toHaveClass(/wk-v/)
    await noHorizontalScroll(page)
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(page.getByTestId('view-week')).toHaveClass(/wk-h/)
    await expect(page.getByTestId('view-week')).toHaveAttribute('data-head-rows', '1')
    await expect(page.getByTestId(`week-start-${I.materials}`)).not.toHaveClass(/is-two-lines/)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/week/2026-11-08')
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
    // 列 100px ほど: 始点のカードの件名は2行で全部読める（開発）
    await expect(page.getByTestId(`week-start-${I.materials}`)).toHaveClass(/is-two-lines/)
    await titleFits(page.getByTestId(`week-start-${I.materials}`))
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
    '週の中の物を見える所へ出す時（落とした後・目立たせる時など）は、上に固定した段の名札の行の下に出す（隠れない）',
    { tag: ['@s'] },
    async ({ page }) => {
      await openWeek(page)
      const view = page.getByTestId('view-week')
      // 下まで送ってから、上の方のカードを上へ出す（scrollIntoView の nearest。src/ui/scrollWithin.ts も同じく .wk-v の
      // scroll-padding-top を見込む）
      for (const id of [`week-start-${I.materials}`, `week-card-${I.weekly}`, `week-card-${I.dinner}`]) {
        const hidden = await view.evaluate((v, id) => {
          v.scrollTop = v.scrollHeight
          const target = v.querySelector(`[data-testid="${id}"]`) as HTMLElement
          target.scrollIntoView({ block: 'nearest' })
          const tags = (v.querySelector('.wk-vtags') as HTMLElement).getBoundingClientRect().bottom
          return tags - target.getBoundingClientRect().top
        }, id)
        expect(hidden, id).toBeLessThanOrEqual(0.5)
      }
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

test.describe('7日を縦（S）の動き', { tag: ['@s'] }, () => {
  test('指でなぞっても週は移らない（［‹］［›］だけ。3.7・ITEMS-100・CALENDAR-200）。指で押すと詳細・すばやく足す・完了・休み', async ({
    page,
  }) => {
    await openWeek(page)
    const view = page.getByTestId('view-week')
    await touchSwipe(page, page.getByTestId(`week-card-${I.dinner}`), -160, 4)
    await touchSwipe(page, page.getByTestId(`week-card-${I.dinner}`), 160, 0)
    await page.waitForTimeout(200)
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/week/2026-11-08')
    await expect(view).toHaveClass(/wk-v/)

    // 予定を押すと詳細（ITEMS-079）
    await page.getByTestId(`week-start-${I.expo}`).locator('.wk-open').tap()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await expect(page.getByTestId('item-sheet')).toContainText('展示会の手配')
    await page.goBack()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)

    // 「＋」はいつも出ていて、押すとその場ですばやく足す（ITEMS-068・089）
    const add = page.getByTestId('week-add-2026-11-10-private')
    await expect(add).toHaveCSS('opacity', '1')
    await add.tap()
    const input = page.getByTestId('quick-add-input')
    await expect(input).toBeFocused()
    await input.fill('花を買う')
    await input.press('Enter')
    const it = await itemByTitle(page, '花を買う')
    expect(it).toMatchObject({ start: '2026-11-10', kind: 'private' })
    await expect(col(page, '2026-11-10').locator('[data-tier="private"]').getByTestId(`week-card-${it?.id}`)).toBeVisible()

    // 完了の丸（ITEMS-075）
    await page.getByTestId(`done-${I.book}`).tap()
    await expect(page.getByTestId(`week-card-${I.book}`)).toHaveClass(/is-done/)
    await expect(page.locator('.toast', { hasText: '『本を返す』を完了にしました' })).toBeVisible()

    // 休みのチェック（ITEMS-056・085）
    await page.getByTestId('week-off-2026-11-10').tap()
    await expect(page.getByTestId('week-off-2026-11-10')).toBeChecked()
    await expect(col(page, '2026-11-10')).toHaveClass(/cp-offday/)
  })

  test('すばやく足すを開いたまま下のかたまりの予定を押すと、押した予定の詳細が開く（入力欄が閉じて並びが上へずれても、別の予定にならない）', async ({
    page,
  }) => {
    await openWeek(page)
    // 月曜の仕事の半分がかたまりの高さを決める: 入力欄（40px）は「＋」の行（28px）より高いので、閉じると下のかたまりが上へずれる
    await page.getByTestId('week-add-2026-11-09-work').tap()
    await expect(page.getByTestId('quick-add-input')).toBeFocused()
    // 火曜の「展示会の手配」の下の端の近く（すぐ下は「定例ミーティング」）
    const expo = page.getByTestId(`week-start-${I.expo}`)
    await expo.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('quick-add-input')).toBeVisible()
    const b = await box(expo)
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 4)
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await expect(page.getByTestId('item-title')).toHaveValue('展示会の手配')
    await expect(page.getByTestId('quick-add-input')).toHaveCount(0)
  })
})
