// テスト用の仮のクラウドと端末（docs/SPEC.md の 2.10）。同期エンジン（src/sync/engine.ts）と同じ規則で送受信する:
// - 送信: 送信待ちを readOutbox で読み、selectBatch・decideBatch（src/sync/batch.ts）で、クラウドの指紋が base と同じものだけを
//   1回の書き込み（同じ時刻）で書く。受け取り箱の依頼ごとのまとまりは全部書けるか1つも書かない。書くたびに送る書き込みの印
//   （cloud.marks）を書き、返事を受け取れなかった書き込みが届いていたかを、次の送信・受信でそれで確かめる
// - 受信: クラウドの書き込みを、オフラインから戻った最初はまとめて1回、その後は書き込みごとに1回ずつ applyRemote で反映する
// - バックアップからの復元: 送る前に（送っている途中に復元した時は、次の分を送る前に）、返事を受け取れなかった書き込みを印で確かめ、
//   この端末に無いクラウドのレコードを消し、「必ず上書き」の送信待ちは reset の印付きで書く
// - 端末内の保存・3者マージは本物（src/db/persistence.ts。fake-indexeddb）
// NS の src/test/fakeCloud.ts を写し、幕の知らせを外し、受け取り箱の当て方（依頼ごとのまとまり）を足した。月の束は扱わない（エミュレーターで確かめる）。
import {
  createPersistence,
  tableSendRank,
  type AuthoritativeKeep,
  type Change,
  type ConflictNote,
  type OutboxItem,
  type Persistence,
  type ReplaceOptions,
} from '../db/persistence'
import type { InboxContext, Touched } from '../domain/inbox'
import { repairData } from '../domain/repair'
import type { AppData } from '../domain/types'
import { newId } from '../domain/util'
import { decideBatch, nothingToSend, sameAsBase, selectBatch, type BatchEntry } from '../sync/batch'
import { hashRecord, type Rec } from '../sync/codec'
import { createConflictHooks } from '../sync/conflicts'
import { stableStringify } from '../sync/merge'

interface CloudDoc {
  table: string
  id: string
  record: Rec | null
  hash: string
  ts: number
  device: string
  /** 復元・すべて削除で書いた（その内容を正とする） */
  reset?: boolean
}

export class FakeCloud {
  docs = new Map<string, CloudDoc>()
  /** 送る書き込みの印（端末 → その端末の最後に届いた送る書き込みの id。エンジンの users/{uid}/sync/{端末の ID}） */
  marks = new Map<string, string>()
  ts = 0
  /** 書き込みの記録（失敗した時の説明用） */
  log: string[] = []

  /** コネクタと同じく記録を置く（device: ds-connector） */
  put(table: string, rec: Rec, device = 'ds-connector'): void {
    const ts = ++this.ts
    this.docs.set(`${table}:${rec.id}`, { table, id: rec.id, record: rec, hash: hashRecord(rec), ts, device })
    this.log.push(`${device}@${ts}: 置いた ${table}:${rec.id.slice(0, 6)}`)
  }
}

let seq = 0

const PERMS = { linked: true, adds: true, edits: true, proposals: true }

export class FakeDevice {
  readonly p: Persistence
  /** 受け取った位置（クラウドの書き込みの時刻） */
  cursor = 0
  /** オフラインから戻った後、まだまとめて受け取っていない */
  catchingUp = false
  notes: ConflictNote[] = []
  private sent = new Map<string, string[]>()
  /** 送る書き込みの印で最後に確かめた値（エンジンの lastLanded） */
  private lastLanded: string | null = null
  private attempts = 0

  constructor(
    readonly name: string,
    readonly cloud: FakeCloud,
  ) {
    this.p = createPersistence(`fake-${name}-${++seq}-${Math.random().toString(36).slice(2)}`)
  }

  load(): Promise<AppData> {
    return this.p.load()
  }

  private async hooks() {
    const before = repairData(await this.p.load()).data
    return createConflictHooks({ device: this.name, data: () => before, newId, report: (n) => this.notes.push(n) })
  }

  async edit(fn: (d: AppData) => AppData): Promise<void> {
    const prev = await this.p.load()
    await this.p.save(prev, fn(prev), await this.hooks())
  }

