// E2E テスト用のヘルパー。NS の e2e/helpers.ts から。開発サーバーでは window.__ds（src/main.tsx）からログインの状態・データ・操作を使える。
// 段階2のカレンダーの E2E は、画面を通さずにデータを置き（seedData・seed）、時刻を決めて開く（openCalendar。初めは
// 2026年11月10日（火）9:00）。指の操作は Chromium（Pixel 7・タブレット）では CDP の本物のタッチ、WebKit（iPhone）では
// 合成した PointerEvent（pointerType: 'touch'）で送る（longPressDrag・touchSwipe）。データは作り物だけを使う（個人の情報を入れない）
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { AppData, Item } from '../src/domain/types'
import type { Prefs } from '../src/store/uiStore'

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
    // E2E_LAUNCH_RENDERER=page の時（CI の iPhone の WebKit と、その見比べの webkit-diag。.github/workflows/ci.yml）: 起動アニメーションを
    // Worker ではなくページの中で描かせる（OffscreenCanvas の無いブラウザと同じにする。e2e/launch.spec.ts の「ページの中で描く時」と同じ）。
    // CI の WebKit（Linux 版）は、Worker で描いた絵を画面に渡す所で時々ページごと落ちるため（docs/SPEC.md の 2.10）
    if (process.env.E2E_LAUNCH_RENDERER === 'page') {
      await page.addInitScript(() => {
        delete (window as { OffscreenCanvas?: unknown }).OffscreenCanvas
        Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
          value: undefined,
          configurable: true,
        })
      })
    }
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

/** 画面から呼ぶ操作（src/store/actions.ts） */
export type Actions = typeof import('../src/store/actions').actions

export interface DevHook {
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
  /** 表示用のデータ（直した後の物）・端末の raw のデータ */
  getData: () => AppData
  getRaw: () => AppData
  /** 画面から呼ぶ操作 */
  actions: Actions
  /** 端末の中のデータを読み終えるまで待つ */
  whenStoreReady: () => Promise<void>
  /** 端末の中のデータを丸ごと置き換える（足りない表は空） */
  replaceAllData: (data: AppData) => Promise<void>
  /** 保留中の変更をすぐ保存する */
  flushNow: () => Promise<boolean>
  /** ゴミ箱の期限切れを決める時刻を差し替える */
  setTrashClock: (fn: () => number | null) => void
  /** アプリの履歴（src/history/appHistory.ts）が、ブラウザの履歴を動かし終えるまで待つ */
  historyIdle: () => Promise<void>
  /** 今の履歴の形 */
  historyShape: () => HistoryShape | null
}

/** アプリの履歴の形（src/history/appHistory.ts の HistoryShape） */
export interface HistoryShape {
  /** popstate が何から来るか（iPhone・iPad は edge-flick、Android・PC は os-back） */
  source: 'edge-flick' | 'os-back'
  busy: boolean
  cur: number
  base: number | null
  shownIdx: number
  top: number
  buildPending: boolean
  exitArmed: boolean
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

// ---------- 段階2: データを置く・時刻を決めて開く ----------

/**
 * 画面を通さずにデータを用意する（NS の seed）。fn はブラウザの中で動く（外の変数は arg で渡す）。終わったら保存まで待つ。
 *   const id = await seed(page, ({ actions }) => actions.addItem({ origin: 'calendar', title: '打ち合わせ', start: '2026-11-10' }))
 */
export async function seed<R, A = undefined>(page: Page, fn: (hook: DevHook, arg: A) => R, arg?: A): Promise<Awaited<R>> {
  const result = await page.evaluate(
    async ({ src, arg }) => {
      await window.__ds.whenStoreReady()
      const f = new Function(`return (${src})`)() as (h: DevHook, a: unknown) => unknown
      const r = await f(window.__ds, arg)
      await window.__ds.flushNow()
      return r
    },
    { src: fn.toString(), arg: arg as unknown },
  )
  return result as Awaited<R>
}

/** 端末の中のデータを、渡した物（足りない表は空）に置き換えて保存する。アプリを開いた後に呼ぶ */
export async function seedData(page: Page, data: Partial<AppData>): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__ds))
  await page.evaluate(async (d) => {
    await window.__ds.whenStoreReady()
    await window.__ds.replaceAllData(d as AppData)
    await window.__ds.flushNow()
  }, data)
}

