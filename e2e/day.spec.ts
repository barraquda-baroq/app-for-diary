// デイリーの E2E（docs/SPEC.md の 11.・7.3・4.3・12.1・12.5）: 本物のブラウザでしか確かめられない所だけ（開いた時の位置・今の時刻の
// 線が動くこと・区切りの地の色・貼り付く開始のカード・重なりの列と「+n」の一覧・L/M の 4:6 と S の上下の積み方・空いた所を押した
// 時の登録の画面・マンスリーの数字から来た時に目立たせて見える所まで動かすこと・●の完了と［元に戻す］・すばやく足す（Esc で閉じると
// 行へフォーカスが戻る・開いても下の物が動かない）・指でなぞって次の日・狭い枠でも件名が読めること）。
// 並びや表記は dayModel.test.ts・DayView.test.tsx。データは作り物の e2e/fixtures/demoData.ts、今は 2026年11月10日（火）9:00
import { expect, test, type Locator, type Page } from '@playwright/test'
import { testIds } from '../src/features/calendar/common/testIds'
import { DEMO_IDS, DEMO_NOW, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar, sheetReady, touchSwipe } from './helpers'

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

/** 今の行き先（# の後ろ）が path になるまで待つ */
async function at(page: Page, path: string) {
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
}

/** タイムスケジュールの予定を置く所（時間の縞）の、その時刻（分）の所の、左の端から x px の点（画面の座標）。見える所まで動かす */
async function slotPoint(page: Page, minute: number, x: number) {
  const grid = page.getByTestId(testIds.dayTimeline).locator('.dy-grid')
  const px = await hourPx(page)
  await scroller(page).evaluate((e, y) => e.scrollTo(0, Math.max(0, y - 60)), (minute * px) / 60)
  const g = await box(grid)
  return { x: g.x + x, y: g.y + (minute * px) / 60 }
}

