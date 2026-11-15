// リストの並べ替え（docs/SPEC.md の 14.2・15.2・7.11）: Routine List は同じ種類のかたまりの中だけ、Favorite List はまだの行の中
// （済みの行は動かさない）。PC は行の掴む所（GripIcon）を 5px 動かす、指は行のどこでも 0.4秒 8px の中で押し続ける。離すと
// actions.reorder（並びの変わった物だけ order を書く）。行の部品は返す物を行・掴む所に付ける。MIM のメモ（段階4）も同じ物を使う。
// 契約の形だけ（S3-STUB）: 今はいつも disabled（並べ替えない）で、ReorderGroup は中身をそのまま出すだけ（中身は段階3の WP8b が入れる）
import type { HTMLAttributes, ReactNode } from 'react'
import type { ID } from '../../domain/types'
import type { ReorderTable } from './dragData'

/** 並べ替える1行 */
export interface ReorderInput {
  table: ReorderTable
  /** かたまり（Routine List は種類 daily…、Favorite List は 'open'） */
  group: string
  id: ID
  /** かたまりの中の今の位置（0 から） */
  index: number
  /** 並べ替えない（済みの行など） */
  disabled?: boolean
}

export interface Reorder {
  /** 行に付ける（指はここを押し続ける） */
  ref: (el: Element | null) => void
  /** PC の掴む所に付ける */
  handleRef: (el: Element | null) => void
  /** 今その行を掴んで動かしている */
  isDragging: boolean
  /** 行に広げて渡す */
  rowProps: HTMLAttributes<HTMLElement>
  disabled: boolean
}

const INERT: Reorder = { ref: () => {}, handleRef: () => {}, isDragging: false, rowProps: {}, disabled: true }

export function useReorder(input: ReorderInput): Reorder {
  void input
  return INERT
}

/** 並べ替える行のかたまり（ids は今の並び。中の行が useReorder を呼ぶ） */
export interface ReorderGroupProps {
  table: ReorderTable
  group: string
  ids: readonly ID[]
  children: ReactNode
}

export function ReorderGroup({ children }: ReorderGroupProps) {
  return <>{children}</>
}
