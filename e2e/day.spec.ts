// デイリーの E2E（docs/SPEC.md の 11.・7.3・4.3）: 本物のブラウザでしか確かめられない所だけ（開いた時の位置・今の時刻の線が
// 動くこと・区切りの地の色・貼り付く開始のカード・重なりの列と「+n」・L/M の 4:6 と S の上下の積み方）。並びや表記は
// dayModel.test.ts・DayView.test.tsx。データは作り物の e2e/fixtures/demoData.ts、今は 2026年11月10日（火）9:00
import { expect, test, type Locator, type Page } from '@playwright/test'
import { testIds } from '../src/features/calendar/common/testIds'
import { DEMO_IDS, DEMO_NOW, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar } from './helpers'

collectDiagnosticsOnFailure()

/** タイムスケジュールの中だけでスクロールする所 */
const scroller = (page: Page) => page.getByTestId(testIds.dayTimeline).locator('.dy-tl-scroll')

/** 1時間の高さ（px）。0:00 の時間の縞と 1:00 の縞の上の端の差 */
const hourPx = (page: Page) =>
  page
    .getByTestId(testIds.dayTimeline)
    .locator('.dy-hour')
    .evaluateAll((els) => (els[1] as HTMLElement).offsetTop - (els[0] as HTMLElement).offsetTop)

/** 要素の画面の上での四角（見えていない時は落とす） */
async function box(target: Locator) {
  const b = await target.boundingBox()
  if (!b) throw new Error('要素が見えていません')
  return b
}

