// イヤーの E2E（docs/SPEC.md の 8.・7.3・7.9・7.12・3.2・3.7）: 本物のブラウザでしか確かめられない所だけ（測った領域の幅で選ぶ並べ方と、
// ウインドウの幅を変えた時にすぐ並べ直すこと・870px の境・ふつうのスクロールバーでも並べ方が変わらないこと・中だけのスクロール・
// 計算した色と枠・乗せた時の地・押した時の行き先と見ている日・キーボード・S の2列と 360px・指でなぞって次の年）。
// 中身の決まり（日付・●・色・読み上げ）は yearModel.test.ts・YearView.test.tsx・yearCss.test.ts。データは作り物の
// e2e/fixtures/demoData.ts、今は 2026年11月10日（火）9:00（11/3 文化の日・11/23 勤労感謝の日、休みは 11/11・11/14・11/23・12/2）
import { expect, test, type Locator, type Page } from '@playwright/test'
import { testIds } from '../src/features/calendar/common/testIds'
import { demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar, touchSwipe } from './helpers'

collectDiagnosticsOnFailure()

const YEAR = '/year/2026'

const view = (page: Page) => page.getByTestId(testIds.view('year'))
const cell = (page: Page, date: string) => page.getByTestId(testIds.yearCell(date))
const dot = (page: Page, date: string, kind: 'work' | 'private') => cell(page, date).locator(`.yr-dot.is-${kind}`)

/** 今の行き先（# の後ろ）が path になるまで待つ */
async function at(page: Page, path: string) {
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
}

/** CSS の変数の色を、ブラウザが計算した rgb() にする（トークンの値が変わってもテストを直さなくてよいように） */
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.createElement('span')
    el.style.color = `var(${n})`
    document.body.appendChild(el)
    const c = getComputedStyle(el).color
    el.remove()
    return c
  }, name)

const style = (target: Locator, prop: string) => target.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)

/** カレンダーの領域（モードの画面を入れる所）の中身の幅と、ウインドウの幅との差（その差の分だけ窓を広げると領域がその幅になる） */
async function areaWidth(page: Page): Promise<{ area: number; offset: number }> {
  return page.evaluate(() => {
    const body = document.querySelector('[data-testid="calendar-body"]') as HTMLElement
    const cs = getComputedStyle(body)
    const area = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
    return { area, offset: window.innerWidth - area }
  })
}

/** 測る箱（.cal-body）・ページ・イヤーの画面のそれぞれが縦にスクロールするか */
const scrolls = (page: Page) =>
  page.evaluate(() => {
    const body = document.querySelector('[data-testid="calendar-body"]') as HTMLElement
    const yr = document.querySelector('[data-testid="view-year"]') as HTMLElement
    return {
      body: body.scrollHeight > body.clientHeight + 1,
      page: document.documentElement.scrollHeight > window.innerHeight + 1,
      year: yr.scrollHeight > yr.clientHeight + 1,
    }
  })

