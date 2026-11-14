// 設定の「開発」（iPhone・iPad だけ。docs/SPEC.md の 3.1・18.1）: 端からのフリックの記録（src/history/swipeLog.ts）を取る・コピーする・
// 消す。うまくいかなかった払いの後に、作者が［記録をコピー］で送れるようにする（iPhone が指を取ったのか、アプリの側で何かしたのかを
// 分ける）。記録を取るかは端末に覚え、控えた物はこのページの間だけ（読み込み直すと消える）。画面の上に浮かべる物は作らない。
// 「履歴の数」は今のブラウザの履歴の数（history.length）。iPhone・iPad ではいつも1つにしている（src/history/singleEntryHistory.ts）ので、
// 1 なら端から払った時にブラウザのめくる動きは出ない。前の版が残した履歴がある間（更新した直後・Google のログインの後など）は 2 以上で、
// アプリを一度閉じて開き直すと 1 に戻る（22. の ■31〜■33）
import { useId, useState } from 'react'
import { clearSwipeLog, setSwipeLogEnabled, SWIPE_LOG_MAX, swipeLogEnabled, swipeLogText } from '../../history/swipeLog'

export function DevSettings() {
  const id = useId()
  const [on, setOn] = useState(swipeLogEnabled)
  /** 押した後の知らせ（コピーした・できなかった・消した） */
  const [status, setStatus] = useState<string | null>(null)
  /** コピーできなかった時に、字を選んでコピーできるように出す記録 */
  const [fallback, setFallback] = useState<string | null>(null)
  /** 今のブラウザの履歴の数（開いた時の物） */
  const [historyLength] = useState(() => window.history.length)

  const toggle = (next: boolean) => {
    setSwipeLogEnabled(next)
    setOn(next)
    setStatus(null)
    setFallback(null)
  }

  /** クリップボードへ入れる（押した出来事の中で書く。iPhone は押した直後でないと書かせない）。できなければ字を選べる欄に出す */
  const copy = () => {
    const text = swipeLogText()
    setFallback(null)
    if (!text) {
      setStatus('記録はまだありません')
      return
    }
    const count = text.split('\n').length
    const failed = () => {
      setFallback(text)
      setStatus('コピーできませんでした。下の字を選んでコピーしてください')
    }
    try {
      const written = navigator.clipboard?.writeText(text)
      if (!written) {
        failed()
        return
      }
      written.then(() => setStatus(`コピーしました（${count}件）`), failed)
    } catch {
      failed()
    }
  }

  const clear = () => {
    clearSwipeLog()
    setFallback(null)
    setStatus('消しました')
  }

  return (
    <section className="card aset-card" aria-labelledby={`${id}-title`} data-testid="dev-settings">
      <div className="aset-card-head">
        <h2 id={`${id}-title`}>開発</h2>
        <p className="aset-card-lead">画面の端からのフリックがうまくいかなかった時に、何が起きたかを調べるための物です。</p>
      </div>
      <div className="aset-row">
        <div className="aset-row-label">
          <span id={`${id}-log`}>端からのフリックの記録を取る</span>
          <span className="aset-row-desc">
            入れている間、端からのフリックと、その時にアプリがしたこと（履歴・指の出来事・めくる動き）を新しい物から
            {SWIPE_LOG_MAX}
            件まで控えます。予定の中身は控えません。読み込み直すと消えます。
          </span>
        </div>
        <div className="aset-row-control">
          <label className="switch aset-switch" data-testid="swipe-log-switch">
            <input
              type="checkbox"
              role="switch"
              checked={on}
              onChange={(e) => toggle(e.target.checked)}
              aria-labelledby={`${id}-log`}
              data-testid="swipe-log"
            />
            <span className="track" aria-hidden="true" />
            <span className="aset-switch-state" aria-hidden="true">
              {on ? 'オン' : 'オフ'}
            </span>
          </label>
        </div>
      </div>
      <div className="aset-row">
        <div className="aset-row-label">
          <span data-testid="history-length">履歴の数 {historyLength}</span>
          <span className="aset-row-desc">
            1 なら、画面の端から払った時にブラウザのページがめくれる動きは出ません。2 以上の時は、アプリを一度閉じて（App
            スイッチャーで上へ払って）開き直すと 1 に戻ります。
          </span>
        </div>
      </div>
      <div className="aset-row">
        <div className="aset-row-label">
          <span>記録</span>
          <span className="aset-row-desc">うまくいかなかった払いの後に、すぐコピーして送ってください。</span>
          <span className="aset-row-desc" role="status" data-testid="swipe-log-status">
            {status}
          </span>
        </div>
        <div className="aset-row-control">
          <button type="button" className="btn" onClick={copy} data-testid="swipe-log-copy">
            記録をコピー
          </button>
          <button type="button" className="btn" onClick={clear} data-testid="swipe-log-clear">
            記録を消す
          </button>
        </div>
        {fallback !== null ? (
          <div className="aset-log">
            <textarea
              className="textarea"
              readOnly
              rows={6}
              value={fallback}
              aria-label="端からのフリックの記録"
              onFocus={(e) => e.currentTarget.select()}
              data-testid="swipe-log-text"
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