  /** 受け取り箱の当て方を raw に当てて、依頼ごとのまとまりで保存する（ストアの commitRaw と同じ） */
  async inbox(fn: (d: AppData, ctx: InboxContext) => { data: AppData; touched: Touched }, now = Date.now()): Promise<void> {
    const prev = await this.p.load()
    const gone = await this.p.goneKeys()
    const r = fn(prev, { now, perms: PERMS, isGone: (t, id) => gone.has(`${t}/${id}`) })
    await this.p.save(prev, r.data, await this.hooks(), { groups: r.touched })
  }

  /** バックアップからの復元（次に送る時に、クラウドもこの内容に揃える） */
  async restore(data: AppData, opts?: ReplaceOptions): Promise<void> {
    if (!(await this.p.getMeta('uid'))) await this.p.setMeta('uid', 'fake-user')
    await this.p.replaceAll(data, opts)
  }

  /** エンジンの pushAuthoritative と同じ: 復元の後、この端末に無いクラウドのレコードを、子から先に消す */
  async pushAuthoritative(): Promise<void> {
    const stamp = await this.p.getMeta<unknown>('authoritative')
    if (!stamp) return
    // エンジンと同じ: 復元の前に送って返事を受け取れなかった書き込みが届いていたら、送った内容を base にしておく
    await this.confirmLanded([...(await this.p.outboxKeys())])
    const local = await this.p.localKeys()
    const keep = (await this.p.getMeta<AuthoritativeKeep | null>('authoritativeKeep')) ?? {
      tables: ['inbox'],
      keys: [],
      mimTrash: false,
    }
    let from = await this.p.getMeta<number>('authoritativeFrom')
    if (from == null) {
      from = this.cloud.ts
      // エンジンと同じ: 境は、印がまだこの復元の物の時だけ書く（1つのトランザクション）。次の復元が入っていたら、その内容で当て直す
      if (!(await this.p.setAuthoritativeFrom(stamp, from))) return this.pushAuthoritative()
    }
    const bound = from
    const rank = (key: string) => tableSendRank(key.slice(0, key.indexOf(':')))
    const doomed = [...this.cloud.docs.entries()]
      .filter(([, d]) => {
        const k = `${d.table}/${d.id}`
        return d.record && !local.has(k) && d.ts <= bound && !keep.tables.includes(d.table as never) && !keep.keys.includes(k)
      })
      .map(([key]) => key)
      .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    if (doomed.length) {
      const ts = ++this.cloud.ts
      for (const key of doomed) {
        const d = this.cloud.docs.get(key)!
        this.cloud.docs.set(key, { ...d, record: null, hash: hashRecord(null), ts, device: this.name, reset: true })
      }
      this.cloud.log.push(`${this.name}@${ts}: 復元で消した ${doomed.join(' ')}`)
    }
    // エンジンと同じ: 当てている間にもう一度復元した時は、印を残したまま、その内容で当て直す（比べるのと外すのは1つのトランザクション）
    if (!(await this.p.finishAuthoritative(stamp))) return this.pushAuthoritative()
  }

  /** 復元を始めた時の時刻（エンジンの restoreBound） */
  private restoreFrom: number | null = null

  /** オフラインにする（戻った最初の受信は、それまでの書き込みをまとめて受け取る） */
  offline(): void {
    this.catchingUp = true
  }

