// 同期の部品（docs/SPEC.md の 2.4・6.10・6.11・18.4）: 文書の形（分割・parentTable・指紋が合わない時）、送るものの選び方
// （まとまりは全部か無し・内容から作った id の削除の印）、月の束の純粋な部分、競合の控え、同期の表示、アプリの版
import { describe, expect, it } from 'vitest'
import type { OutboxItem } from '../db/persistence'
import { mkFavorite, mkItem, mkMim, mkRoutine, dataWith, T0 } from '../domain/testData'
import { DAY_MS } from '../domain/util'
import pkgJson from '../../package.json?raw'
import { APP_VERSION } from './appVersion'
import { decideBatch, needsTombstone, nothingToSend, selectBatch, type BatchEntry } from './batch'
import {
  chunkIdOf,
  decodeRecord,
  docIdOf,
  encodeRecord,
  hashRecord,
  splitDocId,
  splitJson,
  type ChunkDoc,
  type RecordDoc,
} from './codec'
import { conflictTrash, deviceLabel } from './conflicts'
import { NO_CONNECTOR, parseConnectorDoc } from './engine'
import {
  PACK_LIMIT,
  decodePack,
  encodePack,
  itemsPerTransaction,
  keepsTombstone,
  needsFullResync,
  packBoundary,
  packCandidates,
  packMonthOf,
  withItems,
  withoutItems,
} from './packs'
import { syncViewOf } from './syncView'

const LIMITS = { chunkSize: 250_000, maxChars: 1_500_000, maxDocs: 400 }

function item(p: Partial<OutboxItem> & Pick<OutboxItem, 'table' | 'id'>): OutboxItem {
  return { k: `${p.table}/${p.id}`, base: null, noHistory: false, force: false, local: { id: p.id }, ...p }
}

describe('文書の形（codec）', () => {
  it('サロゲートペアの途中で切らずに分け、分けた文書から元に戻す', () => {
    const json = 'a'.repeat(9) + '😀' + 'b'.repeat(5)
    const parts = splitJson(json, 10)
    expect(parts.join('')).toBe(json)
    expect(parts[0].endsWith('\ud83d')).toBe(false)
    const rec = { id: 'x', memo: 'あ'.repeat(30) }
    const enc = encodeRecord(rec, 10)
    expect(enc.json).toBeNull()
    const doc: RecordDoc = {
      table: 'items',
      id: 'x',
      json: null,
      chunks: enc.parts.length,
      deleted: false,
      hash: enc.hash,
      updated: null,
      device: 'd',
    }
    const chunks = enc.parts.map(
      (json, index): ChunkDoc => ({
        table: '_chunk',
        parent: 'items:x',
        parentTable: 'items',
        index,
        json,
        hash: enc.hash,
        updated: null,
        device: 'd',
        deleted: false,
      }),
    )
    expect(decodeRecord(doc, (i) => chunks[i])).toEqual(rec)
    // 指紋が合わない・揃わない時は undefined（読み直す）
    expect(decodeRecord(doc, (i) => (i === 0 ? undefined : chunks[i]))).toBeUndefined()
    expect(decodeRecord({ ...doc, hash: 'x' }, (i) => chunks[i])).toBeUndefined()
    expect(decodeRecord({ ...doc, id: 'y' }, (i) => chunks[i])).toBeUndefined()
  })
  it('文書の id と表（コロンを含むチェックの記録の id も）', () => {
    expect(docIdOf('routineChecks', 'r1:2026-11')).toBe('routineChecks:r1:2026-11')
    expect(splitDocId('routineChecks:r1:2026-11')).toEqual({ table: 'routineChecks', id: 'r1:2026-11' })
    expect(chunkIdOf('items:x', 2)).toBe('items:x#2')
    expect(hashRecord(null)).toBe('')
  })
})

