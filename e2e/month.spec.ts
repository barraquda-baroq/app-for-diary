// マンスリーの E2E（docs/SPEC.md の 9.・7.1〜7.4・7.6・7.12・3.10・4.5・4.7・4.11・4.12）: マス目の形と色（L・M・S）、件数の字の
// 大きさと太さ（L・M は 19〜28px・太さ 600 の少し淡い色、S は 14px から・太さ 600。狭い S でも「12/10」が入る。D27）、完了にした・戻した時の件数、押した時の行き先（S は目立たせずにいちばん上から。D32）、
// キーボードでマスの間を動く、休みを付ける状態（［休み］・帯・点線・付ける／外す・Esc・［終わる］・もう一度［休み］・モードの切り替え・
// 月をまたぐ・［今日］・［＋ 登録］・スワイプ・読み込み直し。D30）、端末の時差。データは作り物の e2e/fixtures/demoData.ts
// （今日は 2026年11月10日（火）9:00）。
// 11月の見本: 11/10 は仕事 8・プライベート 2、11/19 は 12/10、11/3 文化の日・11/23 勤労感謝の日、休みは 11/11・11/14・11/23・12/2
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkItem } from '../src/domain/testData'
import type { Item } from '../src/domain/types'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import { centerOf, collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar, seed, tapSize, touchSwipe } from './helpers'

collectDiagnosticsOnFailure()

const MONTH = '/month/2026-11'

/** 今の行き先（# の後ろ）が path になるまで待つ */
async function at(page: Page, path: string) {
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
}

const cell = (page: Page, date: string) => page.getByTestId(`month-cell-${date}`)
const count = (page: Page, date: string, kind: 'work' | 'private') => page.getByTestId(`month-count-${date}-${kind}`)
/** マスいっぱいのボタン */
const hitOf = (page: Page, date: string) => cell(page, date).locator('.mo-hit')

/** 予定を完了にする・完了を外す（画面を通さずにストアの操作で。ウィークリー・デイリーの丸は別の担当が作る） */
async function setDone(page: Page, id: string, done: boolean) {
  await seed(page, ({ actions }, a) => actions.setItemDone(a.id, a.done), { id, done })
}

/** その日の仕事の件数（数字） */
async function workCount(page: Page, date: string): Promise<number> {
  return Number(await count(page, date, 'work').textContent())
}

/**
 * 目立たせる枠（.flash。src/ui/motion.ts）が付いた要素を、この後ずっと覚えておく（目立たせないことの確かめ。読むのは flashed）。
 * 行き先を移ってもページは同じなので続く
 */
async function watchFlash(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __flashed: string[] }
    w.__flashed = []
    const note = (el: Element) => w.__flashed.push(el.getAttribute('data-testid') ?? el.className)
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && (r.target as Element).classList.contains('flash')) note(r.target as Element)
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue
          if (n.classList.contains('flash')) note(n)
          n.querySelectorAll('.flash').forEach(note)
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  })
}

const flashed = (page: Page) => page.evaluate(() => (window as unknown as { __flashed: string[] }).__flashed)

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

/** 字の大きさ（px の数）と太さ */
const fontOf = (target: Locator) =>
  target.evaluate((e) => {
    const cs = getComputedStyle(e)
    return { size: parseFloat(cs.fontSize), weight: cs.fontWeight }
  })

/**
 * L・M の件数の字（9.2・4.7）: 19〜28px・太さ 600（等幅の書体で読み込んでいるいちばん太い字。端末が太らせた字ではない）。
 * 「/」と飾りの「0」も同じ太さ
 */
async function countFontLM(page: Page, date: string): Promise<number> {
  const work = await fontOf(count(page, date, 'work'))
  expect(work.size, `${date} の件数の大きさ`).toBeGreaterThanOrEqual(19)
  expect(work.size, `${date} の件数の大きさ`).toBeLessThanOrEqual(28)
  expect(work.weight).toBe('600')
  expect(await fontOf(count(page, date, 'private'))).toEqual(work)
  expect(await fontOf(cell(page, date).locator('.mo-sep'))).toEqual(work)
  expect(await page.evaluate((px) => document.fonts.check(`600 ${px}px "Roboto Mono"`), work.size)).toBe(true)
  return work.size
}

