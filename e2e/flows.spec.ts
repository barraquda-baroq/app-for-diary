// モードをまたぐ流れの E2E（docs/SPEC.md の 1.・6.2・6.4・6.15・12.4・12.8。FRAME-112・CALENDAR-025・ITEMS-001・018・037・043・238・269）:
// - 端末の時差（America/Los_Angeles）でも、マンスリー・ウィークリー・デイリーで予定の日と時刻は日本で入れた時と同じ（壁時計の値）。
//   その端末で登録した予定も、選んだ日・時刻のまま残る
// - 時計を進めても（0時を過ぎる・2日たつ）、過ぎた日の完了していない予定は動かさず、何も知らせない（今日の印だけが移る）
// - 同じ1件を、詳細で直す・完了にすると、ウィークリー・デイリー・マンスリーのどこにも同じ変更が出る（写しを作らない）
// - 削除してゴミ箱へ移した予定を戻すと、同じ1件がどのモードにも元のまま戻る（ゴミ箱の画面は段階5なので、戻すのは window.__ds から）
// - Task List 生まれの4通り（日付の有る無し）と、済んで7日を過ぎたタスクが、4つのモードで同じに出る・出ない（6.3）
// データは作り物の e2e/fixtures/demoData.ts（今日は 2026年11月10日（火）9:00）
import { expect, test, type Page } from '@playwright/test'
import { testIds } from '../src/features/calendar/common/testIds'
import { mkItem, mkTask } from '../src/domain/testData'
import { DEMO_IDS as I, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, openCalendar, openItemMore, rawItem, sheetReady } from './helpers'

collectDiagnosticsOnFailure()

/** 行き先を移る（# だけを替える。同じページのまま積む）。そのモードの画面が出るまで待つ */
async function go(page: Page, mode: 'year' | 'month' | 'week' | 'day', path: string) {
  await page.evaluate((p) => {
    window.location.hash = p
  }, path)
  await expect(page.getByTestId(testIds.view(mode))).toBeVisible()
}

/** 段のその日のマス（7日を横。L） */
const cellOf = (page: Page, kind: 'work' | 'private', date: string) =>
  page.locator(`[data-tier="${kind}"] .wk-cell[data-date="${date}"]`)

/** マンスリーのその日のその区分の件数（無い時は空） */
const countOf = (page: Page, date: string, kind: 'work' | 'private') => page.getByTestId(testIds.monthCount(date, kind))

/** タイムスケジュールの予定の、0:00 からの上の端の位置（px） */
async function eventTop(page: Page, id: string): Promise<number> {
  const grid = await page.getByTestId(testIds.dayTimeline).locator('.dy-grid').boundingBox()
  const ev = await page.getByTestId(testIds.dayEvent(id)).boundingBox()
  return ev!.y - grid!.y
}

test.describe('端末の時差（PC）', { tag: ['@pc'] }, () => {
  test.use({ timezoneId: 'America/Los_Angeles' })

  test('ロサンゼルスの時刻の端末でも、予定はマンスリー・ウィークリー・デイリーで日本で入れた日と時刻のまま。その端末で登録した予定も選んだ日と時刻のまま（CALENDAR-025・ITEMS-018）', async ({
    page,
  }) => {
    // ロサンゼルスの 11/10 9:00（日本では 11/11 2:00）
    await openCalendar(page, '/month/2026-11', { now: '2026-11-10T09:00:00-08:00', data: demoData() })
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/Los_Angeles')
    // マンスリー: 今日は 11/10、件数は日本と同じ（11/10 は仕事 8・プライベート 2）、11/3 は文化の日
    await expect(page.getByTestId(testIds.calendarMonth).locator('.today-mark')).toHaveText(['10'])
    await expect(countOf(page, '2026-11-10', 'work')).toHaveText('8')
    await expect(countOf(page, '2026-11-10', 'private')).toHaveText('2')
    await expect(page.getByTestId(testIds.monthCell('2026-11-03'))).toContainText('文化の日')
    // ウィークリー: 定例ミーティングは 11/10 の列に 10:00–11:30、夜行バスは 11/11 に始まる
    await go(page, 'week', '/week/2026-11-08')
    await expect(cellOf(page, 'work', '2026-11-10').getByTestId(testIds.weekCard(I.weekly))).toContainText('10:00–11:30')
    await expect(cellOf(page, 'private', '2026-11-11').getByTestId(testIds.weekStart(I.nightBus))).toBeVisible()
    // デイリー: 見出しは 2026.11.10、定例ミーティングは 10:00 の所（1時間 48px）
    await go(page, 'day', '/day/2026-11-10')
    await expect(page.getByTestId(testIds.dayHead)).toContainText('2026.11.10')
    expect(Math.round(await eventTop(page, I.weekly))).toBe(10 * 48)
    // この端末で 6:10 の空いた所（右の端。左は日をまたぐ資料づくりの列）から登録すると、11/10 6:00〜7:00 のまま残る
    const grid = page.getByTestId(testIds.dayTimeline).locator('.dy-grid')
    await page
      .getByTestId(testIds.dayTimeline)
      .locator('.dy-tl-scroll')
      .evaluate((e) => e.scrollTo(0, 5 * 48))
    const g = (await grid.boundingBox())!
    await page.mouse.click(g.x + g.width - 24, g.y + 6 * 48 + 8)
    await sheetReady(page)
    await page.getByTestId(testIds.itemTitle).fill('時差の確かめ')
    await page.getByTestId(testIds.itemRegister).click()
    await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
    const added = await page.evaluate(async () => {
      await window.__ds.flushNow()
      return Object.values(window.__ds.getRaw().items).find((i) => i.title === '時差の確かめ')
    })
    expect(added).toMatchObject({ start: '2026-11-10', due: null, startTime: '06:00', endTime: '07:00' })
    await expect(page.getByTestId(testIds.dayEvent(added!.id))).toBeVisible()
  })
})