describe('送るものの選び方（batch）', () => {
  it('まとまりは全部書けるか1つも書かない', () => {
    const a = item({ table: 'items', id: 'ce-1', group: 'xa-1' })
    const b = item({ table: 'inbox', id: 'xa-1', group: 'xa-1', base: { id: 'xa-1' }, local: { id: 'xa-1', updatedAt: 2 } })
    const c = item({ table: 'favorites', id: 'f1' })
    const batch = selectBatch([a, b, c], LIMITS)
    expect(batch.map((e) => e.it.id)).toEqual(['ce-1', 'xa-1', 'f1'])
    const d = decideBatch(batch, [
      { exists: false, hash: '' },
      { exists: true, hash: 'other' },
      { exists: false, hash: '' },
    ])
    expect(d.write).toEqual([false, false, true])
    expect(d.conflicts.map((x) => x.id)).toEqual(['xa-1'])
  })
  it('まとまりは上限を超えても分けずに、それだけを送る', () => {
    const big = 'x'.repeat(600)
    const rows = [
      item({ table: 'items', id: 'ce-1', group: 'g', local: { id: 'ce-1', memo: big } as never }),
      item({ table: 'inbox', id: 'g', group: 'g', local: { id: 'g', memo: big } as never }),
      item({ table: 'favorites', id: 'f1' }),
    ]
    const batch = selectBatch(rows, { chunkSize: 250_000, maxChars: 1000, maxDocs: 400 })
    expect(batch.map((e: BatchEntry) => e.it.id)).toEqual(['ce-1', 'g'])
    expect(batch.every((e) => e.it.group === 'g')).toBe(true)
  })
  it('内容から作った id の記録を送る前に消した時は、クラウドに無くても削除の印を書く（19.5）', () => {
    const gone = item({ table: 'items', id: 'ce-abc.def.1', local: null })
    expect(needsTombstone(gone)).toBe(true)
    expect(nothingToSend(gone)).toBe(false)
    expect(selectBatch([gone], LIMITS)).toHaveLength(1)
    // 手で作った id は送らない（NS と同じ）
    const plain = item({ table: 'items', id: '5f0c-uuid', local: null })
    expect(nothingToSend(plain)).toBe(true)
    // 休み・MIM は内容から作る id を持たない
    expect(needsTombstone(item({ table: 'mimNotes', id: 'ce-abc', local: null }))).toBe(false)
  })
  it('共通の履歴が無いものは、クラウドに何も無い時だけ書く。復元は必ず上書き（復元の後にほかの端末が書いた物は base と比べる）', () => {
    const batch = selectBatch(
      [item({ table: 'items', id: 'a', noHistory: true }), item({ table: 'items', id: 'b', force: true })],
      LIMITS,
    )
    expect(
      decideBatch(batch, [
        { exists: true, hash: 'h' },
        { exists: true, hash: 'h' },
      ]).write,
    ).toEqual([false, true])
    expect(
      decideBatch(batch, [
        { exists: false, hash: '' },
        { exists: true, hash: 'h', fresh: true },
      ]).write,
    ).toEqual([true, false])
  })
})

