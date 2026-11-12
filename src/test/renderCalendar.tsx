// 段階2のカレンダー・予定の画面の部品のテスト用（docs/SPEC.md の 2.10。Vitest＋jsdom＋Testing Library）。
// 端末の中のデータは何も保存しない偽物（fakePersistence）に置き、持ち主だと確かめたアカウントでログインした状態・画面の幅・
// 決まった時刻（初めは 2026年11月10日（火）9:00）で描く。
//   setupCalendarTests()                                   ファイルの先頭で1回（毎回の初期化と後片付け）
//   await renderAt('/month/2026-11', { data, width: 'S' }) 画面の行き先ごと（src/App.tsx の routes）
//   await renderView(MonthView, viewProps({ mode: 'month' }), { data })   1つの部品だけ（AppFrame の中。お知らせ・ダイアログも出る）
// ドラッグ・大きさの測り・本物の履歴・指の操作は E2E で確かめる（jsdom はレイアウトも本物の指も持たない）
import { act, cleanup, render, type RenderResult } from '@testing-library/react'
import { useState, type ComponentType } from 'react'
import { createMemoryRouter, RouterProvider, type InitialEntry } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { T0 } from '../domain/testData'
import { emptyData, type AppData } from '../domain/types'
import { initStore, resetStoreForTests } from '../store/appStore'
import {
  DEFAULT_PREFS,
  initialCalendarUi,
  useCalendarUi,
  usePrefs,
  useStackedLists,
  useToasts,
  type Prefs,
} from '../store/uiStore'
import { WIDTH_M, type WidthClass } from '../ui/hooks'
import type { ViewProps } from '../features/calendar/common/types'
import { fakePersistence } from './fakePersistence'
import { TEST_WIDTHS } from './width'

/** 画面の幅（区分の代表の幅か px）・指かマウスか・視差効果を減らす設定 */
export interface TestMedia {
  /** 'L' 1400px・'M' 700px・'S' 412px（src/test/width.ts の TEST_WIDTHS）か、px の数 */
  width?: WidthClass | number
  /** fine = マウス（上に載せられる）、coarse = 指。既定は L・M が fine、S が coarse */
  pointer?: 'fine' | 'coarse'
  reducedMotion?: boolean
}

export interface RenderOptions extends TestMedia {
  /** 端末の中のデータ（足りない表は空） */
  data?: Partial<AppData>
  /** 今の時刻（既定は setupCalendarTests の時刻 = 2026年11月10日（火）9:00） */
  now?: Date | number
  /** 端末ごとの表示の設定（lastMode・collapsed など） */
  prefs?: Partial<Prefs>
}

const originalMatchMedia = typeof window === 'undefined' ? undefined : window.matchMedia

/** 1つの (name: value) を答える */
function feature(text: string, m: Required<Omit<TestMedia, 'width'>> & { px: number }): boolean {
  const f = /^\(\s*([a-z-]+)\s*:\s*([a-z0-9-]+)\s*\)$/.exec(text.trim())
  if (!f) return false
  const [, name, value] = f
  switch (name) {
    case 'min-width':
      return m.px >= parseInt(value, 10)
    case 'max-width':
      return m.px <= parseInt(value, 10)
    case 'hover':
      return value === (m.pointer === 'fine' ? 'hover' : 'none')
    case 'any-hover':
      return value === (m.pointer === 'fine' ? 'hover' : 'none')
    case 'pointer':
    case 'any-pointer':
      return value === m.pointer
    case 'prefers-reduced-motion':
      return value === (m.reducedMotion ? 'reduce' : 'no-preference')
    case 'prefers-color-scheme':
      return value === 'light'
    default:
      return false
  }
}

/**
 * 画面の幅・指かマウスか・視差効果を減らす設定に答える matchMedia を置く（「,」はどれか、「and」は全部。後片付けで元に戻す）。
 * src/test/width.ts の setTestWidth に、上に載せられるか（D43）・視差効果を減らす設定（4.9）を足した物
 */
export function setTestMedia({ width = 'L', pointer, reducedMotion = false }: TestMedia = {}): void {
  const px = typeof width === 'number' ? width : TEST_WIDTHS[width]
  const m = { px, pointer: pointer ?? (px < WIDTH_M ? 'coarse' : 'fine'), reducedMotion } as const
  window.matchMedia = ((query: string) => {
    const matches = query.split(',').some((part) => part.split(/\band\b/).every((f) => feature(f, m)))
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList
  }) as typeof window.matchMedia
}

/** 見ている要素（target を渡すとその要素だけ）の大きさが変わったことにする（src/test/setup.ts の ResizeObserver の代わり） */
export function resizeObserved(width: number, height: number, target?: Element): void {
  const fake = window.ResizeObserver as unknown as { resizeAll?: (w: number, h: number, t?: Element) => void }
  fake.resizeAll?.(width, height, target)
}