/** 端末の raw の予定（知らない値も残っているか・ゴミ箱へ移ったかの確かめ。無ければ null） */
export async function rawItem(page: Page, id: string): Promise<Item | null> {
  return page.evaluate((i) => window.__ds.getRaw().items[i] ?? null, id)
}

/** カレンダーの E2E の「今」（2026年11月10日（火）9:00 日本時間。docs/SPEC.md の例の日） */
export const E2E_NOW = '2026-11-10T09:00:00+09:00'

export interface OpenCalendarOptions {
  /** 今の時刻（page.clock.setFixedTime。タイマーは本物のまま動く）。false なら時刻を決めない（clock.install を自分でする時） */
  now?: string | Date | false
  /** 外観（white・dark・deep-dark・system） */
  appearance?: 'system' | 'white' | 'dark' | 'deep-dark'
  /** 端末ごとの表示の設定（lastMode・collapsed など。src/store/uiStore.ts の Prefs） */
  prefs?: Partial<Prefs>
  /** 開いた後に置くデータ */
  data?: Partial<AppData>
  /**
   * 開いた後に、何も無い所（ヘッダーの真ん中）を1回押して、アプリの履歴の形（土台と「戻る」「進む」の印）を作らせるか（既定 true。
   * アプリは押す前には履歴に積まない。src/history/appHistory.ts）。押す前の形を確かめる時は false
   */
  arm?: boolean
}

/** openCalendar を呼んだ回の番号（表示の設定を置いたかの印を、呼んだ回ごとに分ける） */
let openCount = 0

/**
 * ログインした状態（テスト用の印 diary-studio:test-auth。Firebase は使わない）で、決めた時刻・外観・表示の設定でカレンダーを開く。
 * 表示の設定は、その回に開いた時だけ置く（読み込み直しても、アプリが覚えた設定が残る）。起動アニメーションは出さない（強制しない）。
 * 同じページでもう一度呼ぶと、その回の設定で読み込み直す（行き先の # だけが違う時もページを開き直す）。
 *   await openCalendar(page, '/week/2026-11-08', { data: { items } })
 */
export async function openCalendar(page: Page, hash = '/', opts: OpenCalendarOptions = {}): Promise<void> {
  const { now = E2E_NOW, appearance, prefs, data } = opts
  if (now !== false) await page.clock.setFixedTime(new Date(now))
  const stored = appearance || prefs ? { v: 1, ...(appearance ? { appearance } : {}), ...prefs } : null
  // 2回目からは、# だけが違う行き先へ移ってもページは読み込み直されない（初めに置いた物が効かない）。移ってから読み込み直すと、
  // その間にアプリが # を書き換え（#/ → 前回のモードの #/week/… など）、書き換えた後の行き先を読み込み直すことがある（CI で
  // 前回のモードが 1回目のままになった）。2回目からは ? の後ろを変えて、初めから新しいページとして開く（アプリは ? の後ろを
  // launch=1 しか見ない）
  const opened = page.url() !== 'about:blank'
  const mark = `e2e:prefs-set:${++openCount}`
  await page.addInitScript(
    ({ p, mark }) => {
      localStorage.setItem('diary-studio:test-auth', '1')
      if (p && !sessionStorage.getItem(mark)) {
        localStorage.setItem('diary-studio:prefs', JSON.stringify(p))
        sessionStorage.setItem(mark, '1')
      }
    },
    { p: stored, mark },
  )
  await page.goto(opened ? `/?e2e-open=${openCount}#${hash}` : `/#${hash}`)
  await page.waitForFunction(() => Boolean(window.__ds))
  await expect(page.getByTestId('top-page')).toBeVisible()
  if (data) await seedData(page, data)
  if (opts.arm ?? true) await armHistory(page)
}

// ---------- 段階2: 履歴（docs/SPEC.md の 3.1。src/history/appHistory.ts） ----------

/** 今の履歴の形（今いる所・土台の番号など。window.__ds.historyShape） */
export function historyShape(page: Page): Promise<HistoryShape | null> {
  return page.evaluate(() => window.__ds.historyShape())
}

