// 起動アニメーション（src/launch/launch.js。index.html に埋め込み、アプリの本体より先に動く）の E2E テスト。NS の e2e/launch.spec.ts から
// 名前・時間・下の画面を DS に直した物（docs/SPEC.md の 5.10）。
// テスト（navigator.webdriver）ではふだん出さないので、URL の launch=1（または localStorage の diary-studio:launch = 'force'）で出す。
// ログインしていないので、重なりの下ではログインの画面が起動する（docs/SPEC.md の 2.5）
import { expect, test, type Page } from '@playwright/test'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openApp } from './helpers'

collectDiagnosticsOnFailure()

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

/** 起動アニメーションの流れ（ページを開いてからの時刻。ミリ秒。最初の1回だけ） */
interface Timeline {
  /** 重なりを出した・取り除いた */
  shown?: number
  gone?: number
  /** 下のログインの画面ができた・アプリが知らせてきた（appReady） */
  login?: number
  ready?: number
  /** 描いた所（'worker' | 'page'）と、canvas の実ピクセルの大きさ（'幅x高さ'） */
  renderer?: string
  canvas?: string
  /** ページの中で描いていて重いので、動きをやめて最後の絵に飛んだ理由（'setup' | 'frame' | 'gaps'）と時刻 */
  slow?: string
  slowAt?: number
  /** 消え始めた理由（'done' | 'skip' | 'cap'）と時刻 */
  end?: string
  endAt?: number
  /** メインのスレッドの詰まり（250ミリ秒おきのタイマーが遅れた、いちばん長い時間） */
  lagMax?: number
}

/**
 * 起動アニメーションの流れを控える（readTimeline で読む）。同じことを console.debug にも出して、テストの側で lines に集める
 * （ページが固まっても、それまでの流れが残る）。失敗した時は afterEach が lines を添える。CI の WebKit（iPhone）でしか起きない
 * 失敗で、どちらで描いたか・いつ何が起きたか・メインのスレッドがどれだけ詰まったかを見るため。
 * DiaryStudioLaunch と Worker を包むので、keepOverlayUntilPressed などと一緒には使わない
 */
async function recordTimeline(page: Page): Promise<string[]> {
  const lines: string[] = []
  page.on('console', (m) => {
    const text = m.text()
    if (text.startsWith('[launch] ')) lines.push(text.slice(9))
    else if (m.type() === 'warning' || m.type() === 'error') lines.push(`${m.type()}:${text.slice(0, 80)}`)
  })
  page.on('pageerror', (e) => lines.push(`pageerror:${e.message.slice(0, 80)}`))
  await page.addInitScript(() => {
    const t: Timeline = {}
    ;(window as unknown as { __timeline: Timeline }).__timeline = t
    const now = () => Math.round(performance.now())
    const log = (s: string) => console.debug(`[launch] ${s}@${now()}`)
    let seen = false
    new MutationObserver(() => {
      const el = document.getElementById('ds-launch')
      if (el) {
        if (!seen) {
          seen = true
          t.shown = now()
          log('shown')
        }
        const renderer = el.getAttribute('data-launch-renderer')
        if (renderer && renderer !== t.renderer) {
          t.renderer = renderer
          log(`renderer=${renderer}`)
        }
        const cv = el.querySelector('canvas')
        if (cv && cv.width && t.canvas == null) t.canvas = `${cv.width}x${cv.height}`
        const slow = el.getAttribute('data-launch-slow')
        if (slow && t.slow == null) {
          t.slow = slow
          t.slowAt = now()
          log(`slow=${slow}`)
        }
        const end = el.getAttribute('data-launch-end')
        if (end && t.end == null) {
          t.end = end
          t.endAt = now()
          log(`end=${end}`)
        }
      } else if (seen && t.gone == null) {
        t.gone = now()
        log(`gone(lagMax=${t.lagMax ?? 0})`)
      }
      if (t.login == null && document.querySelector('[data-testid="login-page"]')) {
        t.login = now()
        log('login')
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-launch-renderer', 'data-launch-slow', 'data-launch-end'],
    })
    // Worker の知らせ（'started'・'end'）と、Worker で描けなかった時
    const Base = window.Worker
    if (Base) {
      window.Worker = class extends Base {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          this.addEventListener('message', (e) => log(`w:${(e.data as { type?: string })?.type}`))
          this.addEventListener('error', () => log('w:error'))
        }
      }
    }
    // アプリの知らせ（DiaryStudioLaunch.appReady）
    let api: { appReady: () => void } | undefined
    Object.defineProperty(window, 'DiaryStudioLaunch', {
      configurable: true,
      get: () => api,
      set(v: { appReady: () => void }) {
        const appReady = v.appReady
        v.appReady = () => {
          if (t.ready == null) {
            t.ready = now()
            log('ready')
          }
          appReady()
        }
        api = v
      },
    })
    // メインのスレッドの詰まり。0.25秒より長く遅れるたびに出す
    let last = performance.now()
    window.setInterval(() => {
      const at = performance.now()
      const lag = Math.round(at - last - 250)
      last = at
      if (lag > (t.lagMax ?? 0)) {
        t.lagMax = lag
        if (lag > 250) log(`lag=${lag}`)
      }
    }, 250)
  })
  return lines
}
const readTimeline = (page: Page) => page.evaluate(() => (window as unknown as { __timeline: Timeline }).__timeline)