/** 1つのモードの画面に渡す物の既定（2026年11月10日（火）を見ている L のマンスリー。領域は 1400×900 の窓の左の列の大きさ） */
export function viewProps(over: Partial<ViewProps> = {}): ViewProps {
  return {
    mode: 'month',
    viewed: '2026-11-10',
    today: '2026-11-10',
    width: 'L',
    area: { width: 1068, height: 700 },
    ...over,
  }
}

/**
 * ファイルの先頭で1回呼ぶ: 毎回のテストの前に、時刻（Date だけ偽物。タイマーは本物）・端末の設定・カレンダーの画面の状態・
 * お知らせを初めに戻し、後で描いた物・ダイアログ・データのストア・matchMedia を片付ける。
 * タイマーも偽物にするテスト（目立たせる 1.2秒など）は、その中で vi.useFakeTimers() を呼ぶ（後片付けで本物に戻る）
 */
export function setupCalendarTests({ now = T0 }: { now?: Date | number } = {}): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    localStorage.clear()
    usePrefs.setState(DEFAULT_PREFS)
    useStackedLists.setState({ collapsed: { routine: true, task: true, favorite: true } })
    useCalendarUi.setState(initialCalendarUi())
    useToasts.setState({ toasts: [] })
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(async () => {
    cleanup()
    const { cancelAllDialogs } = await import('../ui/dialogs')
    cancelAllDialogs()
    resetStoreForTests()
    vi.useRealTimers()
    if (originalMatchMedia) window.matchMedia = originalMatchMedia
    else delete (window as Partial<Window>).matchMedia
  })
}

/** データのストアを、何も保存しない偽物の端末の中のデータで始める */
async function startStore(data: Partial<AppData> = {}): Promise<void> {
  resetStoreForTests()
  await initStore(fakePersistence({ load: async () => ({ ...emptyData(), ...data }) }))
}

/** 持ち主だと確かめたアカウントでログインした状態にする（Firebase は使わない） */
async function signIn(): Promise<void> {
  const { useSync } = await import('../sync/controller')
  useSync.setState({
    auth: 'signedIn',
    user: { uid: 'u1', name: 'テスト', email: 'test@example.com' },
    busy: false,
    error: null,
    owner: 'ok',
    ownerSeen: true,
    accountMismatch: null,
  })
}

async function prepare(opts: RenderOptions): Promise<void> {
  if (opts.now !== undefined) vi.setSystemTime(opts.now)
  setTestMedia(opts)
  if (opts.prefs) usePrefs.setState(opts.prefs)
  await startStore(opts.data)
  await signIn()
}

export type CalendarRender = RenderResult & { router: ReturnType<typeof createMemoryRouter> }

/**
 * アプリの行き先（src/App.tsx の routes）を描く。entries に履歴を並べると最後の物を開く（{ pathname, state } で location.state も）。
 * 例: await renderAt('/week/2026-11-08', { width: 'S', data: { items } })
 */
export async function renderAt(entries: InitialEntry | InitialEntry[], opts: RenderOptions = {}): Promise<CalendarRender> {
  await prepare(opts)
  const { routes } = await import('../App')
  const list = Array.isArray(entries) ? entries : [entries]
  const router = createMemoryRouter(routes, { initialEntries: list, initialIndex: list.length - 1 })
  const result = render(<RouterProvider router={router} />)
  return { ...result, router }
}

export type ViewRender<P> = CalendarRender & {
  /** 部品に渡す物を替えて描き直す */
  setProps: (props: P) => void
}

/**
 * 1つの部品だけを、アプリの外枠（AppFrame: お知らせ・ダイアログ）とデータのルーター（useNavigate・useBlocker が使える）の中に描く。
 * どの行き先へ移っても同じ部品を出したまま（router.state.location で移った先を確かめる）。path は初めの行き先
 */
export async function renderView<P extends object>(
  Component: ComponentType<P>,
  props: P,
  opts: RenderOptions & { path?: InitialEntry } = {},
): Promise<ViewRender<P>> {
  await prepare(opts)
  const { AppFrame } = await import('../ui/Layout')
  let setter: ((p: P) => void) | null = null
  function Host() {
    const [p, setP] = useState(props)
    setter = setP
    return <Component {...p} />
  }
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AppFrame>
            <Host />
          </AppFrame>
        ),
      },
    ],
    { initialEntries: [opts.path ?? '/'] },
  )
  const result = render(<RouterProvider router={router} />)
  return {
    ...result,
    router,
    setProps: (p) => {
      act(() => setter?.(p))
    },
  }
}
