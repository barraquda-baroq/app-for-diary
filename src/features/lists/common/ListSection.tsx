// 3つのリストの枠（docs/SPEC.md の 3.5・3.6・4.9・6.13）: 見出し（高さ 44px。英語の名前（等幅 13px・500・字間 0.06em）＋下に小さく
// 日本語（11px・--text-faint）、右にまだ済んでいない数（等幅 12px・--text-faint）と畳む・開くの山形（34px 四方））と、畳む・開くの中身
// （入力欄・行・「済み n件」。各リストの *ListBody）。見出しのどこを押しても畳む・開く（中のボタン［すべて開く］などを除く）。
// 畳むと見出しだけになる（180ms で高さを変える。視差効果を減らす設定では動かさない。.fold）。
// 畳んだ・開いた状態（3.6・6.13）:
// - L（右の列。stacked でない）: 端末ごとに覚える（diary-studio:prefs の collapsed.routine・task・favorite。初めは開いている）
// - S・M（縦に積んだリスト。stacked）: アプリを開くたびに3つとも畳んで始まり、開いている間だけ画面の中（useStackedLists）で持つ
//   （端末に覚えない。裏に回って戻っただけなら続く）。幅を替えて行き来しても、それぞれの状態を使う
// 畳む時に中（入力欄など）にフォーカスがあれば、先にその見出しの畳む・開くボタンへ移す（隠れた欄に iPhone のキーボードを残さない）。
// headerExtra は開いている間だけ見出しの右に出す物（Routine List の［すべて開く／畳む］。14.2）。
// data-testid は段階0のまま（list-{リスト}・-count・-fold・-body。common/testIds.ts）
import { useId, type MouseEvent, type ReactNode } from 'react'
import { usePrefs, useStackedLists, type ListKey } from '../../../store/uiStore'
import { DownIcon } from '../../../ui/icons'
import { LIST_INFO } from '../listInfo'
import { listTestIds } from './testIds'
import './lists.css'

/**
 * そのリストを畳んでいるか。stacked（S・M の縦に積んだリスト）はアプリを開くたびに畳んで始まる画面の中の状態、そうでなければ
 * （L の右の列）端末ごとに覚えた状態を使う
 */
export function useListCollapsed(list: ListKey, stacked: boolean): [boolean, (collapsed: boolean) => void] {
  const wide = usePrefs((s) => s.collapsed[list])
  const setWide = usePrefs((s) => s.setCollapsed)
  const narrow = useStackedLists((s) => s.collapsed[list])
  const setNarrow = useStackedLists((s) => s.setCollapsed)
  if (stacked) return [narrow, (collapsed) => setNarrow(list, collapsed)]
  return [wide, (collapsed) => setWide({ [list]: collapsed })]
}

/**
 * リストを畳む前に、中にあるフォーカスをそのリストの畳む・開くボタンへ移す（隠れた入力欄に iPhone のキーボードを残さない。
 * 移す時もページは動かさない）。中に無ければ何もしない。移したら true
 */
export function releaseFocusBeforeFold(section: Element | null): boolean {
  const active = document.activeElement
  if (!section || !(active instanceof HTMLElement) || !section.contains(active)) return false
  const fold = section.querySelector<HTMLElement>('.list-head-fold')
  if (fold && fold !== active) fold.focus({ preventScroll: true })
  // ボタンへ移せなかった時（見えていない）も、入力欄からは外す
  if (document.activeElement === active && active !== fold) active.blur()
  return true
}

export interface ListSectionProps {
  list: ListKey
  /** S・M の縦に積んだリスト（1つずつ面に載せ、畳んだ状態は端末に覚えない） */
  stacked: boolean
  /** まだ済んでいない数（畳んでいても数える。src/features/lists/counts.ts） */
  count: number
  /** 切り替えの列から飛ぶ先（S・M の区切りの id） */
  id?: string
  /** 見出しの id（切り替えの列で飛んだ時、ここにフォーカスを移す） */
  headingId?: string
  /** 開いている間だけ見出しの右に出す物（Routine List の［すべて開く／畳む］） */
  headerExtra?: ReactNode
  /** 中身（入力欄・行・「済み n件」。各リストの *ListBody） */
  children?: ReactNode
}

export function ListSection({ list, stacked, count, id, headingId, headerExtra, children }: ListSectionProps) {
  const info = LIST_INFO[list]
  const baseId = useId()
  const titleId = headingId ?? `${baseId}-title`
  const bodyId = `${baseId}-body`
  const [collapsed, setCollapsed] = useListCollapsed(list, stacked)
  const toggle = (e: MouseEvent<HTMLElement>) => {
    if (!collapsed) releaseFocusBeforeFold(e.currentTarget.closest('.list-panel'))
    setCollapsed(!collapsed)
  }
  // 見出しのどこを押しても畳む・開く（中のボタン［すべて開く］などを押した時を除く）
  const onHeadClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return
    toggle(e)
  }
  return (
    <section
      id={id}
      className={`list-panel${stacked ? ' is-stacked top-pane' : ''}${collapsed ? ' is-collapsed' : ''}`}
      aria-labelledby={titleId}
      data-list={list}
      data-collapsed={collapsed}
      data-testid={listTestIds.section(list)}
    >
      <div className="list-head" onClick={onHeadClick}>
        <h2 id={titleId} tabIndex={-1} className="list-head-title">
          <span className="head-en">{info.en}</span>
          <span className="head-ja">{info.ja}</span>
        </h2>
        {!collapsed && headerExtra ? headerExtra : null}
        <span className="mono list-head-count" data-testid={listTestIds.count(list)}>
          <span aria-hidden="true">{count}</span>
          <span className="visually-hidden">まだ済んでいない {count}件</span>
        </span>
        <button
          type="button"
          className="icon-btn list-head-fold"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={`${info.en}を${collapsed ? '開く' : '畳む'}`}
          title={collapsed ? '開く' : '畳む'}
          onClick={toggle}
          data-testid={listTestIds.fold(list)}
        >
          <DownIcon />
        </button>
      </div>
      <div id={bodyId} className={`fold${collapsed ? ' is-closed' : ''}`} data-testid={listTestIds.body(list)}>
        <div className="list-fold-inner">
          <div className="list-body">{children}</div>
        </div>
      </div>
    </section>
  )
}
