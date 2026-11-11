// 2つのブラウザでの同期の E2E（docs/SPEC.md の 2.4・2.10・D13。CALENDAR-272・FRAME-288）。Firebase エミュレーターにつないだ
// 開発サーバー（playwright.sync.config.ts。npm run test:e2e:sync）で、2つのブラウザの文脈を同じアカウントの2台の端末に見立てる。
// 片方（A）で足した予定と付けた休みが、もう片方（B）のマンスリーの件数・ウィークリーのカード・休みの地に出て、B で動かした日付が
// A のカレンダーに出る。持ち主の確かめは本番と同じに動かし（VITE_E2E_OWNER_LOCK=1）、アクセスルールも本番の firestore.rules にする。
// 時刻は決めない（本物の時計。同期の時刻の見積もりを狂わせないように）。行き先は日付で決めるので、今日がいつでも同じ所を開く。
// データは作り物だけ（アカウントはテストの回ごとに名前を替える）
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { testIds } from '../src/features/calendar/common/testIds'
import { adminCreateOwner, adminGoogleUser, useRules } from '../src/test/emulatorAdmin'
import { seed, signInSync, startMouseDrag, syncDevice } from './helpers'

test.beforeAll(async () => {
  await useRules(readFileSync('firestore.rules', 'utf8'))
})

// 端末に見立てて開いた文脈（syncDevice）は、テストごとに閉じる（前のテストのアカウントの同期が、次のテストの間も動き続けないように。
// このファイルのテストは page を使わないので、閉じるのは syncDevice で開いた物だけ）
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((c) => c.close()))
})

/** 行き先を移る（# だけを替える。同じページのまま） */
async function go(page: Page, path: string) {
  await page.evaluate((p) => {
    window.location.hash = p
  }, path)
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
}

/** 仕事の段の、その日のマス（7日を横。L） */
const workCell = (page: Page, date: string) => page.locator(`[data-tier="work"] .wk-cell[data-date="${date}"]`)

/** 段のその日のマスの中のカード（7日を横。L） */
const cardIn = (page: Page, kind: 'work' | 'private', date: string, id: string) =>
  page.locator(`[data-tier="${kind}"] .wk-cell[data-date="${date}"]`).getByTestId(testIds.weekCard(id))

test('A で足した予定と休みが B のマンスリーの件数・ウィークリー・休みの地に出て、B で動かした日付が A に出る（CALENDAR-272）', async ({
  browser,
}) => {
  const sub = `e2e-cal-${Date.now()}`
  await adminCreateOwner(await adminGoogleUser(sub))
  const a = await syncDevice(browser)
  const b = await syncDevice(browser)
  await signInSync(a, sub)
  await signInSync(b, sub)

  // A: 11/12（木）に仕事の予定を足し、11/13（金）に休みを付ける
  const id = await seed(a, ({ actions }) => {
    const id = actions.addItem({ origin: 'calendar', kind: 'work', title: '同期の打ち合わせ', start: '2026-11-12' })
    actions.setOffDay('2026-11-13', true)
    return id
  })

  // B のマンスリー: 11/12 の仕事の件数が 1、11/13 は休みの地と「休」
  await go(b, '/month/2026-11')
  await expect(b.getByTestId(testIds.monthCount('2026-11-12', 'work'))).toHaveText('1', { timeout: 15_000 })
  const offCell = b.getByTestId(testIds.monthCell('2026-11-13'))
  await expect(offCell).toHaveAttribute('data-off', 'true', { timeout: 15_000 })
  await expect(offCell).toHaveClass(/cp-offday/)
  await expect(offCell).toContainText('休')

  // B のウィークリー: 11/12 の仕事のマスにカード、11/13 の列は休みの地でチェックが付いている
  await go(b, '/week/2026-11-08')
  await expect(workCell(b, '2026-11-12').getByTestId(testIds.weekCard(id))).toContainText('同期の打ち合わせ')
  await expect(b.getByTestId(testIds.weekCol('2026-11-13'))).toHaveClass(/cp-offday/)
  await expect(b.getByTestId(testIds.weekOff('2026-11-13'))).toBeChecked()

  // B の画面でカードを 11/14（土）のマスへマウスでドラッグして落とす（7.10・7.11）。上にあるマスに印が付いてから離す
  const drag = await startMouseDrag(b, workCell(b, '2026-11-12').getByTestId(testIds.weekCard(id)))
  await drag.moveTo(workCell(b, '2026-11-14'))
  await expect(workCell(b, '2026-11-14')).toHaveAttribute('data-drop', 'hover')
  await drag.drop()
  await expect(workCell(b, '2026-11-14').getByTestId(testIds.weekCard(id))).toBeVisible()
  expect(await b.evaluate((i) => window.__ds.getData().items[i], id)).toMatchObject({ start: '2026-11-14', due: null })

  // A: ウィークリーでは 11/14 のマスに移り、マンスリーの件数も 11/12 から 11/14 へ移る
  await go(a, '/week/2026-11-08')
  await expect(workCell(a, '2026-11-14').getByTestId(testIds.weekCard(id))).toContainText('同期の打ち合わせ', {
    timeout: 15_000,
  })
  await expect(workCell(a, '2026-11-12').getByTestId(testIds.weekCard(id))).toHaveCount(0)
  await go(a, '/month/2026-11')
  await expect(a.getByTestId(testIds.monthCount('2026-11-14', 'work'))).toHaveText('1')
  // 予定の無くなった 11/12 は件数を書かない（0 / 0 は空。9.2）
  await expect(a.getByTestId(testIds.monthCount('2026-11-12', 'work'))).toHaveCount(0)
  await expect(a.getByTestId('sync-indicator')).toHaveAttribute('data-tone', 'ok')
})

