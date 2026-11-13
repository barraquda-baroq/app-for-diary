// 段階0の完成の目安（docs/SPEC.md の 21.）を通しで確かめる E2E:
// 起動アニメーション → ログインの画面 → （テスト用のログインで）空のトップ画面、外観4つの切り替え、
// 書体（Roboto Mono）が読み込まれていること、スマホの縦の積みと3つのリストが畳んで始まること。
// 細かい決まりは e2e/launch.spec.ts（起動アニメーション）と e2e/frame.spec.ts（ログインの画面・画面の枠）で確かめる
import { expect, test, type Page } from '@playwright/test'
import { collectDiagnosticsOnFailure, historySettled, luminance, noHorizontalScroll } from './helpers'

collectDiagnosticsOnFailure()

const PREFS_KEY = 'diary-studio:prefs'
const TEST_AUTH_KEY = 'diary-studio:test-auth'

/** 外観ごとの <html data-theme>・枠の色（meta theme-color）・ページの地（--bg）。docs/SPEC.md の 4.2・4.5 */
const THEMES = {
  white: { theme: 'white', meta: '#ffffff', bg: 'rgb(246, 246, 244)' },
  dark: { theme: 'dark', meta: '#17181b', bg: 'rgb(16, 17, 19)' },
  'deep-dark': { theme: 'deep-dark', meta: '#0e0f11', bg: 'rgb(8, 9, 10)' },
} as const

async function themeOf(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    meta: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
  }))
}

const storedAppearance = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').appearance ?? null, PREFS_KEY)

test(
  '起動アニメーション → ログインの画面 → テスト用のログインで空のトップ画面',
  { tag: ['@pc', '@s', '@ios'] },
  async ({ page, isMobile }) => {
    // 1. 起動アニメーション（テストではふだん出さないので launch=1 で出す）。ログインしていないので、下ではログインの画面が起動する
    await page.goto('/?launch=1#/', { waitUntil: 'commit' })
    const overlay = page.getByTestId('launch-overlay')
    await expect(overlay).toBeVisible()
    // 2. アニメーションが終わり（2.27秒）、ログインの画面ができたら消える（5秒の期限より前）
    await expect(overlay).toHaveCount(0, { timeout: 8000 })
    await expect(page).toHaveURL(/#\/login$/)
    await expect(page.getByTestId('login-page')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Diary Studio' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Google でログイン' })).toBeVisible()
    await expect(page.getByTestId('app-header')).toHaveCount(0)
    await noHorizontalScroll(page)

    // 3. テスト用のログインの印を置いて読み込み直すと、ログインの画面からトップへ移る（同じタブなので起動アニメーションは出ない）
    await page.evaluate((key) => localStorage.setItem(key, '1'), TEST_AUTH_KEY)
    await page.goto('/#/login')
    await expect(page.getByTestId('top-page')).toBeVisible()
    // トップ #/ は前回のモード（初めはマンスリー）の今日を含む期間へ置き換わる（FRAME-001）
    await expect(page).toHaveURL(/#\/month\/\d{4}-\d{2}$/)
    await expect(overlay).toHaveCount(0)
    // 空のトップ画面: ヘッダー・カレンダーの操作の列・3つのリストの空の形
    await expect(page.getByTestId('app-header')).toBeVisible()
    await expect(page.getByTestId('open-mim')).toBeVisible()
    await expect(page.getByTestId('calendar-toolbar')).toBeVisible()
    for (const key of ['routine', 'task', 'favorite']) await expect(page.getByTestId(`list-${key}`)).toBeVisible()
    if (isMobile) {
      // スマホ: 切り替えの列と縦の積み（カレンダー → Routine → Task → Favorite）。3つのリストは畳んで始まる（X1）
      await expect(page.getByTestId('top-switcher')).toBeVisible()
      const ys: number[] = []
      for (const id of ['calendar-area', 'list-routine', 'list-task', 'list-favorite']) {
        ys.push((await page.getByTestId(id).boundingBox())?.y ?? -1)
      }
      expect([...ys].sort((a, b) => a - b)).toEqual(ys)
      for (const key of ['routine', 'task', 'favorite']) {
        await expect(page.getByTestId(`list-${key}`)).toHaveAttribute('data-collapsed', 'true')
        await expect(page.getByTestId(`list-${key}-input`)).toBeHidden()
      }
    } else {
      // PC: 右の列（Routine → Task → Favorite）は初めは開いている
      await expect(page.getByTestId('side-column')).toBeVisible()
      await expect(page.getByTestId('top-switcher')).toHaveCount(0)
      for (const key of ['routine', 'task', 'favorite']) {
        await expect(page.getByTestId(`list-${key}`)).toHaveAttribute('data-collapsed', 'false')
      }
    }
    await noHorizontalScroll(page)

    // 等幅の英数字の書体（Roboto Mono。アプリに同梱。docs/SPEC.md の 4.7）が使える
    await expect.poll(() => page.evaluate(() => document.fonts.check('12px "Roboto Mono"'))).toBe(true)
    expect(await page.getByTestId('cal-numeral').evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Roboto Mono')
  },
)

test(
  '外観4つ（端末の設定に合わせる・ホワイト・ダーク・ディープダーク）が設定で切り替わり、読み込み直しても残る',
  { tag: ['@pc', '@s', '@ios'] },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript((key) => localStorage.setItem(key, '1'), TEST_AUTH_KEY)
    await page.goto('/#/settings')
    await expect(page.getByTestId('display-settings')).toBeVisible()

    // 初めは「端末の設定に合わせる」（端末がライトなのでホワイト）
    await expect(page.getByTestId('appearance-system')).toHaveAttribute('aria-pressed', 'true')
    expect(await themeOf(page)).toEqual(THEMES.white)

    for (const value of ['dark', 'deep-dark', 'white'] as const) {
      await page.getByTestId(`appearance-${value}`).click()
      await expect(page.getByTestId(`appearance-${value}`)).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => themeOf(page)).toEqual(THEMES[value])
      expect(await storedAppearance(page)).toBe(value)
    }

    // ディープダークは読み込み直しても、最初の描画の前（src/launch/launch.js の boot）からディープダークで始まる
    await page.getByTestId('appearance-deep-dark').click()
    await page.reload()
    await expect(page.getByTestId('appearance-deep-dark')).toHaveAttribute('aria-pressed', 'true')
    expect(await themeOf(page)).toEqual(THEMES['deep-dark'])
    // トップ画面でも同じ外観（ヘッダーの面は暗い）
    await page.getByTestId('settings-back').click()
    await expect(page.getByTestId('top-page')).toBeVisible()
    expect(luminance(await page.getByTestId('app-header').evaluate((e) => getComputedStyle(e).backgroundColor))).toBeLessThan(
      0.05,
    )

    // 「端末の設定に合わせる」に戻すと、端末のライト／ダークに付いていく。# を書き換えて開くのは、アプリの履歴が落ち着いてから（iPhone は
    // ［‹ 戻る］の後に、土台の前後の履歴の絵を自分で動いて写し直す。その途中に書き換えると、ブラウザが待っていた動きを書き換えた所から
    // 行い、設定から戻ったのと同じになることがある。docs/SPEC.md の 3.1）
    await historySettled(page)
    await page.goto('/#/settings')
    await page.getByTestId('appearance-system').click()
    await expect.poll(() => themeOf(page)).toEqual(THEMES.white)
    expect(await storedAppearance(page)).toBe('system')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => themeOf(page)).toEqual(THEMES.dark)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => themeOf(page)).toEqual(THEMES.white)
    await noHorizontalScroll(page)
  },
)