/** 予定の枠の幅と、予定を置ける所（時刻の欄の右）の幅の比 */
async function widthRatio(page: Page, id: string) {
  const events = await box(page.getByTestId(testIds.dayTimeline).locator('.dy-events'))
  return (await box(page.getByTestId(testIds.dayEvent(id)))).width / events.width
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
  test('開いた時の位置は今日なら今の 60分前（9:00 → 8:00）、今の時刻の線は 1分たつと動く。詳細を閉じても位置はそのまま、ほかの日は 7:00 で線は無い（ITEMS-131・132）', async ({
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
    // 中を動かしてから詳細を開いて閉じても、位置はそのまま（開いた時の位置は当て直さない。AMB-ITEMS-31）
    await scroller(page).evaluate((e, y) => e.scrollTo(0, y), 6 * px)
    await page.getByTestId(testIds.dayEvent(DEMO_IDS.weekly)).locator('.dy-ev-open').click()
    await sheetReady(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
    expect(await scroller(page).evaluate((e) => e.scrollTop)).toBe(6 * px)
    // 中を動かしてから次の日へ: 7:00 を上に出し直し、線は出さない
    await scroller(page).evaluate((e) => e.scrollTo(0, 0))
    await page.getByTestId(testIds.calNext).click()
    await expect(page.getByTestId(testIds.dayHead)).toContainText('2026.11.11')
    await expect.poll(() => scroller(page).evaluate((e) => e.scrollTop)).toBe(7 * px)
    await expect(now).toHaveCount(0)
  })

  test('区切りの地は見出しから下の端まで、行の無い所も --work-area／--private-area。ディープダークは --surface と間の線（FRAME-126・127・ITEMS-110）', async ({
    page,
  }) => {
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
    // ディープダーク: 区切りの地は区分で変えずに両方 --surface、2つの区切りの間に 1px の --rule-strong（ITEMS-110・FRAME-119・143）
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'deep-dark'))
    const surface = await tokenColor(page, '--surface')
    for (const kind of ['work', 'private'] as const) {
      await expect(page.getByTestId(testIds.dayArea(kind))).toHaveCSS('background-color', surface)
    }
    const lower = page.getByTestId(testIds.dayArea('private'))
    await expect(lower).toHaveCSS('border-top-width', '1px')
    await expect(lower).toHaveCSS('border-top-color', await tokenColor(page, '--rule-strong'))
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
    // 札は最後の列のすぐ右（まとまりの右の端に空けた札の所）で、どの予定の枠にも重ならない（資料の送付の区分のアイコンも隠さない）
    expect(m.x).toBeGreaterThanOrEqual(last.x + last.width)
    expect(m.x - (last.x + last.width)).toBeLessThanOrEqual(4)
    const events = await box(page.getByTestId(testIds.dayTimeline).locator('.dy-events'))
    expect(m.x + m.width).toBeLessThanOrEqual(events.x + events.width)
    const all = await page.getByTestId(testIds.dayTimeline).locator('.dy-event').all()
    for (const ev of all) {
      const b = await box(ev)
      const apart = m.x >= b.x + b.width || b.x >= m.x + m.width || m.y >= b.y + b.height || b.y >= m.y + m.height
      expect(apart, (await ev.getAttribute('data-testid')) ?? '').toBe(true)
    }
    // 隠れた「社内の確認」は 14:45 から（14:30 の資料の送付の上の端より 15分下）
    expect(m.y - last.y).toBeGreaterThan(0)
    expect(m.y - last.y).toBeLessThan(await hourPx(page))
    // 押すと隠れた予定の一覧、押すと詳細（ITEMS-148）
    await more.click()
    const item = page.getByTestId(testIds.dayMoreList).getByRole('menuitem', { name: '社内の確認、14:45–15:30' })
    await expect(item).toBeVisible()
    await item.click()
    await expect(page.getByTestId(testIds.itemSheet)).toBeVisible()
    await expect(page.getByTestId(testIds.itemTitle)).toHaveValue('社内の確認')
  })

  test('空いた所（13:10）を押すと登録の画面（この日・13:00〜14:00・仕事）。「＋ 予定を足す」は Enter で足して開いたまま、Esc で閉じる（ITEMS-149・123）', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    // 13:10 の、日をまたぐ予定（資料づくり）の列の線の右（押せない部分の入れ物の下の、空いた時間）
    const p = await slotPoint(page, 13 * 60 + 10, 80)
    await page.mouse.click(p.x, p.y)
    const sheet = page.getByTestId(testIds.itemSheet)
    await sheetReady(page)
    await expect(page.getByTestId(testIds.itemStart)).toHaveText('11月10日（火）')
    await expect(page.getByTestId(testIds.itemStartTime)).toHaveValue('13:00')
    await expect(page.getByTestId(testIds.itemEndTime)).toHaveValue('14:00')
    await expect(page.getByTestId(testIds.itemKind('work'))).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    // すばやく足す（プライベートの区切り）
    const area = page.getByTestId(testIds.dayArea('private'))
    await page.getByTestId(testIds.dayAdd('private')).click()
    const input = area.getByTestId(testIds.quickAddInput)
    await expect(input).toBeFocused()
    await input.fill('鉢植えの水やり')
    await input.press('Enter')
    await expect(area.locator('.dy-row', { hasText: '鉢植えの水やり' })).toBeVisible()
    await expect(input).toHaveValue('')
    await expect(input).toBeFocused()
    await input.press('Escape')
    await expect(page.getByTestId(testIds.quickAddInput)).toHaveCount(0)
    await expect(page.getByTestId(testIds.dayAdd('private'))).toBeVisible()
    // Esc で閉じた時は「＋ 予定を足す」の行へフォーカスを戻す（キーボードで続けて操作できるように）
    await expect(page.getByTestId(testIds.dayAdd('private'))).toBeFocused()
  })

  test('マンスリーの仕事の数字から来ると、仕事の区切りとタイムスケジュールの仕事の予定を目立たせる（ITEMS-124・CALENDAR-188）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    await page.getByTestId(testIds.monthCount('2026-11-10', 'work')).click()
    await at(page, '/day/2026-11-10')
    await expect(page.getByTestId(testIds.dayArea('work'))).toHaveClass(/\bflash\b/)
    await expect(page.getByTestId(testIds.dayEvent(DEMO_IDS.weekly))).toHaveClass(/\bflash\b/)
    await expect(page.getByTestId(testIds.dayEvent(DEMO_IDS.materials))).toHaveClass(/\bflash\b/)
    await expect(page.getByTestId(testIds.dayArea('private'))).not.toHaveClass(/\bflash\b/)
    await expect(page.getByTestId(testIds.dayEvent(DEMO_IDS.dinner))).not.toHaveClass(/\bflash\b/)
    // 目立たせるのは 1.2秒
    await expect(page.getByTestId(testIds.dayArea('work'))).not.toHaveClass(/\bflash\b/, { timeout: 3000 })
    // 11/11 のプライベートの数字から: 開いた時の 7:00 からは見えない夜行バス（22:00〜）が見える所まで動かす
    await page.goBack()
    await at(page, '/month/2026-11')
    await page.getByTestId(testIds.monthCount('2026-11-11', 'private')).click()
    await at(page, '/day/2026-11-11')
    const bus = page.getByTestId(testIds.dayEvent(DEMO_IDS.nightBus))
    await expect(bus).toHaveClass(/\bflash\b/)
    const view = await box(scroller(page))
    const b = await box(bus)
    expect(b.y).toBeGreaterThanOrEqual(view.y - 1)
    expect(b.y + b.height).toBeLessThanOrEqual(view.y + view.height + 1)
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
    // 日をまたぐ予定（資料づくり）の列は 1/3。重ならない打ち合わせは残りの幅いっぱい（前は 1/3 で件名が切れていた）
    expect(await widthRatio(page, DEMO_IDS.meeting)).toBeGreaterThan(0.6)
    await noHorizontalScroll(page)
  })
})

