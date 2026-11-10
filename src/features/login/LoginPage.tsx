// ログインの画面（docs/SPEC.md の 2.5・Q27）: 最初にこの画面を出し、ログインしてから使う（ヘッダーは出さない）。
// 見た目は参考画像の表紙の組み方（4.4）: 画面いっぱいに --cover（外観ごとのグレー）の地、左寄せで等幅の「Diary Studio」、その下に今日の曜日と
// 日付「TUE · 2026.11.10」、さらに下に［Google でログイン］。画面の左下に「DIARY STUDIO  v0.1」。
// iPhone をホーム画面のアプリでなく開いた時は、ホーム画面に追加してから使う案内と［追加の手順］を出す（D44）。iPhone は Chrome を基準にし
// （作者の指示）、案内の言葉は開いているブラウザ（Chrome・Safari。ほかは「ブラウザ」）の名前で出す。
// Firebase の設定がまだ仮の値の時（docs/DEPLOY.md の手順で差し替える前）は、ログインを始めずに「まだ公開の準備ができていません」と出す。
// ログインした後、持ち主を確かめている間（「確かめています…」）・持ち主の記録が無い・ほかのアカウントの記録の時・前に別のアカウントで
// 使っていた時は、この画面の中に文とボタンを出す（2.5 の 3・4。データは何も見えない）
import { useEffect, useState } from 'react'
import { coverDateLabel } from '../../domain/dates'
import { canShowData, confirmAccountSwitch, signIn, signOut, useSync } from '../../sync/controller'
import { firebaseConfigIsPlaceholder } from '../../sync/firebaseConfig'
import { APP_VERSION } from '../../sync/appVersion'
import { OWNER_MISMATCH_MESSAGE, OWNER_MISSING_MESSAGE } from '../../sync/syncView'
import { useDocumentTitle, useToday } from '../../ui/hooks'
import { Modal } from '../../ui/Modal'
import { InstallHelp } from './InstallHelp'
import { currentIosBrowser, currentPlatform, isStandalone, needsHomeScreenNotice, type IosBrowser } from './platform'
import './login.css'

/** 画面の左下の版（src/sync/appVersion.ts の APP_VERSION） */
export const VERSION_LABEL = `v${APP_VERSION}`

/** 持ち主を確かめている間の言葉（2.5） */
export const OWNER_CHECKING_MESSAGE = '確かめています…'

/** 前に別のアカウントで使っていた時の確かめの言葉（2.5 の 4） */
export function accountSwitchMessage(previousEmail: string): string {
  const who = previousEmail ? `別のアカウント（${previousEmail}）` : '別のアカウント'
  return `この端末は前に${who}で使っていました。このアカウントで同期すると、この端末の中のデータがこのアカウントのクラウドと合わさります。`
}

export const NOT_READY_MESSAGE = 'まだ公開の準備ができていません（docs/DEPLOY.md）'
export const OFFLINE_MESSAGE = 'ネットにつながっていません。最初の1回はネットにつないでログインしてください。'

/** iPhone の案内で呼ぶ、開いているブラウザのタブ（Chrome を基準にし、Safari で開いた時は Safari。ほかは「ブラウザ」） */
const BROWSER_TAB: Record<IosBrowser, string> = { chrome: 'Chrome のタブ', safari: 'Safari のタブ', other: 'ブラウザのタブ' }
const STAY_LABEL: Record<IosBrowser, string> = {
  chrome: 'このまま Chrome で使う',
  safari: 'このまま Safari で使う',
  other: 'このままブラウザで使う',
}

/** iPhone をホーム画面のアプリでなく開いた時の案内（D44。Q27 の A のおすすめ案の中身を借りた物） */
export function homeScreenMessage(browser: IosBrowser): string {
  return `ホーム画面に追加してから使ってください。${BROWSER_TAB[browser]}のままだと、ホーム画面のアプリとデータが別々になり、しばらく使わないとデータが消されることもあります。`
}

