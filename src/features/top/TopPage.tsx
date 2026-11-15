// トップ画面（docs/SPEC.md の 3.）。カレンダーの行き先（#/・#/year/2026・#/month/2026-11・#/week/2026-11-08・#/day/2026-11-10）と
// #/mim（MIM を開いている時）のどれでも、同じこの画面を出したまま中だけを替える（モードを替えても右の列のスクロール・畳んだ状態を
// 保つ。src/App.tsx の行き先の木）。
// - L（900px 以上。3.4）: 左にカレンダーの領域（残りの幅）、右に右の列（300px）。ページ全体はスクロールせず、それぞれの中だけで
//   スクロールする。MIM を開いた時は、カレンダーの領域が MIM に替わる（右の列はそのまま）。
// - S・M（3.5）: ヘッダーの下に切り替えの列（カレンダー｜Routine 2｜Task 3｜Favorite 12。数はまだ済んでいない数。押すとその先頭へ
//   スクロールする）、その下にカレンダー → Routine List → Task List → Favorite List を縦に積む。3つのリストはアプリを開くたびに畳んで
//   始まる。MIM は、M ではカレンダーの区切りが MIM に替わり、S ではカレンダーとリストと切り替えの列の代わりに全面で開く。
// 3つのリストは src/features/lists の枠（common/ListSection: 見出し・数・畳む・開く）に各リストの中身（*ListBody）を置く。まだ済んで
// いない数は lists/counts.ts の useListCounts で1回だけ数えて、見出しと切り替えの列に渡す（畳んでいるリストも数える）。
// S・M では、切り替えの列で選ばれている物（見ている所）と積んだ所の形（幅・S の全面の MIM か）を useStackedLists の shown・layout に
// 出し（■34 の「開いているリスト」を決める。src/features/top/listBack.ts）、その場で畳む関数（stackedFold.ts）を届ける。
// ドラッグの入れ物（features/dnd の TopDnd）は L と S・M の両方を包む（幅が替わっても同じ物が残る）。
// カレンダーの領域は src/features/calendar/common/CalendarView（行き先・操作の列・モードの画面）、小さな画面は、カレンダーから開いた
// 登録・詳細が SheetHost（MIM を開いている間は置かない）、リストから開いた物（「タスク」の詳細・ルーチンとやりたいことの［詳しく］・
// ［予定にする］の登録）が ListSheetHost（どの幅でも・MIM を開いている時も）。裏から戻って6時間たった時に今日へ移す決まり（6.4）も
// ここで見張る。MIM（段階4）はまだ無い
import { useEffect, useId, useRef, useState, type ComponentType } from 'react'
import { useLocation } from 'react-router-dom'
import { calendarModeOf, isMimPath } from '../../routes'
import { useCalendarUi, usePrefs, useStackedLists, type ListKey, type PaneKey } from '../../store/uiStore'
import { useDocumentTitle, useWidthClass, type WidthClass } from '../../ui/hooks'
import { AppHeader } from '../../ui/Layout'
import { scrollBehavior } from '../../ui/motion'
import { CalendarView } from '../calendar/common/CalendarView'
import { SheetHost } from '../calendar/common/SheetHost'
import { useReturnToToday } from '../calendar/common/useReturnToToday'
import { TopDnd } from '../dnd'
import { ListSection, releaseFocusBeforeFold } from '../lists/common/ListSection'
import { useListCounts } from '../lists/counts'
import { FavoriteListBody } from '../lists/favorite/FavoriteListBody'
import { FOLD_MS, LIST_INFO, LIST_ORDER } from '../lists/listInfo'
import { ListSheetHost } from '../lists/ListSheetHost'
import { RoutineAllToggle } from '../lists/routine/RoutineAllToggle'
import { RoutineListBody } from '../lists/routine/RoutineListBody'
import { TaskListBody } from '../lists/task/TaskListBody'
import type { ListBodyProps, ListCounts } from '../lists/types'
import { MimPlaceholder } from './MimPlaceholder'
import { foldScrollTop, foldSpacerHeight, provideStackedFold } from './stackedFold'
import './top.css'

const PANES: readonly PaneKey[] = ['calendar', ...LIST_ORDER]

/** 各リストの中身と、開いている間だけ見出しの右に出す物（Routine List の［すべて開く／畳む］） */
const LIST_PARTS: Record<ListKey, { Body: ComponentType<ListBodyProps>; HeaderExtra?: ComponentType }> = {
  routine: { Body: RoutineListBody, HeaderExtra: RoutineAllToggle },
  task: { Body: TaskListBody },
  favorite: { Body: FavoriteListBody },
}