test('電波が無い間の足す・完了・休み・削除・日付の移動は端末に残り、同期の表示は「同期済み」でなくなる。つながると送って「同期済み」に戻り、もう片方のカレンダーに出る（FRAME-275・2.4・18.4）', async ({
  browser,
}) => {
  const sub = `e2e-off-${Date.now()}`
  await adminCreateOwner(await adminGoogleUser(sub))
  const a = await syncDevice(browser)
  const b = await syncDevice(browser)
  await signInSync(a, sub)
  await signInSync(b, sub)
  // つながっている間に3件（完了にする・消す・動かす物）を足し、B に届くまで待つ
  const ids = await seed(a, ({ actions }) => ({
    done: actions.addItem({ origin: 'calendar', kind: 'work', title: '完了にする予定', start: '2026-11-16' }),
    gone: actions.addItem({ origin: 'calendar', kind: 'work', title: '消す予定', start: '2026-11-17' }),
    moved: actions.addItem({ origin: 'calendar', kind: 'private', title: '動かす予定', start: '2026-11-18' }),
  }))
  await go(b, '/week/2026-11-15')
  await expect(b.getByTestId(testIds.weekCard(ids.moved))).toBeVisible({ timeout: 15_000 })
  await go(a, '/week/2026-11-15')

  // A の電波を切って、カレンダーの操作をする（画面と同じ actions を通す。ドラッグは日付の移動 moveItemDates）
  await a.context().setOffline(true)
  const added = await seed(
    a,
    async ({ actions }, i) => {
      const id = actions.addItem({ origin: 'calendar', kind: 'work', title: '電波の無い間の予定', start: '2026-11-19' })
      actions.setItemDone(i.done, true)
      actions.setOffDay('2026-11-20', true)
      actions.moveItemDates(i.moved, { start: '2026-11-21', due: null, clearEnd: false })
      await actions.trashItem(i.gone)
      return id
    },
    ids,
  )
  // A の画面には出ていて、同期の表示は「同期済み」でない（送信中・未送信 n件・オフライン）
  await expect(a.getByTestId(testIds.weekCard(added))).toContainText('電波の無い間の予定')
  await expect(a.getByTestId(testIds.weekCard(ids.gone))).toHaveCount(0)
  await expect(a.getByTestId('sync-indicator')).not.toHaveAttribute('data-tone', 'ok', { timeout: 15_000 })
  await expect(a.getByTestId('sync-indicator')).toHaveAttribute('title', /送信中|未送信|オフライン/)

  // つながると送り、「同期済み」に戻る。B のウィークリーに全部が出る
  await a.context().setOffline(false)
  await expect(a.getByTestId('sync-indicator')).toHaveAttribute('data-tone', 'ok', { timeout: 20_000 })
  await expect(cardIn(b, 'work', '2026-11-19', added)).toContainText('電波の無い間の予定', { timeout: 15_000 })
  await expect(b.getByTestId(testIds.weekCard(ids.done))).toHaveClass(/is-done/)
  await expect(b.getByTestId(testIds.weekCol('2026-11-20'))).toHaveClass(/cp-offday/)
  await expect(cardIn(b, 'private', '2026-11-21', ids.moved)).toBeVisible()
  await expect(b.getByTestId(testIds.weekCard(ids.gone))).toHaveCount(0)
})
