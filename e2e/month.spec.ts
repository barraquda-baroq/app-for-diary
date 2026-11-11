// マンスリーの E2E（docs/SPEC.md の 9.・7.1〜7.4・7.12・3.10・4.5・4.7・4.11）: マス目の形と色（L・M・S）、件数の字の大きさ
// （狭い S でも「12/10」が入る。D27）、押した時の行き先、休みを付ける状態（［休み］・帯・点線・付ける／外す・Esc・［終わる］・
// 月をまたぐ・読み込み直し）、端末の時差。データは作り物の e2e/fixtures/demoData.ts（今日は 2026年11月10日（火）9:00）。
// 11月の見本: 11/10 は仕事 8・プライベート 2、11/19 は 12/10、11/3 文化の日・11/23 勤労感謝の日、休みは 11/11・11/14・11/23・12/2
import { expect, test, type Locator, type Page } from '@playwright/test'
import { demoData } from './fixtures/demoData'
import { centerOf, collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar, tapSize, touchSwipe } from './helpers'

collectDiagnosticsOnFailure()

const MONTH = '/month/2026-11'

/** 今の行き先（# の後ろ）が path になるまで待つ */
async function at(page: Page, path: string) {
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
}

const cell = (page: Page, date: string) => page.getByTestId(`month-cell-${date}`)
const count = (page: Page, date: string, kind: 'work' | 'private') => page.getByTestId(`month-count-${date}-${kind}`)

/** 要素の真ん中へマウスを動かす・そこを押す（上に重なった物が受ける。休みを付ける状態の数字の上など） */
async function hover(page: Page, target: Locator) {
  const { x, y } = await centerOf(target)
  await page.mouse.move(x, y)
}

async function clickAt(page: Page, target: Locator) {
  const { x, y } = await centerOf(target)
  await page.mouse.click(x, y)
}

/** マスの数字でない所（左上の日付の下あたり）を押す */
const pressCell = (page: Page, date: string) => cell(page, date).click({ position: { x: 12, y: 28 } })

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

const colorOf = (target: Locator) => target.evaluate((e) => getComputedStyle(e).color)
const groundOf = (target: Locator) => target.evaluate((e) => getComputedStyle(e).backgroundColor)

/** 件数の字がマスの中に収まっている（はみ出して隣のマスに掛からない。D27） */
async function countsFit(page: Page, date: string) {
  const box = (await cell(page, date).boundingBox())!
  for (const kind of ['work', 'private'] as const) {
    const text = await count(page, date, kind).evaluate((e) => {
      const r = document.createRange()
      r.selectNodeContents(e)
      const b = r.getBoundingClientRect()
      return { left: b.left, right: b.right }
    })
    expect(text.left, `${date} ${kind}`).toBeGreaterThanOrEqual(box.x - 0.5)
    expect(text.right, `${date} ${kind}`).toBeLessThanOrEqual(box.x + box.width + 0.5)
  }
}