test.describe('イヤー（PC）', { tag: ['@pc'] }, () => {
  test('1400px の窓は「月を行・日を列」: 帯 64px・マス 52px、今日の枠・今月の帯・休みの地・●の薄さを決まった色で（8.2・7.3・7.9）', async ({
    page,
  }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    await expect(view(page)).toHaveAttribute('data-layout', 'rows')
    await expect(view(page).locator('.yr-row')).toHaveCount(12)
    const band = page.getByTestId(testIds.yearMonth(11))
    const bandBox = (await band.boundingBox())!
    expect(Math.round(bandBox.width)).toBe(64)
    expect(Math.round(bandBox.height)).toBe(52)
    // マスの幅 =（領域の幅 − 64px − 31 × 2px）÷ 31、高さ 52px（CALENDAR-210）
    const { area } = await areaWidth(page)
    const box = (await cell(page, '2026-11-10').boundingBox())!
    expect(box.width).toBeCloseTo((area - 64 - 62) / 31, 0)
    expect(Math.round(box.height)).toBe(52)
    // 今日: 内側に 2px の --accent の枠（輪の代わり）と太さ 600。地は替えない（D07）
    const accent = await tokenColor(page, '--accent')
    expect(await style(cell(page, '2026-11-10'), 'box-shadow')).toBe(`${accent} 0px 0px 0px 2px inset`)
    expect(await style(cell(page, '2026-11-10').locator('.yr-date'), 'font-weight')).toBe('600')
    expect(await style(cell(page, '2026-11-09').locator('.yr-date'), 'font-weight')).toBe('400')
    // 今月の帯は今日の印（地 --today-bg・字 --on-primary）、ほかの月は --surface-3（CALENDAR-208・209）
    expect(await style(band, 'background-color')).toBe(await tokenColor(page, '--today-bg'))
    expect(await style(band, 'color')).toBe(await tokenColor(page, '--on-primary'))
    expect(await style(page.getByTestId(testIds.yearMonth(10)), 'background-color')).toBe(await tokenColor(page, '--surface-3'))
    // 休みの日の地、日曜・祝日・土曜の日付の色。祝日名は出さない（CALENDAR-216）。休みの地は、開いた後にデータを置くので
    // 地の移り変わり（--dur-hover）の途中のことがある。移り終わるまで待つ
    const offFill = await tokenColor(page, '--off-fill')
    await expect.poll(() => style(cell(page, '2026-11-11'), 'background-color')).toBe(offFill)
    expect(await style(cell(page, '2026-11-03').locator('.yr-date'), 'color')).toBe(await tokenColor(page, '--sun'))
    expect(await style(cell(page, '2026-11-07').locator('.yr-wd'), 'color')).toBe(await tokenColor(page, '--sat'))
    await expect(view(page)).not.toContainText('文化の日')
    // ●: 仕事 --work-line・プライベート --private-line。全部完了した日（11/4 の申請の受付）は 0.35、済んでいない日は 1
    expect(await style(dot(page, '2026-11-10', 'work'), 'background-color')).toBe(await tokenColor(page, '--work-line'))
    expect(await style(dot(page, '2026-11-10', 'private'), 'background-color')).toBe(await tokenColor(page, '--private-line'))
    expect(await style(dot(page, '2026-11-04', 'work'), 'opacity')).toBe('0.35')
    expect(await style(dot(page, '2026-11-10', 'work'), 'opacity')).toBe('1')
    // 予定の無い区分も場所は空けたまま（11/3 は仕事だけ。プライベートの場所は見えないまま、仕事の●は左）
    await expect(dot(page, '2026-11-03', 'private')).toHaveCSS('visibility', 'hidden')
    const w = (await dot(page, '2026-11-03', 'work').boundingBox())!
    const p = (await dot(page, '2026-11-03', 'private').boundingBox())!
    expect(p.x - w.x).toBeCloseTo(7, 0)
    // L のページはスクロールしない
    expect((await scrolls(page)).page).toBe(false)
  })

  test('窓の幅を変えるとすぐに並べ直す（1400 → 1200px で小さな月の4列 → 1400px で行）。領域 870px が境（CALENDAR-205・206・FRAME-021・025）', async ({
    page,
  }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    await expect(view(page)).toHaveAttribute('data-layout', 'rows')
    await page.setViewportSize({ width: 1200, height: 900 })
    await expect(view(page)).toHaveAttribute('data-layout', 'mini')
    await expect(view(page).locator('.yr-minis')).toHaveAttribute('data-cols', '4')
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(view(page)).toHaveAttribute('data-layout', 'rows')
    // 領域が 869px なら小さな月、ちょうど 870px なら行（マスは 24px）。小さな月から行へ替わるのを待つ（行のままの所で 870px に
    // しても、並べ方が替わらないのか、まだ測り直していないのかが分からないので、先に 869px で小さな月にしておく）
    const { offset } = await areaWidth(page)
    await page.setViewportSize({ width: 869 + offset, height: 900 })
    await expect(view(page)).toHaveAttribute('data-layout', 'mini')
    expect((await areaWidth(page)).area).toBe(869)
    await noHorizontalScroll(page)
    await page.setViewportSize({ width: 870 + offset, height: 900 })
    await expect(view(page)).toHaveAttribute('data-layout', 'rows')
    expect((await areaWidth(page)).area).toBe(870)
    expect(Math.round((await cell(page, '2026-11-10').boundingBox())!.width)).toBe(24)
    await noHorizontalScroll(page)
  })

  test('日のマスはその日の月のマンスリーへ（見ている日はその日）。続けて「週」でその日の週へ。月の見出しはその月の1日へ（7.12・8.4）', async ({
    page,
  }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    await cell(page, '2026-11-28').click()
    await at(page, '/month/2026-11')
    await expect(page.getByTestId(testIds.view('month'))).toBeVisible()
    await page.getByTestId(testIds.calMode('week')).click()
    await at(page, '/week/2026-11-22')
    // ［年］でイヤーへ（モードを替えても履歴に積まないので、「戻る」では戻らない。3.1）
    await page.getByTestId(testIds.calMode('year')).click()
    await at(page, YEAR)
    await expect(view(page)).toBeVisible()
    await page.getByTestId(testIds.yearMonth(2)).click()
    await at(page, '/month/2026-02')
    await page.getByTestId(testIds.calMode('day')).click()
    await at(page, '/day/2026-02-01')
  })

  test('乗せるとマスの地を --surface-3 に（休みの日は替えない。8.4）', async ({ page }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    const surface3 = await tokenColor(page, '--surface-3')
    await cell(page, '2026-11-16').hover()
    await expect.poll(() => style(cell(page, '2026-11-16'), 'background-color')).toBe(surface3)
    await cell(page, '2026-11-11').hover()
    await expect.poll(() => style(cell(page, '2026-11-11'), 'background-color')).toBe(await tokenColor(page, '--off-fill'))
  })

  test('縦に収まらない時はイヤーの中だけでスクロールし、測る箱とページはスクロールしない（CALENDAR-217）', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 560 })
    await openCalendar(page, YEAR, { data: demoData() })
    await expect(view(page)).toHaveAttribute('data-layout', 'rows')
    expect(await scrolls(page)).toEqual({ body: false, page: false, year: true })
    await view(page).evaluate((e) => e.scrollTo(0, e.scrollHeight))
    await expect(page.getByTestId(testIds.yearMonth(12))).toBeInViewport()
    // 小さな月（窓 960px）でも同じ
    await page.setViewportSize({ width: 960, height: 560 })
    await expect(view(page)).toHaveAttribute('data-layout', 'mini')
    expect(await scrolls(page)).toEqual({ body: false, page: false, year: true })
  })

  test('キーボード: 見ている日のマスに Tab で入り、矢印キーで動いて Enter でそのマスの月へ（4.12）', async ({ page }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    // 今月の帯から Tab で、見ている日（今日）のマスへ
    await page.getByTestId(testIds.yearMonth(11)).focus()
    await page.keyboard.press('Tab')
    await expect(cell(page, '2026-11-10')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await expect(cell(page, '2026-12-11')).toBeFocused()
    // フォーカスの枠はマスの外側に 2px 離して（マスにぴったり付いた内側の 2px は今日の枠。4.8・4.12）
    expect(await style(cell(page, '2026-12-11'), 'outline-style')).toBe('solid')
    expect(await style(cell(page, '2026-12-11'), 'outline-offset')).toBe('2px')
    await page.keyboard.press('Enter')
    await at(page, '/month/2026-12')
    await page.getByTestId(testIds.calMode('day')).click()
    await at(page, '/day/2026-12-11')
  })
})