/** 今のテストの流れ（recordTimeline の lines）。失敗した時に afterEach が添える */
let timeline: string[] | null = null

test.describe('起動アニメーション', () => {
  test.afterEach(async ({}, testInfo) => {
    if (timeline && testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('launch-timeline', { body: timeline.join(' '), contentType: 'text/plain' })
    }
    timeline = null
  })

  // ほかのテストは「テストではふだん出さない」を前提にしている（出ると最初に押した物を重なりが飲み込む。5.2）。
  // ブラウザ（WebKit など）が navigator.webdriver を true にしないと全部のテストが崩れるので、原因が分かるようにここで確かめる
  test('テストのブラウザでは navigator.webdriver が true で、強制しなければ出さない', async ({ page }) => {
    await page.goto('/#/', { waitUntil: 'domcontentloaded' })
    expect(await page.evaluate(() => navigator.webdriver)).toBe(true)
    await expect(overlay(page)).toHaveCount(0)
    await expect(loginButton(page)).toBeVisible()
  })

  test('強制すると最初に出て、アニメーションが終わりアプリの画面ができたら消えて取り除かれる', async ({ page }, testInfo) => {
    timeline = await recordTimeline(page)
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
    if (testInfo.project.name === 'iphone') {
      // CI の WebKit（iPhone）はソフトウェアの描画で遅く（Worker の最初の絵まで約1.5秒、メインのスレッドの詰まり 0.6〜0.8秒）、
      // アニメーションの終わりより先に5秒の期限が来ることがある。その時に期限（cap）で消えるのは docs/SPEC.md の 5.2 の決まりどおりの
      // 動きなので、ここでは 'done' と 'cap' の両方を認める（消えること・消えた後に押せること・active() が false になることは下で確かめる）
      expect(['done', 'cap']).toContain(await launchEnd(page))
    } else {
      expect(await launchEnd(page)).toBe('done')
    }
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

  test.describe('ページの中で描く時（Worker に canvas を渡せないブラウザ）', () => {
    // iPhone 14 と同じ大きさ・細かさ（dpr 3）
    test.use({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3 })

    test('メインのスレッドが遅い時は、動きをやめてロゴに飛び（倍率も 2 まで）、ログインの画面ができてから数秒で消える', async ({
      page,
      browserName,
    }) => {
      test.skip(
        browserName !== 'chromium',
        'メインのスレッドを遅くする（CDP の Emulation.setCPUThrottlingRate）のは Chromium だけ',
      )
      test.slow()
      timeline = await recordTimeline(page)
      // OffscreenCanvas の無いブラウザ（Safari 16.3 まで など）にして、ページの中で描かせる
      await page.addInitScript(() => {
        delete (window as { OffscreenCanvas?: unknown }).OffscreenCanvas
        Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { value: undefined, configurable: true })
      })
      // 遅い端末: メインのスレッドを 10 倍遅くする（下ごしらえと最初の絵が、この環境で 0.4秒ほどになる）
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 10 })
      await page.goto('/?launch=1#/', { waitUntil: 'commit' })
      await expect(overlay(page)).toHaveCount(0, { timeout: 20_000 })
      await expect(loginButton(page)).toBeAttached({ timeout: 20_000 })
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      const t = await readTimeline(page)
      expect(t.renderer).toBe('page')
      // 描く大きさの倍率は 2 まで（dpr 3 の画面でも、canvas は CSS の大きさの2倍）
      expect(t.canvas).toBe(`${390 * 2}x${664 * 2}`)
      // 下ごしらえか1コマが重いので、動きをやめて最後の絵（ロゴ）に飛んだ
      expect(['setup', 'frame', 'gaps']).toContain(t.slow)
      // 消え始めたのは、ロゴを0.5秒出してアプリの知らせもそろった時（done）か、アプリの起動がとても遅い時の5秒の期限（cap）
      expect(['done', 'cap']).toContain(t.end)
      // ログインの画面ができてから数秒で消える（ログインの画面より先に、5秒の期限で消えていることもある）
      expect(t.gone! - t.login!).toBeLessThan(3000)
      // 5秒の期限が重い1コマで遅れない（期限＋消える 0.25秒＋アプリの起動で遅れるタイマーの分まで）
      expect(t.gone! - t.shown!).toBeLessThan(5000 + 250 + 2000)
    })
  })

  test('外観ごとの地の色（白・黒・もっと暗い黒）と 360px の見え方', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', '画面の写しはスマホの幅だけで撮る')
    await page.setViewportSize({ width: 360, height: 760 })
    // 決まった瞬間の絵を撮るため、ページの中で描かせ（Worker を使わせない）、requestAnimationFrame をテストから進める
    // （アプリの知らせは requestAnimationFrame が来なくても届く）。ページの中で描く時の見張り（重い時はロゴに飛ぶ）は、
    // テストを動かす機械が混んでいても全部の場面を撮れるよう止める
    await page.context().addInitScript(() => {
      Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', { value: undefined, configurable: true })
      let api: { PAGE_DRAW: { setupMs: number; frameMs: number } } | undefined
      Object.defineProperty(window, 'DiaryStudioLaunch', {
        configurable: true,
        get: () => api,
        set(v: { PAGE_DRAW: { setupMs: number; frameMs: number } }) {
          v.PAGE_DRAW.setupMs = v.PAGE_DRAW.frameMs = Infinity
          api = v
        },
      })
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