/** CSS の変数の色を、ブラウザが計算した rgb() にする（トークンの値が変わってもテストを直さなくてよいように） */
const tokenColor = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement('div')
    probe.style.background = `var(${n})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    return c
  }, name)

test.describe('デイリー（PC）', { tag: ['@pc'] }, () => {
  test('開いた時の位置は今日なら今の 60分前（9:00 → 8:00）、今の時刻の線は 1分たつと動く。ほかの日は 7:00 で線は無い（ITEMS-131・132）', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date(DEMO_NOW) })
    await openCalendar(page, '/day/2026-11-10', { now: false, data: demoData() })
    const px = await hourPx(page)
    expect(px).toBe(48)
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollTop)).toBe(8 * px)
    const now = page.getByTestId(testIds.dayNow)
    await expect(now).toBeVisible()
    await expect(now).toHaveAttribute('data-minute', String(9 * 60))
    const top = await box(now)
    await page.clock.runFor(60_000)
    await expect(now).toHaveAttribute('data-minute', String(9 * 60 + 1))
    expect((await box(now)).y).toBeCloseTo(top.y + px / 60, 0)
    // 中を動かしてから次の日へ: 7:00 を上に出し直し、線は出さない
    await scroller(page).evaluate((e) => e.scrollTo(0, 0))
    await page.getByTestId(testIds.calNext).click()
    await expect(page.getByTestId(testIds.dayHead)).toContainText('2026.11.11')
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollTop)).toBe(7 * px)
    await expect(now).toHaveCount(0)
  })

  test('区切りの地は見出しから下の端まで、行の無い所も --work-area／--private-area（FRAME-126・127）', async ({ page }) => {
    await openCalendar(page, '/day/2026-11-12', { data: demoData() })
    for (const kind of ['work', 'private'] as const) {
      const area = page.getByTestId(testIds.dayArea(kind))
      const ground = await tokenColor(page, `--${kind}-area`)
      await expect(area).toHaveCSS('background-color', ground)
      // 区切りのいちばん下（行の無い所）に見えている色も、区切りの地
      const b = await box(area)
      const seen = await page.evaluate(
        ({ x, y }) => {
          let el = document.elementFromPoint(x, y)
          while (el) {
            const bg = getComputedStyle(el).backgroundColor
            if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
            el = el.parentElement
          }
          return null
        },
        { x: b.x + b.width / 2, y: b.y + b.height - 6 },
      )
      expect(seen, kind).toBe(ground)
    }
    expect(await tokenColor(page, '--work-area')).not.toBe(await tokenColor(page, '--private-area'))
  })

  test('日をまたぐ予定の開始のカードは、部分が見えている間は上の端に貼り付き、部分が終わると上へ流れる（ITEMS-144）', async ({
    page,
  }) => {
    // 11/12 は資料づくり（11/9 10:00〜11/12 18:00）と夜行バス（11/11 22:00〜11/12 2:00）の最終日。開いた時は 7:00 が上
    await openCalendar(page, '/day/2026-11-12', { data: demoData() })
    const materials = page.getByTestId(testIds.dayEvent(DEMO_IDS.materials))
    const bus = page.getByTestId(testIds.dayEvent(DEMO_IDS.nightBus))
    await expect(materials).toContainText('‹ 資料づくり')
    await expect(bus).toContainText('‹ 夜行バス')
    const px = await hourPx(page)
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollTop)).toBe(7 * px)
    const viewTop = (await box(scroller(page))).y
    const topGap = async (card: Locator) => Math.abs((await box(card)).y - viewTop)
    const bottomOf = async (card: Locator) => {
      const b = await box(card)
      return b.y + b.height
    }
    // 資料づくりの部分（0:00〜18:00）は見えているので、カードは上の端に貼り付く。夜行バス（0:00〜2:00）は流れて見えない
    expect(await topGap(materials)).toBeLessThanOrEqual(1)
    expect(await bottomOf(bus)).toBeLessThanOrEqual(viewTop + 1)
    // 0:30 を上へ: 夜行バスの部分の中なので、カードは上の端に貼り付く
    await scroller(page).evaluate((e, y) => e.scrollTo(0, y), px / 2)
    await expect.poll(() => topGap(bus)).toBeLessThanOrEqual(1)
    // 3:00 を上へ: 夜行バスの部分（2:00 まで）が見えなくなったので、カードも上へ流れる
    await scroller(page).evaluate((e, y) => e.scrollTo(0, y), 3 * px)
    await expect.poll(() => bottomOf(bus)).toBeLessThanOrEqual(viewTop + 1)
    expect(await topGap(materials)).toBeLessThanOrEqual(1)
  })

  test('重なる5件は4列に並び、5件目は「+1」の札（最後の列の右端・隠れた予定の時刻）（ITEMS-146・147）', async ({ page }) => {
    await openCalendar(page, '/day/2026-11-13', { data: demoData() })
    const shown = DEMO_IDS.busy.slice(0, 4).map((id) => page.getByTestId(testIds.dayEvent(id)))
    const boxes = await Promise.all(shown.map(box))
    // 左から順に並び、幅は等しく、重ならない
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width)
      expect(Math.abs(boxes[i].width - boxes[0].width)).toBeLessThanOrEqual(1)
    }
    await expect(page.getByTestId(testIds.dayEvent(DEMO_IDS.busy[4]))).toHaveCount(0)
    const more = page.getByTestId(testIds.dayMore)
    await expect(more).toHaveText('+1')
    const m = await box(more)
    const last = boxes[3]
    expect(m.x + m.width).toBeLessThanOrEqual(last.x + last.width)
    expect(m.x).toBeGreaterThan(last.x)
    // 隠れた「社内の確認」は 14:45 から（14:30 の資料の送付の上の端より 15分下）
    expect(m.y - last.y).toBeGreaterThan(0)
    expect(m.y - last.y).toBeLessThan(await hourPx(page))
  })
})

test.describe('デイリー（M。768px）', { tag: ['@m'] }, () => {
  test('左にリスト、右にタイムスケジュールを 4:6、間 16px（FRAME-023・ITEMS-103）', async ({ page }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    const list = await box(page.getByTestId(testIds.dayArea('work')))
    const tl = await box(page.getByTestId(testIds.dayTimeline))
    expect(Math.abs(list.y - tl.y)).toBeLessThanOrEqual(1)
    expect(Math.round(tl.x - (list.x + list.width))).toBe(16)
    expect(list.width / tl.width).toBeCloseTo(4 / 6, 1)
    expect(await hourPx(page)).toBe(48)
    await noHorizontalScroll(page)
  })
})

test.describe('デイリー（S）', { tag: ['@s'] }, () => {
  test('上に時刻の無いリスト（仕事 → プライベート。日の見出しより下の 45% まで）、下にタイムスケジュール（1時間 44px）（ITEMS-106）', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    const head = await box(page.getByTestId(testIds.dayHead))
    const work = await box(page.getByTestId(testIds.dayArea('work')))
    const list = await box(page.locator('.dy-list'))
    const tl = await box(page.getByTestId(testIds.dayTimeline))
    const below = await box(page.locator('.dy-main'))
    // 仕事の区切りが上、リストの下にタイムスケジュール
    expect(work.y).toBeGreaterThan(head.y)
    expect(tl.y).toBeGreaterThanOrEqual(list.y + list.height)
    // 見本の 11/10 は行が多いので、リストは 45% で止まり、その中でスクロールする
    expect(list.height).toBeLessThanOrEqual(below.height * 0.45 + 1)
    expect(list.height).toBeGreaterThan(below.height * 0.4)
    expect(await page.locator('.dy-list').evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true)
    expect(await hourPx(page)).toBe(44)
    await expect(page.getByTestId(testIds.dayNow)).toBeVisible()
    await noHorizontalScroll(page)
  })
})

test.describe('デイリー（iPhone）', { tag: ['@ios'] }, () => {
  test('上下に積んで描き、今日は今の時刻の線を出す', async ({ page }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    const list = await box(page.getByTestId(testIds.dayArea('work')))
    const tl = await box(page.getByTestId(testIds.dayTimeline))
    expect(tl.y).toBeGreaterThan(list.y)
    await expect(page.getByTestId(testIds.dayNow)).toBeVisible()
    await expect(page.getByTestId(testIds.dayEvent(DEMO_IDS.weekly))).toBeVisible()
  })
})