test.describe('マンスリー（PC）', { tag: ['@pc'] }, () => {
  test('5行のマス目が領域の高さいっぱい（88px 以上）。今日の丸・休み・祝日名・件数・前後の月の日を、決まった色で出す（9.1・9.2）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    const month = page.getByTestId('calendar-month')
    await expect(month).toHaveAttribute('data-rows', '5')
    await expect(month.locator('.cal-cell')).toHaveCount(35)
    // L の行の高さ = max(88px, (領域の高さ − 曜日の行) ÷ 行の数)。マス目は領域の下の端まで（ページも領域もスクロールしない）
    const rows = await month.evaluate((m) => {
      const cells = [...m.querySelectorAll('.cal-cell')].filter((_, i) => i % 7 === 0)
      const body = document.querySelector('[data-testid="calendar-body"]') as HTMLElement
      const last = cells[cells.length - 1].getBoundingClientRect()
      return {
        heights: cells.map((c) => c.getBoundingClientRect().height),
        gap: body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom) - last.bottom,
        bodyScrolls: body.scrollHeight > body.clientHeight,
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
      }
    })
    expect(Math.max(...rows.heights) - Math.min(...rows.heights)).toBeLessThan(1)
    expect(rows.heights[0]).toBeGreaterThanOrEqual(88)
    expect(Math.abs(rows.gap)).toBeLessThan(1.5)
    expect([rows.bodyScrolls, rows.pageScrolls]).toEqual([false, false])

    // 今日は直径 22px の丸（CALENDAR-071・235）
    const today = cell(page, '2026-11-10').locator('.today-mark')
    await expect(today).toHaveText('10')
    const t = (await today.boundingBox())!
    expect([Math.round(t.width), Math.round(t.height)]).toEqual([22, 22])
    expect(await groundOf(today)).toBe(await token(page, '--today-bg'))
    // 件数「8 / 2」: 仕事 --work-text・「/」--text-faint・プライベート --private-text、L は 22px（CALENDAR-238・244・FRAME-133）
    await expect(count(page, '2026-11-10', 'work')).toHaveText('8')
    await expect(count(page, '2026-11-10', 'private')).toHaveText('2')
    expect(await colorOf(count(page, '2026-11-10', 'work'))).toBe(await token(page, '--work-text'))
    expect(await colorOf(count(page, '2026-11-10', 'private'))).toBe(await token(page, '--private-text'))
    expect(await colorOf(cell(page, '2026-11-10').locator('.mo-sep'))).toBe(await token(page, '--text-faint'))
    expect(await count(page, '2026-11-10', 'work').evaluate((e) => getComputedStyle(e).fontSize)).toBe('22px')
    // 片方が 0 なら飾りの「0」（--numeral）。前後の月の日は日付だけ --numeral（CALENDAR-232・240・FRAME-171）
    await expect(count(page, '2026-11-03', 'private')).toHaveText('0')
    expect(await colorOf(count(page, '2026-11-03', 'private'))).toBe(await token(page, '--numeral'))
    expect(await colorOf(cell(page, '2026-12-03').locator('.mo-date'))).toBe(await token(page, '--numeral'))
    await expect(cell(page, '2026-12-03').locator('.mo-counts')).toHaveCount(0)
    // 休みの日は地 --off-fill と「休」（前後の月の日も。D06）。土日・祝日は自動で休みにしない（CALENDAR-047・081・242）
    expect(await groundOf(cell(page, '2026-11-11'))).toBe(await token(page, '--off-fill'))
    await expect(cell(page, '2026-11-11').locator('.cp-off')).toContainText('休')
    expect(await groundOf(cell(page, '2026-12-02'))).toBe(await groundOf(cell(page, '2026-11-11')))
    expect(await groundOf(cell(page, '2026-11-15'))).not.toBe(await groundOf(cell(page, '2026-11-11')))
    // 祝日は日付が --sun、右上に祝日名（マスの幅の 60% まで）。祝日で休みの日は両方（CALENDAR-066・082・237）
    expect(await colorOf(cell(page, '2026-11-03').locator('.mo-date'))).toBe(await token(page, '--sun'))
    expect(await colorOf(cell(page, '2026-11-07').locator('.mo-date'))).toBe(await token(page, '--sat'))
    await expect(cell(page, '2026-11-23').locator('.cp-holiday')).toHaveText('勤労感謝の日')
    await expect(cell(page, '2026-11-23').locator('.cp-off')).toBeVisible()
    const name = (await cell(page, '2026-11-03').locator('.cp-holiday').boundingBox())!
    const box = (await cell(page, '2026-11-03').boundingBox())!
    expect(name.width).toBeLessThanOrEqual((box.width - 16) * 0.6 + 0.5)
    expect(name.x + name.width).toBeGreaterThan(box.x + box.width - 16)

    // PC はマスに乗せると地が --surface-2（休みの日は休みの地のまま。CALENDAR-249）
    await hover(page, cell(page, '2026-11-12'))
    await expect.poll(() => groundOf(cell(page, '2026-11-12'))).toBe(await token(page, '--surface-2'))
    await hover(page, cell(page, '2026-11-11'))
    await page.waitForTimeout(200)
    expect(await groundOf(cell(page, '2026-11-11'))).toBe(await token(page, '--off-fill'))
  })

  test('数字はその日のデイリーへ（積む）、マスのほかの所もその日のデイリーへ、前後の月の日はその月のマンスリーへ（7.12・9.3）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await count(page, '2026-11-10', 'private').click()
    await at(page, '/day/2026-11-10')
    await page.goBack()
    await at(page, MONTH)
    await pressCell(page, '2026-11-12')
    await at(page, '/day/2026-11-12')
    await page.goBack()
    await at(page, MONTH)
    await pressCell(page, '2026-12-02')
    await at(page, '/month/2026-12')
    await expect(page.getByTestId('cal-numeral')).toHaveText('12')
  })

  test('休みを付ける状態: ［休み］で帯と点線の枠。数字の上を押してもその日の休みが付き、月をまたいで続け、読み込み直しても残る。Esc・［終わる］で終わる（9.5）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    const off = page.getByTestId('cal-off')
    await off.click()
    await expect(off).toHaveAttribute('aria-pressed', 'true')
    const pressed = await token(page, '--today-bg')
    await expect.poll(() => groundOf(off)).toBe(pressed)
    const banner = page.getByTestId('off-banner')
    await expect(banner).toContainText('休みを付ける: 日付を押すと休みが付いたり外れたりします')
    expect(Math.round((await banner.boundingBox())!.height)).toBe(36)
    expect(await groundOf(banner)).toBe(await token(page, '--accent-soft'))
    expect(await colorOf(banner.locator('.mo-banner-text'))).toBe(await token(page, '--accent-strong'))
    const frame = await cell(page, '2026-11-12').evaluate((e) => {
      const s = getComputedStyle(e, '::before')
      return `${s.borderTopWidth} ${s.borderTopStyle}`
    })
    expect(frame).toBe('1px dotted')
    // 数字の上を押しても、デイリーへ移らずに休みが付く（CALENDAR-254）。休みの日を押すと外れる
    await clickAt(page, count(page, '2026-11-12', 'work'))
    await expect(cell(page, '2026-11-12')).toHaveClass(/cp-offday/)
    await pressCell(page, '2026-11-14')
    await expect(cell(page, '2026-11-14')).not.toHaveClass(/cp-offday/)
    await at(page, MONTH)
    // › で次の月へ移っても続き、前後の月の日も押せる（CALENDAR-257・258）
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2026-12')
    await expect(banner).toBeVisible()
    await pressCell(page, '2026-12-24')
    await pressCell(page, '2027-01-02')
    await expect(cell(page, '2026-12-24')).toHaveClass(/cp-offday/)
    await expect(cell(page, '2027-01-02')).toHaveClass(/cp-offday/)
    // Esc で終わる（CALENDAR-256・268）
    await page.keyboard.press('Escape')
    await expect(banner).toHaveCount(0)
    await expect(off).toHaveAttribute('aria-pressed', 'false')
    // 付けた・外した休みは端末に保存され、読み込み直しても残る（休みを付ける状態は終わっている。CALENDAR-259）
    await page.evaluate(() => window.__ds.flushNow())
    await page.reload()
    await page.getByTestId('cal-prev').click()
    await at(page, MONTH)
    await expect(cell(page, '2026-11-12')).toHaveClass(/cp-offday/)
    await expect(cell(page, '2026-11-14')).not.toHaveClass(/cp-offday/)
    await expect(banner).toHaveCount(0)
    // ［終わる］でも終わる
    await off.click()
    await page.getByTestId('off-end').click()
    await expect(banner).toHaveCount(0)
    await expect(off).toBeFocused()
  })
})

