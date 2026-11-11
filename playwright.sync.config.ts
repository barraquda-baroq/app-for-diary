import { defineConfig, devices } from '@playwright/test'

// 同期の E2E テスト（docs/SPEC.md の 2.10・D13）。Firebase エミュレーターにつなぐ開発サーバーで、2つのブラウザ（端末）を動かす。
// `npm run test:e2e:sync` で、エミュレーターを立ち上げてから実行する（NS の playwright.sync.config.ts から）。
// - e2e/calendar.sync.spec.ts: 2つのブラウザでの同期（片方で足した予定・付けた休み・動かした日付が、もう片方のカレンダーに出る）
// - e2e/owner-gate.sync.spec.ts: 持ち主の関所（別のアカウントで開いた時・まだ持ち主だと確かめていないアカウントで電波が無い時に、
//   端末のデータ（カレンダーの予定）が出ない）
// エミュレーターにつないだ開発サーバーはふだん持ち主を確かめない（docs/SPEC.md の 2.5）ので、ここでは VITE_E2E_OWNER_LOCK=1
// （開発サーバーだけ。src/sync/controller.ts）で本番と同じに確かめさせ、持ち主の記録 config/owner はテストが管理者の権限で作る
// （src/test/emulatorAdmin.ts）。持ち主の記録は1つだけなので、テストは1つずつ流す。
// エミュレーターのアカウントはテストごとに名前を替える（前の回のデータと混ざらないように）。データは作り物だけ。
// 入っている Chromium を使う時は PW_CHROMIUM_PATH にその場所を入れる（playwright.config.ts と同じ）
const port = Number(process.env.E2E_SYNC_PORT ?? 5180)
const chromium = process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.sync.spec.ts',
  outputDir: './e2e/artifacts/sync-results',
  fullyParallel: false,
  workers: 1,
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
    env: {
      VITE_FIREBASE_EMULATOR: '127.0.0.1',
      VITE_E2E_OWNER_LOCK: '1',
    },
    url: `http://localhost:${port}`,
    // CI では必ず上の環境変数で立ち上げる。手元では、同じ2つの環境変数で先に立ち上げた開発サーバーを使ってもよい
    // （ふつうの開発サーバーを使うと、ログインできない・持ち主を確かめないので、テストが落ちて分かる）
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, ...chromium },
    },
  ],
})
