// 設定の画面（#/settings。別のページで、右の列は出さない。docs/SPEC.md の 18.1）。NS の src/features/appSettings/AppSettingsPage.tsx から。
// 上に［‹ 戻る］。区切りは「表示」（外観4つ・起動アニメーション。src/features/appSettings/DisplaySettings.tsx）と
// 「同期」（アカウント・同期の状態・最後に揃った時刻・［今すぐ同期］・［ログアウト］。18.1・18.4）。ラベルの色・Claude・
// ホーム画面に追加・データ・この端末・このアプリについては後の段階（段階2・5）で足す
import { useId, useState } from 'react'
import { signOut, syncNow, useSync } from '../../sync/controller'
import { useSyncView } from '../../sync/syncView'
import { useDocumentTitle } from '../../ui/hooks'
import { AppHeader, useGoBack } from '../../ui/Layout'
import { syncDetail } from '../../ui/SyncIndicator'
import { DisplaySettings } from './DisplaySettings'

/** 最後に揃った時刻の表記（「11/10 14:05」） */
export function syncedAtLabel(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 同期（アカウント・状態・［今すぐ同期］・［ログアウト］。ログアウトするとログインの画面に戻る。端末の中のデータは消さない。2.5・18.4） */
function SyncSection() {
  const id = useId()
  const email = useSync((s) => s.user?.email ?? '')
  const busy = useSync((s) => s.busy)
  const lastSyncedAt = useSync((s) => s.status?.lastSyncedAt ?? null)
  const view = useSyncView((s) => s.view)
  const [syncing, setSyncing] = useState(false)
  const now = async () => {
    setSyncing(true)
    try {
      await syncNow()
    } finally {
      setSyncing(false)
    }
  }
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
          <span>同期の状態</span>
          <span className="aset-row-desc" data-testid="sync-state">
            {view ? syncDetail(view) : '同期していません'}
          </span>
          {lastSyncedAt ? (
            <span className="aset-row-desc" data-testid="sync-last">
              最後に揃った時刻: {syncedAtLabel(lastSyncedAt)}
            </span>
          ) : null}
        </div>
        <div className="aset-row-control">
          <button type="button" className="btn" onClick={() => void now()} disabled={syncing} data-testid="sync-now">
            今すぐ同期
          </button>
        </div>
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