/**
 * アプリの履歴が落ち着くまで待つ: ブラウザの今の履歴が、アプリの思う今いる所で、ルーターが出している所（土台へ戻し終えた。
 * 閉じられずに最初の履歴へ戻った時はそこ）で、動かしている途中の物が無い
 */
export async function historySettled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__ds.historyShape()
        const idx = (history.state as { idx?: number } | null)?.idx
        return Boolean(s && !s.busy && idx === s.cur && (s.cur === s.shownIdx || s.exitArmed))
      }),
    )
    .toBe(true)
}

/**
 * 何も無い所（ヘッダーの、左のアイコンと右のボタンの間の真ん中）を押して、アプリの履歴の形を作らせる（押した直後だけ作る。
 * openCalendar が開いた後に呼ぶ）
 */
export async function armHistory(page: Page): Promise<void> {
  const brand = await page.getByTestId('brand').boundingBox()
  const gear = await page.getByTestId('open-settings').boundingBox()
  if (!brand || !gear) throw new Error('ヘッダーが見えていません')
  // 右のボタンの左の端（同期の表示があればそこ）
  const sync = (await page.getByTestId('sync-indicator').count()) ? await page.getByTestId('sync-indicator').boundingBox() : null
  const right = Math.min(gear.x, sync?.x ?? Infinity)
  await page.mouse.click((brand.x + brand.width + right) / 2, brand.y + brand.height / 2)
  await expect.poll(async () => (await historyShape(page))?.base ?? null).not.toBeNull()
  await historySettled(page)
}

/** ブラウザ（端末）の「戻る」（iPhone では左の端からのフリック）をして、アプリの履歴が落ち着くまで待つ */
export async function goBack(page: Page): Promise<void> {
  await page.goBack()
  await historySettled(page)
}

/** ブラウザ（端末）の「進む」（iPhone では右の端からのフリック）をして、アプリの履歴が落ち着くまで待つ */
export async function goForward(page: Page): Promise<void> {
  await page.goForward()
  await historySettled(page)
}

// ---------- 段階2: マウス・指の操作 ----------

/** 要素の真ん中（画面の座標） */
export async function centerOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox()
  if (!box) throw new Error('要素が見えていません')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

type Point = { x: number; y: number }
const pointOf = async (p: Locator | Point): Promise<Point> => ('x' in p && 'y' in p ? p : centerOf(p as Locator))

/**
 * マウスでドラッグする（押す → 少し動かして掴む（5px 以上。docs/SPEC.md の 7.11） → 落とす所の真ん中まで steps 回に分けて動かす → 離す）
 */
export async function mouseDrag(page: Page, from: Locator | Point, to: Locator | Point, { steps = 10 } = {}): Promise<void> {
  const a = await pointOf(from)
  const b = await pointOf(to)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + 8, a.y, { steps: 2 })
  await page.mouse.move(b.x, b.y, { steps })
  await page.mouse.up()
}

/** Chromium（Pixel 7・タブレット）か。CDP の本物のタッチを使えるのはこちらだけ */
const isChromium = (page: Page) => page.context().browser()?.browserType().name() === 'chromium'

/**
 * 指の送り方: cdp = 本物のタッチ（Chromium だけ。ブラウザが pointer・touch の両方の出来事を作り、動かすとスクロールもする）、
 * synthetic = 合成した PointerEvent（WebKit 用。スクロールはしない）。省くと Chromium は cdp、ほかは synthetic
 */
export type TouchVia = 'cdp' | 'synthetic'
const touchVia = (page: Page, via?: TouchVia): TouchVia => via ?? (isChromium(page) ? 'cdp' : 'synthetic')

/**
 * 合成した指の PointerEvent（pointerType: 'touch'）を送る（WebKit 用）。押した所の要素に pointerdown を送り、その後の動きと離す
 * のも同じ要素に送る（指の pointer は押した要素に捕まる。document まで伝わる。押した要素が外れた後は指の下の要素へ）。
 * holdMs は押してから動かし始めるまで
 */
