// 文字列の指紋（同期の文書の hash・内容から作る id・受け取り箱の baseHash・afterHash・コネクタの rev）。同じ関数を使うアプリと
// 段階6のコネクタ（Cloudflare Worker）で同じ値になるように、外の物に頼らない純粋な関数にしておく。NS の src/domain/hash.ts を
// そのまま写し、recordHash と revOf を足した。
import { stableStringify } from './equal'

/** 53 ビットの文字列ハッシュ（cyrb53）。36進数の文字列で返す */
export function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * 文字列の指紋（2つの種の cyrb53 と長さ。[0-9a-z.] だけ、最長 30 字ほど）。null は ''。
 * 同期の文書の hash（json の指紋）と同じもの。
 */
export function hashJson(json: string | null): string {
  if (json === null) return ''
  return `${cyrb53(json, 1)}.${cyrb53(json, 2)}.${json.length.toString(36)}`
}

/** 同期の文書の hash（記録の stableStringify の指紋。src/sync/codec.ts の hashRecord） */
export function recordHash(record: unknown): string {
  return hashJson(stableStringify(record))
}

/** 受け取り箱の指紋の材料から外す項目（直した日時と並びの数。形2） */
export const REV_IGNORED_FIELDS = ['updatedAt', 'order'] as const

/**
 * 記録の内容の指紋（受け取り箱の baseHash・afterHash・undo の beforeHash、段階6のコネクタの rev。6.14・19.5・19.6）。
 * 最後に直した日時（updatedAt）と並びの数（order）を外し、中身（件名・日付・メモなど）が同じなら同じ値にする（形2。2台が同じ依頼を
 * 同時に当てて updatedAt・order だけが違う記録になっても、後の after: の依頼と［元に戻す］が要らない競合にならないように）。
 * 材料は端末の raw の記録（クラウドの json と同じ。表示用に直した内容ではない）。記録が無ければ ''
 */
export function revOf(record: object | null | undefined): string {
  if (!record) return ''
  const rest: Record<string, unknown> = { ...(record as Record<string, unknown>) }
  for (const k of REV_IGNORED_FIELDS) delete rest[k]
  return hashJson(stableStringify(rest))
}