  /**
   * エンジンの uploadBatch と同じ: 1回分を送る。
   * replyLost = 書き込みはクラウドに届いたが、返事を受け取れなかった: 送った記録（completeUpload・送った版の指紋）を残さない
   */
  async uploadBatch(opts: { replyLost?: boolean } = {}): Promise<{ done: boolean; progressed: number; conflicts: OutboxItem[] }> {
    const items = await this.p.readOutbox(100)
    if (!items.length) return { done: true, progressed: 0, conflicts: [] }
    const idle = items.filter(nothingToSend)
    if (idle.length) await this.p.completeUpload(idle.map((it) => ({ table: it.table, id: it.id, record: it.local })))
    const given = selectBatch(items, { chunkSize: 250_000, maxChars: 1_500_000, maxDocs: 400 })
    if (!given.length) return { done: false, progressed: idle.length, conflicts: [] }
    // エンジンと同じ: 送る書き込みの印が前に返事を受け取れなかった書き込みなら、その時に送った内容を base にしてから決める
    const attempt = `${this.name}-tx-${++this.attempts}`
    const landed = this.cloud.marks.get(this.name) ?? null
    if (landed && landed !== this.lastLanded) {
      await this.p.confirmLanded(landed)
      this.lastLanded = landed
    }
    const batch: BatchEntry[] = given.map((b) =>
      landed && b.it.tx === landed
        ? {
            ...b,
            it: { ...b.it, base: b.it.sent ?? null, noHistory: false, force: false, unconfirmed: false, tx: undefined },
            baseHash: hashRecord(b.it.sent ?? null),
          }
        : b,
    )
    const clouds = batch.map((b) => this.cloud.docs.get(`${b.it.table}:${b.it.id}`))
    const from = batch.some((b) => b.it.force) ? ((await this.p.getMeta<number>('authoritativeFrom')) ?? null) : null
    const decision = decideBatch(
      batch,
      clouds.map((c) => ({
        exists: Boolean(c),
        hash: c?.record ? c.hash : '',
        fresh: Boolean(c && c.device !== this.name && from !== null && c.ts > from),
      })),
    )
    const marks = batch.filter((b, i) => decision.write[i] && !sameAsBase(b.it)).map((b) => ({ key: b.it.k, record: b.it.local }))
    if (marks.length) await this.p.markUnconfirmed(marks, attempt)
    const ts = ++this.cloud.ts
    const written: Change[] = []
    const settled: Change[] = []
    batch.forEach((b, i) => {
      if (!decision.write[i]) return
      if (sameAsBase(b.it)) {
        settled.push({ table: b.it.table, id: b.it.id, record: b.it.local })
        return
      }
      const key = `${b.it.table}:${b.it.id}`
      const hash = hashRecord(b.it.local)
      this.cloud.docs.set(key, {
        table: b.it.table,
        id: b.it.id,
        record: b.it.local,
        hash,
        ts,
        device: this.name,
        ...(b.it.force ? { reset: true } : {}),
      })
      if (!opts.replyLost) {
        const list = this.sent.get(key) ?? []
        list.push(hash)
        this.sent.set(key, list.slice(-20))
      }
      written.push({ table: b.it.table, id: b.it.id, record: b.it.local })
    })
    if (marks.length) this.cloud.marks.set(this.name, attempt)
    this.cloud.log.push(
      `${this.name}@${ts}: 書いた ${written.map((w) => `${w.table}:${w.id.slice(0, 6)}${w.record ? '' : '(削除)'}`).join(' ')}` +
        (decision.conflicts.length ? ` | 書けなかった ${decision.conflicts.map((c) => c.k).join(' ')}` : '') +
        (opts.replyLost ? '（返事を受け取れなかった）' : ''),
    )
    if (opts.replyLost) return { done: false, progressed: 0, conflicts: [] }
    if (marks.length) this.lastLanded = attempt
    await this.p.completeUpload([...written, ...settled])
    return { done: false, progressed: idle.length + written.length + settled.length, conflicts: decision.conflicts }
  }

  private staleEcho(key: string, d: CloudDoc): boolean {
    if (d.device !== this.name) return false
    const list = this.sent.get(key)
    if (!list || !list.includes(d.hash)) return false
    if (list[list.length - 1] === d.hash) {
      this.sent.set(key, [d.hash])
      return false
    }
    this.sent.set(key, list.slice(list.lastIndexOf(d.hash) + 1))
    return true
  }

  private changeOf(key: string, d: CloudDoc): Change | null {
    if (this.staleEcho(key, d)) return null
    return {
      table: d.table as Change['table'],
      id: d.id,
      record: d.record as Change['record'],
      ...(d.device === this.name ? { own: true } : {}),
      ...(d.reset && d.ts > this.cursor ? { reset: true } : {}),
      ...(d.device !== this.name && this.restoreFrom !== null && d.ts > this.restoreFrom ? { afterRestore: true } : {}),
    }
  }

  /** エンジンの confirmLandedKeys と同じ: keys の送信待ちのうち返事を受け取れなかった物の書き込みが、届いていたら送り終わりにする */
  private async confirmLanded(keys: string[]): Promise<void> {
    const txs = await this.p.unconfirmedTx(keys)
    const landed = this.cloud.marks.get(this.name)
    if (landed && txs.has(landed)) {
      await this.p.confirmLanded(landed)
      this.lastLanded = landed
    }
  }

