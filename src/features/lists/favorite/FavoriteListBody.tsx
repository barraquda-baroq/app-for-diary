// Favorite List の中身（docs/SPEC.md の 15.・3.6）: 入力欄（自動で伸びる欄と［足す］。common/ListInput）、まだの行（新しい物が上）、
// 「済み n件」（ふだんは畳む。開くと右に［済みを片付ける］）と済んだ行。見出しと畳む・開くの枠は common/ListSection（トップの画面が置く）。
// 行・「済み n件」・済んだ行は1つの平らな並び（common/ListRows。チェックで行が区切りをまたいでも作り直さない）。並べ替えはまだの行の
// 中だけ（features/dnd の ReorderGroup。済んだ行は動かさない）。
// - 今日は、この部品の1つの useToday() から決める（足した日に年を出すか）
// - 入力欄: PC は Enter で足す・Shift+Enter で改行、指の端末は Enter が改行で［足す］（✓）で足す（どの端末も［足す］がある）。変換中の
//   Enter では足さない（common/listInputModel の enterAction）。いちばん上に足し（前後の空白は落とす）、欄を空にしてフォーカスを残し、
//   足した行を 1.2秒目立たせる（L は右の列の中だけで見える所まで送る。S・M はページを動かさない）。書きかけは
//   diary-studio:draft:favorite に控える（common/useListInput）
// - ［済みを片付ける］: 済みの物をまとめてゴミ箱の1件へ（［元に戻す］付きのお知らせ。favorite/favoriteActions.ts）。押した所が消えるので、
//   フォーカスはこのリストの見出しの畳む・開くボタンへ移す（ページは動かさない）
// - ［予定にする］: 登録の画面（12.2）を、この中身から作った初めの値で開く（Favorite List から開いた印 from 'favorite'。L も真ん中の
//   小さな画面、S・M は下からのシート。ListSheetHost が出す）。［詳しく］は favorite/FavoritePanel（ListSheetHost が出す）
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { toYmd, todayStr } from '../../../domain/dates'
import type { FavoriteRowView } from '../../../domain/favoriteList'
import { favoriteToRegister } from '../../../domain/favoriteList'
import { useToday } from '../../../ui/hooks'
import { useItemSheets } from '../../calendar/common/sheets'
import { ReorderGroup } from '../../dnd'
import { useDoneCollapsed } from '../common/DoneSection'
import { flashList, listFlashKey } from '../common/listFlash'
import { ListInput } from '../common/ListInput'
import type { ListDraft } from '../common/listInputModel'
import { ListRows } from '../common/ListRows'
import { listTestIds } from '../common/testIds'
import { useListInput } from '../common/useListInput'
import type { ListBodyProps } from '../types'
import { addFavoriteFrom, clearDoneFavorites } from './favoriteActions'
import { FavoriteRow } from './FavoriteRow'
import { useFavoriteList } from './useFavoriteList'
import './favorite.css'

export function FavoriteListBody(props: ListBodyProps) {
  void props
  const today = toYmd(useToday())
  const view = useFavoriteList(today)
  const { openFavoriteDetail, openRegister } = useItemSheets()
  const [doneCollapsed, setDoneCollapsed] = useDoneCollapsed({ list: 'favorite' })
  const box = useRef<HTMLDivElement | null>(null)
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

  const onAdd = useCallback((d: ListDraft): boolean => {
    const id = addFavoriteFrom(d.text)
    if (id === undefined) return false
    flashList(listFlashKey.row('favorite', id))
    return true
  }, [])
  const input = useListInput({ list: 'favorite', onAdd })

  const onRegister = useCallback(
    (text: string) => openRegister(favoriteToRegister(text, todayStr()), { from: 'favorite' }),
    [openRegister],
  )

  const clearDone = async () => {
    const panel = box.current?.closest('.list-panel')
    if (!(await clearDoneFavorites())) return
    // 押した［済みを片付ける］は消えるので、フォーカスを見出しの畳む・開くボタンへ（中に残っていた時だけ。ページは動かさない）
    const active = document.activeElement
    if (active === null || active === document.body)
      panel?.querySelector<HTMLElement>('.list-head-fold')?.focus({ preventScroll: true })
  }

  const openIds = useMemo(() => view.open.map((r) => r.id), [view.open])
  const indexOf = useMemo(() => new Map(openIds.map((id, i) => [id, i])), [openIds])
  const renderRow = (r: FavoriteRowView) => (
    <FavoriteRow
      row={r}
      index={indexOf.get(r.id) ?? -1}
      doneCollapsed={doneCollapsed}
      onDetail={openFavoriteDetail}
      onRegister={onRegister}
      onHidden={onHidden}
    />
  )

  return (
    <>
      <ListInput input={input} />
      <div ref={box} className="fv-list">
        <ReorderGroup table="favorites" group="open" ids={openIds}>
          <ListRows
            open={view.open}
            done={view.done}
            doneSection={{
              collapsed: doneCollapsed,
              onToggle: () => setDoneCollapsed(!doneCollapsed),
              testId: listTestIds.done('favorite'),
              flash: listFlashKey.done('favorite'),
              footer: doneCollapsed ? undefined : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm fv-clear"
                  onClick={() => void clearDone()}
                  data-testid={listTestIds.favoriteClearDone}
                >
                  済みを片付ける
                </button>
              ),
            }}
            renderRow={renderRow}
          />
        </ReorderGroup>
      </div>
    </>
  )
}
