// 設定の「開発」（iPhone・iPad だけ。docs/SPEC.md の 3.1・18.1）: 端からのフリックの記録（src/history/swipeLog.ts）を取る・コピーする・
// 消す。うまくいかなかった払いの後に、作者が［記録をコピー］で送れるようにする（iPhone が途中で戻したのか、アプリの側で何かしたのかを
// 分ける）。記録を取るかは端末に覚え、控えた物はこのページの間だけ（読み込み直すと消える）。画面の上に浮かべる物は作らない（端からの
// フリックの間に見える絵に写るため）
import { useId, useState } from 'react'
import { clearSwipeLog, setSwipeLogEnabled, SWIPE_LOG_MAX, swipeLogEnabled, swipeLogText } from '../../history/swipeLog'

export function DevSettings() {
  const id = useId()
  const [on, setOn] = useState(swipeLogEnabled)
  /** 押した後の知らせ（コピーした・できなかった・消した） */
  const [status, setStatus] = useState<string | null>(null)
  /** コピーできなかった時に、字を選んでコピーできるように出す記録 */
  const [fallback, setFallback] = useState<string | null>(null)

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
