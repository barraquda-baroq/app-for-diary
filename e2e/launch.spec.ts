// 起動アニメーション（src/launch/launch.js。index.html に埋め込み、アプリの本体より先に動く）の E2E テスト。NS の e2e/launch.spec.ts から
// 名前・時間・下の画面を DS に直した物（docs/SPEC.md の 5.10）。
// テスト（navigator.webdriver）ではふだん出さないので、URL の launch=1（または localStorage の diary-studio:launch = 'force'）で出す。
// ログインしていないので、重なりの下ではログインの画面が起動する（docs/SPEC.md の 2.5）
import { expect, test, type Page } from '@playwright/test'
import { noHorizontalScroll, openApp } from './helpers'

const PREFS_KEY = 'diary-studio:prefs'
const overlay = (page: Page) => page.getByTestId('launch-overlay')
/** 重なりの下に出る、ログインの画面の［Google でログイン］ */
const loginButton = (page: Page) => page.getByRole('button', { name: 'Google でログイン' })

/** 重なりが消え始めた理由（'done' | 'skip' | 'cap'）を控える（消え始めて 0.25 秒で取り除かれるので、属性を後から読めないことがある） */
async function recordLaunchEnd(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      for (const r of records) {
        const reason = (r.target as Element).getAttribute('data-launch-end')
        if (reason) (window as unknown as { __launchEnd: string }).__launchEnd = reason
      }
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-launch-end'] })
  })
}
const launchEnd = (page: Page) => page.evaluate(() => (window as unknown as { __launchEnd?: string }).__launchEnd ?? null)

/**
 * ［Google でログイン］が押された（クリックがボタンまで届いた）回数を数える。ログインは始めない（Firebase のプロジェクトは
 * 差し替え用の仮の値なので、届いたクリックはアプリに渡さずに止める）。ページを開き直すと 0 から数え直す
 */
async function recordAppClicks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __appClicks: number }
    w.__appClicks = 0
    document.addEventListener(
      'click',
      (e) => {
        const button = (e.target as Element | null)?.closest?.('button')
        if (!button || !(button.textContent ?? '').includes('Google でログイン')) return
        w.__appClicks++
        e.preventDefault()
        e.stopPropagation()
      },
      true,
    )
  })
}
const appClicks = (page: Page) => page.evaluate(() => (window as unknown as { __appClicks: number }).__appClicks)

/**
 * 開発サーバーが混んでいてアプリの画面ができるのが遅くても、重なりが出ているうちに押せるよう、重なりを押すまで残す
 * （アプリの知らせを受け取らず、5秒の期限を延ばす。消えるのは押した時だけになる）
 */
async function keepOverlayUntilPressed(page: Page) {
  await page.addInitScript(() => {
    let api: { TIMING: { capMs: number }; appReady: () => void } | undefined
    Object.defineProperty(window, 'DiaryStudioLaunch', {
      configurable: true,
      get: () => api,
      set(v: { TIMING: { capMs: number }; appReady: () => void }) {
        v.TIMING.capMs = 60_000
        v.appReady = () => {}
        api = v
      },
    })
  })
}

/** 外観を決めてから開く（localStorage はページを開く前に入れる） */
async function withPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [PREFS_KEY, JSON.stringify(prefs)])
}

