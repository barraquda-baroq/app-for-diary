// 画面の行き先と外枠。NS の src/App.tsx から（小説の画面・ゴミ箱の自動の片付け・Claude 連携を外し、ログインの関所を足した物）。
// 段階0の行き先はトップ・ログイン・設定の3つ（docs/SPEC.md の 3.1・21.）
import { lazy, Suspense } from 'react'
import {
  createHashRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useLocation,
  useRouteError,
  type RouteObject,
} from 'react-router-dom'
import { LoginPage } from './features/login/LoginPage'
import { TopPage } from './features/top/TopPage'
import { paths } from './routes'
import { useSync } from './sync/controller'
import { ErrorBoundary, ErrorScreen } from './ui/ErrorBoundary'
import { AppFrame } from './ui/Layout'
import { NotFound } from './ui/NotFound'

// 起動を軽くするため、トップ・ログイン以外の画面は開いた時に読み込む（PWA ではオフライン用に事前キャッシュされる）
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))

function PageLoading() {
  return (
    <div className="page" role="status">
      <p className="muted">読み込み中…</p>
    </div>
  )
}

/**
 * ログインの関所（docs/SPEC.md の 2.5）: ログインしていない間は、ログインの画面だけを出す（トップ画面もデータも出さない）。
 * ログインしたらログインの画面からトップへ。ログインの状態を確かめている間は「読み込み中…」（起動アニメーションの下）
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useSync((s) => s.auth)
  const { pathname } = useLocation()
  if (auth === 'idle' || auth === 'checking') return <PageLoading />
  if (auth === 'signedOut' && pathname !== paths.login()) return <Navigate to={paths.login()} replace />
  if (auth === 'signedIn' && pathname === paths.login()) return <Navigate to={paths.top()} replace />
  return <>{children}</>
}

/** 1つの画面で描画エラーが起きても、他の画面へ移ればまた表示できるようにする */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

/** すべての画面の外枠。画面ごとの中身は <Outlet /> に入る */
function RootLayout() {
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
      { path: paths.top(), element: <TopPage /> },
      { path: paths.login(), element: <LoginPage /> },
      { path: paths.settings(), element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

// 画面を離れる前の確認（useBlocker）を後で使えるよう、NS と同じくデータルーターにする
let router: ReturnType<typeof createHashRouter> | null = null

export function App() {
  router ??= createHashRouter(routes)
  return <RouterProvider router={router} />
}