describe('月の束（packs。6.11）', () => {
  const now = new Date(2026, 10, 10, 9, 0).getTime()
  const old = (id: string, p: Parameters<typeof mkItem>[0] = {}) =>
    mkItem({ id, start: '2026-07-31', updatedAt: now - 61 * DAY_MS, createdAt: now - 200 * DAY_MS, ...p })
  it('まとめる条件の境目: 2026年11月なら7月まで・60日・送信待ち・束にある物・大きな項目は除く', () => {
    expect(packBoundary(now)).toBe('2026-08')
    const items = [
      old('a'),
      old('b', { start: '2026-08-01' }),
      old('c', { updatedAt: now - 59 * DAY_MS }),
      old('d'),
      old('e'),
      old('f', { memo: 'x'.repeat(3000) }),
      // カレンダーに出ていないタスクは、済んだ日（無ければ作った日）の月
      mkItem({ id: 'g', origin: 'list', start: null, due: null, doneOn: '2026-05-02', updatedAt: now - 90 * DAY_MS }),
    ]
    const r = packCandidates(items, { now, queued: new Set(['d']), packed: new Set(['e']), chunkSize: 2000 })
    expect([...r.entries()].map(([m, list]) => [m, list.map((i) => i.id)])).toEqual([
      ['2026-05', ['g']],
      ['2026-07', ['a']],
    ])
  })
  it('1回に最大 450 件（束の文書と分けた文書の分を引く）', () => {
    const many = Array.from({ length: 500 }, (_, i) => old(`x${String(i).padStart(3, '0')}`))
    const r = packCandidates(many, { now, queued: new Set(), packed: new Set() })
    expect([...r.values()].flat()).toHaveLength(PACK_LIMIT)
    expect(itemsPerTransaction(100)).toBe(449)
    expect(itemsPerTransaction(600_000, 250_000)).toBe(450 - 1 - 3)
  })
  it('束の文書の形（{ month, items }）。足す・抜く・空になっても items: {}', () => {
    const body = withItems({ month: '2026-07', items: {} }, [old('a'), old('b')])
    const back = decodePack(encodePack(body))!
    expect(Object.keys(back.items)).toEqual(['a', 'b'])
    expect(withoutItems(back, ['a', 'b'])).toEqual({ month: '2026-07', items: {} })
    // 形の違う束・id の合わない項目のある束は読めない（undefined。空の束 {} とは分ける）
    expect(decodePack('{"month":"2026-07","items":{"x":{"id":"y"}}}')).toBeUndefined()
    expect(decodePack('{"month":"2026-07","items":[]}')).toBeUndefined()
    expect(decodePack('{"month":"2026-07","list":[]}')).toBeUndefined()
    expect(decodePack('壊れた')).toBeUndefined()
    expect(decodePack('{"month":"2026-07","items":{}}')).toEqual({ month: '2026-07', items: {} })
    expect(packMonthOf('itemPack:2026-07')).toBe('2026-07')
    expect(packMonthOf('items:2026-07')).toBeNull()
  })
  it('片付けない削除の印（内容から作った id）と、全部を受け取り直す端末（85日）', () => {
    expect(keepsTombstone('items:ce-abc.def.1')).toBe(true)
    expect(keepsTombstone('favorites:cf-abc')).toBe(true)
    expect(keepsTombstone('items:5f0c-uuid')).toBe(false)
    expect(keepsTombstone('offDays:2026-11-10')).toBe(false)
    expect(needsFullResync(now / 1000 - 86 * 86_400, now)).toBe(true)
    expect(needsFullResync(now / 1000 - 84 * 86_400, now)).toBe(false)
    expect(needsFullResync(null, now)).toBe(false)
  })
})

describe('競合の控え（conflicts）', () => {
  const data = dataWith({ favorites: [mkFavorite()], routines: [mkRoutine({ cycle: 'weekly' })] })
  it('中身の表は「同期の競合で残した内容」の1件にする（種類・場所は元の物）', () => {
    const r = conflictTrash(data, 'items', mkItem({ start: '2026-11-10' }), { now: T0, newId: () => 'n' + Math.random() })!
    expect(r.entry).toMatchObject({
      kind: 'event',
      reason: 'conflict',
      place: 'カレンダー 11/10（火） 仕事',
      by: 'user',
      inboxId: null,
    })
    expect(r.records).toHaveLength(1)
    expect(conflictTrash(data, 'routines', mkRoutine({ cycle: 'weekly' }), { now: T0, newId: () => 'r' })!.entry.place).toBe(
      'Routine List › 毎週',
    )
    expect(conflictTrash(data, 'mimNotes', mkMim(), { now: T0, newId: () => 'm' })!.entry.kind).toBe('mimNote')
    expect(conflictTrash(data, 'offDays', { id: '2026-11-10' }, { now: T0, newId: () => 'o' })).toBeNull()
  })
  it('端末の呼び名', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows')
    expect(deviceLabel('')).toBe('ブラウザ')
  })
})

