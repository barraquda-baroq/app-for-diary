// 設定の画面（段階0の土台の仮の物）。外観と起動アニメーションの切り替え（docs/SPEC.md の 4.2・5.2）と、ログアウトだけ。
// 区切り（表示・ラベルの色・同期・データなど。docs/SPEC.md の 18.1）は後の段階で作る
import { Link } from 'react-router-dom'
import { signOut, useSync } from '../../sync/controller'
import { AppHeader } from '../../ui/Layout'
import { usePrefs, type AppearanceMode } from '../../store/uiStore'

const APPEARANCES: { value: AppearanceMode; label: string }[] = [
  { value: 'system', label: '端末の設定に合わせる' },
  { value: 'white', label: 'ホワイト' },
  { value: 'dark', label: 'ダーク' },
  { value: 'deep-dark', label: 'ディープダーク' },
]

export function SettingsPage() {
  const appearance = usePrefs((s) => s.appearance)
  const launchAnimation = usePrefs((s) => s.launchAnimation)
  const setPrefs = usePrefs((s) => s.setPrefs)
  const email = useSync((s) => s.user?.email ?? '')
  const busy = useSync((s) => s.busy)
  return (
    <>
      <AppHeader />
      <main className="page page-narrow stack">
        <div>
          <Link to="/" className="btn btn-ghost btn-sm">
            ‹ 戻る
          </Link>
        </div>
        <section className="section" data-testid="display-settings">
          <div className="section-head">
            <h2>表示</h2>
          </div>
          <div className="field">
            <span id="appearance-label">外観</span>
            <div className="segmented" role="group" aria-labelledby="appearance-label">
              {APPEARANCES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  aria-pressed={appearance === a.value}
                  onClick={() => setPrefs({ appearance: a.value })}
                  data-testid={`appearance-${a.value}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={launchAnimation}
              onChange={(e) => setPrefs({ launchAnimation: e.target.checked })}
              data-testid="launch-animation"
            />
            <span className="track" aria-hidden="true" />
            <span>起動アニメーション</span>
          </label>
        </section>
        <section className="section" id="sync">
          <div className="section-head">
            <h2>同期</h2>
          </div>
          {email ? (
            <p className="small muted" style={{ margin: 0 }}>
              {email}
            </p>
          ) : null}
          <div>
            <button type="button" className="btn" onClick={() => void signOut()} disabled={busy} data-testid="sign-out">
              ログアウト
            </button>
          </div>
        </section>
      </main>
    </>
  )
}
