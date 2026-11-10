// E2E テスト用のヘルパー。NS の e2e/helpers.ts から。開発サーバーでは window.__ds（src/main.tsx）からログインの状態などを操作できる。
// データを用意する seed は、データのストアを作る段階1で足す
import { expect, type Locator, type Page } from '@playwright/test'

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
