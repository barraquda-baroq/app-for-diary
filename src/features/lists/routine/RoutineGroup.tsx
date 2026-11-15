// Routine List の種類ごとのかたまり（docs/SPEC.md の 14.2・3.6・6.13・4.9）: 毎日 → 毎週 → 毎月 → 四半期 → 毎年 の順で、いつも5つ。
// - 見出し（高さ 32px）: 種類の名前（13px・500）、済んだ数／全部（等幅 12px・--text-faint。「2/5」）、畳む・開くの山形。今の期間
//   （毎週 11/8〜11/14 など）は出さない（Q15・I2）。見出しのどこを押しても畳む・開く。畳んだ・開いたは、どの幅でも端末ごとに覚える
//   （diary-studio:prefs の collapsed.routineGroups。初めは開いている）。畳む時に中にフォーカスがあれば、先にその山形へ移す
// - 項目の無い種類: 見出しを不透明度 0.5 で、名前と右に「＋」だけ（数と山形は出さない）。＋を押すと、その種類を選んだ入力欄へ
//   フォーカスする（押した出来事の中で。iPhone でもキーボードが出る。P3）
// - 中身: まだの行（並べた順）→「済み n件」（ふだんは畳む。開いた・畳んだは端末ごとに覚える。collapsed.routineDone）→ 済んだ行
//   （common/ListRows の1つの平らな並び。チェックで行が区切りをまたいでも作り直さない）。並べ替えはこのかたまりの中だけ
//   （features/dnd の ReorderGroup。済んだ行は動かさない）
// data-testid は routine-group-{種類}・routine-group-fold-{種類}・routine-group-add-{種類}・routine-done-{種類}（common/testIds.ts）
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react'
import type { RoutineGroupView, RoutineRowView } from '../../../domain/routineList'
import type { ID } from '../../../domain/types'
import { usePrefs, type RoutineCycle } from '../../../store/uiStore'
import { DownIcon, PlusIcon } from '../../../ui/icons'
import { ReorderGroup } from '../../dnd'
import { useDoneCollapsed } from '../common/DoneSection'
import { listFlashKey } from '../common/listFlash'
import { ListRows } from '../common/ListRows'
import { listTestIds } from '../common/testIds'
import { RoutineRow } from './RoutineRow'

export interface RoutineGroupProps {
  group: RoutineGroupView
  /** 空のかたまりの＋: その種類を選んだ入力欄へフォーカスする */
  onAddTo: (cycle: RoutineCycle) => void
  /** 行の［詳しく］ */
  onDetail: (id: ID) => void
}

/** そのかたまりを畳んでいるか（端末ごとに覚える。どの幅でも同じ） */
export function useGroupCollapsed(cycle: RoutineCycle): [boolean, (collapsed: boolean) => void] {
  const collapsed = usePrefs((s) => s.collapsed.routineGroups[cycle])
  const setCollapsed = usePrefs((s) => s.setCollapsed)
  const set = useCallback(
    (value: boolean) => setCollapsed({ routineGroups: { ...usePrefs.getState().collapsed.routineGroups, [cycle]: value } }),
    [cycle, setCollapsed],
  )
  return [collapsed, set]
}

export const RoutineGroup = memo(function RoutineGroup({ group, onAddTo, onDetail }: RoutineGroupProps) {
  const { cycle, name } = group
  const baseId = useId()
  const [collapsed, setCollapsed] = useGroupCollapsed(cycle)
  const [doneCollapsed, setDoneCollapsed] = useDoneCollapsed({ list: 'routine', cycle })
  const box = useRef<HTMLElement | null>(null)
  /** 次に描いた後に「済み n件」へフォーカスを移す（フォーカスのあった行が畳んだ区切りへ隠れた） */
  const focusDone = useRef(false)
  const onHidden = useCallback(() => {
    focusDone.current = true
  }, [])

  useLayoutEffect(() => {
    if (!focusDone.current) return
    focusDone.current = false
    box.current?.querySelector<HTMLElement>('.list-done-toggle')?.focus({ preventScroll: true })
  })

  const openIds = useMemo(() => group.open.map((r) => r.id), [group.open])
  const indexOf = useMemo(() => new Map(openIds.map((id, i) => [id, i])), [openIds])

  if (group.empty) {
    return (
      <section
        ref={box}
        className="rt-group is-empty"
        aria-labelledby={`${baseId}-name`}
        data-testid={listTestIds.routineGroup(cycle)}
      >
        <div className="rt-group-head">
          <h3 id={`${baseId}-name`} className="rt-group-name">
            {name}
          </h3>
          <button
            type="button"
            className="icon-btn rt-group-add"
            aria-label={`${name}のルーチンを足す`}
            title="足す"
            onClick={() => onAddTo(cycle)}
            data-testid={listTestIds.routineGroupAdd(cycle)}
          >
            <PlusIcon />
          </button>
        </div>
      </section>
    )
  }

  const toggle = () => {
    // 畳む時に中（行の欄・チェックなど）にフォーカスがあれば、先に山形へ移す（隠れた欄にキーボードを残さない）
    if (!collapsed && box.current?.querySelector('.fold')?.contains(document.activeElement)) {
      box.current.querySelector<HTMLElement>('.rt-group-fold')?.focus({ preventScroll: true })
    }
    setCollapsed(!collapsed)
  }
  const onHeadClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button')) return
    toggle()
  }
  const renderRow = (r: RoutineRowView) => (
    <RoutineRow row={r} index={indexOf.get(r.id) ?? -1} doneCollapsed={doneCollapsed} onDetail={onDetail} onHidden={onHidden} />
  )
  return (
    <section
      ref={box}
      className={`rt-group${collapsed ? ' is-collapsed' : ''}`}
      aria-labelledby={`${baseId}-name`}
      data-collapsed={collapsed}
      data-testid={listTestIds.routineGroup(cycle)}
    >
      <div className="rt-group-head" onClick={onHeadClick}>
        <h3 id={`${baseId}-name`} className="rt-group-name">
          {name}
        </h3>
        <span className="mono rt-group-count">
          <span aria-hidden="true">
            {group.doneCount}/{group.total}
          </span>
          <span className="visually-hidden">
            {group.total}件のうち {group.doneCount}件済み
          </span>
        </span>
        <button
          type="button"
          className="icon-btn rt-group-fold"
          aria-expanded={!collapsed}
          aria-controls={`${baseId}-body`}
          aria-label={`${name}を${collapsed ? '開く' : '畳む'}`}
          title={collapsed ? '開く' : '畳む'}
          onClick={toggle}
          data-testid={listTestIds.routineGroupFold(cycle)}
        >
          <DownIcon />
        </button>
      </div>
      <div id={`${baseId}-body`} className={`fold${collapsed ? ' is-closed' : ''}`}>
        <div className="rt-group-body">
          <ReorderGroup table="routines" group={cycle} ids={openIds}>
            <ListRows
              open={group.open}
              done={group.done}
              doneSection={{
                collapsed: doneCollapsed,
                onToggle: () => setDoneCollapsed(!doneCollapsed),
                testId: listTestIds.routineDone(cycle),
                flash: listFlashKey.routineDone(cycle),
              }}
              renderRow={renderRow}
            />
          </ReorderGroup>
        </div>
      </div>
    </section>
  )
})
