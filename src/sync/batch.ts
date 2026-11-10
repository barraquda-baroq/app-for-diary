// 1回のトランザクションで送るものを選び（selectBatch）、クラウドの内容と突き合わせて書くものを決める（decideBatch）。
// 純粋関数（エンジンと、テスト用の仮のクラウドの両方で使う）。NS の src/sync/batch.ts を写し、2.8 の追記の依頼の扱いを外した。
// - 送信待ちは1件ずつ、クラウド側が前回揃えた時（base）から変わっていない時だけ書く
// - 受け取り箱の依頼ごとのまとまり（OutboxItem.group。依頼を当てて作った・直した記録・ゴミ箱の件・受け取り箱の記録）は、
//   全部を書けるか、1つも書かないか（ほかの端末が、記録だけが届いて依頼がまだ「待っています」の途中の状態を見て、同じ依頼を
//   duplicate で断らないように。6.10・19.5）。まとまりは、大きくても分けて送らない
// - 内容から作った id（ce-・ct-・cf-・cr-）の記録を消した時は、クラウドにまだ無くても削除の印を書く（19.5。作ってすぐ消した物も、
//   同じ依頼から足し直されないように）
import type { OutboxItem } from '../db/persistence'
import { isDerivedId } from '../domain/derivedId'
import { encodeRecord, hashRecord, type Encoded } from './codec'
import { deepEqual } from './merge'

export interface BatchEntry {
  it: OutboxItem
  enc: Encoded
  baseHash: string
}

export interface BatchLimits {
  chunkSize: number
  /** 1回に書く量の上限（文字数） */
  maxChars: number
  /** 1回に書く文書の数の上限 */
  maxDocs: number
}

/** 内容から作る id を使う表（19.4） */
const DERIVED_TABLES: ReadonlySet<string> = new Set(['items', 'favorites', 'routines'])

/** クラウドに無くても削除の印を書く送信待ち（内容から作った id の記録を、送る前に消した。19.5） */
export const needsTombstone = (it: OutboxItem): boolean =>
  !it.force && !it.noHistory && it.local === null && it.base === null && DERIVED_TABLES.has(it.table) && isDerivedId(it.id)

/** 端末内の内容が、最後に知ったクラウドの内容と同じ（この端末にもクラウドにも無いもの・クラウドと全く同じもの） */
export const sameAsBase = (it: OutboxItem): boolean =>
  !it.force && !needsTombstone(it) && (it.noHistory ? it.local === null : deepEqual(it.local, it.base))

/**
 * 送る必要が無い送信待ち。送ったトランザクションの返事を受け取っていない行（unconfirmed）は、書き込みがクラウドに
 * 届いているかもしれないので、端末内が base と同じでも外さない（送る時にクラウドを読んで確かめ、同じなら書かずに終える。
 * 返事の無い書き込みで作ったものをその後に消した時、クラウドに残った版が受信で戻ってこないように）
 */
export const nothingToSend = (it: OutboxItem): boolean => !it.unconfirmed && sameAsBase(it)

const docsOf = (e: BatchEntry) => 1 + e.enc.parts.length

/**
 * 送るものを選ぶ。readOutbox が返した順（まとまりは続けて並ぶ）に、上限に収まるだけ取る。
 * まとまりは分けずに取る（入らなければ次の回へ。まとまりだけで上限を超える時も、分けずにそのまとまりだけを送る）。
 */
export function selectBatch(items: readonly OutboxItem[], limits: BatchLimits): BatchEntry[] {
  const blocks: BatchEntry[][] = []
  for (const it of items) {
    if (nothingToSend(it)) continue
    const entry: BatchEntry = { it, enc: encodeRecord(it.local, limits.chunkSize), baseHash: hashRecord(it.base) }
    const last = blocks[blocks.length - 1]
    if (it.group && last && last[0].it.group === it.group) last.push(entry)
    else blocks.push([entry])
  }
  const out: BatchEntry[] = []
  let chars = 0
  let docs = 0
  const fits = (block: BatchEntry[]) => {
    const c = block.reduce((n, e) => n + e.enc.size, 0)
    const d = block.reduce((n, e) => n + docsOf(e), 0)
    return chars + c <= limits.maxChars && docs + d <= limits.maxDocs
  }
  const take = (block: BatchEntry[]) => {
    for (const e of block) {
      out.push(e)
      chars += e.enc.size
      docs += docsOf(e)
    }
  }
  for (const block of blocks) {
    if (fits(block)) {
      take(block)
      continue
    }
    if (out.length) break
    // 1件だけで上限を超える（分割文書に分けて送る大きなレコード）・まとまりだけで上限を超える: それだけを送る
    if (block.length > 1) console.warn('受け取り箱の依頼のまとまりが大きいため、まとまりだけを送ります')
    take(block)
    break
  }
  return out
}

/** クラウド側の文書の状態（無い = exists: false。削除の印なら hash は ''） */
export interface CloudState {
  exists: boolean
  hash: string
  /**
   * この端末のバックアップからの復元・すべて削除を始めた後に、ほかの端末が書いた。「必ず上書き」でも上書きせず、
   * base と比べる（違えば書かずに、受信で 3者マージしてから送る）
   */
  fresh?: boolean
}

export interface BatchDecision {
  /** batch と同じ順に、書くかどうか */
  write: boolean[]
  /** クラウド側が先に変わっていて書けなかったもの（まとまりのほかの項目は含めない） */
  conflicts: OutboxItem[]
}

/**
 * 書くものを決める。1件ずつ、共通の履歴が無いものはクラウドに何も無い時、ほかは base の指紋がクラウドと同じ時に書く
 * （復元・すべて削除の後は必ず上書き。ただし復元を始めた後にほかの端末が書いたもの（fresh）は base と比べる）。
 * まとまりは、全部を書ける時だけ書く。
 */
export function decideBatch(batch: readonly BatchEntry[], cloud: readonly CloudState[]): BatchDecision {
  const ok = batch.map((b, i) => {
    const c = cloud[i]
    if (b.it.force && !c.fresh) return true
    if (b.it.noHistory) return !c.exists
    return (c.exists ? c.hash : '') === b.baseHash
  })
  const heldGroups = new Set<string>()
  batch.forEach((b, i) => {
    if (!ok[i] && b.it.group) heldGroups.add(b.it.group)
  })
  const write = batch.map((b, i) => ok[i] && !(b.it.group && heldGroups.has(b.it.group)))
  const conflicts = batch.filter((_, i) => !ok[i]).map((b) => b.it)
  return { write, conflicts }
}