test.describe('イヤー（PC・ふつうのスクロールバー）', { tag: ['@pc'] }, () => {
  // 幅を取るスクロールバー（Windows などの端末）で確かめる。Playwright の Chromium は既定でスクロールバーを隠すので、その指定を外した
  // ブラウザをこのテストの中で開く（PW_CHROMIUM_PATH の時はその Chromium。playwright.config.ts と同じ）
  test('領域が 870px を少し超える窓で行が縦に収まらなくても、スクロールバーで並べ方が変わらない（870px の境の行ったり来たり）', async ({
    playwright,
    baseURL,
    locale,
    timezoneId,
  }) => {
    const browser = await playwright.chromium.launch({
      ignoreDefaultArgs: ['--hide-scrollbars'],
      ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
    })
    try {
      // 窓と領域の幅の差は、行が縦に収まる高さ（どこにもスクロールバーが無い時）で測る
      const context = await browser.newContext({ baseURL, locale, timezoneId, viewport: { width: 1400, height: 900 } })
      const page = await context.newPage()
      await openCalendar(page, YEAR, { data: demoData() })
      const { offset } = await areaWidth(page)
      await page.setViewportSize({ width: 875 + offset, height: 560 })
      await expect(view(page)).toHaveAttribute('data-layout', 'rows')
      // 並べ方が替わらないこと（無いこと）を確かめるので、決まった時間（0.5秒）だけ data-layout の書き換えを数える（スクロールバーが
      // 測る箱に出ると、領域の幅が 860px ほどになって小さな月に替わる）
      const flips = await view(page).evaluate(
        (e) =>
          new Promise<number>((resolve) => {
            let n = 0
            const mo = new MutationObserver(() => n++)
            mo.observe(e, { attributes: true, attributeFilter: ['data-layout'] })
            setTimeout(() => {
              mo.disconnect()
              resolve(n)
            }, 500)
          }),
      )
      await expect(view(page)).toHaveAttribute('data-layout', 'rows')
      expect(flips).toBe(0)
      // スクロールバーはイヤーの中に出て（幅を取る）、測った領域の幅は変わらない
      expect((await areaWidth(page)).area).toBe(875)
      const bar = await view(page).evaluate((e) => (e as HTMLElement).offsetWidth - e.clientWidth)
      expect(bar).toBeGreaterThan(0)
    } finally {
      await browser.close()
    }
  })
})

