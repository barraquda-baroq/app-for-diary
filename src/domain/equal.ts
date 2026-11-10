// 内容の比較（キーの順番と undefined の項目は問わない）と、キーを並べ替えた JSON。同期で届いたレコードはキーが並べ替えてあるので、
// JSON 文字列の比較では同じ内容でも違うと判定してしまう。NS の src/domain/equal.ts に、NS の src/sync/merge.ts の
// stableStringify・contentEqual をここへ移した（内容から作る id・受け取り箱・段階6のコネクタが sync を import せずに使えるように。
// src/sync/merge.ts はここから再び公開する）。

/** 同じ内容か（キーの順番は問わない） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    if (a.length !== bb.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined)
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined)
  if (ak.length !== bk.length) return false
  for (const k of ak) if (!deepEqual(ao[k], bo[k])) return false
  return true
}

/** キーを並べ替えた JSON（同じ内容なら同じ文字列になる）。undefined の項目は書かない */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`
  const obj = value as Record<string, unknown>
  const parts: string[] = []
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k]
    if (v === undefined || typeof v === 'function') continue
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`)
  }
  return `{${parts.join(',')}}`
}

/** 直した日時（updatedAt）を除いて同じ内容か（どちらも無い時も同じ） */
export function contentEqual(a: object | null | undefined, b: object | null | undefined): boolean {
  if (!a || !b) return !a && !b
  if (a === b) return true
  return deepEqual({ ...a, updatedAt: undefined }, { ...b, updatedAt: undefined })
}
