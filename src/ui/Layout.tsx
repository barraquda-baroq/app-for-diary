// アプリの外枠: ヘッダー、外観の反映、アプリの更新の帯、お知らせ（トースト）、ダイアログ。NS の src/ui/Layout.tsx から。
// 段階0の土台の仮の物: ヘッダーの中身（MIM のボタンなど。docs/SPEC.md の 3.3）は画面の枠の担当が作る。
// NS のパンくず・端末への保存の状態・別のタブの変更の帯・iPhone / Android のアプリの帯は持ち込まない（保存の帯などは段階1で足す）
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { saveBeforeLeave } from '../store/lifecycle'
import { resolveAppearance, THEME_COLORS, useAppUpdate, usePrefs, useToasts } from '../store/uiStore'
import { DialogHost, cancelAllDialogs } from './dialogs'
import { GearIcon, XIcon } from './icons'
import { SyncIndicator } from './SyncIndicator'

/** 各画面のヘッダー。actions に右側のボタンを渡す */
export function AppHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label="トップ（カレンダー）">
        <img src="./icon.svg" alt="" />
        <span className="hide-mobile">Diary Studio</span>
      </Link>
      <span className="spacer" />
      {actions}
      <SyncIndicator />
      <Link to="/settings" className="icon-btn" aria-label="設定" title="設定" data-testid="open-settings">
        <GearIcon />
      </Link>
    </header>
  )
}

function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  // ダイアログ表示中は画面本体が操作不可（inert）になるので、お知らせは body 直下に出す
  return createPortal(
    <div className="toasts" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <p>{t.message}</p>
          {t.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismiss(t.id)
                t.action?.run()
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" onClick={() => dismiss(t.id)} aria-label="閉じる">
            <XIcon />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

/** 新しい版を受け取ったら「新しい版があります ［更新する］」の帯を出す。押すと入力中の下書きを保存してから読み込み直す（docs/SPEC.md の 2.8） */
function UpdateBanner() {
  const ready = useAppUpdate((s) => s.ready)
  const apply = useAppUpdate((s) => s.apply)
  if (!ready || !apply) return null
  const update = async () => {
    await saveBeforeLeave()
    await apply()
  }
  return (
    <div className="banner banner-info" role="status" data-testid="update-banner">
      <span className="grow">新しい版があります</span>
      <button type="button" className="btn btn-sm" onClick={() => void update()} data-testid="app-update">
        更新する
      </button>
    </div>
  )
}

/**
 * 外観を <html> に反映する（docs/SPEC.md の 4.2）。
 * data-theme には実際の外観（white / dark / deep-dark）を入れる。「端末の設定に合わせる」の間は端末の切り替えにも追従する。
 * ブラウザの枠の色（<meta name="theme-color">）も外観に合わせる。最初の描画前は index.html のスクリプト（src/launch/launch.js）が同じことをする。
 */
export function PrefsEffect() {
  const appearance = usePrefs((s) => s.appearance)
  useEffect(() => {
    const root = document.documentElement
    const query = appearance === 'system' ? window.matchMedia?.('(prefers-color-scheme: dark)') : undefined
    const apply = () => {
      const resolved = resolveAppearance(appearance, query?.matches ?? false)
      root.setAttribute('data-theme', resolved)
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      if (!meta) {
        meta = document.createElement('meta')
        meta.name = 'theme-color'
        document.head.appendChild(meta)
      }
      meta.content = THEME_COLORS[resolved]
    }
    apply()
    query?.addEventListener?.('change', apply)
    return () => query?.removeEventListener?.('change', apply)
  }, [appearance])
  return null
}

/** 画面が変わったら、開いたままの確認・入力ダイアログはキャンセル扱いで閉じる */
function CloseDialogsOnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => cancelAllDialogs, [pathname])
  return null
}

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <CloseDialogsOnNavigate />
      <PrefsEffect />
      <UpdateBanner />
      {children}
      <Toasts />
      <DialogHost />
    </div>
  )
}