describe('同期の表示（18.4 の8つ）', () => {
  const st = (p: Partial<Parameters<typeof syncViewOf>[0]['status'] & object> = {}) => ({
    status: { phase: 'synced' as const, pending: 0, lastSyncedAt: 1, error: null, ...p },
    owner: 'ok' as const,
  })
  const now = Date.UTC(2026, 10, 10, 0, 0)
  it('状態ごとの表示', () => {
    expect(syncViewOf(st(), now)).toEqual({ kind: 'synced' })
    expect(syncViewOf(st({ phase: 'uploading', pending: 2 }), now)).toEqual({ kind: 'sending' })
    expect(syncViewOf(st({ pending: 3 }), now)).toEqual({ kind: 'pending', count: 3 })
    expect(syncViewOf(st({ phase: 'downloading' }), now)).toEqual({ kind: 'downloading' })
    expect(syncViewOf(st({ phase: 'offline' }), now)).toEqual({ kind: 'offline' })
    expect(syncViewOf(st({ phase: 'error', errorCode: 'quota' }), now)).toMatchObject({ kind: 'quota' })
    expect(syncViewOf(st({ outdated: { model: 2, appVersion: '0.2' } }), now)).toEqual({ kind: 'outdated' })
    expect(syncViewOf(st({ phase: 'error', errorCode: 'permission-denied', error: '長い文' }), now)).toEqual({
      kind: 'error',
      reason: 'アクセスが拒否されました',
    })
  })
  it('持ち主の記録が無い時は「同期できません（持ち主の記録がまだありません）」（同期を始めていなくても）', () => {
    expect(syncViewOf({ status: null, owner: 'missing' }, now)).toEqual({ kind: 'error', reason: '持ち主の記録がまだありません' })
    expect(syncViewOf({ status: null, owner: 'ok' }, now)).toBeNull()
  })
})

describe('アプリの版', () => {
  it('package.json の version の x.y と揃っている', () => {
    const pkg = JSON.parse(pkgJson) as { version: string }
    expect(pkg.version.split('.').slice(0, 2).join('.')).toBe(APP_VERSION)
  })
})

describe('Claude との連携と許可（config/connector。19.6）', () => {
  const doc = {
    uid: 'connector-anon',
    pairing: 'p',
    pairedAt: { seconds: 1, nanoseconds: 0 },
    approvedOn: 'PC の Chrome',
    adds: true,
    edits: false,
    proposals: true,
    v: 1,
  }
  it('19.6 の平らな形で読み、連携が済んでいる時だけ linked', () => {
    expect(parseConnectorDoc(doc, 'owner')).toEqual({ linked: true, adds: true, edits: false, proposals: true })
    // 連携の途中（pairedAt・approvedOn が無い）・コネクタのアカウントが無い・持ち主のアカウント
    expect(parseConnectorDoc({ ...doc, pairedAt: null }, 'owner')).toEqual(NO_CONNECTOR)
    expect(parseConnectorDoc({ ...doc, approvedOn: undefined }, 'owner')).toEqual(NO_CONNECTOR)
    expect(parseConnectorDoc({ ...doc, uid: '' }, 'owner')).toEqual(NO_CONNECTOR)
    expect(parseConnectorDoc({ ...doc, uid: 'owner' }, 'owner')).toEqual(NO_CONNECTOR)
    // 前の仮の形（perms の中）は読まない
    expect(parseConnectorDoc({ linked: true, perms: { adds: true, edits: true, proposals: true } }, 'owner')).toEqual(
      NO_CONNECTOR,
    )
    // 許可は true の物だけ
    expect(parseConnectorDoc({ ...doc, adds: 'yes', proposals: 1 }, 'owner')).toMatchObject({ adds: false, proposals: false })
  })
})
