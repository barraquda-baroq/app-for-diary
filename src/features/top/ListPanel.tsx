// 右の列（S・M は縦に積んだ所）の3つのリストの空の形（docs/SPEC.md の 3.6）: 見出し（英語の名前＋小さな日本語・まだ済んでいない数・
// 畳む・開くの山形）と、開いている間はいつも見出しのすぐ下に出す入力欄の形。行・「済み n件」・足す処理は段階3で作る。
// 畳んだ・開いた状態: L（右の列）は端末ごとに覚える（diary-studio:prefs の collapsed）。S・M はアプリを開くたびに3つとも畳んで
// 始まり、開いている間だけ画面の中（useStackedLists）で持つ（docs/SPEC.md の 3.5・3.6・6.13）
import { useId, type KeyboardEvent, type MouseEvent } from 'react'
import {
  notify,
  ROUTINE_CYCLES,
  useStackedLists,
  usePrefs,
  type ListKey,
  type RoutineCycle,
  type RoutineFlags,
} from '../../store/uiStore'
import { DownIcon } from '../../ui/icons'

/** 並びは上から Routine → Task → Favorite（Q21・X1） */
export const LIST_ORDER: readonly ListKey[] = ['routine', 'task', 'favorite']

export const LIST_INFO: Record<ListKey, { en: string; short: string; ja: string; placeholder: string; inputLabel: string }> = {
  routine: { en: 'Routine List', short: 'Routine', ja: 'ルーチン', placeholder: 'ルーチンを足す…', inputLabel: 'ルーチンを足す' },
  task: { en: 'Task List', short: 'Task', ja: 'タスク', placeholder: 'タスクを入れる…', inputLabel: 'タスクを入れる' },
  favorite: {
    en: 'Favorite List',
    short: 'Favorite',
    ja: 'やりたいこと',
    placeholder: '気になったことを入れる…',
    inputLabel: 'やりたいことを入れる',
  },
}

/** Routine List の入力欄の左の種類の切り替え［日｜週｜月｜四半期｜年］（docs/SPEC.md の 14.2） */
const CYCLE_LABELS: Record<RoutineCycle, string> = {
  daily: '日',
  weekly: '週',
  monthly: '月',
  quarterly: '四半期',
  yearly: '年',
}

/** 畳む・開くの動き（src/styles.css の --dur-fold と同じ 180ms） */
export const FOLD_MS = 180

/**
 * そのリストを畳んでいるか。stacked（S・M の縦に積んだリスト）はアプリを開くたびに畳んで始まる画面の中の状態、
 * そうでなければ（L の右の列）端末ごとに覚えた状態を使う（幅を変えて行き来しても、それぞれの状態を使う。docs/SPEC.md の 3.6）
 */
export function useListCollapsed(key: ListKey, stacked: boolean): [boolean, (collapsed: boolean) => void] {
  const wide = usePrefs((s) => s.collapsed[key])
  const setWide = usePrefs((s) => s.setCollapsed)
  const narrow = useStackedLists((s) => s.collapsed[key])
  const setNarrow = useStackedLists((s) => s.setCollapsed)
  if (stacked) return [narrow, (collapsed) => setNarrow(key, collapsed)]
  return [wide, (collapsed) => setWide({ [key]: collapsed })]
}

const allFlags = (value: boolean) => Object.fromEntries(ROUTINE_CYCLES.map((c) => [c, value])) as RoutineFlags

/**
 * ［すべて開く］／［すべて畳む］（種類ごとのかたまり。どれか1つでも畳んでいれば「すべて開く」。docs/SPEC.md の 14.2）。
 * 畳むかたまりが1つも無い間は出さない（押しても画面が何も変わらないので。段階0はルーチンが無いので出ない）
 */
function RoutineAllToggle() {
  const groups = usePrefs((s) => s.collapsed.routineGroups)
  const setCollapsed = usePrefs((s) => s.setCollapsed)
  const anyClosed = ROUTINE_CYCLES.some((c) => groups[c])
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm list-head-all"
      onClick={() => setCollapsed({ routineGroups: allFlags(!anyClosed) })}
      data-testid="routine-toggle-all"
    >
      {anyClosed ? 'すべて開く' : 'すべて畳む'}
    </button>
  )
}

