// ビルド・開発サーバーの環境変数（import.meta.env）の型。NS の src/env.d.ts から（NS のコネクタの origin・ビルドの日時は DS では使わない）

interface ImportMetaEnv {
  /**
   * 開発・テスト用: Firebase エミュレーターのホスト（例: 127.0.0.1）。設定すると、ログインをクラウドではなくエミュレーターにつなぐ
   * （src/sync/firebase.ts。公開するビルドでは読まない）
   */
  readonly VITE_FIREBASE_EMULATOR?: string
  /**
   * E2E 用: '1' なら、エミュレーターにつないだ開発サーバーでも本番と同じに持ち主を確かめる（e2e/owner-gate.sync.spec.ts。
   * playwright.sync.config.ts が立ち上げる開発サーバーだけ。src/sync/controller.ts の skipsOwnerCheck。公開するビルドでは読まない）
   */
  readonly VITE_E2E_OWNER_LOCK?: string
}