test.describe('起動アニメーション', () => {
  // ほかのテストは「テストではふだん出さない」を前提にしている（出ると最初に押した物を重なりが飲み込む。5.2）。
  // ブラウザ（WebKit など）が navigator.webdriver を true にしないと全部のテストが崩れるので、原因が分かるようにここで確かめる
  test('テストのブラウザでは navigator.webdriver が true で、強制しなければ出さない', async ({ page }) => {
    await page.goto('/#/', { waitUntil: 'domcontentloaded' })
    expect(await page.evaluate(() => navigator.webdriver)).toBe(true)
    await expect(overlay(page)).toHaveCount(0)
    await expect(loginButton(page)).toBeVisible()
  })

  test('強制すると最初に出て、アニメーションが終わりアプリの画面ができたら消えて取り除かれる', async ({ page }) => {
    await recordLaunchEnd(page)
    await recordAppClicks(page)
    await page.goto('/?launch=1#/', { waitUntil: 'commit' })
    const el = overlay(page)
    // 最初の描画の前から画面いっぱいに出ている（読み上げない・押せるものを置かない）
    await expect(el).toBeVisible()
    await expect(el).toHaveAttribute('aria-hidden', 'true')
    await expect(el.locator('canvas')).toHaveCount(1)
    await expect(el.locator('a, button, input, textarea, select, [tabindex]')).toHaveCount(0)
    const box = await el.boundingBox()
    const viewport = page.viewportSize()!
    expect(box).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height })
    // アプリはその下で起動している（ログインしていないのでログインの画面）
    await expect(loginButton(page)).toBeAttached({ timeout: 10_000 })

    await expect(el).toHaveCount(0, { timeout: 6000 })
    expect(await launchEnd(page)).toBe('done')
    expect(
      await page.evaluate(() => (window as unknown as { DiaryStudioLaunch: { active(): boolean } }).DiaryStudioLaunch.active()),
    ).toBe(false)
    // 消えた後はアプリをそのまま操作できる
    await loginButton(page).click()
    expect(await appClicks(page)).toBe(1)
  })

  test('押すとすぐ消える（下の画面は押されない）', async ({ page }) => {
    await recordLaunchEnd(page)
    await recordAppClicks(page)
    await keepOverlayUntilPressed(page)
    await page.goto('/?launch=1#/', { waitUntil: 'commit' })
    const el = overlay(page)
    await expect(el).toBeVisible()
    await expect(loginButton(page)).toBeAttached({ timeout: 15_000 })
    await page.waitForTimeout(300)
    await expect(el).toBeVisible()
    const b = (await loginButton(page).boundingBox())!
    const start = Date.now()
    // ［Google でログイン］のある所を押しても、押したのは重なり
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await expect(el).toHaveCount(0)
    expect(Date.now() - start).toBeLessThan(1500)
    expect(await launchEnd(page)).toBe('skip')
    await page.waitForTimeout(300)
    expect(await appClicks(page)).toBe(0)
    await expect(loginButton(page)).toBeVisible()
    await expect(page).toHaveURL(/#\/login$/)
  })

  test('指で押しても（タップ・押したまま）すぐ消え、下の画面は押されない', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', '指で押せる（hasTouch）スマホだけ')
    await recordLaunchEnd(page)
    await recordAppClicks(page)
    await keepOverlayUntilPressed(page)
    /** 重なりを出し、その下にログインのボタンができて 0.4 秒たつまで待つ（ボタンの真ん中を返す） */
    let opened = 0
    async function open() {
      await page.evaluate(() => sessionStorage.clear())
      // 同じ URL（# だけ違う）だと読み込み直さないので、毎回 URL を変える
      await page.goto(`/?launch=1&n=${++opened}#/`, { waitUntil: 'commit' })
      await expect(overlay(page)).toBeVisible()
      await expect(loginButton(page)).toBeAttached({ timeout: 15_000 })
      await page.waitForTimeout(400)
      await expect(overlay(page)).toBeVisible()
      expect(await overlay(page).getAttribute('data-launch-end')).toBeNull()
      const box = (await loginButton(page).boundingBox())!
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }

    // タップ（指を離した所でクリックが作られる。重なりが先に押せなくなっていると、下のボタンが押される）
    await page.goto('/#/', { waitUntil: 'commit' })
    let p = await open()
    await page.touchscreen.tap(p.x, p.y)
    await expect(overlay(page)).toHaveCount(0)
    expect(await launchEnd(page)).toBe('skip')
    await page.waitForTimeout(300)
    expect(await appClicks(page)).toBe(0)
    await expect(page).toHaveURL(/#\/login$/)
    await expect(loginButton(page)).toBeVisible()

    // 押したまま（重なりが消え始めて取り除かれる時間より長く）から離す
    p = await open()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
    await page.waitForTimeout(350)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(overlay(page)).toHaveCount(0)
    expect(await launchEnd(page)).toBe('skip')
    await page.waitForTimeout(300)
    expect(await appClicks(page)).toBe(0)
    await expect(loginButton(page)).toBeVisible()

    // 長押し: 押したままの間は、消えても（見えなくても）重なりが残って押す操作を受け、離してから取り除かれる
    p = await open()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
    await page.waitForTimeout(1000)
    await expect(overlay(page)).toHaveAttribute('data-launch-end', 'skip')
    expect(await overlay(page).evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('auto')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(overlay(page)).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(await appClicks(page)).toBe(0)
    // 取り除いた後は、ふつうにアプリを押せる
    await loginButton(page).tap()
    expect(await appClicks(page)).toBe(1)
  })

  test('キーを押してもすぐ消える', async ({ page }) => {
    await recordLaunchEnd(page)
    await page.goto('/?launch=1#/', { waitUntil: 'commit' })
    await expect(overlay(page)).toBeVisible()
    await page.keyboard.press('Shift')
    await expect(overlay(page)).toHaveCount(0)
    expect(await launchEnd(page)).toBe('skip')
  })

  test('同じウインドウで読み込み直すと出ない。新しいタブでは出る', async ({ page, context }) => {
    await page.goto('/?launch=1#/', { waitUntil: 'commit' })
    await expect(overlay(page)).toBeVisible()
    await page.mouse.click(10, 10)
    await expect(overlay(page)).toHaveCount(0)

    await page.reload({ waitUntil: 'domcontentloaded' })
    // 出すならページを読む途中で作るので、この時点で無ければ出ない
    await expect(overlay(page)).toHaveCount(0)
    expect(await page.evaluate(() => sessionStorage.getItem('diary-studio:launched'))).toBe('1')

    const tab = await context.newPage()
    await tab.goto('/?launch=1#/', { waitUntil: 'commit' })
    await expect(overlay(tab)).toBeVisible()
  })

  test('見えていないタブ（裏で開いたタブ・先読み）で開くと出さず、見えた後の再読み込みでも出ない', async ({ page }) => {
    // 最初の読み込みだけ、見えていないタブにする
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e:hidden-once')) return
      sessionStorage.setItem('e2e:hidden-once', '1')
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    })
    await page.goto('/?launch=1#/', { waitUntil: 'domcontentloaded' })
    await expect(overlay(page)).toHaveCount(0)
    const flag = () => page.evaluate(() => sessionStorage.getItem('diary-studio:launched'))
    expect(await flag()).toBeNull()
    // タブに切り替えた（見えた）
    await page.evaluate(() => {
      delete (document as { visibilityState?: string }).visibilityState
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(await flag()).toBe('1')
    // 再読み込み（F5・「更新する」）では出さない
    await page.reload({ waitUntil: 'domcontentloaded' })
    expect(await page.evaluate(() => document.visibilityState)).toBe('visible')
    await expect(overlay(page)).toHaveCount(0)
  })

  test('localStorage の diary-studio:launch = force でも出る（強制しないテストでは出ない）', async ({ page, context }) => {
    await page.goto('/#/', { waitUntil: 'domcontentloaded' })
    await expect(overlay(page)).toHaveCount(0)
    await page.evaluate(() => localStorage.setItem('diary-studio:launch', 'force'))
    const tab = await context.newPage()
    await tab.goto('/#/')
    await expect(overlay(tab)).toBeVisible()
  })

  test('設定の「起動アニメーション」をオフにすると出ない。オンに戻すとまた出る', async ({ page, context }) => {
    await openApp(page, '/settings')
    // 設定 → 表示 の「起動アニメーション」（オン／オフ。初めはオン。docs/SPEC.md の 5.2・18.1）。
    // スイッチ（NS と同じ <label class="switch">。押すと切り替わる）と、読み上げの名前「起動アニメーション」
    const toggle = page.getByTestId('launch-switch')
    const sw = page.getByRole('switch', { name: '起動アニメーション', exact: true })
    await expect(sw).toBeChecked()
    await expect(toggle).toContainText('オン')
    await toggle.click()
    await expect(sw).not.toBeChecked()
    await expect(toggle).toContainText('オフ')
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').launchAnimation, PREFS_KEY)).toBe(false)

    // 新しいタブ（ウインドウを開いた最初の1回）でも出ない
    const off = await context.newPage()
    await off.goto('/?launch=1#/', { waitUntil: 'domcontentloaded' })
    await expect(overlay(off)).toHaveCount(0)
    await off.close()

    await toggle.click()
    await expect(sw).toBeChecked()
    const on = await context.newPage()
    await on.goto('/?launch=1#/', { waitUntil: 'commit' })
    await expect(overlay(on)).toBeVisible()
  })

  test('視差効果を減らす設定では動かさずにロゴだけを出し、描いてから0.5秒ほどで消える', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      type Times = {
        __created?: number
        __removed?: number
        __drawn?: number
        __ready?: number
        __fade?: number
        __reason?: string
      }
      const w = window as unknown as Times
      new MutationObserver(() => {
        const el = document.getElementById('ds-launch')
        if (el && w.__created == null) w.__created = performance.now()
        if (el && el.getAttribute('data-launch-end') && w.__fade == null) {
          w.__fade = performance.now()
          w.__reason = el.getAttribute('data-launch-end')!
        }
        if (!el && w.__created != null && w.__removed == null) w.__removed = performance.now()
      }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-launch-end'] })
      // Worker がロゴを描いた時（描いてすぐ 'started' を送ってくる）
      const Base = window.Worker
      window.Worker = class extends Base {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          this.addEventListener('message', (e) => {
            if ((e.data as { type?: string })?.type === 'started' && w.__drawn == null) w.__drawn = performance.now()
          })
        }
      }
      // アプリが最初の画面を出せた時（DiaryStudioLaunch.appReady を呼んだ時）
      let api: { appReady: () => void } | undefined
      Object.defineProperty(window, 'DiaryStudioLaunch', {
        configurable: true,
        get: () => api,
        set(v: { appReady: () => void }) {
          const appReady = v.appReady
          v.appReady = () => {
            if (w.__ready == null) w.__ready = performance.now()
            appReady()
          }
          api = v
        },
      })
    })
    await page.goto('/?launch=1#/', { waitUntil: 'commit' })
    const el = overlay(page)
    await expect(el).toHaveAttribute('data-launch-mode', 'still')
    await expect(el).toHaveCount(0, { timeout: 6000 })
    const t = await page.evaluate(() => {
      const w = window as unknown as Record<'__created' | '__removed' | '__drawn' | '__ready' | '__fade', number | undefined> & {
        __reason?: string
      }
      const at = (v: number | undefined) => (v == null ? null : v - w.__created!)
      return { removed: at(w.__removed)!, drawn: at(w.__drawn), ready: at(w.__ready), fade: at(w.__fade)!, reason: w.__reason }
    })
    // （Chromium は Worker で描く）
    expect(t.drawn).not.toBeNull()
    expect(t.ready).not.toBeNull()
    expect(t.reason).toBe('done')
    // 0.5秒は、重なりを出した時からではなく、ロゴを描いた時から数える（Worker の立ち上がりが遅い端末でもロゴを0.5秒は出す）
    expect(t.fade - t.drawn!).toBeGreaterThanOrEqual(495)
    // ロゴを0.5秒出し、アプリの最初の画面もできたら、すぐ消え始める（アニメーションの長さ（約2.27秒）は待たない）。
    // アプリの画面ができるまでの時間は開発サーバーの混み具合で変わるので、その時から数える
    expect(t.fade).toBeLessThan(Math.max(t.drawn! + 500, t.ready!) + 250)
    expect(t.removed - t.fade).toBeGreaterThanOrEqual(245)
  })

  test('ふだんは Worker（別のスレッド）で描き、絵が進む', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'OffscreenCanvas を Worker に渡せるブラウザ')
    await page.goto('/?launch=1#/', { waitUntil: 'commit' })
    const el = overlay(page)
    await expect(el).toHaveAttribute('data-launch-renderer', 'worker')
    await page.waitForTimeout(250)
    const a = await el.screenshot()
    await page.waitForTimeout(500)
    const b = await el.screenshot()
    expect(a.equals(b)).toBe(false)
  })

  test('外観ごとの地の色（白・黒・もっと暗い黒）と 360px の見え方', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', '画面の写しはスマホの幅だけで撮る')
    await page.setViewportSize({ width: 360, height: 760 })
    // 決まった瞬間の絵を撮るため、ページの中で描かせ（Worker を使わせない）、requestAnimationFrame をテストから進める
    // （アプリの知らせは requestAnimationFrame が来なくても届く）
    await page.context().addInitScript(() => {
      Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { value: undefined, configurable: true })
      const w = window as unknown as { __step: (to: number) => void }
      let queue: FrameRequestCallback[] = []
      let now = 0
      window.requestAnimationFrame = (cb) => queue.push(cb)
      window.cancelAnimationFrame = () => {}
      w.__step = (to: number) => {
        while (now < to) {
          now = Math.min(to, now + 16)
          const q = queue
          queue = []
          q.forEach((cb) => cb(now))
        }
      }
    })
    const cases = [
      { theme: 'white', anim: 'light', bg: 'rgb(251, 252, 254)' },
      { theme: 'dark', anim: 'dark', bg: 'rgb(5, 6, 7)' },
      { theme: 'deep-dark', anim: 'deep', bg: 'rgb(0, 0, 0)' },
    ]
    for (const c of cases) {
      const tab = await page.context().newPage()
      await withPrefs(tab, { v: 1, appearance: c.theme })
      await tab.goto('/?launch=1#/', { waitUntil: 'commit' })
      const el = overlay(tab)
      await expect(el).toHaveAttribute('data-launch-theme', c.anim)
      expect(await el.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(c.bg)
      await noHorizontalScroll(tab)
      await expect(el).toHaveAttribute('data-launch-renderer', 'page')
      // 1回目の描画で下ごしらえをし、2回目の描画（32）を 0 秒として数える。
      // 0.50秒（閉じた日記帳）・0.70秒（表紙が開く途中）・1.30秒（見開きに暦と「日々を、記す。」）・1.69秒（線が開いてロゴ）・
      // 2.26秒（ロゴ）
      for (const [name, t] of [
        ['book', 500],
        ['opening', 704],
        ['spread', 1300],
        ['open', 1690],
        ['logo', 2260],
      ] as const) {
        await tab.evaluate((ms) => (window as unknown as { __step: (to: number) => void }).__step(32 + ms), t)
        await tab.screenshot({ path: `e2e/artifacts/screens/launch-360-${c.theme}-${name}.png` })
      }
      await tab.close()
    }
  })
})