export function TopPage() {
  const width = useWidthClass()
  const { pathname } = useLocation()
  const lastMode = usePrefs((s) => s.lastMode)
  const mimOpen = isMimPath(pathname)
  const counts = useListCounts()
  useDocumentTitle(mimOpen ? 'MIM' : undefined)
  useReturnToToday()
  // トップ #/ は前回のモードに置き換わる
  useEndOffMode(mimOpen ? null : (calendarModeOf(pathname) ?? lastMode))
  return (
    <>
      <AppHeader />
      <TopDnd>
        {width === 'L' ? (
          <WideTop mimOpen={mimOpen} counts={counts} />
        ) : (
          <StackedTop width={width} mimOpen={mimOpen} counts={counts} />
        )}
      </TopDnd>
      {mimOpen ? null : <SheetHost />}
      <ListSheetHost />
    </>
  )
}

/**
 * マンスリーを離れたら休みを付ける状態を終わる（ほかのモード・MIM・設定などの別の画面。「戻る」で離れた時も。D30）。
 * mode はいま出しているカレンダーのモード（MIM の時は null）
 */
function useEndOffMode(mode: string | null): void {
  useEffect(() => {
    if (mode !== 'month') useCalendarUi.getState().setOffMode(false)
  }, [mode])
  useEffect(() => () => useCalendarUi.getState().setOffMode(false), [])
}

/** 1つのリスト（枠と中身） */
function ListPane({
  list,
  width,
  count,
  id,
  headingId,
}: {
  list: ListKey
  width: WidthClass
  count: number
  id?: string
  headingId?: string
}) {
  const { Body, HeaderExtra } = LIST_PARTS[list]
  return (
    <ListSection
      list={list}
      stacked={width !== 'L'}
      count={count}
      id={id}
      headingId={headingId}
      headerExtra={HeaderExtra ? <HeaderExtra /> : null}
    >
      <Body width={width} />
    </ListSection>
  )
}

/** L の並べ方（docs/SPEC.md の 3.4） */
function WideTop({ mimOpen, counts }: { mimOpen: boolean; counts: ListCounts }) {
  return (
    <main className="top top-wide" data-testid="top-page" data-width="L">
      <section className="top-calendar" aria-label={mimOpen ? 'MIM' : 'カレンダー'} data-testid="calendar-area">
        {mimOpen ? <MimPlaceholder /> : <CalendarView width="L" />}
      </section>
      <aside className="top-side" aria-label="リスト" data-testid="side-column">
        {LIST_ORDER.map((key) => (
          <ListPane key={key} list={key} width="L" count={counts[key]} />
        ))}
      </aside>
    </main>
  )
}

/**
 * S・M でその場で畳む時（■34。stackedFold.ts）: 畳んで縮む分（リストの中身の高さ）で位置 y を保てなくなるなら、いちばん下の空き
 * （space）を足りない分だけ足す
 */
function keepScrollOnFold(space: HTMLElement | null, pane: HTMLElement, y: number): void {
  const body = pane.querySelector<HTMLElement>('.fold')
  if (!space || !body) return
  const height = foldSpacerHeight({
    scrollY: y,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    spacer: space.offsetHeight,
    lost: body.getBoundingClientRect().height,
  })
  if (height !== null) space.style.height = `${height}px`
}

/** 切り替えの列で飛んだ後、スクロールが止まったとみなす続けて同じ位置の描画の数 */
const SCROLL_STILL_FRAMES = 3
/** 切り替えの列で飛んだ後、止まるのを待ついちばん長い時間（ms。過ぎたら止まっていなくても合わせ直す） */
const JUMP_SETTLE_MAX_MS = 1500

