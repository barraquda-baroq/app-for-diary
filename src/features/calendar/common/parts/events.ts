// カードの中の部品（完了の丸・AI の札・小窓）が、押した出来事をカード・行の「押すと詳細を開く」「掴む」に渡さないための小さな物
import type { KeyboardEvent, SyntheticEvent } from 'react'

/** 出来事を親（カード・行）へ伝えない */
export const stopPropagation = (e: SyntheticEvent): void => e.stopPropagation()

/** 部品の上の Enter・スペースを、カード・行の「押すと詳細」に渡さない（ボタンの押す動きはそのまま） */
export function stopActivationKeys(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
}
