// アプリの外枠: ヘッダー、外観の反映、アプリの更新の帯、お知らせ（トースト）、ダイアログ。NS の src/ui/Layout.tsx から。
// ヘッダー（docs/SPEC.md の 3.3）: 左に DS のアイコンと名前、右に 同期の表示 → 設定の歯車 → いちばん右に［MIM］。
// NS のパンくず・端末への保存の状態・別のタブの変更の帯・iPhone / Android のアプリの帯は持ち込まない（保存の帯などは段階1で足す）。
// 段階2で、左のアイコンと名前の行き先（前回のモードの今日を含む期間）・カレンダーの ‹ › 今日 でスクロールを戻さないこと・
// iPhone のキーボードの高さ（--kb）を足した。お知らせのボタンは、指で押した時は指を離した時に効く（src/ui/fingerTap.ts）
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { todayStr } from '../domain/dates'
import { calendarModeOf, isCalendarPath, isMimPath, paths } from '../routes'
import { saveBeforeLeave } from '../store/lifecycle'
import {
  notifyError,
  OK_LABEL,
  resolveAppearance,
  THEME_COLORS,
  useAppUpdate,
  useCalendarUi,
  usePrefs,
  useToasts,
  type Toast,
} from '../store/uiStore'
import { DialogHost, cancelAllDialogs } from './dialogs'
import { useFingerTap } from './fingerTap'
import { GearIcon, KeyIcon, XIcon } from './icons'
import { useKeyboardInset } from './keyboardInset'
import { keepQuickAddAttr } from './keepQuickAdd'
import { SyncIndicator } from './SyncIndicator'
import './layout.css'

/**
 * 1つ前の画面へ戻る（設定の［‹ 戻る］・MIM を閉じる時）。その行き先を直接開いた時（アプリの中で移ってきた履歴が無い時）は、
 * アプリの外へ戻らないよう、トップへ置き換える（React Router は最初の履歴の key を 'default' にする）
 */
export function useGoBack(): () => void {
  const navigate = useNavigate()
  const { key } = useLocation()
  return useCallback(() => {
    if (key !== 'default') void navigate(-1)
    else void navigate(paths.top(), { replace: true })
  }, [navigate, key])
}

/** MIM を開いた時に履歴に付ける印: カレンダーの画面から開いたか（［‹ カレンダーに戻る］で1つ前へ戻ってよいか） */
interface MimHistoryState {
  mimFromCalendar?: boolean
}

/**
 * ［MIM］の開く・閉じる（docs/SPEC.md の 3.3・16.1）。開くと #/mim を履歴に積み（「戻る」で閉じられる）、開いている間に押すと
 * 閉じて前の画面へ戻る（toggle）。設定などの画面から押した時も #/mim（トップの画面の中の MIM）を開く。
 * backToCalendar は MIM の上の列の［‹ カレンダーに戻る］: カレンダーから開いていれば1つ前へ戻り、ほかの画面から開いた時は
 * トップ（カレンダー）へ置き換える
 */
export function useMim(): { open: boolean; toggle: () => void; backToCalendar: () => void } {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useGoBack()
  const open = isMimPath(location.pathname)
  const fromCalendar = isCalendarPath(location.pathname)
  const toggle = useCallback(() => {
    if (open) goBack()
    else void navigate(paths.mim(), { state: { mimFromCalendar: fromCalendar } satisfies MimHistoryState })
  }, [open, fromCalendar, goBack, navigate])
  const cameFromCalendar = Boolean((location.state as MimHistoryState | null)?.mimFromCalendar)
  const backToCalendar = useCallback(() => {
    if (cameFromCalendar && location.key !== 'default') void navigate(-1)
    else void navigate(paths.top(), { replace: true })
  }, [cameFromCalendar, location.key, navigate])
  return { open, toggle, backToCalendar }
}

/** ヘッダーのいちばん右の［MIM］。開いている間は押した状態（今日の印と同じ地と輪）。S では鍵のアイコンを出さず「MIM」だけ */
function MimButton() {
  const { open, toggle } = useMim()
  return (
    <button
      type="button"
      className="mim-btn"
      aria-pressed={open}
      onClick={toggle}
      title={open ? 'MIM を閉じる' : 'MIM（most important memo）を開く'}
      data-testid="open-mim"
    >
      <span className="mim-btn-icon hide-mobile" aria-hidden="true">
        <KeyIcon />
      </span>
      <span className="mim-btn-label">MIM</span>
    </button>
  )
}

