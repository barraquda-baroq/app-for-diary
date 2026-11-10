// アプリの入り口。NS の src/main.tsx から、iPhone / Android のアプリ（Capacitor）・端末の中のデータの読み込み（段階1）・
// Claude 連携の部分を外した物（docs/SPEC.md の 2.2・2.3）。
// 等幅の英数字の書体（Roboto Mono。latin の 300・400・500・600 だけ。アプリに同梱し、オフラインでも出る。docs/SPEC.md の 4.7）
import '@fontsource/roboto-mono/latin-300.css'
import '@fontsource/roboto-mono/latin-400.css'
import '@fontsource/roboto-mono/latin-500.css'
import '@fontsource/roboto-mono/latin-600.css'
// 共通スタイルを先に読み込み、各画面の CSS で上書きできるようにする
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { afterNextPaint, notifyAppReady } from './launch/launchHook'
import { installLeaveHandlers, saveBeforeLeave } from './store/lifecycle'
import { useAppUpdate } from './store/uiStore'
import { fakeSignInForTest, initSync, signInForTest, useSync, whenAuthKnown } from './sync/controller'

// 端末内のデータが勝手に消されないよう、永続ストレージを要求する（対応ブラウザのみ）
void navigator.storage?.persist?.().catch(() => undefined)

// 画面を閉じる・裏に回る時は、入力中の下書きも含めて保留中の変更をすぐ保存する
installLeaveHandlers()

// 新しい版の知らせ（サービスワーカー）。更新は「更新する」を押した時だけ（docs/SPEC.md の 2.8）
if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      useAppUpdate.setState({
        ready: true,
        apply: async () => {
          await saveBeforeLeave()
          await updateSW(true)
        },
      })
    },
  })
}

// E2E テストから操作するための開発用フック（本番ビルドには含まれない。NS の window.__ns と同じ。docs/SPEC.md の 2.10）
if (import.meta.env.DEV) {
  ;(window as unknown as { __ds: unknown }).__ds = {
    /** エミュレーターにつないでいる時だけ: 仮のアカウントでログインする */
    signInForTest,
    /** 画面のテスト用: Firebase を使わずにログインした状態にする */
    fakeSignIn: () => fakeSignInForTest(),
    /** ログインしているアカウント（同期のテスト用） */
    syncUid: () => useSync.getState().user?.uid ?? null,
  }
}

// ログインの状態を確かめ始める（ログインしていなければログインの画面、していればトップ画面。docs/SPEC.md の 2.5）
void initSync()
// 起動アニメーション（index.html に埋め込んだ src/launch/launch.js）に、最初の画面（読み込み中…ではなく、ログインの画面か
// トップ画面）が出たことを知らせる。アニメーションも終わっていれば、それで消える。端末の中のデータの読み込みは段階1で待つ物に足す
void whenAuthKnown().then(() => afterNextPaint(notifyAppReady))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
