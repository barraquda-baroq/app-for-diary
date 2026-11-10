import { defineConfig, devices } from '@playwright/test'

// E2E テスト（docs/SPEC.md の 2.10）。`npm run test:e2e` で開発サーバーを立ち上げて実行する。NS の playwright.config.ts から。
// 複数の作業を並行して走らせる時は E2E_PORT でポートを分ける。
// 入っている Chromium を使う時は PW_CHROMIUM_PATH にその場所を入れる（@playwright/test の版と入っているブラウザの版が違う環境）。
// 同期のテスト（エミュレーターで2つのブラウザ）は段階1で playwright.sync.config.ts に足す
const port = Number(process.env.E2E_PORT ?? 5174)
const chromium = process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/*.sync.spec.ts',
  outputDir: './e2e/artifacts/results',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, ...chromium } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...chromium } },
    // iPhone と同じ WebKit。WebKit を入れた所（CI）だけで動かす: npx playwright install webkit のあと E2E_WEBKIT=1
    ...(process.env.E2E_WEBKIT ? [{ name: 'iphone', use: { ...devices['iPhone 14'] } }] : []),
  ],
})
