// ウィークリー・デイリーを出している間、予定を変える操作を元に戻す・やり直すの並びに積む（docs/SPEC.md の 7.13。src/store/undoStore.ts の
// enterUndoScope）。積む時に、このモードと今見ている日を操作をした所としてステップに覚えさせる（■28 の作者の答え: 戻した・やり直した
// 時に、今のモードと違えばこのモードへ戻る。そこから開いた登録・詳細の画面でした操作も、このモード）
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { UndoMode, UndoPlace } from '../../../domain/undo'
import { enterUndoScope } from '../../../store/undoStore'

export function useUndoScope(mode: UndoMode, viewed: string): void {
  // 描いた後の物を読む（描きかけで捨てられた描き方の日を覚えない）
  const place = useRef<UndoPlace>({ mode, date: viewed })
  useLayoutEffect(() => {
    place.current = { mode, date: viewed }
  })
  useEffect(() => enterUndoScope(() => place.current), [])
}
