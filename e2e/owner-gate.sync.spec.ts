// 持ち主の関所の E2E（docs/SPEC.md の 2.5・2.10・D13。CALENDAR-272・FRAME-288）。Firebase エミュレーターにつないだ開発サーバー
// （playwright.sync.config.ts。npm run test:e2e:sync）で、本番と同じに持ち主を確かめさせて（VITE_E2E_OWNER_LOCK=1。開発サーバーだけ）
// 動かす。持ち主の記録 config/owner はテストが管理者の権限で作る（作者が Firebase の画面で作るのと同じ。アプリからは作れない）。
// 共用の PC で、持ち主がカレンダーに予定を入れてログアウトした後に:
// - 別のアカウントでログインすると、ログインの画面に「このアカウントは Diary Studio の持ち主ではありません」と［ログアウト］だけ。
//   端末の中の予定はどこにも出ない（トップ画面も一瞬も出さない）
// - まだ持ち主だと確かめていないアカウントで、電波が無い時は、ログインの画面のまま「ネットにつながっていません。…」。端末の中の予定は
//   出ない。つながると確かめ直し、持ち主でなければ上と同じ文になる
// データは作り物だけ（アカウントはテストの回ごとに名前を替える）
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { adminCreateOwner, adminGoogleUser, useRules } from '../src/test/emulatorAdmin'
import { seed, signInSync, syncDevice } from './helpers'

test.beforeAll(async () => {
  await useRules(readFileSync('firestore.rules', 'utf8'))
})

/** 持ち主が入れる予定（作り物） */
const OWNER_TITLE = '持ち主の打ち合わせ'

/** 持ち主でログインして予定を入れ、カレンダーに出てクラウドへ送り終えてから、設定の［ログアウト］でログインの画面へ戻る */
async function ownerLeavesData(page: Page, owner: string): Promise<string> {
  await signInSync(page, owner)
  const id = await seed(
    page,
    ({ actions }, title) => actions.addItem({ origin: 'calendar', title, start: '2026-11-12' }),
    OWNER_TITLE,
  )
  await page.evaluate(() => {
    window.location.hash = '/week/2026-11-08'
  })
  await expect(page.getByTestId(`week-card-${id}`)).toContainText(OWNER_TITLE)
  await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-tone', 'ok', { timeout: 20_000 })
  await page.evaluate(() => {
    window.location.hash = '/settings'
  })
  await page.getByTestId('sign-out').click()
  await expect(page.getByTestId('login-page')).toBeVisible()
  return id
}

/**
 * この後ずっと、トップ画面・カレンダーの画面・持ち主の予定の件名が一度でも出たかを覚えておく（読むのは shownData）。
 * 確かめている間に一瞬だけ出て消える、ということも見落とさないように
 */
async function watchData(page: Page) {
  await page.evaluate((title) => {
    const w = window as unknown as { __shown: string[] }
    w.__shown = []
    const check = () => {
      if (document.querySelector('[data-testid="top-page"]')) w.__shown.push('top-page')
      if (document.querySelector('[data-testid^="view-"]')) w.__shown.push('view')
      if (document.body.innerText.includes(title)) w.__shown.push('title')
    }
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true })
  }, OWNER_TITLE)
}

const shownData = (page: Page) => page.evaluate(() => (window as unknown as { __shown: string[] }).__shown)

/** ログインの画面のままで、端末の中の予定はあるのに、どこにも出ていない */
async function noDataShown(page: Page, id: string) {
  await expect(page.getByTestId('login-page')).toBeVisible()
  await expect(page.getByTestId('top-page')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(OWNER_TITLE)
  // 端末の中には持ち主の予定が残っている（消したから見えないのではなく、関所で出していない）
  expect(await page.evaluate((i) => window.__ds.getRaw().items[i]?.title ?? null, id)).toBe(OWNER_TITLE)
  // カレンダーの行き先を開いても、ログインの画面へ戻される
  await page.evaluate(() => {
    window.location.hash = '/month/2026-11'
  })
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('#/login')
  await expect(page.getByTestId('top-page')).toHaveCount(0)
  expect(await shownData(page)).toEqual([])
}

test('持ち主でないアカウントでログインすると、ログインの画面に「持ち主ではありません」と［ログアウト］だけで、端末の予定は出ない（2.5 の 3）', async ({
  browser,
}) => {
  const stamp = Date.now()
  const owner = `e2e-owner-${stamp}`
  const other = `e2e-other-${stamp}`
  await adminCreateOwner(await adminGoogleUser(owner))
  const page = await syncDevice(browser)
  const id = await ownerLeavesData(page, owner)

  await watchData(page)
  await signInSync(page, other, { shown: false })
  await expect(page.getByTestId('login-owner')).toHaveText('このアカウントは Diary Studio の持ち主ではありません', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('login-sign-out')).toBeVisible()
  await expect(page.getByTestId('login-google')).toHaveCount(0)
  await noDataShown(page, id)
})

test('まだ持ち主だと確かめていないアカウントは、電波が無い間はログインの画面のまま「ネットにつながっていません」で、端末の予定は出ない（2.5）', async ({
  browser,
}) => {
  const stamp = Date.now()
  const owner = `e2e-owner-${stamp}`
  const other = `e2e-unverified-${stamp}`
  await adminCreateOwner(await adminGoogleUser(owner))
  const page = await syncDevice(browser)
  const id = await ownerLeavesData(page, owner)

  // クラウドの保存先（エミュレーターの Firestore）へ届かなくする。ログイン（エミュレーターの Authentication）は通す。
  // ログインした後に端末ごと電波を切る（ログインはネットが要るので、電波の無い端末で初めてログインすることはできない。共用の PC で
  // ログインした直後に電波が切れた、と同じ）
  const context = page.context()
  await context.route('http://127.0.0.1:8080/**', (route) => route.abort('internetdisconnected'))
  await watchData(page)
  await signInSync(page, other, { shown: false })
  await context.setOffline(true)
  const gate = page.getByTestId('login-owner-checking')
  await expect(gate).toHaveText('ネットにつながっていません。最初の1回はネットにつないでログインしてください。', {
    timeout: 20_000,
  })
  await expect(page.locator('.login-actions')).toContainText(`${other}@example.com`)
  await expect(page.getByTestId('login-sign-out')).toBeVisible()
  await noDataShown(page, id)

  // つながると確かめ直す: 持ち主でないので「持ち主ではありません」。この間も予定は出ない
  await context.unroute('http://127.0.0.1:8080/**')
  await context.setOffline(false)
  await expect(page.getByTestId('login-owner')).toHaveText('このアカウントは Diary Studio の持ち主ではありません', {
    timeout: 20_000,
  })
  await noDataShown(page, id)
})