async function syntheticTouch(page: Page, points: Point[], holdMs: number, stepMs: number): Promise<void> {
  await page.evaluate(
    async ({ points, holdMs, stepMs }) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const [first] = points
      const target = document.elementFromPoint(first.x, first.y) ?? document.body
      // 押した要素が描き直しで外れた時は、本物の指と同じく、その時に指の下にある要素へ送る（外れた要素からは document まで伝わらない）
      const fire = (type: string, p: { x: number; y: number }, buttons: number) =>
        (target.isConnected ? target : (document.elementFromPoint(p.x, p.y) ?? document.body)).dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            // 1（マウスの番号）にする。dnd-kit は掴んだ時に document.body.setPointerCapture(pointerId) を呼び、動いていない
            // 番号だと NotFoundError で掴むのをやめる。1 はいつも動いている扱いなので何も起きない（WP11s の試し）
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: p.x,
            clientY: p.y,
            button: 0,
            buttons,
            width: 10,
            height: 10,
            pressure: buttons ? 0.5 : 0,
          }),
        )
      fire('pointerdown', first, 1)
      await wait(holdMs)
      for (const p of points.slice(1)) {
        fire('pointermove', p, 1)
        await wait(stepMs)
      }
      fire('pointerup', points[points.length - 1], 0)
    },
    { points, holdMs, stepMs },
  )
}

/** a から b までを steps 等分した点（a を含む） */
function path(a: Point, b: Point, steps: number): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }))
}

/** 本物の指（CDP の Input.dispatchTouchEvent。Chromium だけ）で、押す → holdMs 待つ → 動かす → 離す */
async function cdpTouch(page: Page, points: Point[], holdMs: number, stepMs: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] })
    if (holdMs) await page.waitForTimeout(holdMs)
    for (const p of points.slice(1)) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] })
      if (stepMs) await page.waitForTimeout(stepMs)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await cdp.detach()
  }
}

/**
 * 指で長押ししてからドラッグする（押したまま holdMs（初めは 450ms。掴むのは 400ms・8px 以内。docs/SPEC.md の 7.11）待ち、
 * 落とす所まで steps 回に分けて動かして離す）。Chromium は CDP の本物のタッチ、WebKit は合成した PointerEvent。
 * page.clock.install（タイマーも偽物）と一緒には使わない（待つ間にタイマーが進まないので掴めない）
 */
export async function longPressDrag(
  page: Page,
  from: Locator | Point,
  to: Locator | Point,
  { holdMs = 450, steps = 10, stepMs = 16, via }: { holdMs?: number; steps?: number; stepMs?: number; via?: TouchVia } = {},
): Promise<void> {
  const points = path(await pointOf(from), await pointOf(to), steps)
  if (touchVia(page, via) === 'cdp') await cdpTouch(page, points, holdMs, stepMs)
  else await syntheticTouch(page, points, holdMs, stepMs)
}

/**
 * 指ですばやく払う（スワイプ。docs/SPEC.md の 3.7: 横に 60px 以上・角度 30° 未満で前・次へ）。from から dx・dy だけ、
 * steps 回に分けて durationMs で動かす。Chromium は CDP の本物のタッチ、WebKit は合成した PointerEvent
 */
export async function touchSwipe(
  page: Page,
  from: Locator | Point,
  dx: number,
  dy = 0,
  { steps = 8, durationMs = 160, via }: { steps?: number; durationMs?: number; via?: TouchVia } = {},
): Promise<void> {
  const a = await pointOf(from)
  const points = path(a, { x: a.x + dx, y: a.y + dy }, steps)
  const stepMs = Math.round(durationMs / steps)
  if (touchVia(page, via) === 'cdp') await cdpTouch(page, points, 0, stepMs)
  else await syntheticTouch(page, points, 0, stepMs)
}

/**
 * 指で決めた道筋をなぞる（大きく払う・親指の弧。docs/SPEC.md の 3.7）。points の初めの点で押し、残りの点へ stepMs ごとに動かして、
 * 最後の点で離す。画面の端の点（x が 0〜数 px）も送れる。Chromium は CDP の本物のタッチ、WebKit は合成した PointerEvent
 * （押した所の要素に送る。画面の端の点なら、その所にある要素）
 */
export async function touchPath(page: Page, points: Point[], { stepMs = 12, via }: { stepMs?: number; via?: TouchVia } = {}) {
  if (touchVia(page, via) === 'cdp') await cdpTouch(page, points, 0, stepMs)
  else await syntheticTouch(page, points, 0, stepMs)
}