/** 案内を閉じる小さなボタンの言葉 */
export function stayLabel(browser: IosBrowser): string {
  return STAY_LABEL[browser]
}

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

/** ログインの前のボタンと案内 */
function LoginActions(props: {
  online: boolean
  homeNotice: boolean
  browser: IosBrowser
  message: string | null
  busy: boolean
  onHelp: () => void
  onStay: () => void
  onLogin: () => void
}) {
  const { online, homeNotice, browser, message, busy } = props
  return (
    <>
      {!online ? (
        <p className="login-note" role="status" data-testid="login-offline">
          {OFFLINE_MESSAGE}
        </p>
      ) : null}
      {homeNotice ? (
        <div className="login-home" data-testid="login-home-notice">
          <p className="login-note">{homeScreenMessage(browser)}</p>
          <div className="login-home-actions">
            <button type="button" className="btn btn-sm" onClick={props.onHelp} data-testid="login-install-help">
              追加の手順
            </button>
            <button type="button" className="login-link" onClick={props.onStay} data-testid="login-stay-browser">
              {stayLabel(browser)}
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
        <button type="button" className="btn login-google" onClick={props.onLogin} disabled={busy} data-testid="login-google">
          Google でログイン
        </button>
      </div>
    </>
  )
}

/** ログインした後、まだデータを出せない時の文とボタン（2.5 の 3・4） */
function SignedInGate({ online }: { online: boolean }) {
  const busy = useSync((s) => s.busy)
  const owner = useSync((s) => s.owner)
  const mismatch = useSync((s) => s.accountMismatch)
  const email = useSync((s) => s.user?.email ?? '')
  const logout = (
    <button
      type="button"
      className="btn login-google"
      onClick={() => void signOut()}
      disabled={busy}
      data-testid="login-sign-out"
    >
      ログアウト
    </button>
  )
  if (owner === 'missing' || owner === 'mismatch') {
    return (
      <>
        <p className="login-note is-alert" role="alert" data-testid="login-owner">
          {owner === 'missing' ? OWNER_MISSING_MESSAGE : OWNER_MISMATCH_MESSAGE}
        </p>
        <div>{logout}</div>
      </>
    )
  }
  if (mismatch) {
    return (
      <>
        <p className="login-note" role="status" data-testid="login-account-switch">
          {accountSwitchMessage(mismatch.previousEmail)}
        </p>
        <div className="login-home-actions">
          <button
            type="button"
            className="btn login-google"
            onClick={() => void confirmAccountSwitch()}
            disabled={busy}
            data-testid="login-confirm-account"
          >
            このアカウントで同期する
          </button>
          {logout}
        </div>
      </>
    )
  }
  return (
    <>
      <p className="login-note" role="status" data-testid="login-owner-checking">
        {online ? OWNER_CHECKING_MESSAGE : OFFLINE_MESSAGE}
      </p>
      {email ? <p className="login-note">{email}</p> : null}
      <div>{logout}</div>
    </>
  )
}

export function LoginPage() {
  useDocumentTitle('ログイン')
  const busy = useSync((s) => s.busy)
  const error = useSync((s) => s.error)
  // ログインした後、まだデータを出せない（持ち主を確かめている・持ち主でない・別のアカウントの確かめ）
  const gated = useSync((s) => s.auth === 'signedIn' && !canShowData(s))
  const online = useOnline()
  const [notice, setNotice] = useState<string | null>(null)
  const [homeNotice, setHomeNotice] = useState(() => needsHomeScreenNotice(currentPlatform(), isStandalone()))
  const [browser] = useState(currentIosBrowser)
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
          {gated ? (
            <SignedInGate online={online} />
          ) : (
            <LoginActions
              online={online}
              homeNotice={homeNotice}
              browser={browser}
              message={message}
              busy={busy}
              onHelp={() => setHelp(true)}
              onStay={() => setHomeNotice(false)}
              onLogin={login}
            />
          )}
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