/**
 * 左のアイコンと名前を押した時、履歴を置き換えるか（docs/SPEC.md の 3.1・3.3・確かめ A6・D05）。カレンダーを見ている時（トップ #/ を
 * 含む）は［今日］と同じく置き換える（カレンダーの中の行き来は積まない）。ほかの画面（設定・MIM）からは積む行き来にし、アプリの履歴
 * （src/history/appHistory.ts）がカレンダーの履歴の所まで戻ってから置き換える（履歴は増えない）
 */
export function brandReplaces(pathname: string): boolean {
  return isCalendarPath(pathname)
}

/**
 * 各画面のヘッダー（ログインの画面では出さない）。actions にほかのボタンを渡すと、同期の表示の左に並ぶ。
 * 左のアイコンと名前を押すと、前回のモードの今日を含む期間へ（FRAME-029）。行き先はトップ（#/）で、トップを開くと前回のモードの
 * 今日を含む期間へ置き換わる（FRAME-001）。見ている日も今日にする。幅 380px 未満では名前を出さない
 */
export function AppHeader({ actions }: { actions?: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <header className="app-header" data-testid="app-header">
      <Link
        to={paths.top()}
        replace={brandReplaces(pathname)}
        onClick={() => useCalendarUi.getState().setViewed(todayStr())}
        className="brand"
        aria-label="Diary Studio（トップへ）"
        data-testid="brand"
      >
        <img src="./icon.svg" alt="" width={26} height={26} />
        <span className="brand-name">Diary Studio</span>
      </Link>
      <span className="spacer" />
      {actions}
      <SyncIndicator />
      <Link to={paths.settings()} className="icon-btn" aria-label="設定" title="設定" data-testid="open-settings">
        <GearIcon />
      </Link>
      <MimButton />
    </header>
  )
}

/**
 * 出ているお知らせ（重ねた全部）の高さを <html> の --toasts-h に入れ続ける。［OK］まで出すお知らせ（■26）が画面の下に出ている間、
 * S のウィークリー・デイリーのタイムスケジュールの中の終わりに、その分の余白を足す（src/styles.css。終わりの近くの予定・入力欄も
 * お知らせの上まで送れるように。4.9）。出し入れした時は描いた直後に測る（その後に、目立たせる物・入力欄をお知らせの上へ送る）。
 * 字の折り返しなどで高さが変わった時は ResizeObserver で
 */
function useToastsHeight(box: RefObject<HTMLDivElement | null>, toasts: readonly Toast[]): void {
  const measure = useCallback(() => {
    const el = box.current
    if (el) document.documentElement.style.setProperty('--toasts-h', `${Math.ceil(el.getBoundingClientRect().height)}px`)
  }, [box])
  useLayoutEffect(measure, [measure, toasts])
  useEffect(() => {
    const el = box.current
    const observer = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (el) observer?.observe(el)
    return () => {
      observer?.disconnect()
      document.documentElement.style.removeProperty('--toasts-h')
    }
  }, [box, measure])
}

function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const box = useRef<HTMLDivElement>(null)
  useToastsHeight(box, toasts)
  // ダイアログ表示中は画面本体が操作不可（inert）になるので、お知らせは body 直下に出す
  return createPortal(
    <div className="toasts" aria-live="assertive" ref={box}>
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  )
}

/** 押してもフォーカスを動かさない（ブラウザがフォーカスを移すのは mousedown。指の時は useFingerTap が離した時に click を送り、mousedown は来ない） */
const keepFocus = (e: ReactMouseEvent) => e.preventDefault()

/**
 * お知らせ1つ。［元に戻す］などのボタンと［×］は、指で押した時は指を離した時に効く（ブラウザが click を作るのを待たない。
 * iPhone でウィークリーのカードを動かした後に［元に戻す］が効かなかったことへの手当て。iPhone が click を作らなかった見込みで、
 * 原因は確かめられていない。src/ui/fingerTap.ts・docs/SPEC.md の 3.9）。
 * ［OK］まで出すお知らせ（untilOk。元に戻す・やり直すのボタン・キーで当てた・断った時。■26）は、［×］の代わりに［OK］を出す（同じく
 * 指を離した時に効く。出してもフォーカスは取らない。キーボードでは Tab で届く）。小さな画面を開いている間は出さない（styles.css）。
 * ［OK］は、押してもフォーカスを動かさず（mousedown を止める）、開いているすばやく足すを閉じない（字も足さない。KEEP_QUICK_ADD の印。
 * 操作の列の［元に戻す］［やり直す］と同じ。12.1）
 */
