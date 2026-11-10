// 月の束（docs/SPEC.md の 6.11）の純粋な部分。何年分も溜まっても、新しい端末で初めて全部を受け取る時の読み取りが1日の無料枠に
// 収まるよう、古い月の項目（items）をクラウドで月ごとの1文書（users/{uid}/records/itemPack:{YYYY-MM}）にまとめる。
// 端末の中の持ち方は変えない（束を受け取ったら中の項目をふつうの記録として受け取る）。NS には無い、新しく作る部分。
// 束の文書を読み書きする所（受け取る・束の中の項目を送る・まとめる・復元）は src/sync/engine.ts。
import { isDerivedId } from '../domain/derivedId'
import { monthOf, todayStr, monthsBefore, isMonth } from '../domain/dates'
import { stableStringify } from '../domain/equal'
import { itemPackMonth } from '../domain/items'
import type { ID, Item } from '../domain/types'
import { DAY_MS } from '../domain/util'
import { CHUNK_CHARS, PACK_TABLE, encodeRecord, splitDocId } from './codec'

export { PACK_TABLE }

/** 1回のトランザクションで書く文書の数の上限（束の文書・分けた文書・消す項目の文書を合わせて。Firestore の上限は 500） */
export const PACK_LIMIT = 450
/** 最後に直してから、この日数が過ぎた項目だけを束にまとめる */
export const PACK_AGE_MS = 60 * DAY_MS
/** 束にまとめる月: 今月のこの数か月前より前（今が 2026年11月なら 2026年7月まで） */
export const PACK_MONTHS_BACK = 3
/** 削除の印を片付けるまでの日数（それより前の削除の印の文書を本当に消す） */
export const TOMBSTONE_KEEP_MS = 90 * DAY_MS
/**
 * 最後に受け取った位置（サーバーの時刻）がこれより前の端末は、全部を受け取り直す（片付けの 90日より短くして、端末の時計のずれの分の
 * 余裕を見る）
 */
export const FULL_RESYNC_MS = 85 * DAY_MS

/** 束の文書の id（itemPack:{YYYY-MM}）の月。束の文書でなければ null */
export function packMonthOf(docId: string): string | null {
  const { table, id } = splitDocId(docId)
  return table === PACK_TABLE && isMonth(id) ? id : null
}

/** 束の中身（json）の形 */
export interface PackBody {
  month: string
  items: Record<ID, Item>
}

/** 束の JSON（キーを並べ替えた形。分割は src/sync/codec.ts の encodeJson） */
export function encodePack(body: PackBody): string {
  return stableStringify(body)
}

/**
 * 束の JSON を読む。形が違う・id の合わない項目がある時は undefined（読めない。「空の束」「消した束」と分ける。新しい版が書いた形の
 * 違う束を、古い版が「中の項目が消された」と読んで端末やクラウドから項目を消さないように）
 */
export function decodePack(json: string): PackBody | undefined {
  let v: unknown
  try {
    v = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!v || typeof v !== 'object') return undefined
  const o = v as { month?: unknown; items?: unknown }
  if (typeof o.month !== 'string' || !o.items || typeof o.items !== 'object' || Array.isArray(o.items)) return undefined
  const items: Record<ID, Item> = {}
  for (const [id, rec] of Object.entries(o.items as Record<string, unknown>)) {
    if (!rec || typeof rec !== 'object' || (rec as { id?: unknown }).id !== id) return undefined
    items[id] = rec as Item
  }
  return { month: o.month, items }
}

/** 束に項目を足す・抜く（新しい中身を返す。渡した中身は書き換えない） */
export function withItems(body: PackBody, items: readonly Item[]): PackBody {
  const next = { ...body.items }
  for (const it of items) next[it.id] = it
  return { month: body.month, items: next }
}

export function withoutItems(body: PackBody, ids: Iterable<ID>): PackBody {
  const next = { ...body.items }
  for (const id of ids) delete next[id]
  return { month: body.month, items: next }
}

/** 束にまとめてよい月の境（この月より前の月だけをまとめる） */
export function packBoundary(nowMs: number): string {
  return monthsBefore(monthOf(todayStr(nowMs)), PACK_MONTHS_BACK)
}

export interface PackCandidateOptions {
  now: number
  /** 送信待ちのある項目の id */
  queued: ReadonlySet<ID>
  /** もう束に入っている項目の id（端末の _pack） */
  packed: ReadonlySet<ID>
  chunkSize?: number
  /** 1回にまとめる項目の数の上限 */
  limit?: number
}

/**
 * 束にまとめる項目を月ごとに選ぶ（6.11 のまとめる条件）: 項目の月が今月の3か月前より前、最後に直してから 60日以上、送信待ちが無い、
 * まだ束に入っていない、分けた文書の要らない大きさ（2.4 の 25万字以下）。月の古い順・id の順に、全部で limit 件まで
 */
export function packCandidates(items: Iterable<Item>, opts: PackCandidateOptions): Map<string, Item[]> {
  const boundary = packBoundary(opts.now)
  const chunkSize = opts.chunkSize ?? CHUNK_CHARS
  const limit = opts.limit ?? PACK_LIMIT
  const picked: { month: string; item: Item }[] = []
  for (const it of items) {
    if (!it || typeof it.id !== 'string') continue
    if (opts.queued.has(it.id) || opts.packed.has(it.id)) continue
    const updatedAt = typeof it.updatedAt === 'number' ? it.updatedAt : 0
    if (opts.now - updatedAt < PACK_AGE_MS) continue
    const month = itemPackMonth(it)
    if (!isMonth(month) || month >= boundary) continue
    if (encodeRecord(it, chunkSize).parts.length > 0) continue
    picked.push({ month, item: it })
  }
  picked.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.item.id < b.item.id ? -1 : 1))
  const out = new Map<string, Item[]>()
  for (const { month, item } of picked.slice(0, limit)) {
    const list = out.get(month) ?? []
    list.push(item)
    out.set(month, list)
  }
  return out
}

/**
 * 1回のトランザクションに入れてよい項目の数（束の文書と分けた文書の分を引く）。束の中身が大きくて分けた文書が要る時は少なくなる
 */
export function itemsPerTransaction(packChars: number, chunkSize = CHUNK_CHARS): number {
  const packDocs = 1 + (packChars > chunkSize ? Math.ceil(packChars / chunkSize) : 0)
  return Math.max(0, PACK_LIMIT - packDocs)
}

/** 片付けない削除の印か（内容から作った id の items・favorites・routines。19.5 の previously_deleted のため。6.11） */
export function keepsTombstone(docId: string): boolean {
  const { table, id } = splitDocId(docId)
  return (table === 'items' || table === 'favorites' || table === 'routines') && isDerivedId(id)
}

/** 削除の印を片付ける境（これより前に書かれた削除の印を消す。ミリ秒） */
export function tombstoneCutoff(nowMs: number): number {
  return nowMs - TOMBSTONE_KEEP_MS
}

/** 最後に受け取った位置（サーバーの時刻の秒）が古すぎて、全部を受け取り直す端末か */
export function needsFullResync(cursorSeconds: number | null | undefined, nowMs: number): boolean {
  if (typeof cursorSeconds !== 'number' || !Number.isFinite(cursorSeconds)) return false
  return nowMs - cursorSeconds * 1000 > FULL_RESYNC_MS
}
