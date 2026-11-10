// テストの時だけ効く「ログインした状態」の印（E2E で空のトップ画面・設定を開くため。docs/SPEC.md の 2.10）。
// 開発サーバー（import.meta.env.DEV）の時だけ、localStorage の diary-studio:test-auth があれば、Firebase を使わずに
// ログインした状態にする。公開するビルドでは import.meta.env.DEV が false になり、この処理はビルドから消える（印を置いても効かない）。
// 使い方（Playwright）: page.addInitScript(() => localStorage.setItem('diary-studio:test-auth', '1')) の後にページを開く
import { fakeSignInForTest, initSync, useSync } from '../../sync/controller'

export const TEST_AUTH_KEY = 'diary-studio:test-auth'

/** 開発サーバーで、テスト用のログインの印が置いてあるか */
export function testAuthRequested(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return localStorage.getItem(TEST_AUTH_KEY) !== null
  } catch {
    return false
  }
}

let started: Promise<void> | null = null

/**
 * 印があれば、ログインの状態を確かめ終えた所で（起動時の確かめに上書きされないように）、ログインした状態にする。
 * 1回だけ動く（ログアウトしたら、読み込み直すまでログインの画面のまま）
 */
export function startTestAuth(): Promise<void> | null {
  if (!import.meta.env.DEV || !testAuthRequested()) return null
  started ??= initSync().then(() => {
    if (useSync.getState().auth !== 'signedIn') fakeSignInForTest()
  })
  return started
}

/** テスト用 */
export function resetTestAuthForTests(): void {
  started = null
}