/**
 * iPhone（WebKit）で、touch-action: pan-y の所を横に払った指の出来事を真似て送る（docs/SPEC.md の 3.7）。WebKit は指が少しでも縦に
 * 動くと縦のスクロールを始めて pointer を取る（pointercancel）が、touch の出来事は離すまで送り続ける。points の初めの点で押し、
 * 押した所から cancelAt（px）動いた所で pointercancel を送り、その後は touchmove だけ、最後の点で touchend。どの出来事も押した所の
 * 要素に送る（document まで伝わる。押した要素が外れた後の touch の出来事は、本物と同じく外れた要素へ）。Chromium・WebKit の
 * どちらでも同じ合成した出来事（スクロールはしない）。Touch を作れないブラウザでは、座標を持たせた Event を送る
 */
export async function iosCancelledTouch(page: Page, points: Point[], { cancelAt = 12, stepMs = 12 } = {}) {
  await page.evaluate(
    async ({ points, cancelAt, stepMs }) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const [first] = points
      const target = document.elementFromPoint(first.x, first.y) ?? document.body
      // pointer は、押した要素が描き直しで外れた後は指の下の要素へ（syntheticTouch と同じ）。touch の出来事は本物と同じく、外れた後も
      // 押した要素へ送る（document まで伝わらない）
      const pointer = (type: string, p: { x: number; y: number }, buttons: number) =>
        (target.isConnected ? target : (document.elementFromPoint(p.x, p.y) ?? document.body)).dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: type !== 'pointercancel',
            composed: true,
            // syntheticTouch と同じ番号（dnd-kit の setPointerCapture で掴むのをやめないように）
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            clientX: p.x,
            clientY: p.y,
            button: 0,
            buttons,
            width: 10,
            height: 10,
            pressure: buttons ? 0.5 : 0,
          }),
        )
      const touch = (type: string, p: { x: number; y: number }, ended: boolean) => {
        const init = { identifier: 1, target, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, pageX: p.x, pageY: p.y }
        let ev: Event
        try {
          const t = new Touch(init)
          const list = ended ? [] : [t]
          ev = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            touches: list,
            targetTouches: list,
            changedTouches: [t],
          })
        } catch {
          ev = new Event(type, { bubbles: true, cancelable: true, composed: true })
          Object.defineProperty(ev, 'touches', { value: ended ? [] : [init] })
          Object.defineProperty(ev, 'targetTouches', { value: ended ? [] : [init] })
          Object.defineProperty(ev, 'changedTouches', { value: [init] })
        }
        target.dispatchEvent(ev)
      }
      pointer('pointerdown', first, 1)
      touch('touchstart', first, false)
      let cancelled = false
      for (const p of points.slice(1)) {
        await wait(stepMs)
        if (!cancelled && Math.hypot(p.x - first.x, p.y - first.y) >= cancelAt) {
          pointer('pointercancel', p, 0)
          cancelled = true
        }
        if (!cancelled) pointer('pointermove', p, 1)
        touch('touchmove', p, false)
      }
      const last = points[points.length - 1]
      if (!cancelled) pointer('pointerup', last, 0)
      touch('touchend', last, true)
    },
    { points, cancelAt, stepMs },
  )
}

/**
 * 親指で大きく払った時の弧の道筋: a から b へ steps 回に分けた点（a を含む）。横は同じ割合で進み、縦は進んだ割合の2乗で逸れる
 * （払い始めは水平で、終わりほど上（下）へ逸れる）
 */
export function thumbArc(a: Point, b: Point, steps: number): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t * t }
  })
}

// ---------- 段階2: 期間を移った時にページをめくる（docs/SPEC.md の 3.7・4.9。src/features/calendar/common/PageTurn.tsx） ----------

/**
 * これから置かれるめくる箱（.cal-turn）の向き（next・prev）を、置かれるたびに控え始める（turnsOf で読む）。カレンダーを開いた後に呼ぶ
 * （めくる箱はカレンダーの区切り（calendar）のすぐ下に置かれ、めくり終えると外れる）
 */
export async function recordTurns(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __e2eTurns: string[] }
    w.__e2eTurns = []
    const cal = document.querySelector('[data-testid="calendar"]')
    if (!cal) throw new Error('カレンダーがありません')
    new MutationObserver((list) => {
      for (const m of list)
        for (const n of m.addedNodes)
          if (n instanceof HTMLElement && n.classList.contains('cal-turn')) w.__e2eTurns.push(n.dataset.turn ?? '')
    }).observe(cal, { childList: true })
  })
}

