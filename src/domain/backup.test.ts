// バックアップ（docs/SPEC.md の 6.16・形4）: 書き出し → 読み込みで同じ、MIM を含めない時（ゴミ箱の MIM・MIM の競合の控えも無い）、
// MIM を含まないファイルの読み込みで今の MIM とゴミ箱の MIM に触れない、受け取り箱が古い結果に戻らない、
// ほかのアプリ・新しい版・壊れた記録・id の合わない記録を断る、ファイル名
import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  backupJson,
  mimTrashIds,
  parseBackup,
  restoreData,
  toBackup,
} from './backup'
import { T0, dataWith, mkCheck, mkFavorite, mkInbox, mkItem, mkLabelName, mkMim, mkOffDay, mkRoutine } from './testData'
import { trashItem, trashMimNote } from './trash'
import { transact } from './tx'
import type { AppData } from './types'

const OPTS = { appVersion: '0.1', exportedAt: new Date(2026, 10, 10, 9, 0) }

/** MIM のメモ2枚（1枚はゴミ箱）と、MIM の同期の競合の控え（kind は mimNote でない形でも中身で見分ける）を持つデータ */
function sample(): AppData {
  let d = dataWith({
    items: [mkItem(), mkItem({ id: 'i2', title: '研修' })],
    offDays: [mkOffDay('2026-11-20')],
    labelNames: [mkLabelName('sky-l', '会議')],
    routines: [mkRoutine()],
    routineChecks: [mkCheck('r1', '2026-11', ['2026-11-10'])],
    favorites: [mkFavorite()],
    mimNotes: [mkMim(), mkMim({ id: 'm2', title: '銀行', secrets: [{ id: 's', name: '暗証番号', value: '1234' }] })],
    inbox: [mkInbox({ id: 'xa-1', op: 'add', table: 'favorites', targetId: 'cf-x', status: 'applied', appliedAt: T0 })],
  })
  d = trashItem(d, 'i2', { at: T0 }).data
  d = trashMimNote(d, 'm2', { at: T0 }).data
  // 同期の競合で残した MIM の内容（別の端末で消された m3 の、この端末の編集）
  d = transact(d, (tx) => {
    tx.put('trashRecords', {
      id: 'trc',
      entryId: 'tec',
      table: 'mimNotes',
      record: mkMim({ id: 'm3', body: 'パスワード: abc' }),
      createdAt: T0,
      updatedAt: T0,
    })
    tx.put('trashEntries', {
      id: 'tec',
      kind: 'mimNote',
      label: 'm3',
      place: 'MIM',
      origin: { index: 0 },
      recordIds: ['trc'],
      reason: 'conflict',
      by: 'user',
      ai: null,
      inboxId: null,
      deletedAt: T0,
      createdAt: T0,
      updatedAt: T0,
    })
  }).data
  return d
}

describe('書き出し（6.16）', () => {
  it('ファイルの形とファイル名', () => {
    const file = toBackup(sample(), { ...OPTS, includesMim: true })
    expect(file).toMatchObject({ format: 'diary-studio-backup', version: 1, appVersion: '0.1', includesMim: true })
    expect(file.exportedAt).toBe(OPTS.exportedAt.toISOString())
    expect(Object.keys(file.tables)).toEqual([
      'items',
      'offDays',
      'labelNames',
      'routines',
      'routineChecks',
      'favorites',
      'mimNotes',
      'inbox',
      'trashEntries',
      'trashRecords',
    ])
    expect(backupFileName(new Date(2026, 10, 10, 23, 59))).toBe('diary-studio-backup-2026-11-10.json')
  })

  it('書き出して読み込むと同じ（MIM を含める）', () => {
    const data = sample()
    const parsed = parseBackup(backupJson(data, { ...OPTS, includesMim: true }))
    expect(parsed.data).toEqual(data)
    expect(parsed).toMatchObject({ includesMim: true, appVersion: '0.1' })
  })

  it('MIM を含めない時は、MIM のメモとゴミ箱の MIM（消したメモ・同期の競合の控え）も入れない（形4）', () => {
    const data = sample()
    const file = toBackup(data, { ...OPTS, includesMim: false })
    expect('mimNotes' in file.tables).toBe(false)
    const json = JSON.stringify(file)
    expect(json).not.toContain('1234')
    expect(json).not.toContain('パスワード: abc')
    expect(json).not.toContain('p@ss')
    // ほかのゴミ箱の件（予定）は入る
    expect(Object.values(file.tables.trashEntries!).map((e) => e.kind)).toEqual(['event'])
    expect(Object.values(file.tables.trashRecords!).map((r) => r.table)).toEqual(['items'])
    // 渡したデータは書き換えない
    expect(Object.keys(data.mimNotes)).toEqual(['m1'])
    expect(mimTrashIds(data).entries.size).toBe(2)
  })
})

