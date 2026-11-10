// 設定の画面（#/settings。別のページで、右の列は出さない。docs/SPEC.md の 18.1）。NS の src/features/appSettings/AppSettingsPage.tsx から。
// 上に［‹ 戻る］。段階0の区切りは「表示」（外観4つ・起動アニメーション。src/features/appSettings/DisplaySettings.tsx）と
// 「同期」（ログインしているアカウントと［ログアウト］だけ）。同期の状態・［今すぐ同期］・ラベルの色・Claude・ホーム画面に追加・
// データ・この端末・このアプリについては後の段階（段階1・2・5）で足す
import { useId } from 'react'
import { signOut, useSync } from '../../sync/controller'
import { useDocumentTitle } from '../../ui/hooks'
import { AppHeader, useGoBack } from '../../ui/Layout'
import { DisplaySettings } from './DisplaySettings'

/** 同期（段階0はアカウントと［ログアウト］だけ。ログアウトするとログインの画面に戻る。端末の中のデータは消さない。docs/SPEC.md の 2.5） */
function SyncSection() {
  const id = useId()
  const email = useSync((s) => s.user?.email ?? '')
  const busy = useSync((s) => s.busy)
  return (
    <section id="sync" className="card aset-card" aria-labelledby={`${id}-title`} data-testid="sync-settings">
      <div className="aset-card-head">
        <h2 id={`${id}-title`}>同期</h2>
        <p className="aset-card-lead">
          ログアウトしても、この端末の中のデータは消えません（同じアカウントで入り直せば続きから使えます）。
        </p>
      </div>
      <div className="aset-row">
        <div className="aset-row-label">
          <span>ログインしているアカウント</span>
          {email ? (
            <span className="aset-row-desc" data-testid="sync-account">
              {email}
            </span>
          ) : null}
        </div>
        <div className="aset-row-control">
          <button type="button" className="btn" onClick={() => void signOut()} disabled={busy} data-testid="sign-out">
            ログアウト
          </button>
        </div>
      </div>
    </section>
  )
}

export function AppSettingsPage() {
  useDocumentTitle('設定')
  const goBack = useGoBack()
  return (
    <>
      <AppHeader />
      <main className="page page-narrow stack" data-testid="app-settings">
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={goBack} data-testid="settings-back">
            ‹ 戻る
          </button>
        </div>
        <h1 className="visually-hidden">設定</h1>
        <DisplaySettings />
        <SyncSection />
      </main>
    </>
  )
}