test.describe('時計が進んでも動かさない・知らせない（PC）', { tag: ['@pc'] }, () => {
  test('0時を過ぎて2日たっても、過ぎた日の完了していない予定はその日のまま（マンスリーの数字が残る）で、お知らせ・通知・アイコンの数字・題の数は出さない（FRAME-112・ITEMS-238）', async ({
    page,
  }) => {
    // 通知・アイコンの数字・音・ふるえを使ったら覚えておく（何も使わないことの確かめ）
    await page.addInitScript(() => {
      const w = window as unknown as { __alerts: string[] }
      w.__alerts = []
      const note = (what: string) => () => {
        w.__alerts.push(what)
        return Promise.resolve()
      }
      const N = function () {
        w.__alerts.push('Notification')
      } as unknown as typeof Notification
      Object.assign(N, { permission: 'default', requestPermission: note('requestPermission') })
      Object.defineProperty(window, 'Notification', { configurable: true, value: N })
      Object.assign(navigator, { setAppBadge: note('setAppBadge') })
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: note('vibrate') })
      window.alert = () => w.__alerts.push('alert')
      HTMLMediaElement.prototype.play = note('play') as () => Promise<void>
    })
    await page.clock.install({ time: new Date('2026-11-10T23:59:30+09:00') })
    const items = {
      late: mkItem({ id: 'late', title: '出しそびれた書類', start: '2026-11-10' }),
      span: mkItem({ id: 'span', title: '続きの作業', kind: 'private', start: '2026-11-09', due: '2026-11-10' }),
    }
    await openCalendar(page, '/month/2026-11', { now: false, data: { items, offDays: {}, labelNames: {} } })
    const marks = page.getByTestId(testIds.calendarMonth).locator('.today-mark')
    await expect(marks).toHaveText(['10'])
    await expect(countOf(page, '2026-11-10', 'work')).toHaveText('1')
    const title = await page.title()
    const before = await page.evaluate(() => window.__ds.getRaw().items)

    // 0時を過ぎる（今日の印だけが 11/11 へ）、さらに2日たつ（11/13）
    await page.clock.runFor(60_000)
    await expect(marks).toHaveText(['11'])
    await page.clock.fastForward('48:00:00')
    await page.clock.runFor(60_000)
    await expect(marks).toHaveText(['13'])

    // 予定は動かない: 11/10 の数字はそのまま、今日（11/13）には出ない。端末の記録も変わらない
    await expect(countOf(page, '2026-11-10', 'work')).toHaveText('1')
    await expect(countOf(page, '2026-11-10', 'private')).toHaveText('1')
    await expect(countOf(page, '2026-11-13', 'work')).toHaveCount(0)
    expect(await page.evaluate(() => window.__ds.getRaw().items)).toEqual(before)
    await go(page, 'week', '/week/2026-11-08')
    await expect(cellOf(page, 'work', '2026-11-10').getByTestId(testIds.weekCard('late'))).toBeVisible()
    await expect(cellOf(page, 'work', '2026-11-13').locator('.wk-card')).toHaveCount(0)

    // 知らせない: お知らせ（トースト）・知らせの領域の文・通知・アイコンの数字・音・ふるえ・題の数字が無い
    await expect(page.locator('.toast')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __alerts: string[] }).__alerts)).toEqual([])
    expect(await page.title()).toBe(title)
  })
})

