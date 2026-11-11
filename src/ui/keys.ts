// キー操作の小さな共通部品（入力欄・メニュー）。NS の src/ui/keys.ts のまま。段階2で、登録の画面の Ctrl+Enter・⌘+Enter
// （docs/SPEC.md の 12.2・3.10）の決まりを NS の src/features/ideas/ideaLogic.ts から足した
import type { SyntheticEvent } from 'react'

/** Mac・iPhone・iPad（ショートカットは ⌘。iPad の物理キーボードも UA が Mac なので ⌘） */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** 押してもフォーカスを動かさない（入力欄にカーソルを残し、スマホのキーボードを閉じない）。onPointerDown・onMouseDown に付ける */
export const keepFocus = (e: SyntheticEvent) => e.preventDefault()

/** Ctrl+Enter・⌘+Enter（日本語の変換中の Enter は除く）。登録の画面の［登録］（12.2） */
export function isSubmitShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; isComposing?: boolean }): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing
}

/** ショートカットの表記（Mac なら ⌘） */
export function submitShortcutLabel(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘+Enter' : 'Ctrl+Enter'
}