test.describe('マンスリー（端末の時差）', { tag: ['@pc'] }, () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('ロサンゼルスの時刻の端末でも、11/3 は文化の日で、予定は同じ日に数える（CALENDAR-064・D22）', async ({ page }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await expect(cell(page, '2026-11-03').locator('.cp-holiday')).toHaveText('文化の日')
    await expect(cell(page, '2026-11-02').locator('.cp-holiday')).toHaveCount(0)
    await expect(count(page, '2026-11-10', 'work')).toHaveText('8')
    await expect(count(page, '2026-11-19', 'work')).toHaveText('12')
    // 今日は端末の暦の日（日本の 11/10 9:00 は、ロサンゼルスでは 11/9 の夕方）
    await expect(page.getByTestId('calendar-month').locator('.today-mark')).toHaveText(['9'])
  })
})

test.describe('マンスリー（S）', { tag: ['@s'] }, () => {
  test('S: 56px の行、件数は「12/10」（14px・空白なし）でマスに収まり、祝日名は出さない。横にスクロールしない。マスを押すとその日のデイリー（9.2・D32）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await expect(page.getByTestId('calendar-month')).toHaveClass(/is-compact/)
    expect(Math.round((await cell(page, '2026-11-02').boundingBox())!.height)).toBe(56)
    await expect(cell(page, '2026-11-19').locator('.mo-counts')).toHaveText('12/10')
    expect(await count(page, '2026-11-19', 'work').evaluate((e) => getComputedStyle(e).fontSize)).toBe('14px')
    await countsFit(page, '2026-11-19')
    await expect(page.locator('.cp-holiday')).toHaveCount(0)
    expect(await colorOf(cell(page, '2026-11-03').locator('.mo-date'))).toBe(await token(page, '--sun'))
    await noHorizontalScroll(page)
    // 数字の上を押しても、その日のデイリー（S の数字はボタンにしない。CALENDAR-190・250）
    await count(page, '2026-11-10', 'work').tap({ force: true })
    await at(page, '/day/2026-11-10')
  })

  test('マスの上から横になぞると次の月（デイリーへ移らない）。休みを付ける状態ではマスを押すと休みが付く（9.4・9.5）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await touchSwipe(page, cell(page, '2026-11-17'), -120, 4)
    await at(page, '/month/2026-12')
    // なぞった直後のタップは、ブラウザが動きを止めるタップとして捨てることがあるので、少し待つ
    await page.waitForTimeout(300)
    await page.getByTestId('cal-off').tap()
    await expect(page.getByTestId('off-banner')).toBeVisible()
    await cell(page, '2026-12-09').tap()
    await expect(cell(page, '2026-12-09')).toHaveClass(/cp-offday/)
    await at(page, '/month/2026-12')
  })
})