test.describe('同じ1件（PC）', { tag: ['@pc'] }, () => {
  test('詳細で件名を直す・完了にすると、同じ1件のウィークリーのカード・デイリーの予定・マンスリーの数字のどれにも出る（写しを作らない。ITEMS-001・269・240・246）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    const count = Object.keys(await page.evaluate(() => window.__ds.getRaw().items)).length
    // ウィークリーのカードから詳細を開いて件名を直す（自動で保存）
    await page.getByTestId(testIds.weekCard(I.meeting)).locator('.wk-open').click()
    await sheetReady(page)
    await page.getByTestId(testIds.itemTitle).fill('打ち合わせ（会議室）')
    await expect.poll(async () => (await rawItem(page, I.meeting))?.title).toBe('打ち合わせ（会議室）')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
    await expect(page.getByTestId(testIds.weekCard(I.meeting))).toContainText('打ち合わせ（会議室）')
    // デイリーの予定にも、同じ件名
    await go(page, 'day', '/day/2026-11-10')
    await expect(page.getByTestId(testIds.dayEvent(I.meeting))).toContainText('打ち合わせ（会議室）')
    // デイリーから詳細を開いて完了にすると、マンスリーの数字が 1 減り、ウィークリーのカードも完了の見え方
    await page.getByTestId(testIds.dayEvent(I.meeting)).locator('.dy-open').click()
    await sheetReady(page)
    await page.getByTestId(testIds.itemDone).click()
    await expect.poll(async () => (await rawItem(page, I.meeting))?.done).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
    await expect(page.getByTestId(testIds.done(I.meeting))).toHaveAttribute('data-done', 'true')
    await go(page, 'month', '/month/2026-11')
    await expect(countOf(page, '2026-11-10', 'work')).toHaveText('7')
    await go(page, 'week', '/week/2026-11-08')
    await expect(page.getByTestId(testIds.weekCard(I.meeting))).toHaveClass(/is-done/)
    await expect(page.getByTestId(testIds.weekCard(I.meeting))).toContainText('打ち合わせ（会議室）')
    // 端末の記録は同じ1件のまま（数も変わらない）
    const items = await page.evaluate(() => Object.values(window.__ds.getRaw().items))
    expect(items).toHaveLength(count)
    expect(items.filter((i) => i.title === '打ち合わせ（会議室）').map((i) => i.id)).toEqual([I.meeting])
  })

  test('削除してゴミ箱へ移した予定を戻すと、同じ1件がウィークリー・デイリー・マンスリーに元のまま戻る（ゴミ箱の画面は段階5。ITEMS-043・6.15）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    const original = await rawItem(page, I.book)
    // 詳細の［削除］→ 確かめて［削除］
    await page.getByTestId(testIds.weekCard(I.book)).locator('.wk-open').click()
    await sheetReady(page)
    await openItemMore(page)
    await page.getByTestId(testIds.itemDelete).click()
    await page.getByRole('dialog', { name: '『本を返す』を削除しますか？' }).getByRole('button', { name: '削除' }).click()
    await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
    await expect(page.getByTestId(testIds.weekCard(I.book))).toHaveCount(0)
    expect(await rawItem(page, I.book)).toBeNull()
    await go(page, 'month', '/month/2026-11')
    await expect(countOf(page, '2026-11-10', 'private')).toHaveText('1')
    await go(page, 'day', '/day/2026-11-10')
    await expect(page.getByTestId(testIds.dayRow(I.book))).toHaveCount(0)

    // ゴミ箱から戻す（その予定を控えたゴミ箱の項目を戻す）
    await page.evaluate(async (id) => {
      const raw = window.__ds.getRaw()
      const rec = Object.values(raw.trashRecords).find((r) => (r.record as { id: string }).id === id)
      if (!rec) throw new Error('ゴミ箱に無い')
      await window.__ds.actions.restoreTrashEntry(rec.entryId)
      await window.__ds.flushNow()
    }, I.book)
    // 同じ id・同じ中身で戻る（件名・メモの URL・区分・日付）
    expect(await rawItem(page, I.book)).toMatchObject({
      id: I.book,
      title: original!.title,
      memo: original!.memo,
      kind: 'private',
      start: original!.start,
    })
    expect(await page.evaluate(() => Object.keys(window.__ds.getRaw().trashRecords).length)).toBe(0)
    await expect(page.getByTestId(testIds.dayRow(I.book))).toContainText('本を返す')
    await go(page, 'month', '/month/2026-11')
    await expect(countOf(page, '2026-11-10', 'private')).toHaveText('2')
    await go(page, 'week', '/week/2026-11-08')
    await expect(cellOf(page, 'private', '2026-11-10').getByTestId(testIds.weekCard(I.book))).toContainText('本を返す')
  })
})