function ToastView({ toast: t }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss)
  const action = useFingerTap(() => {
    dismiss(t.id)
    t.action?.run()
  })
  const close = useFingerTap(() => dismiss(t.id))
  return (
    <div className={`toast ${t.kind}${t.untilOk ? ' is-until-ok' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
      <p>{t.message}</p>
      {t.action ? (
        <button type="button" className="toast-action" {...action}>
          {t.action.label}
        </button>
      ) : null}
      {t.untilOk ? (
        <button type="button" className="toast-action" {...close} {...keepQuickAddAttr} onMouseDown={keepFocus}>
          {OK_LABEL}
        </button>
      ) : (
        <button type="button" {...close} aria-label="閉じる">
          <XIcon />
        </button>
      )}
    </div>
  )
}

/**
 * 新しい版を受け取ったら「新しい版があります ［更新する］」の帯を出す。押すと入力中の下書きを保存してから読み込み直す（docs/SPEC.md の 2.8）。
 * 保存はここの1か所だけでする（src/main.tsx の apply は新しい版に切り替えるだけ）
 */
export function UpdateBanner() {
  const ready = useAppUpdate((s) => s.ready)
  const apply = useAppUpdate((s) => s.apply)
  if (!ready || !apply) return null
  const update = async () => {
    // 端末に保存できなかった時（容量が足りない・閉じられた）は読み込み直さない（画面の編集が消えないように）
    if (!(await saveBeforeLeave())) {
      notifyError('この端末に保存できなかったため、更新をやめました。少し待ってからもう一度押してください。')
      return
    }
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

/**
 * 画面（パス）が変わったら先頭から表示する（スマホでトップを下までスクロールしてから設定を開いた時など）。
 * ブラウザの「戻る／進む」では動かさない（ブラウザが元の位置に戻す）。カレンダーの中の置き換えのうち、同じモードの中で期間を移る時
 * （‹ ›・［今日］・スワイプ・6時間で今日へ戻る・トップ #/ から前回のモードへ）は動かさない（S・M でカレンダーの下のリストまで
 * 送っていても、その位置のまま。D54）。モードの切り替え（置き換えるが、モードが替わる。3.1）は先頭へ
 */
export function scrollsToTop(navType: 'POP' | 'PUSH' | 'REPLACE', from: string, to: string): boolean {
  if (navType === 'POP') return false
  if (navType === 'REPLACE' && isCalendarPath(from) && isCalendarPath(to)) {
    const a = calendarModeOf(from)
    const b = calendarModeOf(to)
    return a !== null && b !== null && a !== b
  }
  return true
}

function ScrollOnNavigate() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  const prev = useRef(pathname)
  useLayoutEffect(() => {
    const from = prev.current
    prev.current = pathname
    if (from !== pathname && scrollsToTop(navType, from, pathname)) window.scrollTo(0, 0)
    // パスが変わった時だけ動かす（navType は同じ時に一緒に変わるので、依存に入れない）
  }, [pathname])
  return null
}

/** iPhone のキーボードの高さを --kb に入れる（src/ui/keyboardInset.ts） */
function KeyboardInset() {
  useKeyboardInset()
  return null
}

/**
 * 画面が変わったら、開いたままの確認・入力ダイアログはキャンセル扱いで閉じる。画面が替わる前から出している「閉じますか？」
 * （keepOnNavigate）は閉じない: ルーターは startTransition で描くので、モードを替えた描画が重い時は、替わったのが「戻る」で
 * 確かめを出した後になることがある（開発）
 */
function CloseDialogsOnNavigate() {
  const { pathname } = useLocation()
  useEffect(() => () => cancelAllDialogs({ onNavigate: true }), [pathname])
  return null
}

export function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <ScrollOnNavigate />
      <CloseDialogsOnNavigate />
      <KeyboardInset />
      <PrefsEffect />
      <UpdateBanner />
      {children}
      <Toasts />
      <DialogHost />
    </div>
  )
}
