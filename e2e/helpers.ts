// E2E テスト用のヘルパー。NS の e2e/helpers.ts から。開発サーバーでは window.__ds（src/main.tsx）からログインの状態などを操作できる。
// データを用意する seed は、データのストアを作る段階1で足す
import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * 落ちた時の手がかりを残す（CI の WebKit でだけ時々ログインの画面が出ないことがあり、その時に何が起きていたかを見るため）。
 * テストの間、ブラウザの console・ページのエラー・失敗した通信・終わっていない通信を集め、落ちた時だけ
 * 「page-diagnostics」として添付する（line reporter はこの文を CI のログにそのまま出す）。ファイルの先頭で1回呼ぶ
 */
export function collectDiagnosticsOnFailure(): void {
  interface Rec {
    nav: string[]
    errors: string[]
    beats: string[]
    other: string[]
    pending: Map<string, number>
    t0: number
  }
  const logs = new WeakMap<Page, Rec>()
  test.beforeEach(async ({ page }) => {
    const rec: Rec = { nav: [], errors: [], beats: [], other: [], pending: new Map(), t0: Date.now() }
    logs.set(page, rec)
    const at = () => `@${Date.now() - rec.t0}`
    page.on('console', (m) => {
      const text = m.text()
      if (text.startsWith('[diag]')) rec.beats.push(`${text.slice(7)}${at()}`)
      else if (m.type() === 'error' || m.type() === 'warning')
        rec.errors.push(`console.${m.type()}${at()}: ${text.slice(0, 160)}`)
      // 毎回出るだけの物（開発サーバーの接続・React の案内）は省く
      else if (!text.startsWith('[vite]') && !text.includes('React DevTools'))
        rec.other.push(`console.${m.type()}${at()}: ${text.slice(0, 120)}`)
    })
    page.on('pageerror', (e) => rec.errors.push(`pageerror${at()}: ${e.message.slice(0, 200)}`))
    page.on('request', (r) => rec.pending.set(r.url(), Date.now() - rec.t0))
    page.on('requestfinished', (r) => rec.pending.delete(r.url()))
    page.on('requestfailed', (r) => {
      rec.pending.delete(r.url())
      rec.errors.push(`requestfailed${at()}: ${r.url()} ${r.failure()?.errorText ?? ''}`)
    })
    // 読み込み直し（開発サーバーの「依存を作り直したので再読み込み」など）が途中で起きていないかを見る
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) rec.nav.push(`navigated${at()}: ${f.url()}`)
    })
    page.on('load', () => rec.nav.push(`load${at()}`))
    // テストが時間切れで終わるとページが閉じられ、後から様子を読めないので、2秒ごとにページの様子を console に残す
    await page.addInitScript(() => {
      const beat = () => {
        const overlay = document.getElementById('ds-launch')
        const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 80)
        console.debug(
          `[diag] ready=${document.readyState} overlay=${overlay ? (overlay.getAttribute('data-launch-end') ?? 'shown') : 'none'} body=${text}`,
        )
      }
      setInterval(beat, 2000)
    })
  })
  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return
    const rec = logs.get(page)
    if (!rec) return
    const pending = [...rec.pending].map(([url, since]) => `pending(since @${since}): ${url}`)
    const state = await page
      .evaluate(() => {
        const overlay = document.getElementById('ds-launch')
        const attrs = overlay ? [...overlay.attributes].map((a) => `${a.name}=${a.value}`).join(' ') : 'none'
        const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200)
        return `url=${location.href} overlay=${attrs} body=${text}`
      })
      .catch((e: unknown) => `（ページは閉じられていた: ${String(e).slice(0, 60)}）`)
    // CI のログは長い添付の後ろを切るので、手がかりの大きい物から並べる
    await testInfo.attach('page-diagnostics', {
      body: [state, ...rec.nav, ...rec.errors, ...pending, ...rec.beats.slice(-5).map((b) => `beat ${b}`), ...rec.other].join(
        '\n',
      ),
      contentType: 'text/plain',
    })
  })
}

interface DevHook {
  /** エミュレーターにつないでいる時だけ: 仮のアカウントでログインする */
  signInForTest: (sub: string) => Promise<void>
  /** 画面のテスト用: Firebase を使わずにログインした状態にする */
  fakeSignIn: () => void
  /** ログインしているアカウント（同期のテスト用） */
  syncUid: () => string | null
  /** 新しい版を受け取った時の帯（本物の UpdateBanner）を出す */
  showUpdateBanner: () => void
  /** showUpdateBanner で出した帯の［更新する］が押されたか */
  updateApplied: () => boolean
}

declare global {
  interface Window {
    __ds: DevHook
  }
}

/**
 * アプリを開き、最初の画面が出るまで待つ。signedIn ならログインした状態にして（Firebase は使わない）、その行き先を開く。
 * そうでなければ、ログインしていないのでログインの画面が出る
 */
export async function openApp(page: Page, hash = '/', { signedIn = true }: { signedIn?: boolean } = {}): Promise<void> {
  await page.goto(`/#${hash}`)
  await page.waitForFunction(() => Boolean(window.__ds))
  if (signedIn) {
    await page.evaluate(() => window.__ds.fakeSignIn())
    // ログインの画面へ置き換えられていたら、元の行き先へ戻す
    await page.evaluate((h) => {
      if (window.location.hash !== `#${h}`) window.location.hash = h
    }, hash)
  }
  await expect(page.getByText('読み込み中…')).toHaveCount(0)
}

/**
 * ビルドした物（dist/）を出す vite preview の URL（E2E_PREVIEW=1 の時だけ playwright.config.ts が立ち上げる）。
 * ポートは開発サーバー（E2E_PORT、無ければ 5174）の +100
 */
export function previewURL(): string | null {
  if (!process.env.E2E_PREVIEW) return null
  return `http://localhost:${Number(process.env.E2E_PORT ?? 5174) + 100}`
}

/** 横にはみ出していない（横スクロールが出ない） */
export async function noHorizontalScroll(page: Page): Promise<void> {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(scroll).toBeLessThanOrEqual(width)
}

/** 'rgb(r, g, b)' の相対輝度 */
export function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** ディープダーク: 選んだ要素の背景がほぼ黒（白い面が出ない。透明は飛ばす） */
export async function darkSurfaces(page: Page, selectors: string[]): Promise<void> {
  for (const sel of selectors) {
    const els = page.locator(sel)
    const n = await els.count()
    for (let i = 0; i < n; i++) {
      const bg = await els.nth(i).evaluate((e) => getComputedStyle(e).backgroundColor)
      if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue
      expect(luminance(bg), `${sel} ${bg}`).toBeLessThan(0.05)
    }
  }
}

/** 押す所の大きさ（34px 以上。width も見る時は both） */
export async function tapSize(target: Locator, label: string, both = true): Promise<void> {
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  expect(box?.height, label).toBeGreaterThanOrEqual(34)
  if (both) expect(box?.width, label).toBeGreaterThanOrEqual(34)
}