/** 入力欄の形（段階0は、Enter でお知らせを出すだけ。足す処理・書きかけの控えは段階3） */
function ListInput({ listKey }: { listKey: ListKey }) {
  const info = LIST_INFO[listKey]
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    notify(`${info.en} に足すのは段階3で作ります`)
  }
  return (
    <textarea
      className="input list-input"
      rows={1}
      placeholder={info.placeholder}
      aria-label={info.inputLabel}
      onKeyDown={onKeyDown}
      data-testid={`list-${listKey}-input`}
    />
  )
}

function RoutineCycleSwitch() {
  const cycle = usePrefs((s) => s.routineAddCycle)
  const setPrefs = usePrefs((s) => s.setPrefs)
  return (
    <div className="segmented list-cycle" role="group" aria-label="足すルーチンの種類">
      {ROUTINE_CYCLES.map((c) => (
        <button key={c} type="button" aria-pressed={cycle === c} onClick={() => setPrefs({ routineAddCycle: c })}>
          {CYCLE_LABELS[c]}
        </button>
      ))}
    </div>
  )
}

/** Task List の入力欄の下の小さなボタン（開始日・締め切り日・依頼者。docs/SPEC.md の 13.2。段階3で作る） */
function TaskInputButtons() {
  const later = () => notify('Task List の入力は段階3で作ります')
  return (
    <div className="list-input-tools">
      {['開始日', '締め切り日', '依頼者'].map((label) => (
        <button key={label} type="button" className="btn btn-ghost btn-sm" onClick={later}>
          {label}
        </button>
      ))}
    </div>
  )
}

export function ListPanel({
  listKey,
  stacked,
  id,
  headingId,
  count = 0,
  groupCount = 0,
}: {
  listKey: ListKey
  /** S・M の縦に積んだリスト（1つずつ面に載せ、畳んだ状態は端末に覚えない） */
  stacked: boolean
  /** 切り替えの列から飛ぶ先 */
  id?: string
  /** 見出しの id（切り替えの列で飛んだ時、ここにフォーカスを移す） */
  headingId?: string
  /** まだ済んでいない数（段階3でリストの中身から数える） */
  count?: number
  /** Routine List の種類のかたまり（毎日・毎週…）の数。0 の間は［すべて開く／畳む］を出さない（段階3でルーチンの中身から数える） */
  groupCount?: number
}) {
  const info = LIST_INFO[listKey]
  const baseId = useId()
  const titleId = headingId ?? `${baseId}-title`
  const bodyId = `${baseId}-body`
  const [collapsed, setCollapsed] = useListCollapsed(listKey, stacked)
  const toggle = () => setCollapsed(!collapsed)
  // 見出しのどこを押しても畳む・開く（中のボタン［すべて開く］などを押した時を除く）
  const onHeadClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return
    toggle()
  }
  return (
    <section
      id={id}
      className={`list-panel${stacked ? ' is-stacked top-pane' : ''}${collapsed ? ' is-collapsed' : ''}`}
      aria-labelledby={titleId}
      data-list={listKey}
      data-collapsed={collapsed}
      data-testid={`list-${listKey}`}
    >
      <div className="list-head" onClick={onHeadClick}>
        <h2 id={titleId} tabIndex={-1} className="list-head-title">
          <span className="head-en">{info.en}</span>
          <span className="head-ja">{info.ja}</span>
        </h2>
        {listKey === 'routine' && !collapsed && groupCount > 0 ? <RoutineAllToggle /> : null}
        <span className="mono list-head-count" data-testid={`list-${listKey}-count`}>
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
          data-testid={`list-${listKey}-fold`}
        >
          <DownIcon />
        </button>
      </div>
      <div id={bodyId} className={`fold${collapsed ? ' is-closed' : ''}`} data-testid={`list-${listKey}-body`}>
        <div className="list-fold-inner">
          <div className="list-body">
            {listKey === 'routine' ? (
              <div className="list-input-row">
                <RoutineCycleSwitch />
                <ListInput listKey={listKey} />
              </div>
            ) : (
              <ListInput listKey={listKey} />
            )}
            {listKey === 'task' ? <TaskInputButtons /> : null}
          </div>
        </div>
      </div>
    </section>
  )
}
