// ログインの画面（docs/SPEC.md の 2.5・Q27）: 最初にこの画面を出し、ログインしてから使う（ヘッダーは出さない）。
// 見た目は参考画像の表紙の組み方（4.4）: 画面いっぱいに --cover（外観ごとのグレー）の地、左寄せで等幅の「Diary Studio」、その下に今日の曜日と
// 日付「TUE · 2026.11.10」、さらに下に［Google でログイン］。画面の左下に「DIARY STUDIO  v0.1」。
// iPhone をホーム画面のアプリでなく開いた時は、ホーム画面に追加してから使う案内と［追加の手順］を出す（D44）。
// Firebase の設定がまだ仮の値の時（docs/DEPLOY.md の手順で差し替える前）は、ログインを始めずに「まだ公開の準備ができていません」と出す。
// 持ち主の確かめ・別のアカウントの確かめ（2.5 の 3・4）は段階1で足す
import { useEffect, useState } from 'react'
import { coverDateLabel } from '../../domain/dates'
import { signIn, useSync } from '../../sync/controller'
import { firebaseConfigIsPlaceholder } from '../../sync/firebaseConfig'
import { useDocumentTitle, useToday } from '../../ui/hooks'
import { Modal } from '../../ui/Modal'
import { InstallHelp } from './InstallHelp'
import { currentPlatform, isStandalone, needsHomeScreenNotice } from './platform'
import './login.css'

/** 画面の左下の版（段階1で src/sync/appVersion.ts の APP_VERSION（'0.1'）に寄せる） */
export const VERSION_LABEL = 'v0.1'

export const NOT_READY_MESSAGE = 'まだ公開の準備ができていません（docs/DEPLOY.md）'
export const OFFLINE_MESSAGE = 'ネットにつながっていません。最初の1回はネットにつないでログインしてください。'
export const HOME_SCREEN_MESSAGE =
  'ホーム画面に追加してから使ってください。Safari のままだと、ホーム画面のアプリとデータが別々になり、しばらく使わないとデータが消されることもあります。'

/**
 * まだログインできない（Firebase の設定が差し替え用の仮の値のまま。docs/DEPLOY.md）。
 * 開発でエミュレーターにつないでいる時（VITE_FIREBASE_EMULATOR）は、仮の値のままでもログインできる
 */
export function loginNotReady(): boolean {
  const emulator = import.meta.env.DEV && Boolean(import.meta.env.VITE_FIREBASE_EMULATOR)
  return firebaseConfigIsPlaceholder && !emulator
}

/** 電波があるか（無くなった・戻ったらすぐに変わる） */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

export function LoginPage() {
  useDocumentTitle('ログイン')
  const busy = useSync((s) => s.busy)
  const error = useSync((s) => s.error)
  const online = useOnline()
  const [notice, setNotice] = useState<string | null>(null)
  const [homeNotice, setHomeNotice] = useState(() => needsHomeScreenNotice(currentPlatform(), isStandalone()))
  const [help, setHelp] = useState(false)
  // 開いたまま 0時を過ぎたら日付も変える（docs/SPEC.md の 6.4）
  const today = coverDateLabel(useToday())

  const login = () => {
    if (loginNotReady()) {
      setNotice(NOT_READY_MESSAGE)
      return
    }
    setNotice(null)
    void signIn()
  }

  // 電波が無い時は、Firebase を読み込めなかった失敗の言葉の代わりに、ネットにつなぐ案内を出す
  const message = notice ?? (online ? error : null)

  return (
    <main className="login" data-testid="login-page">
      <div className="login-body">
        <h1 className="login-logo">Diary Studio</h1>
        <p className="login-date" data-testid="login-date">
          {today}
        </p>
        <div className="login-actions">
          {!online ? (
            <p className="login-note" role="status" data-testid="login-offline">
              {OFFLINE_MESSAGE}
            </p>
          ) : null}
          {homeNotice ? (
            <div className="login-home" data-testid="login-home-notice">
              <p className="login-note">{HOME_SCREEN_MESSAGE}</p>
              <div className="login-home-actions">
                <button type="button" className="btn btn-sm" onClick={() => setHelp(true)} data-testid="login-install-help">
                  追加の手順
                </button>
                <button type="button" className="login-link" onClick={() => setHomeNotice(false)} data-testid="login-stay-safari">
                  このまま Safari で使う
                </button>
              </div>
            </div>
          ) : null}
          {message ? (
            <p className="login-note is-alert" role="alert" data-testid="login-message">
              {message}
            </p>
          ) : null}
          <div>
            <button type="button" className="btn login-google" onClick={login} disabled={busy} data-testid="login-google">
              Google でログイン
            </button>
          </div>
        </div>
      </div>
      <p className="login-foot">
        <span>DIARY STUDIO</span>
        <span>{VERSION_LABEL}</span>
      </p>
      {help ? (
        <Modal title="ホーム画面に追加" onClose={() => setHelp(false)}>
          <InstallHelp framed={false} />
        </Modal>
      ) : null}
    </main>
  )
}