/** recordTurns から置かれためくる箱の向き（置かれた順） */
export function turnsOf(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __e2eTurns?: string[] }).__e2eTurns ?? [])
}

/** めくり終えた（めくる箱が無い）まで待つ */
export async function turnDone(page: Page): Promise<void> {
  await expect(page.locator('.cal-turn')).toHaveCount(0)
}

/**
 * on の間は、めくる動きが終わってもめくる箱を外さない（開発用フック window.__ds.holdTurns。押す・キーを打つとすぐ終える）。
 * pauseTurn の前（期間を移す前）に呼ぶ。ページを開き直すと外れる
 */
export async function holdTurns(page: Page, on = true): Promise<void> {
  await page.evaluate((v) => (window as unknown as { __ds: { holdTurns: (on: boolean) => void } }).__ds.holdTurns(v), on)
}

/**
 * めくっている途中（動きの長さの frac の所）で、めくる動きを止める（その時の絵を見る・測るため。Web Animations の pause）。
 * 先に holdTurns を呼んでおく（期間を移してからここまでに動きが終わっても、箱が残るので、動きを戻して止められる）。
 * 止めた後は、押す・キーを打つとめくりが終わる
 */
export async function pauseTurn(page: Page, frac: number): Promise<void> {
  await page.locator('.cal-turn-page.is-out, .cal-turn-page.is-in').first().waitFor({ state: 'attached' })
  await page.evaluate((f) => {
    for (const a of document.getAnimations()) {
      const target = (a.effect as KeyframeEffect | null)?.target
      if (!target?.closest('.cal-turn')) continue
      a.pause()
      a.currentTime = 420 * f
    }
  }, frac)
}

// ---------- 段階2: 途中で止められるドラッグ（ウィークリーのドラッグ。掴んでいる間の様子を見る・撮る。WP11） ----------

/** 掴んだまま止めているドラッグ。moveTo で動かし、drop で離す（drop の後は使わない） */
export interface DragSession {
  /** 指・マウスを to へ steps 回に分けて動かす（離さない） */
  moveTo(to: Locator | Point, opts?: { steps?: number; stepMs?: number }): Promise<void>
  /** 離す */
  drop(): Promise<void>
}

/**
 * マウスで押し、grabPx（初めは 8px。掴むのは 5px を超えた時。docs/SPEC.md の 7.11）だけ動かして掴んだ所で止める。
 * 掴めない物（ロック中）でも同じように押して動かす（掴もうとした様子を見る）
 */
export async function startMouseDrag(
  page: Page,
  from: Locator | Point,
  { grabPx = 8, dy = 0 }: { grabPx?: number; dy?: number } = {},
): Promise<DragSession> {
  const a = await pointOf(from)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(a.x + grabPx, a.y + dy, { steps: 2 })
  return {
    moveTo: async (to, { steps = 10 } = {}) => {
      const b = await pointOf(to)
      await page.mouse.move(b.x, b.y, { steps })
    },
    drop: () => page.mouse.up(),
  }
}

/** 合成した指（WebKit 用）の、押している間の控え（ページの中に置く。syntheticTouch と同じ送り方） */
interface SyntheticFinger {
  target: Element
  x: number
  y: number
}

/** 合成した指の出来事を1つ送る（押した要素へ。外れた後は指の下の要素へ。pointerId は 1。syntheticTouch の説明） */
async function syntheticFire(page: Page, type: 'pointerdown' | 'pointermove' | 'pointerup', p: Point): Promise<void> {
  await page.evaluate(
    ({ type, p }) => {
      const w = window as unknown as { __e2eFinger?: SyntheticFinger }
      if (type === 'pointerdown') {
        w.__e2eFinger = { target: document.elementFromPoint(p.x, p.y) ?? document.body, x: p.x, y: p.y }
      }
      const f = w.__e2eFinger
      if (!f) throw new Error('指を押していません')
      const buttons = type === 'pointerup' ? 0 : 1
      ;(f.target.isConnected ? f.target : (document.elementFromPoint(p.x, p.y) ?? document.body)).dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          clientX: p.x,
          clientY: p.y,
          button: 0,
          buttons,
          width: 10,
          height: 10,
          pressure: buttons ? 0.5 : 0,
        }),
      )
      f.x = p.x
      f.y = p.y
      if (type === 'pointerup') delete w.__e2eFinger
    },
    { type, p },
  )
}