test.describe('デイリー（S）', { tag: ['@s'] }, () => {
  test.describe('見本と同じ 390px', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('1/3 の幅の枠でも件名が読める: 印を時刻の行へ下ろし、期間・時刻は入る表記だけ（途中で切らない。D39）', async ({
      page,
    }) => {
      await openCalendar(page, '/day/2026-11-10', { data: demoData() })
      /** 件名・時刻が入りきっているか（切れていれば中身の方が大きい） */
      const fits = (el: Locator) => el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1)
      // 資料づくり（間の日の「‹ 」のカード・1/3）とレビュー（ロック・1/3）
      for (const [id, title] of [
        [DEMO_IDS.materials, '‹ 資料づくり'],
        [DEMO_IDS.review, 'レビュー'],
      ] as const) {
        const ev = page.getByTestId(testIds.dayEvent(id))
        await expect(ev).toHaveClass(/\bis-narrow\b/)
        const t = ev.locator('.dy-ev-title')
        await expect(t).toHaveText(title)
        expect(await fits(t), id).toBe(true)
        // 印は件名の下（時刻の行）
        const marks = await box(ev.locator('.dy-ev-marks'))
        expect(marks.y, id).toBeGreaterThanOrEqual((await box(t)).y + 12)
      }
      const period = page.getByTestId(testIds.dayEvent(DEMO_IDS.materials)).locator('.dy-ev-time')
      await expect(period).toHaveText('〜11/12')
      expect(await fits(period)).toBe(true)
      // 面談の時刻は「15:30」まで（「15:30–17:」のように切らない）
      const interview = page.getByTestId(testIds.dayEvent(DEMO_IDS.interview)).locator('.dy-ev-time')
      await expect(interview).toHaveText('15:30')
      expect(await fits(interview)).toBe(true)
    })
  })

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
    // 重ならない予定は、日をまたぐ予定の列の右の残りの幅いっぱい（見本の「打…」の直し）
    expect(await widthRatio(page, DEMO_IDS.weekly)).toBeGreaterThan(0.6)
    // 指の端末では点線の丸の押せる所が、枠の左上の角から高さ 34px・幅は件名の始まりまで（見える丸の押せる所 24px の下の所も丸）。
    // 件名の始まりは「押すと詳細」のまま（隣と重ならない所だけ広げる。D08・AMB-CAL-14）
    const weekly = await box(page.getByTestId(testIds.dayEvent(DEMO_IDS.weekly)))
    const hitAt = (x: number, y: number) =>
      page.evaluate(
        (p) => {
          const el = document.elementFromPoint(p.x, p.y)
          const done = el?.closest('[data-testid^="done-"]')?.getAttribute('data-testid')
          return done ?? (el?.closest('.dy-ev-open') ? 'open' : null)
        },
        { x: weekly.x + x, y: weekly.y + y },
      )
    expect(await hitAt(28, 30)).toBe(testIds.done(DEMO_IDS.weekly))
    expect(await hitAt(33, 12)).toBe('open')
    await noHorizontalScroll(page)
  })

  test('●を押すと完了にして［元に戻す］のお知らせ、［元に戻す］で戻る。すばやく足す。左へなぞると次の日、右へなぞると前の日（ITEMS-116・123・FRAME-073）', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    const row = page.getByTestId(testIds.dayRow(DEMO_IDS.mail))
    await row.getByTestId(testIds.done(DEMO_IDS.mail)).tap()
    await expect(row).toHaveClass(/\bis-done\b/)
    const toast = page.locator('.toast', { hasText: '『メールの返信』を完了にしました' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: '元に戻す' }).tap()
    await expect(row).not.toHaveClass(/\bis-done\b/)
    // すばやく足す（仕事の区切り）。入力欄は「＋ 予定を足す」の行と同じ高さで、開いても下の物が動かない
    const addRow = page.getByTestId(testIds.dayAdd('work'))
    await addRow.scrollIntoViewIfNeeded()
    const rowHeight = (await box(addRow)).height
    const below = page.getByTestId(testIds.dayArea('private'))
    const belowY = (await box(below)).y
    await addRow.tap()
    const quick = page.getByTestId(testIds.dayArea('work')).locator('.dy-quick')
    await expect(quick).toBeVisible()
    expect((await box(quick)).height).toBe(rowHeight)
    expect((await box(below)).y).toBe(belowY)
    const input = page.getByTestId(testIds.dayArea('work')).getByTestId(testIds.quickAddInput)
    await input.fill('伝票の整理')
    await input.press('Enter')
    await expect(page.getByTestId(testIds.dayArea('work')).locator('.dy-row', { hasText: '伝票の整理' })).toBeVisible()
    await input.press('Escape')
    // タイムスケジュールの上でなぞる
    const tl = page.getByTestId(testIds.dayTimeline)
    await touchSwipe(page, tl, -140, 6)
    await at(page, '/day/2026-11-11')
    await expect(page.getByTestId(testIds.dayHead)).toContainText('2026.11.11')
    await touchSwipe(page, tl, 140, 0)
    await at(page, '/day/2026-11-10')
  })

  test('空いた所を押すと登録の画面（押した所の 30分単位）、「+n」を押すと隠れた予定の一覧（ITEMS-148・149）', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-13', { data: demoData() })
    // 16:20 の空いた時間 → 16:00〜17:00
    const p = await slotPoint(page, 16 * 60 + 20, 120)
    await page.touchscreen.tap(p.x, p.y)
    await expect(page.getByTestId(testIds.itemSheet)).toBeVisible()
    await expect(page.getByTestId(testIds.itemStart)).toHaveText('11月13日（金）')
    await expect(page.getByTestId(testIds.itemStartTime)).toHaveValue('16:00')
    await expect(page.getByTestId(testIds.itemEndTime)).toHaveValue('17:00')
    await page.goBack()
    await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
    // S は3列と「+2」
    await scroller(page).evaluate((e, y) => e.scrollTo(0, y), 13 * 44)
    const more = page.getByTestId(testIds.dayMore)
    await expect(more).toHaveText('+2')
    await more.tap()
    await expect(page.getByTestId(testIds.dayMoreList).getByRole('menuitem')).toHaveCount(2)
    await page.getByRole('menuitem', { name: '社内の確認、14:45–15:30' }).tap()
    await expect(page.getByTestId(testIds.itemSheet)).toBeVisible()
    await expect(page.getByTestId(testIds.itemTitle)).toHaveValue('社内の確認')
  })
})

test.describe('デイリー（iPhone）', { tag: ['@ios'] }, () => {
  test('上下に積んで描き、今日は今の時刻の線を出す。予定を押すと詳細', async ({ page }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    const list = await box(page.getByTestId(testIds.dayArea('work')))
    const tl = await box(page.getByTestId(testIds.dayTimeline))
    expect(tl.y).toBeGreaterThan(list.y)
    await expect(page.getByTestId(testIds.dayNow)).toBeVisible()
    await expect(page.getByTestId(testIds.dayEvent(DEMO_IDS.weekly))).toBeVisible()
    // 予定を押すと詳細
    await page.getByTestId(testIds.dayEvent(DEMO_IDS.weekly)).locator('.dy-ev-open').click()
    await expect(page.getByTestId(testIds.itemSheet)).toBeVisible()
    await expect(page.getByTestId(testIds.itemTitle)).toHaveValue('定例ミーティング')
  })
})
