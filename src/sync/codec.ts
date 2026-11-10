// Firestore の文書の形（docs/SPEC.md の 2.4）。1レコード = 1文書（users/{uid}/records/{表名}:{id}）。
// レコードはキーを並べ替えた JSON 文字列として保存する（端末内の内容とそのまま比べられ、Firestore が扱えない値（undefined など）にも
// 困らない）。1MiB の文書の上限を超えそうな大きなレコードは分けた文書（{表名}:{id}#{n}）に分けて同じトランザクションで書く。
// NS の src/sync/codec.ts をそのまま写し、分けた文書に親の表の名前 parentTable を足した（段階6のコネクタのアクセスルールで、読ませる表の
// 分けた文書だけを読ませ、MIM とゴミ箱の分けた文書を読ませないため。2.4・19.6）。月の束（6.11）の文書の表 itemPack も扱う。
import { stableStringify } from '../domain/equal'
import { hashJson, recordHash } from '../domain/hash'
import type { TableName } from '../domain/types'

export { hashJson }

/** レコードの最小の形（id と、あれば最後に直した日時） */
export type Rec = { id: string; updatedAt?: number }

export const RECORDS = 'records'

/** 月の束の文書の表（クラウドだけ。端末の中では items に戻す。6.11） */
export const PACK_TABLE = 'itemPack'

/** クラウドの記録の文書の表（10表と月の束） */
export type CloudTable = TableName | typeof PACK_TABLE

/** 1つの文書に入れる JSON の最大の長さ（UTF-16 の文字数。UTF-8 で最大 3 バイト/文字なので 1MiB に収まる） */
export const CHUNK_CHARS = 250_000

export interface RecordDoc {
  table: CloudTable
  id: string
  /** レコードの JSON。削除した時と、分割した時は null */
  json: string | null
  /** 分割した数（0 = 分割していない） */
  chunks: number
  deleted: boolean
  /** JSON の指紋（削除した時は ''）。送る前に、クラウド側が前回揃えた時から変わっていないかを確かめる */
  hash: string
  /** サーバー時刻（差分の取得に使う） */
  updated: unknown
  /** 書いた端末 */
  device: string
  /** バックアップからの復元・すべて削除で書いた（受け取った端末は、この内容を正とする） */
  reset?: boolean
}

export interface ChunkDoc {
  table: '_chunk'
  parent: string
  /** 親の文書の表（10表か itemPack。2.4） */
  parentTable: CloudTable
  index: number
  json: string
  hash: string
  updated: unknown
  device: string
  /** 分割文書は削除の印を持たない（復元の時に一緒に探せるように常に false） */
  deleted: false
}

export const docIdOf = (table: string, id: string) => `${table}:${id}`
export const chunkIdOf = (parent: string, index: number) => `${parent}#${index}`

/** 文書の id（{表名}:{id}）から表と id に分ける（id にコロンを含む routineChecks も） */
export function splitDocId(docId: string): { table: string; id: string } {
  const i = docId.indexOf(':')
  return i < 0 ? { table: docId, id: '' } : { table: docId.slice(0, i), id: docId.slice(i + 1) }
}

/** レコードの指紋（null = 無い。src/domain/hash.ts の recordHash） */
export function hashRecord(rec: Rec | null | undefined): string {
  return rec ? recordHash(rec) : ''
}

export interface Encoded {
  /** 文書に直接入れる JSON（分割した時・削除の時は null） */
  json: string | null
  /** 分割した JSON（分割しない時は空） */
  parts: string[]
  hash: string
  /** 書く量の目安（文字数） */
  size: number
}

/** サロゲートペアの途中で切らないように分割する */
export function splitJson(json: string, size = CHUNK_CHARS): string[] {
  const parts: string[] = []
  let i = 0
  while (i < json.length) {
    let end = Math.min(json.length, i + size)
    const last = json.charCodeAt(end - 1)
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end -= 1
    parts.push(json.slice(i, end))
    i = end
  }
  return parts
}

export function encodeJson(json: string, chunkSize = CHUNK_CHARS): Encoded {
  const hash = hashJson(json)
  if (json.length <= chunkSize) return { json, parts: [], hash, size: json.length }
  return { json: null, parts: splitJson(json, chunkSize), hash, size: json.length }
}

export function encodeRecord(rec: Rec | null, chunkSize = CHUNK_CHARS): Encoded {
  if (!rec) return { json: null, parts: [], hash: '', size: 0 }
  return encodeJson(stableStringify(rec), chunkSize)
}

/**
 * 文書の JSON を取り出す（分割した文書は getChunk で分割文書を探す）。削除なら null。
 * 分割文書が揃わない・指紋が合わない時は undefined（読み直しが要る）
 */
export function decodeJson(doc: RecordDoc, getChunk: (index: number) => ChunkDoc | undefined): string | null | undefined {
  if (doc.deleted) return null
  let json = doc.json
  if (json === null) {
    if (!doc.chunks) return undefined
    const parts: string[] = []
    for (let i = 0; i < doc.chunks; i++) {
      const c = getChunk(i)
      if (!c || c.hash !== doc.hash) return undefined
      parts.push(c.json)
    }
    json = parts.join('')
  }
  if (hashJson(json) !== doc.hash) return undefined
  return json
}

/**
 * 文書からレコードを取り出す。分割した文書は getChunk で分割文書を探す。
 * 戻り値: レコード（削除なら null）。分割文書が揃わない・指紋が合わない時は undefined（読み直しが要る）。
 */
export function decodeRecord(doc: RecordDoc, getChunk: (index: number) => ChunkDoc | undefined): Rec | null | undefined {
  const json = decodeJson(doc, getChunk)
  if (json === null || json === undefined) return json
  try {
    const rec = JSON.parse(json) as Rec
    return rec && typeof rec === 'object' && rec.id === doc.id ? rec : undefined
  } catch {
    return undefined
  }
}
