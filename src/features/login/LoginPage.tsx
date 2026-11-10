// ログインの画面（段階0の土台の仮の物。ビルドを通すための形）。
// 見た目（表紙の青の地・等幅の「Diary Studio」・今日の日付・iPhone の Safari の案内。docs/SPEC.md の 2.5）は画面の枠の担当が作る
import { signIn, useSync } from '../../sync/controller'

export function LoginPage() {
  const busy = useSync((s) => s.busy)
  const error = useSync((s) => s.error)
  return (
    <main className="page page-narrow stack" data-testid="login-page">
      <h1>Diary Studio</h1>
      {error ? (
        <p className="small" role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}
      <div>
        <button type="button" className="btn" onClick={() => void signIn()} disabled={busy} data-testid="login-google">
          Google でログイン
        </button>
      </div>
    </main>
  )
}