test.describe('マンスリー（S・幅 360px）', { tag: ['@s'] }, () => {
  test.use({ viewport: { width: 360, height: 780 } })

  test('幅 360px でも横にスクロールせず、「12/10」がマスに収まる（D27・CALENDAR-226）', async ({ page }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await expect(cell(page, '2026-11-19').locator('.mo-counts')).toHaveText('12/10')
    await countsFit(page, '2026-11-19')
    await countsFit(page, '2026-11-15')
    await noHorizontalScroll(page)
  })
})

test.describe('マンスリー（M）', { tag: ['@m'] }, () => {
  test('M: 88px の行、数字のボタンは 34px 四方以上、祝日名を出す（9.1・9.3・D15・CALENDAR-246）', async ({ page }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    expect(Math.round((await cell(page, '2026-11-02').boundingBox())!.height)).toBe(88)
    await tapSize(count(page, '2026-11-10', 'work'), '仕事の数字')
    await tapSize(count(page, '2026-11-10', 'private'), 'プライベートの数字')
    await tapSize(count(page, '2026-11-19', 'work'), '仕事の数字（2桁）')
    await countsFit(page, '2026-11-19')
    await expect(cell(page, '2026-11-03').locator('.cp-holiday')).toHaveText('文化の日')
    await noHorizontalScroll(page)
    await count(page, '2026-11-19', 'private').tap()
    await at(page, '/day/2026-11-19')
  })
})

test.describe('マンスリー（iPhone）', { tag: ['@ios'] }, () => {
  test('マスを押すとその日のデイリーへ（CALENDAR-190・250）', async ({ page }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await pressCell(page, '2026-11-12')
    await at(page, '/day/2026-11-12')
  })
})
