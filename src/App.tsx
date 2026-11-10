// 画面の行き先と外枠。NS の src/App.tsx から（小説の画面・ゴミ箱の自動の片付け・Claude 連携を外し、ログインの関所を足した物）。
// 段階0の行き先はトップ・MIM（仮の画面）・ログイン・設定の4つ（docs/SPEC.md の 3.1・21.）
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
import { startTestAuth } from './features/login/testAuth'
import { TopPage } from './features/top/TopPage'
import { paths } from './routes'
import { canShowData, useSync } from './sync/controller'
import { ErrorBoundary, ErrorScreen } from './ui/ErrorBoundary'
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
      // MIM はトップの画面の中で開く（L はカレンダーの領域、M はカレンダーの区切りが替わり、S は全面。docs/SPEC.md の 16.1）
      { path: paths.mim(), element: <TopPage /> },
      { path: paths.login(), element: <LoginPage /> },
      { path: paths.settings(), element: <AppSettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

// 画面を離れる前の確認（useBlocker）を後で使えるよう、NS と同じくデータルーターにする
let router: ReturnType<typeof createHashRouter> | null = null

export function App() {
  // テストの時だけ: localStorage の diary-studio:test-auth があれば、ログインした状態で開く（開発サーバーだけ。src/features/login/testAuth.ts）
  if (import.meta.env.DEV) void startTestAuth()
  router ??= createHashRouter(routes)
  return <RouterProvider router={router} />
}