  private async apply(changes: Change[], cursor: number | undefined, direct = false): Promise<Change[] | null> {
    // エンジンの confirmLandedFor と同じ: 返事を受け取れなかった書き込みの送信待ちに当たる変化は、印を読んで確かめてから
    await this.confirmLanded(changes.map((c) => `${c.table}/${c.id}`))
    return this.p.applyRemote(changes, { cursor, ...(await this.hooks()), ...(direct ? { direct: true } : {}) })
  }

  /** 受け取っていない書き込みを反映する。戻った最初はまとめて、その後は書き込みごとに */
  async receive(): Promise<boolean> {
    this.restoreFrom = (await this.p.getMeta<number>('authoritativeFrom')) ?? null
    const docs = [...this.cloud.docs.entries()]
      .filter(([, d]) => d.ts > this.cursor)
      .sort((a, b) => a[1].ts - b[1].ts || (a[0] < b[0] ? -1 : 1))
    if (!docs.length) return false
    const groups: [string, CloudDoc][][] = []
    if (this.catchingUp) groups.push(docs)
    else {
      for (const e of docs) {
        const last = groups[groups.length - 1]
        if (last && last[0][1].ts === e[1].ts) last.push(e)
        else groups.push([e])
      }
    }
    this.catchingUp = false
    for (const g of groups) {
      const changes = g.map(([k, d]) => this.changeOf(k, d)).filter((c): c is Change => c !== null)
      const cursor = g[g.length - 1][1].ts
      if ((await this.apply(changes, cursor > this.cursor ? cursor : undefined)) === null) return false
      this.cursor = Math.max(this.cursor, cursor)
    }
    return true
  }

  /** エンジンの pullDirectly と同じ: 書けなかったものだけをクラウドから直接読んで反映する */
  async pullDirectly(items: OutboxItem[]): Promise<void> {
    this.restoreFrom = (await this.p.getMeta<number>('authoritativeFrom')) ?? null
    const changes: Change[] = []
    for (const it of items) {
      const key = `${it.table}:${it.id}`
      const d = this.cloud.docs.get(key)
      if (!d) {
        changes.push({ table: it.table, id: it.id, record: null })
        continue
      }
      const c = this.changeOf(key, d)
      if (c) changes.push(c)
    }
    if (changes.length) await this.apply(changes, undefined, true)
  }

  /** エンジンの uploadAll と同じ: 送り終わるまで送る。書けなければ受信してから送り直す */
  async sync(): Promise<void> {
    let stuck = 0
    for (let round = 0; round < 50; round++) {
      // エンジンと同じ: 送っている間に復元した時も、次の分を送る前にクラウドに当てる
      await this.pushAuthoritative()
      const r = await this.uploadBatch()
      if (r.done) break
      if (r.conflicts.length && r.progressed === 0) {
        stuck += 1
        const got = await this.receive()
        if (!got && stuck >= 3) await this.pullDirectly(r.conflicts)
        if (stuck > 6) throw new Error(`${this.name}: クラウドとの差を解消できませんでした\n${this.cloud.log.join('\n')}`)
      } else stuck = 0
    }
    await this.receive()
  }
}

/** 両方の端末の送信待ちが空になり、クラウドの書き込みをすべて受け取るまで送受信する */
export async function settle(...ds: FakeDevice[]): Promise<void> {
  for (let round = 0; round < 20; round++) {
    for (const d of ds) await d.sync()
    const counts = await Promise.all(ds.map((d) => d.p.outboxCount()))
    if (counts.every((c) => c === 0) && ds.every((d) => d.cursor === d.cloud.ts || !hasNewer(d))) return
  }
  const rows = await Promise.all(ds.map(async (d) => `${d.name}: ${JSON.stringify(await d.p.readOutbox(5)).slice(0, 800)}`))
  throw new Error(`揃いませんでした\n${rows.join('\n')}\n${ds[0].cloud.log.join('\n')}`)
}

function hasNewer(d: FakeDevice): boolean {
  for (const doc of d.cloud.docs.values()) if (doc.ts > d.cursor) return true
  return false
}

/** 2台の端末の内容が同じか */
export async function sameData(a: FakeDevice, b: FakeDevice): Promise<boolean> {
  return stableStringify(await a.load()) === stableStringify(await b.load())
}