test.describe('Task List 生まれの予定（PC）', { tag: ['@pc'] }, () => {
  test('開始も締め切りも無い・開始だけの物はどのモードにも出ず、締め切りだけの物はその日、両方ある物は期間で〆付き。済んで7日を過ぎた物も完了の見え方で残る（6.3。CALENDAR-006〜009・013）', async ({
    page,
  }) => {
    const DAY = 24 * 60 * 60 * 1000
    const now = Date.parse('2026-11-10T09:00:00+09:00')
    const items = {
      none: mkTask({ id: 'none', title: '日付の無いタスク' }),
      due: mkTask({ id: 'due', title: '締め切りだけのタスク', due: '2026-11-12' }),
      both: mkTask({ id: 'both', title: '期間のタスク', start: '2026-11-11', due: '2026-11-13' }),
      startOnly: mkTask({ id: 'start-only', title: '開始だけのタスク', start: '2026-11-11' }),
      // 11/2 に済んで 8日たった（Task List には出ないが、カレンダーには完了で残る）
      old: mkTask({
        id: 'old',
        title: '先週済んだタスク',
        due: '2026-11-09',
        done: true,
        doneAt: now - 8 * DAY,
        doneOn: '2026-11-02',
      }),
    }
    await openCalendar(page, '/week/2026-11-08', { data: { items, offDays: {}, labelNames: {} } })
    // ウィークリー: 締め切りだけ → 11/12 の1日のカードに〆、両方 → 11/11〜11/13 の始点のカードに〆、済んだ物 → 11/9 に完了の見え方
    await expect(cellOf(page, 'work', '2026-11-12').getByTestId(testIds.weekCard('due'))).toContainText('〆')
    await expect(cellOf(page, 'work', '2026-11-11').getByTestId(testIds.weekStart('both'))).toContainText('〆')
    await expect(page.getByTestId(testIds.weekEnd('both'))).toBeVisible()
    await expect(cellOf(page, 'work', '2026-11-09').getByTestId(testIds.weekCard('old'))).toHaveClass(/is-done/)
    for (const id of ['none', 'start-only']) await expect(page.locator(`[data-testid$="-${id}"]`)).toHaveCount(0)
    await expect(page.getByTestId(testIds.view('week'))).not.toContainText('日付の無いタスク')
    await expect(page.getByTestId(testIds.view('week'))).not.toContainText('開始だけのタスク')
    // マンスリー: 11/11 は期間の1件だけ（開始だけの物は数えない）、11/12 は2件、済んだ物は数えない
    await go(page, 'month', '/month/2026-11')
    await expect(countOf(page, '2026-11-11', 'work')).toHaveText('1')
    await expect(countOf(page, '2026-11-12', 'work')).toHaveText('2')
    await expect(countOf(page, '2026-11-13', 'work')).toHaveText('1')
    await expect(countOf(page, '2026-11-09', 'work')).toHaveCount(0)
    // デイリー: 11/11 には期間のタスクだけ、11/9 には済んだタスク（斜線）
    await go(page, 'day', '/day/2026-11-11')
    await expect(page.getByTestId(testIds.dayRow('both'))).toBeVisible()
    await expect(page.getByTestId(testIds.dayRow('start-only'))).toHaveCount(0)
    await expect(page.getByTestId(testIds.view('day'))).not.toContainText('日付の無いタスク')
    await go(page, 'day', '/day/2026-11-09')
    await expect(page.getByTestId(testIds.dayRow('old'))).toContainText('先週済んだタスク')
    // イヤー: 11/11 は仕事の●（期間のタスク）、11/9 は済んだタスクだけなので薄い●
    await go(page, 'year', '/year/2026')
    await expect(page.getByTestId(testIds.yearCell('2026-11-11')).locator('.yr-dot.is-work')).toHaveAttribute(
      'data-state',
      'open',
    )
    await expect(page.getByTestId(testIds.yearCell('2026-11-09')).locator('.yr-dot.is-work')).toHaveAttribute(
      'data-state',
      'allDone',
    )
  })
})