describe('読み込み（6.16）', () => {
  const ok = backupJson(sample(), { ...OPTS, includesMim: true })

  it('ほかのアプリ・新しい版・壊れた JSON を断る', () => {
    expect(() => parseBackup('{')).toThrow('JSON')
    expect(() => parseBackup(JSON.stringify({ app: 'novel-studio', schemaVersion: 4, data: {} }))).toThrow(
      'Diary Studio のバックアップファイルではありません',
    )
    const file = JSON.parse(ok)
    expect(() => parseBackup(JSON.stringify({ ...file, version: BACKUP_VERSION + 1 }))).toThrow('読み込めない')
    expect(() => parseBackup(JSON.stringify({ ...file, includesMim: 'yes' }))).toThrow('形式')
    expect(() => parseBackup(JSON.stringify({ ...file, tables: [] }))).toThrow('形式')
  })

  it('壊れた記録・id の合わない記録を断る', () => {
    const file = JSON.parse(ok)
    expect(() => parseBackup(JSON.stringify({ ...file, tables: { ...file.tables, items: { i1: { id: 'other' } } } }))).toThrow(
      'items に壊れた記録',
    )
    expect(() => parseBackup(JSON.stringify({ ...file, tables: { ...file.tables, favorites: [] } }))).toThrow(
      'favorites が壊れています',
    )
  })

  it('無い表は空として読む。知らない項目はそのまま（raw のまま返し、表示の時に直す）', () => {
    const file = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: '',
      appVersion: '0.2',
      includesMim: true,
      tables: { items: { i1: { ...mkItem(), kind: 'family' } } },
    }
    const parsed = parseBackup(JSON.stringify(file))
    expect(parsed.data.items.i1.kind).toBe('family')
    expect(parsed.data.routines).toEqual({})
  })

  it('MIM を含まないファイルに MIM が入っていても読まない', () => {
    const file = JSON.parse(backupJson(sample(), { ...OPTS, includesMim: true }))
    const parsed = parseBackup(JSON.stringify({ ...file, includesMim: false }))
    expect(parsed.data.mimNotes).toEqual({})
    expect(mimTrashIds(parsed.data).entries.size).toBe(0)
  })
})

describe('復元（6.16・形4）', () => {
  it('MIM を含むファイルは、今の MIM も置き換える', () => {
    const current = dataWith({ mimNotes: [mkMim({ body: '今の本文' })] })
    const parsed = parseBackup(backupJson(sample(), { ...OPTS, includesMim: true }))
    const { data, keep } = restoreData(current, parsed)
    expect(data.mimNotes.m1.body).toBe('受付の横')
    expect(keep).toEqual({ mimNotes: false, trashEntryIds: [], trashRecordIds: [] })
  })

  it('MIM を含まないファイルは、今の MIM とゴミ箱の中の MIM に一切触れない（ほかの端末で直したばかりのパスワードを上書きしない）', () => {
    const current = sample()
    current.mimNotes = {
      ...current.mimNotes,
      m1: mkMim({ secrets: [{ id: 's1', name: 'パスワード', value: '新しいパスワード' }] }),
    }
    const old = parseBackup(backupJson(dataWith({ items: [mkItem({ title: '古い予定' })] }), { ...OPTS, includesMim: false }))
    const { data, keep } = restoreData(current, old)
    expect(data.items.i1.title).toBe('古い予定')
    expect(data.mimNotes).toEqual(current.mimNotes)
    expect(data.mimNotes.m1.secrets[0].value).toBe('新しいパスワード')
    const mim = mimTrashIds(current)
    for (const id of mim.entries) expect(data.trashEntries[id]).toBe(current.trashEntries[id])
    for (const id of mim.records) expect(data.trashRecords[id]).toBe(current.trashRecords[id])
    expect(keep.mimNotes).toBe(true)
    expect(keep.trashEntryIds.sort()).toEqual([...mim.entries].sort())
    expect(keep.trashRecordIds.sort()).toEqual([...mim.records].sort())
  })

  it('古いバックアップで、当てた依頼が「待っています」に戻らない（受け取り箱は結果の強い方。今にだけある物も残す）', () => {
    const pending = mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-x' })
    const applied = { ...pending, status: 'applied' as const, appliedAt: T0, undo: { created: true as const, afterHash: 'h' } }
    const undone = { ...applied, undoneAt: T0 + 5 }
    const later = mkInbox({ id: 'xa-2', op: 'add', table: 'items', targetId: 'ce-y' })
    const old = parseBackup(backupJson(dataWith({ inbox: [pending] }), { ...OPTS, includesMim: true }))
    const { data } = restoreData(dataWith({ inbox: [undone, later] }), old)
    expect(data.inbox['xa-1']).toEqual(undone)
    expect(data.inbox['xa-2']).toEqual(later)
    // バックアップの方が強ければバックアップの組（元に戻した日時は入っている方）
    const { data: d2 } = restoreData(
      dataWith({ inbox: [{ ...pending, undoneAt: T0 + 9 }] }),
      parseBackup(backupJson(dataWith({ inbox: [applied] }), { ...OPTS, includesMim: true })),
    )
    expect(d2.inbox['xa-1']).toMatchObject({ status: 'applied', undoneAt: T0 + 9 })
  })
})
