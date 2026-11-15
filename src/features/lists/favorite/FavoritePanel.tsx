// やりたいことの［詳しく］のパネル（docs/SPEC.md の 3.6・3.8・15.4。パネルは（開発））: 中身・足した日・［削除］と、下の端に段階5の提案の置き場。
// 外枠は common/ListSheet（L は右の列の上のパネル、S・M は下からのシート。地は --surface、題の左に HeartIcon。Esc・［×］・外を押すと
// 閉じる）。履歴の state.sheet の favorite（src/features/calendar/common/types.ts の SheetState）を ListSheetHost が読んで出す。
// 保存のボタンは無く、直したそばから保存する（3.6）:
// - 中身: 止まってから 0.6秒・欄から出た時に保存（前後の空白は落とし、中の改行はそのまま）。空にした時は保存せず、欄から出た時に
//   保存してある中身に戻す。Enter は改行（複数行の欄）
// - 足した日: 「11/10 に足しました」（年が今日と違う時は年も。行の右上と同じ（開発））
// - ［削除］: 行の「…」の［削除］と同じ（確かめずにゴミ箱へ・［元に戻す］付きのお知らせ）で、パネルを閉じる
// 開いた時は中身の欄でなく上の所にフォーカスする（スマホでキーボードを開かない。Tab で中身の欄へ）。data-testid は favorite-panel
import { useState } from 'react'
import { toYmd } from '../../../domain/dates'
import { addedLabel } from '../../../domain/favoriteList'
import { useApp } from '../../../store/appStore'
import { DraftTextarea } from '../../../ui/DraftField'
import { useToday } from '../../../ui/hooks'
import { HeartIcon, TrashIcon } from '../../../ui/icons'
import { ListSheet } from '../common/ListSheet'
import { listTestIds } from '../common/testIds'
import type { ListPanelProps } from '../types'
import { deleteFavorite, FAVORITE_AUTOSAVE_MS, saveFavoriteText } from './favoriteActions'
import { favoritePanelTestIds } from './favoriteTestIds'
import './favorite.css'

export function FavoritePanel({ id, onClose }: ListPanelProps) {
  const favorite = useApp((s) => s.data.favorites[id])
  const today = toYmd(useToday())
  /** 中身の欄を、保存してある中身から作り直す回数（空にして欄から出た時に戻す） */
  const [textKey, setTextKey] = useState(0)
  if (!favorite) return null

  const remove = async () => {
    if (await deleteFavorite(favorite)) onClose()
  }
  const added = addedLabel(favorite.createdAt, today)

  return (
    <ListSheet
      title="やりたいこと"
      icon={<HeartIcon />}
      onClose={onClose}
      testId={listTestIds.favoritePanel}
      initialFocus=".fv-panel-top"
    >
      <div className="fv-panel">
        <div className="fv-panel-top" tabIndex={-1} />
        <label className="field">
          <span>中身</span>
          <DraftTextarea
            key={`${favorite.id}:${textKey}`}
            className="textarea fv-panel-text"
            rows={6}
            value={favorite.text}
            onCommit={(v) => {
              // 空は保存しない（欄から出た時に戻す）
              if (v.trim()) saveFavoriteText(favorite, v)
            }}
            onBlur={(e) => {
              if (!e.currentTarget.value.trim()) setTextKey((k) => k + 1)
            }}
            delay={FAVORITE_AUTOSAVE_MS}
            autoComplete="off"
            data-testid={favoritePanelTestIds.text}
          />
        </label>
        <p className="fv-panel-added" data-testid={favoritePanelTestIds.added}>
          <span className="mono">{added}</span> に足しました
        </p>
        <div className="fv-panel-foot">
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => void remove()}
            data-testid={favoritePanelTestIds.remove}
          >
            <TrashIcon />
            削除
          </button>
        </div>
        {/* 段階5の Claude の提案の置き場（18.6） */}
        <div className="fv-panel-proposal" />
      </div>
    </ListSheet>
  )
}
