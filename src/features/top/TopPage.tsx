// トップ画面（段階0の空の形。docs/SPEC.md の 3.）。行き先 #/ と #/mim（MIM を開いている時）の両方で使う。
// - L（900px 以上。3.4）: 左にカレンダーの領域（残りの幅）、右に右の列（300px）。ページ全体はスクロールせず、それぞれの中だけで
//   スクロールする。MIM を開いた時は、カレンダーの領域が MIM に替わる（右の列はそのまま）。
// - S・M（3.5）: ヘッダーの下に切り替えの列（カレンダー｜Routine｜Task｜Favorite。押すとその先頭へスクロールする）、
//   その下にカレンダー → Routine List → Task List → Favorite List を縦に積む。3つのリストはアプリを開くたびに畳んで始まる。
//   MIM は、M ではカレンダーの区切りが MIM に替わり、S ではカレンダーとリストと切り替えの列の代わりに全面で開く。
// カレンダーの中身（段階2）・リストの中身と数（段階3）・MIM（段階4）はまだ無い
import { useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isMimPath } from '../../routes'
import { useStackedLists, type ListKey } from '../../store/uiStore'
import { useDocumentTitle, useWidthClass, type WidthClass } from '../../ui/hooks'
import { AppHeader } from '../../ui/Layout'
import { scrollBehavior } from '../../ui/motion'
import { CalendarArea } from './CalendarArea'
import { FOLD_MS, LIST_INFO, LIST_ORDER, ListPanel } from './ListPanel'
import { MimPlaceholder } from './MimPlaceholder'
import './top.css'

type PaneKey = 'calendar' | ListKey

const PANES: readonly PaneKey[] = ['calendar', ...LIST_ORDER]

/** まだ済んでいない数（段階3でリストの中身から数える） */
const COUNTS: Record<ListKey, number> = { routine: 0, task: 0, favorite: 0 }

export function TopPage() {
  const width = useWidthClass()
  const mimOpen = isMimPath(useLocation().pathname)
  useDocumentTitle(mimOpen ? 'MIM' : undefined)
  return (
    <>
      <AppHeader />
      {width === 'L' ? <WideTop mimOpen={mimOpen} /> : <StackedTop width={width} mimOpen={mimOpen} />}
    </>
  )
}

/** L の並べ方（docs/SPEC.md の 3.4） */
function WideTop({ mimOpen }: { mimOpen: boolean }) {
  return (
    <main className="top top-wide" data-testid="top-page" data-width="L">
      <section className="top-calendar" aria-label={mimOpen ? 'MIM' : 'カレンダー'} data-testid="calendar-area">
        {mimOpen ? <MimPlaceholder /> : <CalendarArea width="L" />}
      </section>
      <aside className="top-side" aria-label="リスト" data-testid="side-column">
        {LIST_ORDER.map((key) => (
          <ListPanel key={key} listKey={key} stacked={false} count={COUNTS[key]} />
        ))}
      </aside>
    </main>
  )
}

/** S・M の並べ方（docs/SPEC.md の 3.5） */
function StackedTop({ width, mimOpen }: { width: WidthClass; mimOpen: boolean }) {
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
  const spacer = useRef<HTMLDivElement>(null)

  // どれを表示中かはスクロールの位置で決める（その区切りの見出しが切り替えの列のすぐ下にある物）
  useEffect(() => {
    if (fullMim) return
    let raf = 0
    const update = () => {
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
    const release = () => {
      pinned.current = null
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    window.addEventListener('wheel', release, { passive: true })
    window.addEventListener('touchstart', release, { passive: true })
    window.addEventListener('pointerdown', release, { passive: true })
    window.addEventListener('keydown', release)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchstart', release)
      window.removeEventListener('pointerdown', release)
      window.removeEventListener('keydown', release)
    }
    // 区切りの id（paneId）は useId から作るので変わらない。S の MIM の全面を開け閉めした時だけ付け直す
  }, [fullMim])

  useEffect(() => () => window.clearTimeout(timer.current), [])

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
    })
    // 開く動き（180ms）でページが伸びてから、もう一度合わせる
    window.clearTimeout(timer.current)
    if (opening) {
      timer.current = window.setTimeout(() => {
        if (pinned.current === k) scroll('auto')
      }, FOLD_MS + 40)
    }
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
                    <span aria-hidden="true">{COUNTS[k]}</span>
                    <span className="visually-hidden">（まだ済んでいない {COUNTS[k]}件）</span>
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
            <CalendarArea width={width} headingId={headingId('calendar')} />
          )}
        </section>
        {!fullMim
          ? LIST_ORDER.map((key) => (
              <ListPanel key={key} listKey={key} stacked id={paneId(key)} headingId={headingId(key)} count={COUNTS[key]} />
            ))
          : null}
      </div>
      <div ref={spacer} className="top-stack-spacer" aria-hidden="true" data-testid="top-stack-spacer" />
    </main>
  )
}
