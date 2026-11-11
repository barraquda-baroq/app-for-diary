// 画面の枠とログインの画面の E2E（docs/SPEC.md の 2.5・3.・21. の段階0）: ログインの画面 → 空のトップ画面
// （ヘッダー・カレンダーの操作の列・右の列の3つのリスト・スマホの積み方と切り替えの列）。カレンダーの行き先・履歴・高さ・
// 小さな画面（段階2）は e2e/calendar-frame.spec.ts。
// ログインした状態は、テストの時だけ効く印（localStorage の diary-studio:test-auth。src/features/login/testAuth.ts）で作る
import { expect, test, type Page } from '@playwright/test'
import { darkSurfaces, noHorizontalScroll, tapSize } from './helpers'
import { firebaseConfigIsPlaceholder } from '../src/sync/firebaseConfig'

const PREFS_KEY = 'diary-studio:prefs'

/** ログインした状態でアプリを開く（Firebase は使わない） */
async function openSignedIn(page: Page, hash = '/') {
  await page.addInitScript(() => localStorage.setItem('diary-studio:test-auth', '1'))
  await page.goto(`/#${hash}`)
  await expect(page.getByTestId('top-page').or(page.getByTestId('app-settings'))).toBeVisible()
}

/** CSS 変数の色を、その場で計算した rgb() にする */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement('div')
    probe.style.color = `var(${t})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  }, token)
}

test.describe('ログインの画面（2.5）', { tag: ['@pc', '@s'] }, () => {
  test('ログインしていなければログインの画面だけを出す（グレーの地・等幅の名前・今日の日付・［Google でログイン］）', async ({
    page,
  }) => {
    await page.goto('/#/')
    await expect(page).toHaveURL(/#\/login$/)
    const login = page.getByTestId('login-page')
    await expect(login).toBeVisible()
    await expect(page.getByTestId('app-header')).toHaveCount(0)
    await expect(page.getByTestId('open-mim')).toHaveCount(0)

    expect(await login.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(await tokenColor(page, '--cover'))
    const logo = page.getByRole('heading', { name: 'Diary Studio' })
    expect(await logo.evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Roboto Mono')
    await expect(page.getByTestId('login-date')).toHaveText(/^(SUN|MON|TUE|WED|THU|FRI|SAT) · \d{4}\.\d{2}\.\d{2}$/)
    await expect(page.getByText('DIARY STUDIO', { exact: true })).toBeVisible()

    const button = page.getByRole('button', { name: 'Google でログイン' })
    const box = await button.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    // 字は --on-cover、ボタンの枠はグレーの地と 3:1 以上の --cover-border（2.5。比は src/styles.test.ts で確かめる）
    expect(await login.evaluate((e) => getComputedStyle(e).color)).toBe(await tokenColor(page, '--on-cover'))
    expect(await button.evaluate((e) => getComputedStyle(e).borderTopColor)).toBe(await tokenColor(page, '--cover-border'))
    await noHorizontalScroll(page)
  })

  test('Firebase の設定が仮の値の時は、押すと「まだ公開の準備ができていません（docs/DEPLOY.md）」と出す', async ({ page }) => {
    // 本物の設定値（diary-studio-35f4e）に差し替えた後は、この場面は起きない。言葉と、ログインを始めないことは
    // 単体テスト（src/features/login/LoginPage.test.tsx。設定値を仮の値にして確かめる）で確かめ続ける
    test.skip(!firebaseConfigIsPlaceholder, '本物の設定値に差し替え済み（単体テストで確かめる）')
    await page.goto('/#/login')
    await page.getByRole('button', { name: 'Google でログイン' }).click()
    await expect(page.getByRole('alert')).toHaveText('まだ公開の準備ができていません（docs/DEPLOY.md）')
    await expect(page).toHaveURL(/#\/login$/)
  })
})

test.describe('空のトップ画面', { tag: ['@pc', '@s'] }, () => {
  test('テスト用の印でログインした状態になり、ヘッダーの右端に［MIM］、その左に設定の歯車', async ({ page }) => {
    await openSignedIn(page)
    const header = page.getByTestId('app-header')
    await expect(header.getByTestId('brand')).toBeVisible()
    const gear = await header.getByTestId('open-settings').boundingBox()
    const mim = await header.getByTestId('open-mim').boundingBox()
    expect(gear && mim && gear.x < mim.x).toBe(true)
    await tapSize(header.getByTestId('open-settings'), '設定の歯車')
    await tapSize(header.getByTestId('open-mim'), '［MIM］')
    expect(await header.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(52)
    await noHorizontalScroll(page)
  })

  test('［MIM］で仮の画面を開き、押した状態（今日の印と同じ地）になる。もう一度押すと閉じる', async ({ page }) => {
    await openSignedIn(page)
    const mim = page.getByTestId('open-mim')
    await mim.click()
    await expect(page).toHaveURL(/#\/mim$/)
    await expect(page.getByTestId('mim-placeholder')).toBeVisible()
    await expect(mim).toHaveAttribute('aria-pressed', 'true')
    const todayBg = await tokenColor(page, '--today-bg')
    await expect.poll(() => mim.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(todayBg)
    await mim.click()
    // トップ #/ は開いた時に前回のモード（初めはマンスリー）の今日を含む期間へ置き換わっているので、そこへ戻る（FRAME-001）
    await expect(page).toHaveURL(/#\/month\/\d{4}-\d{2}$/)
    await expect(page.getByTestId('calendar')).toBeVisible()
  })

  test('設定の画面（歯車）にも［MIM］があり、［‹ 戻る］でトップへ戻る', async ({ page }) => {
    await openSignedIn(page)
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await expect(page.getByTestId('display-settings')).toBeVisible()
    await expect(page.getByTestId('open-mim')).toBeVisible()
    await page.getByTestId('settings-back').click()
    await expect(page.getByTestId('top-page')).toBeVisible()
  })

  test('ディープダークでは、ヘッダー・カレンダー・リストの面に明るい色が出ない', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ v: 1, appearance: 'deep-dark' })), PREFS_KEY)
    await openSignedIn(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'deep-dark')
    await darkSurfaces(page, ['body', '.app-header', '.top-calendar', '.top-side', '.list-panel', '.top-switcher', '.cal-cell'])
  })
})

test.describe('新しい版の帯（2.8）', { tag: ['@pc', '@s'] }, () => {
  /** ページを3画面ぶんの高さにする（段階2・3で予定やリストの行が増えた時と同じ形。帯の有無でヘッダーの固定が崩れないか見る） */
  async function makeTall(page: Page, container: string) {
    await page.evaluate((sel) => {
      const filler = document.createElement('div')
      filler.style.height = `${window.innerHeight * 3}px`
      filler.dataset.testFiller = '1'
      document.querySelector(sel)?.appendChild(filler)
    }, container)
  }

  test('帯が出ていても、下までスクロールした時にヘッダーは上に固定のまま。［更新する］を押すと切り替える', async ({
    page,
    isMobile,
  }) => {
    await openSignedIn(page)
    await page.waitForFunction(() => Boolean(window.__ds))
    await page.evaluate(() => window.__ds.showUpdateBanner())
    const banner = page.getByTestId('update-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('新しい版があります')
    // 指で操作する端末では押せる所を 34px 以上に（4.11。PC のマウスでは NS の .btn-sm の 30px）
    if (isMobile) await tapSize(banner.getByTestId('app-update'), '［更新する］', false)

    if (isMobile) {
      // S のトップ・設定の画面はページ全体がスクロールする
      await makeTall(page, '.top-stack')
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
      await expect.poll(async () => (await page.getByTestId('app-header').boundingBox())?.y).toBe(0)
    } else {
      // L のトップはページ全体をスクロールさせない（帯の分だけ縮める）
      const [scrollH, innerH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight])
      expect(scrollH).toBeLessThanOrEqual(innerH)
    }
    await noHorizontalScroll(page)

    // 設定の画面（ページ全体がスクロールする）でも、ヘッダーは上に固定のまま
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await expect(banner).toBeVisible()
    await makeTall(page, '[data-testid="app-settings"]')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000)
    await expect.poll(async () => (await page.getByTestId('app-header').boundingBox())?.y).toBe(0)

    await banner.getByTestId('app-update').click()
    await expect.poll(() => page.evaluate(() => window.__ds.updateApplied())).toBe(true)
  })
})

test.describe('PC（L）の並べ方（3.4）', { tag: ['@pc', '@s'] }, () => {
  test.skip(({ isMobile }) => isMobile, 'PC の幅だけ')

  test('左にカレンダーの領域、右に 300px の右の列（Routine → Task → Favorite）。ページ全体はスクロールしない', async ({
    page,
  }) => {
    await openSignedIn(page)
    const side = page.getByTestId('side-column')
    const box = await side.boundingBox()
    expect(Math.round(box?.width ?? 0)).toBe(300)
    const cal = await page.getByTestId('calendar-area').boundingBox()
    expect(cal && box && cal.x + cal.width + 24 <= box.x + 0.5).toBe(true)
    const titles = await side.locator('[data-list] .head-en').allTextContents()
    expect(titles).toEqual(['Routine List', 'Task List', 'Favorite List'])
    await expect(page.getByTestId('top-switcher')).toHaveCount(0)
    const [scrollH, innerH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight])
    expect(scrollH).toBeLessThanOrEqual(innerH)
    // 操作の列: 大きく淡い数字と ‹ › 今日、［年｜月｜週｜日］［休み］［＋ 登録］［Task View］
    const toolbar = page.getByTestId('calendar-toolbar')
    for (const id of ['cal-prev', 'cal-next', 'cal-today', 'cal-mode-year', 'cal-off', 'cal-add', 'cal-taskview']) {
      await expect(toolbar.getByTestId(id)).toBeVisible()
    }
    expect(await page.getByTestId('cal-numeral').evaluate((e) => getComputedStyle(e).color)).toBe(
      await tokenColor(page, '--numeral'),
    )
  })

  test('右の列で畳んだリストは、読み込み直しても畳んだまま（端末ごとに覚える）', async ({ page }) => {
    await openSignedIn(page)
    await page.getByTestId('list-task-fold').click()
    await expect(page.getByTestId('list-task')).toHaveAttribute('data-collapsed', 'true')
    await expect(page.getByTestId('list-task-input')).toBeHidden()
    await page.reload()
    await expect(page.getByTestId('list-task')).toHaveAttribute('data-collapsed', 'true')
    await expect(page.getByTestId('list-routine')).toHaveAttribute('data-collapsed', 'false')
  })

  test('カレンダーの領域が狭くて操作の列が2行に折り返しても、右の物は右に寄せる（L の狭い幅・M。3.7）', async ({ page }) => {
    await openSignedIn(page)
    for (const width of [960, 700]) {
      await page.setViewportSize({ width, height: 800 })
      // 960（L）から 700（M）に替えると、トップ画面が L の並べ方から S・M の並べ方に作り直される。作り直しが済む前に測ると、
      // 消える途中の操作の列を測って大きさが null になることがあるので、幅の区分が替わったのを待ってから測る
      await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', width >= 900 ? 'L' : 'M')
      const toolbar = page.getByTestId('calendar-toolbar')
      await expect(toolbar.locator('.cal-toolbar-right')).toBeVisible()
      const left = await toolbar.locator('.cal-toolbar-left').boundingBox()
      const right = await toolbar.locator('.cal-toolbar-right').boundingBox()
      const bar = await toolbar.boundingBox()
      const padRight = await toolbar.evaluate((e) => Number.parseFloat(getComputedStyle(e).paddingRight))
      expect(left && right && bar, String(width)).toBeTruthy()
      if (!left || !right || !bar) continue
      // 2行に折り返している（右の物が左の物の下の行にある）
      expect(right.y, String(width)).toBeGreaterThanOrEqual(left.y + left.height - 1)
      expect(Math.abs(right.x + right.width - (bar.x + bar.width - padRight)), String(width)).toBeLessThanOrEqual(1)
      await noHorizontalScroll(page)
    }
  })

  test('週・年に替えると、そのモードに無いボタンは消えるが、ほかのボタンの位置は動かない', async ({ page }) => {
    await openSignedIn(page)
    const before = await page.getByTestId('cal-add').boundingBox()
    await page.getByTestId('cal-mode-year').click()
    await expect(page.getByTestId('cal-add')).toBeHidden()
    await expect(page.getByTestId('cal-taskview')).toBeVisible()
    await page.getByTestId('cal-mode-week').click()
    await expect(page.getByTestId('cal-taskview')).toBeHidden()
    const after = await page.getByTestId('cal-add').boundingBox()
    expect(after?.x).toBe(before?.x)
  })
})

test.describe('スマホ（S）の並べ方（3.5・3.6）', { tag: ['@pc', '@s'] }, () => {
  test.skip(({ isMobile }) => !isMobile, 'スマホだけ')

  test('切り替えの列と縦の積み。3つのリストは畳んで始まり、押すと開いてその先頭が切り替えの列のすぐ下に来る', async ({
    page,
  }) => {
    await openSignedIn(page)
    const switcher = page.getByTestId('top-switcher')
    await expect(switcher).toBeVisible()
    expect((await switcher.locator('button').allTextContents()).map((t) => t.replace(/\d+|（.*）/g, '').trim())).toEqual([
      'カレンダー',
      'Routine',
      'Task',
      'Favorite',
    ])
    for (const key of ['routine', 'task', 'favorite']) {
      await expect(page.getByTestId(`list-${key}`)).toHaveAttribute('data-collapsed', 'true')
    }
    await page.getByTestId('top-jump-task').click()
    await expect(page.getByTestId('list-task')).toHaveAttribute('data-collapsed', 'false')
    await expect(page.getByTestId('top-jump-task')).toHaveAttribute('aria-current', 'true')
    const bar = await switcher.boundingBox()
    // 見出しの上の端が、切り替えの列の下の端から 12px の所（スクロールの端数で 1px までずれてよい）
    const under = (bar?.y ?? 0) + (bar?.height ?? 0) + 12
    await expect
      .poll(async () => Math.abs(((await page.getByTestId('list-task').boundingBox())?.y ?? 0) - under))
      .toBeLessThanOrEqual(1.5)
    await tapSize(page.getByTestId('top-jump-task'), '切り替えの列のボタン', false)

    // 読み込み直すと、また3つとも畳んで始まる（端末に覚えない）
    await page.reload()
    await expect(page.getByTestId('list-task')).toHaveAttribute('data-collapsed', 'true')
  })

  test('幅 360px でも横にはみ出さない（操作の列は2行、ヘッダーはアイコンだけ）', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openSignedIn(page)
    await noHorizontalScroll(page)
    await expect(page.locator('.brand-name')).toBeHidden()
    const right = await page.locator('.cal-toolbar-right').boundingBox()
    const cal = await page.getByTestId('calendar-area').boundingBox()
    expect(right && cal && right.x + right.width <= cal.x + cal.width).toBe(true)
    for (const id of ['cal-mode-year', 'cal-mode-month', 'cal-mode-week', 'cal-mode-day', 'cal-off', 'cal-add', 'cal-taskview']) {
      await tapSize(page.getByTestId(id), id)
    }
  })

  test('幅 360px で切り替えの列の数が2〜3桁になっても、名前が切れない（「Favorite 12」「Routine 120」。3.5）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openSignedIn(page)
    // 段階0の数はいつも 0 なので、字だけを書き換えて幅を確かめる（数は段階3でリストの中身から数える）
    for (const counts of [
      ['2', '3', '12'],
      ['120', '30', '12'],
      ['120', '120', '120'],
    ]) {
      const clipped = await page.evaluate((nums) => {
        const shown = document.querySelectorAll<HTMLElement>('.top-switcher-count [aria-hidden="true"]')
        shown.forEach((el, i) => (el.textContent = nums[i]))
        return Array.from(document.querySelectorAll<HTMLElement>('.top-switcher-name'))
          .filter((el) => el.scrollWidth > el.clientWidth)
          .map((el) => el.textContent)
      }, counts)
      expect(clipped, counts.join('・')).toEqual([])
      await noHorizontalScroll(page)
    }
  })

  test('MIM は全面で開く（切り替えの列とリストを隠す）', async ({ page }) => {
    await openSignedIn(page)
    await page.getByTestId('open-mim').click()
    await expect(page.getByTestId('mim-placeholder')).toBeVisible()
    await expect(page.getByTestId('top-switcher')).toHaveCount(0)
    await expect(page.getByTestId('list-task')).toHaveCount(0)
    await page.getByTestId('mim-back').click()
    await expect(page.getByTestId('top-switcher')).toBeVisible()
  })
})