test.describe('イヤー（タブレット）', { tag: ['@m'] }, () => {
  test('M はいつも小さな月（領域 ÷ 170px を 4 列まで）。横にはみ出さず、指で押すとその日の月へ（8.1・8.3）', async ({ page }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    await expect(view(page)).toHaveAttribute('data-layout', 'mini')
    const { area } = await areaWidth(page)
    await expect(view(page).locator('.yr-minis')).toHaveAttribute('data-cols', String(Math.min(4, Math.floor(area / 170))))
    expect((await cell(page, '2026-11-10').boundingBox())!.width).toBeGreaterThanOrEqual(22)
    await noHorizontalScroll(page)
    await cell(page, '2026-11-12').tap()
    await at(page, '/month/2026-11')
  })
})

test.describe('イヤー（スマホ）', { tag: ['@s'] }, () => {
  test('S は小さな月の2列。360px でも横にスクロールせず、マスは 22px 四方以上（CALENDAR-220・221・226）', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await openCalendar(page, YEAR, { data: demoData() })
    await expect(view(page)).toHaveAttribute('data-layout', 'mini')
    await expect(view(page).locator('.yr-minis')).toHaveAttribute('data-cols', '2')
    await noHorizontalScroll(page)
    const box = (await cell(page, '2026-11-10').boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(22 - 0.01)
    expect(box.height).toBeCloseTo(box.width, 1)
    // 2つの小さな月は重ならない（1月の土曜の列の右の端 < 2月の日曜の列の左の端）
    const jan = (await cell(page, '2026-01-03').boundingBox())!
    const feb = (await cell(page, '2026-02-01').boundingBox())!
    expect(jan.x + jan.width).toBeLessThan(feb.x)
  })

  test('マスを押すとその日の月のマンスリーへ。左へなぞると次の年（CALENDAR-200・223）', async ({ page }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    await expect(view(page).locator('.yr-minis')).toHaveAttribute('data-cols', '2')
    await cell(page, '2026-03-11').tap()
    await at(page, '/month/2026-03')
    await page.getByTestId(testIds.calMode('year')).tap()
    await at(page, YEAR)
    // なぞるのは押すのの後にする（速くなぞった直後の指の押し下げは、ブラウザが慣性のスクロールを止める物として扱い、押したことに
    // しないことがある。人がなぞった後に次の年を見てから押すのと違い、テストではすぐに押すので）。なぞり始めは右の列の小さな月
    // （4月）のマスにして、左へ 150px なぞっても指が画面の外へ出ないようにする
    const from = (await cell(page, '2026-04-16').boundingBox())!
    expect(from.x + from.width / 2 - 150).toBeGreaterThan(0)
    await touchSwipe(page, cell(page, '2026-04-16'), -150, 0)
    await at(page, '/year/2027')
    await expect(cell(page, '2027-04-16')).toBeVisible()
  })
})

test.describe('イヤー（iPhone）', { tag: ['@ios'] }, () => {
  test('マスを押すとその日の月のマンスリーへ（CALENDAR-223）', async ({ page }) => {
    await openCalendar(page, YEAR, { data: demoData() })
    await cell(page, '2026-11-12').tap()
    await at(page, '/month/2026-11')
  })
})
