// 画面の行き先と外枠。NS の src/App.tsx から（小説の画面・ゴミ箱の自動の片付け・Claude 連携を外し、ログインの関所を足した物）。
// 行き先はトップ（#/）・カレンダーの4つのモード（#/year/2026・#/month/2026-11・#/week/2026-11-08・#/day/2026-11-10。段階2）・
// MIM（仮の画面）・ログイン・設定（docs/SPEC.md の 3.1・21.）。
// 履歴はアプリの履歴（src/history/appHistory.ts。カレンダーの中の行き来は積まない・iPhone の端からのフリックでモードを回す・Android の
// ブラウザのタブと PC の「戻る」でアプリを閉じるかを聞く・ホーム画面から開いた Android のアプリの「戻る」は聞かずに「もう一度［戻る］を
// 押すと閉じます」。3.1）をデータのルーターに渡す（createHashRouter と同じ作りで、履歴だけを替える）
import { lazy, Suspense } from 'react'
import {
  Navigate,
  Outlet,
  RouterProvider,
  UNSAFE_createRouter,
  UNSAFE_hydrationRouteProperties,
  UNSAFE_mapRouteProperties,
  useLocation,
  useRouteError,
  type RouteObject,
} from 'react-router-dom'
import { screenOf } from './features/calendar/common/calendarHistory'
import { dragActive } from './features/calendar/common/pageTurnDom'
import { LoginPage } from './features/login/LoginPage'
import { startTestAuth } from './features/login/testAuth'
import { useInteractionClock } from './features/calendar/common/useReturnToToday'
import { armExitOnBack, askToCloseApp, consumeBackPress } from './features/top/closeApp'
import { TopPage } from './features/top/TopPage'
import { createAppHistory, setHistoryHandler } from './history/appHistory'
import { paths } from './routes'
import { canShowData, useSync } from './sync/controller'
import { ErrorBoundary, ErrorScreen } from './ui/ErrorBoundary'
import { currentPlatform, exitStyleOf, isStandalone, popSourceOf } from './ui/device'
import { AppFrame } from './ui/Layout'
import { NotFound } from './ui/NotFound'

// 起動を軽くするため、トップ・ログイン以外の画面は開いた時に読み込む（PWA ではオフライン用に事前キャッシュされる）
const AppSettingsPage = lazy(() => import('./features/appSettings/AppSettingsPage').then((m) => ({ default: m.AppSettingsPage })))

function PageLoading() {
  return (
    <div className="page" role="status">
      <p className="muted">読み込み中…</p>
    </div>
  )
}

/**
 * ログインの関所（docs/SPEC.md の 2.5）: ログインしていない間と、持ち主だと確かめていない間は、ログインの画面だけを出す
 * （トップ画面もデータも出さない）。確かめたらログインの画面からトップへ。ログインの状態を確かめている間は「読み込み中…」
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useSync((s) => s.auth)
  // データ（MIM を含む）を出すのは、この端末で持ち主だと確かめたアカウントの時だけ（2.5。まだ確かめていない・持ち主でない・
  // 前に別のアカウントで使っていた時の確かめの間は、ログインの画面に文とボタンを出す）
  const show = useSync(canShowData)
  const { pathname } = useLocation()
  if (auth === 'idle' || auth === 'checking') return <PageLoading />
  if (!show && pathname !== paths.login()) return <Navigate to={paths.login()} replace />
  if (show && pathname === paths.login()) return <Navigate to={paths.top()} replace />
  return <>{children}</>
}

/** 1つの画面で描画エラーが起きても、他の画面へ移ればまた表示できるようにする */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

/** すべての画面の外枠。画面ごとの中身は <Outlet /> に入る */
function RootLayout() {
  // 最後に押した・キーを打った時刻（裏から戻って6時間たったら今日へ移す決まりに使う。どの画面での操作も数える。D31）
  useInteractionClock()
  return (
    <AppFrame>
      <AuthGate>
        <RouteErrorBoundary>
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </RouteErrorBoundary>
      </AuthGate>
    </AppFrame>
  )
}

/** 外枠そのものの描画に失敗した時（ふつうは各画面のエラー表示 RouteErrorBoundary が受け止める） */
function RootError() {
  const error = useRouteError()
  console.error('画面の表示中にエラーが起きました', error)
  return <ErrorScreen message={error instanceof Error ? error.message : String(error)} />
}

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RootError />,
    children: [
      // トップ・カレンダーの4つのモード・MIM は、同じトップの画面（TopPage）の中で替える（モードを替えても作り直さないので、右の列の
      // スクロール・畳んだ状態がそのまま）。中の行き先は描く物を持たず、TopPage が行き先を読む。トップ #/ は前回のモードの今日を含む
      // 期間へ置き換え、日付の形が正しくない行き先は今日を含む期間へ置き換える（src/features/calendar/common/calendarRoute.ts）。
      // #/month だけ・#/month/2026-11/x のような行き先はどこにも当たらず「見つかりません」（3.1）。
      // MIM はトップの画面の中で開く（L はカレンダーの領域、M はカレンダーの区切りが替わり、S は全面。docs/SPEC.md の 16.1）
      {
        element: <TopPage />,
        children: [
          { index: true, element: null },
          { path: 'year/:y', element: null },
          { path: 'month/:ym', element: null },
          { path: 'week/:ymd', element: null },
          { path: 'day/:ymd', element: null },
          { path: paths.mim(), element: null },
        ],
      },
      { path: paths.login(), element: <LoginPage /> },
      { path: paths.settings(), element: <AppSettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

/**
 * 画面を離れる前の確認（useBlocker）を使うので、NS と同じくデータのルーターにする。中身は createHashRouter と同じで、履歴だけを
 * アプリの履歴にする（端末と表示の形で「戻る」「進む」の扱いと閉じ方を決める。src/ui/device.ts）
 */
function createAppRouter() {
  const platform = currentPlatform()
  const history = createAppHistory({
    window,
    source: popSourceOf(platform),
    exit: exitStyleOf(platform, isStandalone()),
    armOnLeaveFail: platform === 'android',
    screenOf,
  })
  setHistoryHandler('askExit', () => void askToCloseApp())
  setHistoryHandler('armExit', () => void armExitOnBack())
  setHistoryHandler('consumePop', consumeBackPress)
  // ドラッグの途中は、押し終えても落とし終えるまで、アプリから履歴を動かさない（印の履歴を作るのも後に回す）
  setHistoryHandler('dragging', dragActive)
  return UNSAFE_createRouter({
    routes,
    history,
    mapRouteProperties: UNSAFE_mapRouteProperties,
    hydrationRouteProperties: UNSAFE_hydrationRouteProperties,
    window,
  }).initialize()
}

let router: ReturnType<typeof createAppRouter> | null = null

export function App() {
  // テストの時だけ: localStorage の diary-studio:test-auth があれば、ログインした状態で開く（開発サーバーだけ。src/features/login/testAuth.ts）
  if (import.meta.env.DEV) void startTestAuth()
  router ??= createAppRouter()
  return <RouterProvider router={router} />
}
