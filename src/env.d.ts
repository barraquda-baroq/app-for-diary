// ビルド・開発サーバーの環境変数（import.meta.env）の型。NS の src/env.d.ts から（NS のコネクタの origin・ビルドの日時は DS では使わない）

interface ImportMetaEnv {
  /**
   * 開発・テスト用: Firebase エミュレーターのホスト（例: 127.0.0.1）。設定すると、ログインをクラウドではなくエミュレーターにつなぐ
   * （src/sync/firebase.ts。公開するビルドでは読まない）
   */
  readonly VITE_FIREBASE_EMULATOR?: string
}
