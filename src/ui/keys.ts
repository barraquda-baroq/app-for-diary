// キー操作の小さな共通部品（入力欄・メニュー）。NS の src/ui/keys.ts のまま。段階2で、登録の画面の Ctrl+Enter・⌘+Enter
// （docs/SPEC.md の 12.2・3.10）の決まりを NS の src/features/ideas/ideaLogic.ts から足した
import type { SyntheticEvent } from 'react'

/** Mac・iPhone・iPad（ショートカットは ⌘。iPad の物理キーボードも UA が Mac なので ⌘） */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** 押してもフォーカスを動かさない（入力欄にカーソルを残し、スマホのキーボードを閉じない）。onPointerDown・onMouseDown に付ける */
export const keepFocus = (e: SyntheticEvent) => e.preventDefault()

/** isSubmitShortcut に渡せるキーの出来事（DOM の KeyboardEvent も、React の onKeyDown の出来事もそのまま渡せる） */
export interface ShortcutKeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  isComposing?: boolean
  keyCode?: number
  /** React の出来事は変換中かを持たないので、元の出来事（nativeEvent）の isComposing を見る */
  nativeEvent?: { isComposing?: boolean }
}

/**
 * Ctrl+Enter・⌘+Enter（日本語の変換中の Enter は除く）。登録の画面の［登録］（12.2）。NS の ideaLogic.ts から、React の出来事を
 * そのまま渡せるようにし（nativeEvent.isComposing）、変換を決める Enter に isComposing を付けない Safari の keyCode 229 も除いた
 */
export function isSubmitShortcut(e: ShortcutKeyEvent): boolean {
  const composing = e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !composing
}

/** ショートカットの表記（Mac なら ⌘） */
export function submitShortcutLabel(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘+Enter' : 'Ctrl+Enter'
}
