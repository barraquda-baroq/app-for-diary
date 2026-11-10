// アプリの入り口。NS の src/main.tsx から、iPhone / Android のアプリ（Capacitor）と Claude 連携の部分を外した物（docs/SPEC.md の 2.2・2.3）。
// 起動の順: 端末の中のデータ（Dexie）を読む → ログインの状態を確かめる → 両方が終わってから起動アニメーションに「準備ができた」と知らせる。
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
import { actions } from './store/actions'
import { getData, getRaw, initStore, startTrashPurge } from './store/appStore'
import { installLeaveHandlers } from './store/lifecycle'
import { useAppUpdate } from './store/uiStore'
import { fakeSignInForTest, inboxContext, initSync, signInForTest, syncNow, useSync, whenAuthKnown } from './sync/controller'

// 端末内のデータが勝手に消されないよう、永続ストレージを要求する（対応ブラウザのみ）
void navigator.storage?.persist?.().catch(() => undefined)

// 画面を閉じる・裏に回る時は、入力中の下書きも含めて保留中の変更をすぐ保存する
installLeaveHandlers()

// 新しい版の知らせ（サービスワーカー）。更新は「更新する」を押した時だけ（docs/SPEC.md の 2.8）。
// 入力中の下書きの保存は、帯の［更新する］（src/ui/Layout.tsx の UpdateBanner）がしてから apply を呼ぶ（保存は1か所だけ）
if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      useAppUpdate.setState({ ready: true, apply: () => updateSW(true) })
    },
  })
}

// E2E テストから操作するための開発用フック（本番ビルドには含まれない。NS の window.__ns と同じ。docs/SPEC.md の 2.10）
if (import.meta.env.DEV) {
  /** showUpdateBanner で出した帯の［更新する］が押されたか */
  let updateApplied = false
  ;(window as unknown as { __ds: unknown }).__ds = {
    /** エミュレーターにつないでいる時だけ: 仮のアカウントでログインする */
    signInForTest,
    /** 画面のテスト用: Firebase を使わずにログインした状態にする */
    fakeSignIn: () => fakeSignInForTest(),
    /** ログインしているアカウント（同期のテスト用） */
    syncUid: () => useSync.getState().user?.uid ?? null,
    /** 表示用のデータ・端末の raw のデータ・操作（同期のテスト用） */
    getData,
    getRaw,
    actions,
    /** 受け取り箱の依頼を当てる時の文脈（段階5で自動で当てる所が使う。テストでは許可を上書きする） */
    inboxContext,
    syncNow,
    syncStatus: () => useSync.getState().status,
    /** 画面のテスト用: 新しい版を受け取った時の帯（本物の UpdateBanner）を出す。［更新する］を押すと updateApplied() が true になる */
    showUpdateBanner: () => {
      updateApplied = false
      useAppUpdate.setState({
        ready: true,
        apply: async () => {
          updateApplied = true
        },
      })
    },
    updateApplied: () => updateApplied,
  }
}

// 端末の中のデータを読み、ログインの状態を確かめ始める（ログインしていなければログインの画面、持ち主だと確かめたアカウントなら
// トップ画面。docs/SPEC.md の 2.5）。ゴミ箱の期限切れは今と1時間ごとに消す（6.15）
const storeReady = initStore().then(() => startTrashPurge())
void storeReady.then(() => initSync())
// 起動アニメーション（index.html に埋め込んだ src/launch/launch.js）に、最初の画面（読み込み中…ではなく、ログインの画面か
// トップ画面）が出たことを知らせる。アニメーションも終わっていれば、それで消える
void storeReady.then(() => whenAuthKnown()).then(() => afterNextPaint(notifyAppReady))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
