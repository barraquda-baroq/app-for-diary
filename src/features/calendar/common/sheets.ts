// 登録・詳細の小さな画面（L は真ん中・M/S は下からのシート）の開け閉めと履歴（docs/SPEC.md の 3.1・3.8。D03・確かめ A3）。
// 開く時は行き先を変えずに、同じ行き先を履歴の state.sheet に積む（URL に予定の id を出さない。スマホの「戻る」で閉じられる）。
// ［×］・Esc・背景・登録・削除で閉じる時は履歴を1つ戻す（戻る物が無い時は state.sheet を外して置き換える）。「戻る」でも同じく閉じる。
// 中の小さな画面（削除の確かめ・複製・日付や時刻の一覧）は積まない（WP9）。小さな画面を出すのは common/SheetHost.tsx
import { useMemo } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import type { ID } from '../../../domain/types'
import type { RegisterInit, SheetLocationState, SheetState } from './types'

/**
 * このページの読み込みの印。小さな画面を開いた時に state に一緒に置き、読み込み直した後に残った state.sheet と
 * 見分ける（読み込み直した後の登録の画面は開き直さない、詳細は予定があれば開き直す。D03）
 */
export const PAGE_ID = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** 履歴の state（小さな画面の印と、それを開いたページの印。MIM の印などほかの物と並ぶ） */
export interface SheetHistoryState extends SheetLocationState {
  /** 小さな画面を開いた時のページの読み込みの印（PAGE_ID） */
  sheetPage?: string
}

/** 履歴の state から、開いている小さな画面（無ければ null） */
export function sheetOf(state: unknown): SheetState | null {
  if (!state || typeof state !== 'object') return null
  const sheet = (state as SheetHistoryState).sheet
  if (!sheet || typeof sheet !== 'object') return null
  if (sheet.kind === 'register' && sheet.init && typeof sheet.init.start === 'string') return sheet
  if (sheet.kind === 'detail' && typeof sheet.id === 'string') return sheet
  return null
}

/** その小さな画面の印が、このページの読み込みの後に開いた物か（読み込み直す前の物でないか） */
export function openedOnThisPage(state: unknown): boolean {
  return Boolean(state && typeof state === 'object' && (state as SheetHistoryState).sheetPage === PAGE_ID)
}

/** 履歴の state から小さな画面の印を外した物（ほかの物は残す） */
function withoutSheet(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== 'object') return {}
  const rest = { ...(state as Record<string, unknown>) }
  delete rest.sheet
  delete rest.sheetPage
  return rest
}

/** 閉じるために履歴を戻している所（同じ所でもう一度押しても2つ戻らないように。key と時刻） */
let popping: { key: string; at: number } | null = null
/** 戻るのを止められた（書きかけの確かめで［戻る］を選んだ）時に、もう一度閉じられるようになるまで */
const POP_GUARD_MS = 1000

export interface ItemSheets {
  /** 登録の画面を開く（12.2。初めの値: 開始日・区分・時刻・件名・メモ） */
  openRegister: (init: RegisterInit) => void
  /** 予定の詳細の画面を開く（12.3） */
  openDetail: (id: ID) => void
  /** 開いている小さな画面を閉じる（［×］・Esc・背景・登録・削除の後。履歴を1つ戻す） */
  closeSheet: () => void
}

/** 小さな画面を開いた state を積む（もう開いている時は、その画面を替える: 置き換える） */
function open(navigate: ReturnType<typeof useNavigate>, location: Location, sheet: SheetState): void {
  const state: SheetHistoryState = { ...withoutSheet(location.state), sheet, sheetPage: PAGE_ID }
  void navigate(location.pathname, { state, replace: sheetOf(location.state) !== null })
}

/** 登録・詳細の小さな画面を開く・閉じる（どの部品からも呼べる） */
export function useItemSheets(): ItemSheets {
  const navigate = useNavigate()
  const location = useLocation()
  return useMemo(
    () => ({
      openRegister: (init) => open(navigate, location, { kind: 'register', init }),
      openDetail: (id) => open(navigate, location, { kind: 'detail', id }),
      closeSheet: () => {
        if (!sheetOf(location.state)) return
        if (popping && popping.key === location.key && Date.now() - popping.at < POP_GUARD_MS) return
        if (location.key !== 'default') {
          popping = { key: location.key, at: Date.now() }
          void navigate(-1)
        } else {
          // 戻る物が無い（この行き先を小さな画面の印付きで開いた）時は、印を外して置き換える
          void navigate(location.pathname, { replace: true, state: withoutSheet(location.state) })
        }
      },
    }),
    [navigate, location],
  )
}
