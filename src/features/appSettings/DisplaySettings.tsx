// 設定の「表示」（この端末だけに保存。同期しない）: 外観4つと起動アニメーションのオン・オフ（docs/SPEC.md の 4.2・5.2・18.1）。
// NS の src/features/appSettings/DisplaySettings.tsx から、原稿の書体・文字サイズ・比較画面の分割・差分のハイライトの行を外した物。
// 選んだ外観は src/ui/Layout.tsx の PrefsEffect が <html data-theme> に入れ、次に開いた時は src/launch/launch.js が最初の描画の前に入れる
import { useId } from 'react'
import { usePrefs, type AppearanceMode } from '../../store/uiStore'

/**
 * 外観の選択肢（並びは docs/SPEC.md の 4.2 の順）。chunks は、狭い画面で名前を折り返す時に切らずに保つ句
 * （「端末の設定に／合わせる」で折り返し、「合わせ／る」のように切れないように）
 */
export const APPEARANCE_OPTIONS: readonly { value: AppearanceMode; label: string; chunks?: readonly string[] }[] = [
  { value: 'system', label: '端末の設定に合わせる', chunks: ['端末の設定に', '合わせる'] },
  { value: 'white', label: 'ホワイト' },
  { value: 'dark', label: 'ダーク' },
  { value: 'deep-dark', label: 'ディープダーク' },
]

export function DisplaySettings() {
  const id = useId()
  const appearance = usePrefs((s) => s.appearance)
  const launchAnimation = usePrefs((s) => s.launchAnimation)
  const setPrefs = usePrefs((s) => s.setPrefs)

  return (
    <section className="card aset-card" aria-labelledby={`${id}-title`} data-testid="display-settings">
      <div className="aset-card-head">
        <h2 id={`${id}-title`}>表示</h2>
        <p className="aset-card-lead">この端末だけの設定です。ほかの端末やバックアップには影響しません。</p>
      </div>

      <div className="aset-row">
        <div className="aset-row-label">
          <span id={`${id}-appearance`}>外観</span>
          <span className="aset-row-desc">
            端末の設定に合わせると、端末がダークモードの時はダーク、それ以外はホワイトになります。ディープダークは仕事とプライベートの色分けも無くして、明るい色を抑えます（区分は位置とかばん・家の印で見分けます）。
          </span>
        </div>
        <div className="aset-row-control">
          <div className="segmented aset-seg aset-seg-theme" role="group" aria-labelledby={`${id}-appearance`}>
            {APPEARANCE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={appearance === o.value}
                onClick={() => setPrefs({ appearance: o.value })}
                data-testid={`appearance-${o.value}`}
              >
                {o.chunks
                  ? o.chunks.map((c) => (
                      <span key={c} className="aset-chunk">
                        {c}
                      </span>
                    ))
                  : o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="aset-row">
        <div className="aset-row-label">
          <span id={`${id}-launch`}>起動アニメーション</span>
          <span className="aset-row-desc">
            開いた時に、点で描いた日記帳と「Diary
            Studio」のアニメーションを出します（2秒ほど。画面を押すかキーを押すとすぐ消えます）。ウインドウ・タブを開いた最初の1回だけです。
          </span>
        </div>
        <div className="aset-row-control">
          <label className="switch aset-switch" data-testid="launch-switch">
            <input
              type="checkbox"
              role="switch"
              checked={launchAnimation}
              onChange={(e) => setPrefs({ launchAnimation: e.target.checked })}
              aria-labelledby={`${id}-launch`}
              data-testid="launch-animation"
            />
            <span className="track" aria-hidden="true" />
            <span className="aset-switch-state" aria-hidden="true">
              {launchAnimation ? 'オン' : 'オフ'}
            </span>
          </label>
        </div>
      </div>
    </section>
  )
}