/** 100件を超える日（11/18 は仕事 100・11/19 は両方 100・11/20 はプライベート 100。「99+」と出す。7.6） */
function crowded(): Record<string, Item> {
  const items: Record<string, Item> = {}
  for (let i = 0; i < 100; i++) {
    items[`w${i}`] = mkItem({ id: `w${i}`, title: `仕事 ${i}`, start: '2026-11-18', due: '2026-11-19' })
    items[`p${i}`] = mkItem({ id: `p${i}`, title: `用事 ${i}`, kind: 'private', start: '2026-11-19', due: '2026-11-20' })
  }
  return items
}

/** 休みを付ける状態の帯の高さ（36px。2行に折り返す S でも。9.5） */
async function bannerHeight(page: Page): Promise<number> {
  return Math.round((await page.getByTestId('off-banner').boundingBox())!.height)
}

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
    // 件数「8 / 2」: 仕事 --work-count・「/」--text-faint・プライベート --private-count（L・M は --*-text より少し淡い）、L の 1400px の
    // ウインドウでは 28px・太さ 600（CALENDAR-238・244・FRAME-133。作者の気になった所: 大きく太く、もう少し淡く）
    await expect(count(page, '2026-11-10', 'work')).toHaveText('8')
    await expect(count(page, '2026-11-10', 'private')).toHaveText('2')
    expect(await colorOf(count(page, '2026-11-10', 'work'))).toBe(await token(page, '--work-count'))
    expect(await colorOf(count(page, '2026-11-10', 'private'))).toBe(await token(page, '--private-count'))
    expect(await colorOf(cell(page, '2026-11-10').locator('.mo-sep'))).toBe(await token(page, '--text-faint'))
    expect(await countFontLM(page, '2026-11-10')).toBe(28)
    // 片方が 0 なら飾りの「0」（--numeral。太さは数字と同じ 600）。前後の月の日は日付だけ --numeral（CALENDAR-232・240・FRAME-171）
    await expect(count(page, '2026-11-03', 'private')).toHaveText('0')
    expect(await colorOf(count(page, '2026-11-03', 'private'))).toBe(await token(page, '--numeral'))
    expect(await countFontLM(page, '2026-11-03')).toBe(28)
    expect(await colorOf(cell(page, '2026-12-03').locator('.mo-date'))).toBe(await token(page, '--numeral'))
    await expect(cell(page, '2026-12-03').locator('.mo-counts')).toHaveCount(0)
    // 休みの日は地 --off-fill と「休」（前後の月の日も。D06）。土日・祝日は自動で休みにしない（CALENDAR-047・081・242）。
    // データを置いた直後は地の色が変わる途中（乗せた時と同じ 120ms の変わり方）なので、変わり終わるまで待つ
    const offFill = await token(page, '--off-fill')
    await expect.poll(() => groundOf(cell(page, '2026-11-11'))).toBe(offFill)
    await expect.poll(() => groundOf(cell(page, '2026-12-02'))).toBe(offFill)
    await expect(cell(page, '2026-11-11').locator('.cp-off')).toContainText('休')
    expect(await groundOf(cell(page, '2026-11-15'))).not.toBe(offFill)
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

  test('予定を完了にするとその期間の毎日の件数が減り、完了を外すと戻る。全部完了した日は何も書かない（7.6・9.2）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    // 資料づくり（11/9〜11/12 の仕事）を完了にすると、4日とも仕事の数が1つ減る
    const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']
    const before = await Promise.all(days.map((d) => workCount(page, d)))
    expect(before[1]).toBe(8)
    await setDone(page, DEMO_IDS.materials, true)
    for (const [i, d] of days.entries()) await expect(count(page, d, 'work')).toHaveText(String(before[i] - 1))
    await expect(count(page, '2026-11-13', 'work')).toHaveText('7')
    // 11/3 は祝日の当番（仕事 1件）だけの日。完了にすると何も書かない
    await expect(cell(page, '2026-11-03').locator('.mo-counts')).toHaveText('1/0')
    await setDone(page, 'demo-w-holiday-duty', true)
    await expect(cell(page, '2026-11-03').locator('.mo-counts')).toHaveCount(0)
    // 数字でない所からデイリーへ移って戻っても、完了にした物は数えない
    await pressCell(page, '2026-11-12')
    await at(page, '/day/2026-11-12')
    await page.goBack()
    await at(page, MONTH)
    await expect(count(page, '2026-11-10', 'work')).toHaveText('7')
    await expect(cell(page, '2026-11-03').locator('.mo-counts')).toHaveCount(0)
    // 完了を外すと戻る（ウィークリー・デイリーの［元に戻す］と同じ操作 setItemDone(id, false)）。初めから完了だった物も数える
    await setDone(page, DEMO_IDS.materials, false)
    for (const [i, d] of days.entries()) await expect(count(page, d, 'work')).toHaveText(String(before[i]))
    await setDone(page, 'demo-w-holiday-duty', false)
    await expect(cell(page, '2026-11-03').locator('.mo-counts')).toHaveText('1/0')
    await expect(cell(page, '2026-11-02').locator('.mo-counts')).toHaveCount(0)
    await setDone(page, 'demo-w-month-start', false)
    await expect(cell(page, '2026-11-02').locator('.mo-counts')).toHaveText('1/0')
    await expect(count(page, '2026-11-02', 'private')).toHaveClass(/is-zero/)
  })

  test('キーボード: Tab でマス目に入ると今日のマス、その数字へ続いてマス目を出る。矢印キー・Home・End でマスの間を動き、Enter でその日のデイリー（4.12）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    const month = page.getByTestId('calendar-month')
    // 操作の列の最後のボタンから Tab で入る。止まるのは今日のマスのボタンと、その数字のボタンだけ
    await page.getByTestId('cal-taskview').focus()
    await page.keyboard.press('Tab')
    await expect(hitOf(page, '2026-11-10')).toBeFocused()
    // キーボードで来たフォーカスには枠（:focus-visible。2px の --accent）
    expect(await hitOf(page, '2026-11-10').evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid')
    await page.keyboard.press('Tab')
    await expect(count(page, '2026-11-10', 'work')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(count(page, '2026-11-10', 'private')).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await month.evaluate((m) => m.contains(document.activeElement))).toBe(false)
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(hitOf(page, '2026-11-10')).toBeFocused()
    // ← → は前・次の日、↑ ↓ は前・次の週、Home・End はその週の日曜・土曜。ページはスクロールしない
    await page.keyboard.press('ArrowRight')
    await expect(hitOf(page, '2026-11-11')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(hitOf(page, '2026-11-18')).toBeFocused()
    await page.keyboard.press('End')
    await expect(hitOf(page, '2026-11-21')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(hitOf(page, '2026-11-15')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(hitOf(page, '2026-11-14')).toBeFocused()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    // 動いた先が Tab で止まるマスになる（マス目の中で1つだけ）
    await expect(month.locator('.mo-hit[tabindex="0"]')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await at(page, '/day/2026-11-14')
  })

  test('休みを付ける状態: ［休み］で帯と点線の枠。数字の上を押してもその日の休みが付き、月をまたいで・［今日］・［＋ 登録］の後も続き、読み込み直しても付けた休みが残る（9.5・D30）', async ({
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
    // 数字の上を押しても、デイリーへ移らずに休みが付く（CALENDAR-254）。休みの日を押すと外れる。地は 120ms で変わるので待つ
    await clickAt(page, count(page, '2026-11-12', 'work'))
    await expect(cell(page, '2026-11-12')).toHaveClass(/cp-offday/)
    await expect.poll(() => groundOf(cell(page, '2026-11-12'))).toBe(await token(page, '--off-fill'))
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
    // ［今日］で今月へ戻っても、［＋ 登録］を開いて閉じても続く（登録の画面の Esc はその画面だけを閉じる。D30）
    await page.getByTestId('cal-today').click()
    await at(page, MONTH)
    await expect(banner).toBeVisible()
    await page.getByTestId('cal-add').click()
    const sheet = page.getByTestId('item-sheet')
    await expect(sheet).toBeVisible()
    // 小さな画面が Esc を聞き始めるのは、中の欄へフォーカスを移した時（src/ui/Modal.tsx の useEffect。描いた直後の Esc は帯が受ける）
    await expect.poll(() => sheet.evaluate((e) => e.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await expect(banner).toBeVisible()
    await pressCell(page, '2026-11-26')
    await expect(cell(page, '2026-11-26')).toHaveClass(/cp-offday/)
    // Esc で終わる（CALENDAR-256・268）
    await page.keyboard.press('Escape')
    await expect(banner).toHaveCount(0)
    await expect(off).toHaveAttribute('aria-pressed', 'false')
    // 付けた・外した休みは端末に保存され、読み込み直しても残る（休みを付ける状態は終わっている。CALENDAR-259）
    await page.evaluate(() => window.__ds.flushNow())
    await page.reload()
    await expect(page.getByTestId('calendar-month')).toBeVisible()
    await at(page, MONTH)
    for (const d of ['2026-11-12', '2026-11-26', '2026-12-02']) await expect(cell(page, d)).toHaveClass(/cp-offday/)
    await expect(cell(page, '2026-11-14')).not.toHaveClass(/cp-offday/)
    await expect(banner).toHaveCount(0)
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2026-12')
    await expect(cell(page, '2026-12-24')).toHaveClass(/cp-offday/)
    await expect(cell(page, '2027-01-02')).toHaveClass(/cp-offday/)
  })

  test('休みを付ける状態は［終わる］・もう一度［休み］・モードの切り替えでも終わる（9.5・CALENDAR-256）', async ({ page }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    const off = page.getByTestId('cal-off')
    const banner = page.getByTestId('off-banner')
    // ［終わる］（フォーカスは［休み］へ）
    await off.click()
    await page.getByTestId('off-end').click()
    await expect(banner).toHaveCount(0)
    await expect(off).toBeFocused()
    // もう一度［休み］
    await off.click()
    await expect(banner).toBeVisible()
    await off.click()
    await expect(banner).toHaveCount(0)
    await expect(off).toHaveAttribute('aria-pressed', 'false')
    // モードを替える（週へ移って月へ戻ると、終わっている。マスを押すとデイリーへ）
    await off.click()
    await expect(banner).toBeVisible()
    await page.getByTestId('cal-mode-week').click()
    await at(page, '/week/2026-11-08')
    await page.getByTestId('cal-mode-month').click()
    await at(page, MONTH)
    await expect(banner).toHaveCount(0)
    await expect(off).toHaveAttribute('aria-pressed', 'false')
    await pressCell(page, '2026-11-12')
    await at(page, '/day/2026-11-12')
  })
})

test.describe('マンスリー（PC・幅 960px のウインドウ）', { tag: ['@pc'] }, () => {
  test.use({ viewport: { width: 960, height: 800 } })

  test('L のいちばん狭いマスでも、件数は太さ 600 の 19px 以上で「12 / 10」がマスに収まり、「/」はマスの真ん中、数字のボタンは 34px 四方以上。「99+」のマスは字を小さくして --*-text（9.2・D27）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await expect(cell(page, '2026-11-19').locator('.mo-counts')).toHaveText('12/10')
    const size = await countFontLM(page, '2026-11-19')
    // 28px より小さく（マスの幅で決まる）、太字の大きな字（18.66px 以上）のまま
    expect(size).toBeLessThan(28)
    await countsFit(page, '2026-11-19')
    for (const kind of ['work', 'private'] as const) await tapSize(count(page, '2026-11-19', kind), `数字 ${kind}`)
    const box = (await cell(page, '2026-11-19').boundingBox())!
    const sep = (await cell(page, '2026-11-19').locator('.mo-sep').boundingBox())!
    expect(Math.abs(sep.x + sep.width / 2 - (box.x + box.width / 2))).toBeLessThan(1)
    expect(await colorOf(count(page, '2026-11-19', 'work'))).toBe(await token(page, '--work-count'))

    // 「99+」のマス: 19px より小さくなる（太字の大きな字にならない）ので、4.5:1 の --work-text・--private-text。飾りの「0」は --numeral
    await openCalendar(page, MONTH, { data: { items: crowded() } })
    await expect(cell(page, '2026-11-19').locator('.mo-counts')).toHaveText('99+/99+')
    for (const date of ['2026-11-18', '2026-11-19', '2026-11-20']) await countsFit(page, date)
    const wide = await fontOf(count(page, '2026-11-19', 'work'))
    expect(wide.size).toBeLessThan(19)
    expect(wide.size).toBeGreaterThanOrEqual(14)
    expect(wide.weight).toBe('600')
    expect(await colorOf(count(page, '2026-11-19', 'work'))).toBe(await token(page, '--work-text'))
    expect(await colorOf(count(page, '2026-11-19', 'private'))).toBe(await token(page, '--private-text'))
    expect(await colorOf(count(page, '2026-11-18', 'private'))).toBe(await token(page, '--numeral'))
    await noHorizontalScroll(page)
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
  test('S（Pixel 7・幅 412px）: 56px の行、件数は「12/10」（14px・太さ 600・空白なし。色は --*-text）でマスに収まり、祝日名は出さない。横にスクロールしない（9.2・D27）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    expect(page.viewportSize()?.width).toBe(412)
    await expect(page.getByTestId('calendar-month')).toHaveClass(/is-compact/)
    expect(Math.round((await cell(page, '2026-11-02').boundingBox())!.height)).toBe(56)
    await expect(cell(page, '2026-11-19').locator('.mo-counts')).toHaveText('12/10')
    // 大きさと色は今までどおりで、太さだけ 600（作者の気になった所: スマホは太字に）。「/」も 600
    expect(await fontOf(count(page, '2026-11-19', 'work'))).toEqual({ size: 14, weight: '600' })
    expect(await fontOf(count(page, '2026-11-19', 'private'))).toEqual({ size: 14, weight: '600' })
    expect(await fontOf(cell(page, '2026-11-19').locator('.mo-sep'))).toEqual({ size: 14, weight: '600' })
    expect(await colorOf(count(page, '2026-11-19', 'work'))).toBe(await token(page, '--work-text'))
    expect(await colorOf(count(page, '2026-11-19', 'private'))).toBe(await token(page, '--private-text'))
    await countsFit(page, '2026-11-19')
    await expect(page.locator('.cp-holiday')).toHaveCount(0)
    expect(await colorOf(cell(page, '2026-11-03').locator('.mo-date'))).toBe(await token(page, '--sun'))
    await noHorizontalScroll(page)
  })

  test('S: マスのどこを押しても（数字の上でも）その日のデイリーへ。目立たせず、ページのいちばん上から出す（D32・CALENDAR-190・250）', async ({
    page,
  }) => {
    // 低い画面（マンスリーがページに収まらず、ページがスクロールする）
    await page.setViewportSize({ width: 412, height: 460 })
    await openCalendar(page, MONTH, { data: demoData() })
    // ページを下へスクロールしてから、下の行のマスの数字の上を押す（S の数字はボタンにしない）
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect(cell(page, '2026-11-26')).toBeInViewport()
    await watchFlash(page)
    await count(page, '2026-11-26', 'work').tap({ force: true })
    await at(page, '/day/2026-11-26')
    const day = page.getByTestId('view-day')
    await expect(day).toBeVisible()
    // 目立たせる枠は付かない（L・M の数字から来た時だけ。目立たせる時間 1.2秒の半分ほど待って確かめる）。ページも、時刻の無い物の
    // リストも、いちばん上のまま（スクロールしているのは、初めの時刻へ動かすタイムスケジュールだけ）
    await page.waitForTimeout(600)
    expect(await flashed(page)).toEqual([])
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const scrolledInside = await day.evaluate((root) => {
      const timeline = root.querySelector('[data-testid="day-timeline"]')
      return [...root.querySelectorAll<HTMLElement>('*')]
        .filter((e) => e.scrollTop > 0 && !(timeline && (timeline === e || timeline.contains(e) || e.contains(timeline))))
        .map((e) => e.className)
    })
    expect(scrolledInside).toEqual([])
  })

  test('マスの上から横になぞると次・前の月（デイリーへ移らない）。休みを付ける状態はなぞっても続き、マスを押すと休みが付く（9.4・9.5・D30）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    const banner = page.getByTestId('off-banner')
    await touchSwipe(page, cell(page, '2026-11-17'), -120, 4)
    await at(page, '/month/2026-12')
    // なぞった直後のタップは、ブラウザが動きを止めるタップとして捨てることがあるので、少し待つ
    await page.waitForTimeout(300)
    await page.getByTestId('cal-off').tap()
    await expect(banner).toBeVisible()
    // 帯の文は S では2行に折り返すが、高さは 36px のまま（［終わる］も 34px 四方）
    expect(await bannerHeight(page)).toBe(36)
    await tapSize(page.getByTestId('off-end'), '［終わる］')
    await cell(page, '2026-12-09').tap()
    await expect(cell(page, '2026-12-09')).toHaveClass(/cp-offday/)
    await at(page, '/month/2026-12')
    // 休みを付ける状態のまま、なぞって次の月へ（なぞり始めたマスの休みは変わらない）
    await touchSwipe(page, cell(page, '2026-12-16'), -120, 4)
    await at(page, '/month/2027-01')
    await expect(banner).toBeVisible()
    await page.waitForTimeout(300)
    await cell(page, '2027-01-13').tap()
    await expect(cell(page, '2027-01-13')).toHaveClass(/cp-offday/)
    // 右へなぞると前の月へ
    await touchSwipe(page, cell(page, '2027-01-20'), 120, -4)
    await at(page, '/month/2026-12')
    await expect(banner).toBeVisible()
    await expect(cell(page, '2026-12-09')).toHaveClass(/cp-offday/)
    await expect(cell(page, '2026-12-16')).not.toHaveClass(/cp-offday/)
    await expect(cell(page, '2027-01-02')).not.toHaveClass(/cp-offday/)
    await page.waitForTimeout(300)
    await page.getByTestId('off-end').tap()
    await expect(banner).toHaveCount(0)
  })
})

test.describe('マンスリー（S・幅 360px）', { tag: ['@s'] }, () => {
  test.use({ viewport: { width: 360, height: 780 } })

  test('幅 360px でも横にスクロールせず、「12/10」がマスに収まる。マスは指で押せる大きさ（34px 以上）のまま（D27・CALENDAR-226・FRAME-244）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    await expect(cell(page, '2026-11-19').locator('.mo-counts')).toHaveText('12/10')
    await countsFit(page, '2026-11-19')
    await countsFit(page, '2026-11-15')
    await noHorizontalScroll(page)
    await tapSize(hitOf(page, '2026-11-19'), 'マス')
  })

  test('「99+」の日も件数がマスに収まる（「/」はマスの真ん中のまま、字を小さくする。7.6・D27）', async ({ page }) => {
    await openCalendar(page, MONTH, { data: { items: crowded() } })
    await expect(cell(page, '2026-11-19').locator('.mo-counts')).toHaveText('99+/99+')
    await expect(cell(page, '2026-11-18').locator('.mo-counts')).toHaveText('99+/0')
    for (const date of ['2026-11-18', '2026-11-19', '2026-11-20']) await countsFit(page, date)
    await noHorizontalScroll(page)
  })
})

test.describe('マンスリー（M）', { tag: ['@m'] }, () => {
  test('M: 88px の行、件数は L と同じ 19〜28px・太さ 600、数字のボタンは 34px 四方以上、祝日名を出す（9.1・9.2・9.3・D15・CALENDAR-246）', async ({
    page,
  }) => {
    await openCalendar(page, MONTH, { data: demoData() })
    expect(Math.round((await cell(page, '2026-11-02').boundingBox())!.height)).toBe(88)
    await countFontLM(page, '2026-11-19')
    expect(await colorOf(count(page, '2026-11-19', 'work'))).toBe(await token(page, '--work-count'))
    await tapSize(count(page, '2026-11-10', 'work'), '仕事の数字')
    await tapSize(count(page, '2026-11-10', 'private'), 'プライベートの数字')
    await tapSize(count(page, '2026-11-19', 'work'), '仕事の数字（2桁）')
    await countsFit(page, '2026-11-19')
    await expect(cell(page, '2026-11-03').locator('.cp-holiday')).toHaveText('文化の日')
    await noHorizontalScroll(page)
    // 休みを付ける状態の帯は 36px（［終わる］は指で押せる 34px）
    await page.getByTestId('cal-off').tap()
    expect(await bannerHeight(page)).toBe(36)
    await page.getByTestId('off-end').tap()
    await expect(page.getByTestId('off-banner')).toHaveCount(0)
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