/**
 * 指で押して holdMs（初めは 450ms。掴むのは 400ms・8px 以内）待ち、掴んだ所で止める。Chromium は CDP の本物のタッチ、WebKit は
 * 合成した PointerEvent（longPressDrag と同じ）。page.clock.install（タイマーも偽物）と一緒には使わない
 */
export async function startLongPress(
  page: Page,
  from: Locator | Point,
  { holdMs = 450, via }: { holdMs?: number; via?: TouchVia } = {},
): Promise<DragSession> {
  let pos = await pointOf(from)
  if (touchVia(page, via) === 'cdp') {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pos] })
    await page.waitForTimeout(holdMs)
    return {
      moveTo: async (to, { steps = 10, stepMs = 16 } = {}) => {
        const b = await pointOf(to)
        for (const p of path(pos, b, steps).slice(1)) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] })
          if (stepMs) await page.waitForTimeout(stepMs)
        }
        pos = b
      },
      drop: async () => {
        try {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        } finally {
          await cdp.detach()
        }
      },
    }
  }
  await syntheticFire(page, 'pointerdown', pos)
  await page.waitForTimeout(holdMs)
  return {
    moveTo: async (to, { steps = 10, stepMs = 16 } = {}) => {
      const b = await pointOf(to)
      for (const p of path(pos, b, steps).slice(1)) {
        await syntheticFire(page, 'pointermove', p)
        if (stepMs) await page.waitForTimeout(stepMs)
      }
      pos = b
    },
    drop: () => syntheticFire(page, 'pointerup', pos),
  }
}

// ---------- 段階2: 同期の E2E（playwright.sync.config.ts。Firebase エミュレーター）・小さな画面 ----------

/**
 * 同期の E2E の1台の端末: 新しいブラウザの文脈（保存も Firebase のログインの状態も別）でアプリを開き、ログインの画面が出るまで待つ
 * （テスト用の印 diary-studio:test-auth は置かない。ログインはエミュレーターの本物の流れ。signInSync）
 */
export async function syncDevice(browser: { newContext: () => Promise<{ newPage: () => Promise<Page> }> }): Promise<Page> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/#/')
  await page.waitForFunction(() => Boolean(window.__ds))
  await expect(page.getByTestId('login-page')).toBeVisible()
  return page
}

/**
 * エミュレーターの仮の Google アカウント（sub）でログインする（window.__ds.signInForTest。開発サーバーだけ）。データの画面まで
 * 進むと決まっている時（持ち主の記録 config/owner がこのアカウント）は shown で、トップ画面と同期の表示「同期済み」まで待つ
 */
export async function signInSync(page: Page, sub: string, { shown = true }: { shown?: boolean } = {}): Promise<void> {
  await page.evaluate((s) => window.__ds.signInForTest(s), sub)
  if (!shown) return
  await expect(page.getByTestId('top-page')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-tone', 'ok', { timeout: 20_000 })
}

/**
 * 小さな画面（登録・詳細）が開き終わるまで待つ（中へフォーカスが移るまで。Esc を聞き始めるのも同じ時: src/ui/Modal.tsx は描いたすぐ後に
 * 両方をする）
 */
export async function sheetReady(page: Page): Promise<Locator> {
  const sheet = page.getByTestId('item-sheet')
  await expect(sheet).toBeVisible()
  await expect.poll(() => sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  return sheet
}

/**
 * 詳細の［…］（ほかの操作）のメニューを開く。メニューはどこかがスクロールすると閉じる（src/ui/PopupMenu.tsx）ので、押した直後に
 * 届いたスクロール（押す前に画面へ送った分など）で閉じた時は、もう一度押す（開いている時は押さない。押すと閉じるため）
 */
export async function openItemMore(page: Page): Promise<void> {
  const item = page.getByTestId('item-delete')
  await expect(async () => {
    if (!(await item.isVisible())) await page.getByTestId('item-more').click()
    await expect(item).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}
