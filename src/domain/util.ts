// 小さな共通の道具（id・時刻・並び・文字数）。NS の src/domain/util.ts をそのまま写し、2つだけ変えた:
// byOrder の id の比べ方を文字コードの比較にした（localeCompare は端末の言語で並びが変わりうる。6.1 の「どの端末でも同じ並び」）、
// いちばん上に足す topOrder（6.8）と文字数の charCount（6.1）を足した。
import type { ID } from './types'

let fallbackCounter = 0

export function newId(): ID {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // 非セキュアコンテキスト（file:// 等）向けのフォールバック
  fallbackCounter += 1
  return `id-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function now(): number {
  return Date.now()
}

export interface Ordered {
  id: ID
  order: number
}

/** 文字コードで比べる（端末の言語に左右されない） */
export function compareStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** order の小さい順。同じ値なら id の小さい順（2台で別々に足して同じ値になっても、どの端末でも同じ並び。6.1） */
export function byOrder<T extends Ordered>(a: T, b: T): number {
  return a.order - b.order || compareStr(a.id, b.id)
}

/** いちばん下に足す時の order（今のいちばん大きい値 + 1。無ければ 0） */
export function nextOrder(items: readonly Ordered[]): number {
  return items.reduce((max, it) => Math.max(max, it.order), -1) + 1
}

/** いちばん上に足す時の order（今のいちばん小さい値 − 1。無ければ 0。6.8） */
export function topOrder(items: readonly Ordered[]): number {
  if (items.length === 0) return 0
  return items.reduce((min, it) => Math.min(min, it.order), Infinity) - 1
}

/** order を持つレコード群の中で id を1つ上/下に動かす。変更が必要なレコードだけを返す */
export function stepOrder<T extends Ordered>(items: T[], id: ID, dir: -1 | 1): T[] {
  const sorted = [...items].sort(byOrder)
  const idx = sorted.findIndex((it) => it.id === id)
  const target = idx + dir
  if (idx < 0 || target < 0 || target >= sorted.length) return []
  const moved = [...sorted]
  ;[moved[idx], moved[target]] = [moved[target], moved[idx]]
  // 並びを 0..n-1 に正規化し、変わったものだけ返す
  const changed: T[] = []
  moved.forEach((it, i) => {
    if (it.order !== i) changed.push({ ...it, order: i })
  })
  return changed
}

export function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const i = Math.max(0, Math.min(index, list.length))
  return [...list.slice(0, i), item, ...list.slice(i)]
}

export function removeValue<T>(list: readonly T[], value: T): T[] {
  return list.filter((v) => v !== value)
}

/** 文字数（前後の空白を除いた、Unicode の文字（コードポイント）の数。6.1） */
export function charCount(s: string): number {
  return Array.from(s.trim()).length
}

export const DAY_MS = 24 * 60 * 60 * 1000