/** S・M の並べ方（docs/SPEC.md の 3.5） */
function StackedTop({ width, mimOpen, counts }: { width: 'S' | 'M'; mimOpen: boolean; counts: ListCounts }) {
  const baseId = useId()
  const paneId = (k: PaneKey) => `${baseId}-pane-${k}`
  const headingId = (k: PaneKey) => `${baseId}-head-${k}`
  // S の MIM は全面（切り替えの列とリストを隠す）
  const fullMim = width === 'S' && mimOpen
  const switcher = useRef<HTMLElement>(null)
  const [current, setCurrent] = useState<PaneKey>('calendar')
  // 切り替えで移った区切り。自分でスクロールし始めるまでは、位置ではなくこれを表示中とする（NS のホームのスマホと同じ）
  const pinned = useRef<PaneKey | null>(null)
  const timer = useRef(0)
  /** 切り替えの列で飛んだ後、止まるのを待って合わせ直す描画の番号 */
  const settleFrame = useRef(0)
  const spacer = useRef<HTMLDivElement>(null)
  /** スクロールの位置から表示中を決め直す（下の見張りが入れる） */
  const update = useRef<() => void>(() => {})

  // どれを表示中かはスクロールの位置で決める（その区切りの見出しが切り替えの列のすぐ下にある物）
  useEffect(() => {
    if (fullMim) return
    let raf = 0
    const decide = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (pinned.current) {
          setCurrent(pinned.current)
          return
        }
        // 区切りの上の端が、切り替えの列の下の端（＋飛んだ時の間の 12px と少しのゆとり）より上に来た物のうち、いちばん下の物
        const line = (switcher.current?.getBoundingClientRect().bottom ?? 0) + 16
        let next: PaneKey = 'calendar'
        for (const k of PANES) {
          const top = document.getElementById(paneId(k))?.getBoundingClientRect().top
          if (top !== undefined && top <= line) next = k
        }
        setCurrent(next)
      })
    }
    update.current = decide
    const release = () => {
      pinned.current = null
    }
    decide()
    window.addEventListener('scroll', decide, { passive: true })
    window.addEventListener('resize', decide)
    window.addEventListener('wheel', release, { passive: true })
    window.addEventListener('touchstart', release, { passive: true })
    window.addEventListener('pointerdown', release, { passive: true })
    window.addEventListener('keydown', release)
    return () => {
      cancelAnimationFrame(raf)
      update.current = () => {}
      window.removeEventListener('scroll', decide)
      window.removeEventListener('resize', decide)
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchstart', release)
      window.removeEventListener('pointerdown', release)
      window.removeEventListener('keydown', release)
    }
    // 区切りの id（paneId）は useId から作るので変わらない。S の MIM の全面を開け閉めした時だけ付け直す
  }, [fullMim])

  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      cancelAnimationFrame(settleFrame.current)
    },
    [],
  )

  // 見ている所と積んだ所の形を出す（■34 の「開いているリスト」。L・ほかの画面へ移ると、見ている所はカレンダー・形は無しに戻す）
  useEffect(() => {
    useStackedLists.getState().setShown(fullMim ? 'calendar' : current)
  }, [current, fullMim])
  useEffect(() => {
    useStackedLists.getState().setLayout({ width, fullMim })
  }, [width, fullMim])
  useEffect(
    () => () => {
      const lists = useStackedLists.getState()
      lists.setShown('calendar')
      lists.setLayout(null)
    },
    [],
  )

  // その場で畳む（■34。stackedFold.ts の foldListInPlace）
  useEffect(
    () =>
      provideStackedFold((k) => {
        if (fullMim) return
        const lists = useStackedLists.getState()
        if (lists.collapsed[k]) return
        const pane = document.getElementById(paneId(k))
        if (!pane) return
        // フォーカスがこのリストの中にあれば、見出しの畳む・開くボタンへ（カレンダーの見出しへは移さない）
        releaseFocusBeforeFold(pane)
        // 見出しが切り替えの列の下に隠れていれば、切り替えの列のすぐ下（飛んだ時と同じ所）まで戻すだけ（カレンダーへは戻さない）
        const margin = Number.parseFloat(getComputedStyle(pane).scrollMarginTop) || 0
        const top = foldScrollTop(pane.getBoundingClientRect().top, margin, window.scrollY)
        if (top !== null) window.scrollTo({ top, behavior: 'auto' })
        // ページの終わりが近い時は、畳んで縮む分だけいちばん下の空きを先に足す（ブラウザに位置を上へ止め直させない）
        keepScrollOnFold(spacer.current, pane, top ?? window.scrollY)
        pinned.current = null
        window.clearTimeout(timer.current)
        cancelAnimationFrame(settleFrame.current)
        lists.setCollapsed(k, true)
        // 畳む動き（180ms）でページが縮んでから、見ている所を決め直す
        update.current()
        timer.current = window.setTimeout(() => update.current(), FOLD_MS + 40)
      }),
    [fullMim],
  )

  const jumpTo = (k: PaneKey) => {
    pinned.current = k
    setCurrent(k)
    // 畳んでいるリストを押した時は、そのリストを開いてから先頭へスクロールする（docs/SPEC.md の 3.5。→22 の I8）
    const lists = useStackedLists.getState()
    const opening = k !== 'calendar' && lists.collapsed[k]
    if (opening) lists.setCollapsed(k, false)
    const scroll = (behavior: ScrollBehavior) => {
      fitSpacer(k)
      document.getElementById(paneId(k))?.scrollIntoView({ block: 'start', behavior })
    }
    requestAnimationFrame(() => {
      scroll(scrollBehavior())
      // 読み上げ・キーボードでも移った先から続けられるように、区切りの見出しへフォーカスを移す
      document.getElementById(headingId(k))?.focus({ preventScroll: true })
      settleAfterJump(k)
    })
    window.clearTimeout(timer.current)
    cancelAnimationFrame(settleFrame.current)
  }

  /**
   * 飛んだ後、なめらかなスクロールと開く動き（180ms）が終わってから（ページの位置が SCROLL_STILL_FRAMES の描画のあいだ同じ）、
   * 区切りの見出しが切り替えの列のすぐ下（scroll-margin-top）に無ければ、なめらかにせずすぐそこへ合わせ直す。なめらかなスクロールの
   * 途中で位置を替えると、ブラウザによってはその後も残りのスクロールを足して行き過ぎるので、止まるまで待つ。自分でスクロールし始めた
   * 時（固定を外した時）はやめる
   */
  const settleAfterJump = (k: PaneKey) => {
    const started = performance.now()
    let lastY = Number.NaN
    let still = 0
    const step = () => {
      if (pinned.current !== k) return
      const y = window.scrollY
      still = y === lastY ? still + 1 : 0
      lastY = y
      const waited = performance.now() - started
      if ((waited >= FOLD_MS + 40 && still >= SCROLL_STILL_FRAMES) || waited >= JUMP_SETTLE_MAX_MS) {
        alignTo(k)
        return
      }
      settleFrame.current = requestAnimationFrame(step)
    }
    settleFrame.current = requestAnimationFrame(step)
  }

  /** 区切りの見出しを、切り替えの列のすぐ下へすぐ合わせる（いちばん下の空きも合わせ直す。合っていれば動かさない） */
  const alignTo = (k: PaneKey) => {
    const pane = document.getElementById(paneId(k))
    if (!pane) return
    fitSpacer(k)
    const margin = Number.parseFloat(getComputedStyle(pane).scrollMarginTop) || 0
    const off = pane.getBoundingClientRect().top - margin
    if (Math.abs(off) > 1) window.scrollTo({ top: Math.max(0, window.scrollY + off), behavior: 'auto' })
  }

  /**
   * 下の区切りが短くて（畳んだリストが続くなど）、押した区切りの見出しが切り替えの列の下まで上がれない時は、いちばん下に
   * 足りない分だけ空きを足す（押した区切りの先頭へ必ずスクロールできるように。カレンダーへ飛んだ時などは 0 に戻る）
   */
  const fitSpacer = (k: PaneKey) => {
    const pane = document.getElementById(paneId(k))
    const space = spacer.current
    if (!pane || !space) return
    const margin = Number.parseFloat(getComputedStyle(pane).scrollMarginTop) || 0
    const target = pane.getBoundingClientRect().top + window.scrollY - margin
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight - space.offsetHeight
    space.style.height = `${Math.max(0, Math.ceil(target - maxScroll))}px`
  }

  return (
    <main className={`top top-stacked${fullMim ? ' is-full-mim' : ''}`} data-testid="top-page" data-width={width}>
      {!fullMim ? (
        <nav ref={switcher} className="top-switcher" aria-label="カレンダーとリストへ移動" data-testid="top-switcher">
          {PANES.map((k) => (
            <button
              key={k}
              type="button"
              className="top-switcher-btn"
              aria-current={current === k ? 'true' : undefined}
              aria-controls={paneId(k)}
              onClick={() => jumpTo(k)}
              data-testid={`top-jump-${k}`}
            >
              {k === 'calendar' ? (
                <span className="top-switcher-name is-ja">カレンダー</span>
              ) : (
                <>
                  <span className="top-switcher-name">{LIST_INFO[k].short}</span>
                  <span className="top-switcher-count">
                    <span aria-hidden="true">{counts[k]}</span>
                    <span className="visually-hidden">（まだ済んでいない {counts[k]}件）</span>
                  </span>
                </>
              )}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="top-stack">
        <section
          id={paneId('calendar')}
          className="top-pane top-calendar"
          aria-label={mimOpen ? 'MIM' : 'カレンダー'}
          data-testid="calendar-area"
        >
          {mimOpen ? (
            <MimPlaceholder headingId={headingId('calendar')} />
          ) : (
            <CalendarView width={width} headingId={headingId('calendar')} />
          )}
        </section>
        {!fullMim
          ? LIST_ORDER.map((key) => (
              <ListPane key={key} list={key} width={width} count={counts[key]} id={paneId(key)} headingId={headingId(key)} />
            ))
          : null}
      </div>
      <div ref={spacer} className="top-stack-spacer" aria-hidden="true" data-testid="top-stack-spacer" />
    </main>
  )
}
