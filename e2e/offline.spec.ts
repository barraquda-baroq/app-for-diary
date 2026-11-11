// オフライン（docs/SPEC.md の 2.8・4.7・2.10）: ビルドした物（PWA）を一度開いた後は、電波が無くても開け、
// 等幅の英数字の書体（Roboto Mono の woff2。サービスワーカーの事前キャッシュ）も出る。
// 書体のライセンスの全文（public/licenses/。4.7・18.1）も、サービスワーカーが受け持った後にアプリの画面に差し替えられずに開ける。
// あわせて、公開するビルドではテスト用の入口（ログインの印 diary-studio:test-auth・window.__ds）が効かないことを確かめる（2.10）。
// サービスワーカーはビルドした物でだけ動くので、E2E_PREVIEW=1 の時（先に npm run build。CI）だけ動かす（playwright.config.ts）
import { expect, test, type Page } from '@playwright/test'
import { previewURL } from './helpers'

/** ビルドした物を開き、サービスワーカーが事前キャッシュを済ませてこの画面を受け持つまで待つ（初めて開いた時は、読み込み直してから受け持つ） */
async function openControlled(page: Page, base: string) {
  await page.goto(`${base}/`)
  await expect(page.getByTestId('login-page')).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
}

test(
  '一度開いた後は、オフラインで読み込み直してもログインの画面が出て、Roboto Mono で描かれる',
  { tag: ['@pc', '@s'] },
  async ({ page, context }, testInfo) => {
    const base = previewURL()
    test.skip(!base, 'E2E_PREVIEW=1 の時だけ（ビルドした物を vite preview で出す）')
    test.skip(testInfo.project.name !== 'desktop', 'サービスワーカーの確かめは PC の Chromium だけで行う')

    await openControlled(page, base!)

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByTestId('login-page')).toBeVisible()
    // 初めてのログインの前に電波が無い時の案内（docs/SPEC.md の 2.5）
    await expect(page.getByText('ネットにつながっていません。', { exact: false })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('12px "Roboto Mono"'))).toBe(true)
    expect(
      await page.getByRole('heading', { name: 'Diary Studio' }).evaluate(async (e) => {
        await document.fonts.load(`300 40px "Roboto Mono"`)
        return (
          [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Roboto Mono' && f.status === 'loaded') &&
          getComputedStyle(e).fontFamily.includes('Roboto Mono')
        )
      }),
    ).toBe(true)
    await context.setOffline(false)
  },
)

test(
  'サービスワーカーが受け持った後も、書体のライセンスの全文はアプリの画面に差し替えずに出す（オフラインでも）',
  { tag: ['@pc', '@s'] },
  async ({ page, context }, testInfo) => {
    const base = previewURL()
    test.skip(!base, 'E2E_PREVIEW=1 の時だけ（ビルドした物を vite preview で出す）')
    test.skip(testInfo.project.name !== 'desktop', 'サービスワーカーの確かめは PC の Chromium だけで行う')

    await openControlled(page, base!)
    for (const offline of [false, true]) {
      await context.setOffline(offline)
      await page.goto(`${base}/licenses/RobotoMono-OFL.txt`)
      const body = page.locator('body')
      await expect(body, offline ? 'オフライン' : 'オンライン').toContainText('SIL OPEN FONT LICENSE Version 1.1')
      await expect(body).toContainText('Copyright 2015 The Roboto Mono Project Authors')
      await expect(page.getByTestId('login-page')).toHaveCount(0)
    }
    await context.setOffline(false)
  },
)

test(
  '公開するビルドでは、テスト用のログインの印も window.__ds も効かない（ログインの画面のまま）',
  { tag: ['@pc', '@s'] },
  async ({ page }) => {
    const base = previewURL()
    test.skip(!base, 'E2E_PREVIEW=1 の時だけ（ビルドした物を vite preview で出す）')

    await page.addInitScript(() => localStorage.setItem('diary-studio:test-auth', '1'))
    await page.goto(`${base}/#/`)
    await expect(page.getByTestId('login-page')).toBeVisible()
    await expect(page).toHaveURL(/#\/login$/)
    await page.reload()
    await expect(page.getByTestId('login-page')).toBeVisible()
    await expect(page.getByTestId('top-page')).toHaveCount(0)
    expect(await page.evaluate(() => typeof (window as unknown as { __ds?: unknown }).__ds)).toBe('undefined')
    expect(await page.evaluate(() => localStorage.getItem('diary-studio:test-auth'))).toBe('1')
  },
)
