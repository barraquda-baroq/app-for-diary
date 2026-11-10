// ゴミ箱（docs/SPEC.md の 6.15・18.2）: 種類ごとに入れる・戻す、Task List とカレンダーの両方に戻る、ルーチンとチェックの記録、
// 30日の境目、内容から作った id は同じ id があれば戻さない、競合の控えの戻し方、依頼の id から決めた id、札
import { describe, expect, it } from 'vitest'
import { isInTaskList, isOnCalendar } from './items'
import { DAY, T0, dataWith, mkCheck, mkFavorite, mkInbox, mkItem, mkMim, mkRoutine, mkTask } from './testData'
import {
  TRASH_RETENTION_MS,
  deleteTrashEntry,
  describeForTrash,
  emptyTrash,
  inboxTrashIds,
  isInTrash,
  isTrashExpired,
  listTrash,
  purgeExpiredTrash,
  putInTrash,
  restoreTrashEntry,
  trashBadge,
  trashContents,
  trashDaysLeft,
  trashDoneFavorites,
  trashFavorite,
  trashItem,
  trashMimNote,
  trashRoutine,
} from './trash'
import { transact } from './tx'
import { DomainError, type AppData } from './types'

describe('入れる（種類・名前・場所）', () => {
  it('カレンダーに出ていた項目は「予定」、場所は「カレンダー 11/10（火） 仕事」', () => {
    const data = dataWith({ items: [mkItem({ listed: true })] })
    const { data: next, result } = trashItem(data, 'i1', { at: T0 })
    expect(next.items.i1).toBeUndefined()
    expect(next.trashEntries[result]).toMatchObject({
      kind: 'event',
      label: '定例会議',
      place: 'カレンダー 11/10（火） 仕事',
      reason: 'deleted',
      by: 'user',
      ai: null,
      inboxId: null,
      deletedAt: T0,
    })
    expect(trashContents(next, next.trashEntries[result]).map((r) => r.record)).toEqual([data.items.i1])
    expect(isInTrash(next, 'items', 'i1')).toBe(true)
  })

  it('カレンダーに出ていなかった項目は「タスク」で「Task List」。プライベートの予定の場所', () => {
    const t = trashItem(dataWith({ items: [mkTask({ start: '2026-11-10' })] }), 't1')
    expect(t.data.trashEntries[t.result]).toMatchObject({ kind: 'task', place: 'Task List', label: '見積書を出す' })
    const p = trashItem(dataWith({ items: [mkItem({ kind: 'private', start: '2026-11-15' })] }), 'i1')
    expect(p.data.trashEntries[p.result].place).toBe('カレンダー 11/15（日） プライベート')
  })

  it('やりたいこと・済みを片付ける・MIM のメモ', () => {
    const data = dataWith({
      favorites: [
        mkFavorite({ id: 'a', order: 0 }),
        mkFavorite({ id: 'b', order: 1, done: true, doneAt: T0 }),
        mkFavorite({ id: 'c', order: 2, done: true, doneAt: T0, text: '旅行\n京都' }),
      ],
      mimNotes: [mkMim()],
    })
    const f = trashFavorite(data, 'a')
    expect(f.data.trashEntries[f.result]).toMatchObject({
      kind: 'favorite',
      place: 'Favorite List',
      origin: { index: 0, prevId: null },
    })
    const done = trashDoneFavorites(data)
    expect(done.result.count).toBe(2)
    const entry = done.data.trashEntries[done.result.entryId]
    expect(entry).toMatchObject({ kind: 'favoritesDone', label: '済みのやりたいこと（2件）', place: 'Favorite List' })
    expect(entry.recordIds).toHaveLength(2)
    expect(Object.keys(done.data.favorites)).toEqual(['a'])
    expect(() => trashDoneFavorites(dataWith({ favorites: [mkFavorite()] }))).toThrow(DomainError)
    const m = trashMimNote(data, 'm1')
    expect(m.data.trashEntries[m.result]).toMatchObject({ kind: 'mimNote', place: 'MIM', label: '会社の Wi-Fi' })
  })

  it('ルーチンはチェックの記録ごと入る（場所は「Routine List › 毎週」）', () => {
    const data = dataWith({
      routines: [mkRoutine({ id: 'r1', cycle: 'weekly' }), mkRoutine({ id: 'r2', cycle: 'weekly', order: 1 })],
      routineChecks: [
        mkCheck('r1', '2026-10', ['2026-10-30']),
        mkCheck('r1', '2026-11', ['2026-11-02']),
        mkCheck('r2', '2026-11', ['2026-11-03']),
      ],
    })
    const { data: next, result } = trashRoutine(data, 'r1')
    expect(next.trashEntries[result]).toMatchObject({
      kind: 'routine',
      place: 'Routine List › 毎週',
      origin: { index: 0, prevId: null },
    })
    expect(trashContents(next, next.trashEntries[result]).map((r) => r.table)).toEqual([
      'routines',
      'routineChecks',
      'routineChecks',
    ])
    expect(Object.keys(next.routineChecks)).toEqual(['r2:2026-11'])
  })

  it('依頼・提案で移す時の id は te-{id}・tr-{id}・tr-{id}-{i}（2台が同じ依頼を当てても1件）', () => {
    const data = dataWith({ routines: [mkRoutine()], routineChecks: [mkCheck('r1', '2026-11', ['2026-11-10'])] })
    const ids = inboxTrashIds('xe-1')
    expect(ids.entry).toBe('te-xe-1')
    const a = trashRoutine(data, 'r1', { at: T0, by: 'connector', ai: 'claude', inboxId: 'xe-1', ids })
    const b = trashRoutine(data, 'r1', { at: T0, by: 'connector', ai: 'claude', inboxId: 'xe-1', ids })
    expect(a.result).toBe('te-xe-1')
    expect(Object.keys(a.data.trashRecords).sort()).toEqual(['tr-xe-1', 'tr-xe-1-1'])
    expect(a.data.trashEntries['te-xe-1']).toEqual(b.data.trashEntries['te-xe-1'])
    expect(a.data.trashEntries['te-xe-1']).toMatchObject({ by: 'connector', ai: 'claude', inboxId: 'xe-1' })
  })

  it('札は「Claude の依頼」か「Claude の提案」（提案に会話で答えた依頼も提案）。作者が消した物には付けない', () => {
    const base = dataWith({ items: [mkItem()] })
    const byUser = trashItem(base, 'i1')
    expect(trashBadge(byUser.data.trashEntries[byUser.result], {})).toBeNull()
    const req = trashItem(base, 'i1', { by: 'connector', ai: 'claude', inboxId: 'xe-1' })
    const entry = req.data.trashEntries[req.result]
    const inbox = {
      'xe-1': mkInbox({ id: 'xe-1', op: 'trash', table: 'items', targetId: 'i1' }),
      'xe-2': mkInbox({ id: 'xe-2', op: 'trash', table: 'items', targetId: 'i1', proposalId: 'xp-1' }),
      'xp-1': mkInbox({ id: 'xp-1', op: 'propose', proposeOp: 'trash', table: 'items', targetId: 'i1' }),
    }
    expect(trashBadge(entry, inbox)).toBe('Claude の依頼')
    expect(trashBadge({ ...entry, inboxId: 'xe-2' }, inbox)).toBe('Claude の提案')
    expect(trashBadge({ ...entry, inboxId: 'xp-1' }, inbox)).toBe('Claude の提案')
    // 受け取り箱の記録が先に消えていたら「Claude の依頼」
    expect(trashBadge({ ...entry, inboxId: 'xp-gone' }, {})).toBe('Claude の依頼')
  })

  it('同期の競合の控えの種類・場所（相手の端末で消された記録）', () => {
    const data = dataWith({ routines: [mkRoutine({ id: 'r2', cycle: 'monthly', order: 0 })] })
    const gone = mkRoutine({ id: 'r1', cycle: 'monthly', order: 5 })
    expect(describeForTrash(data, 'routines', gone)).toEqual({
      kind: 'routine',
      label: '朝の体操',
      place: 'Routine List › 毎月',
      origin: { index: 5 },
    })
    expect(describeForTrash(data, 'items', mkTask()).kind).toBe('task')
  })
})

describe('期限（30日）・一覧・完全に削除', () => {
  const data = trashItem(dataWith({ items: [mkItem()] }), 'i1', { at: T0 }).data
  const entry = Object.values(data.trashEntries)[0]

  it('30日の境目（ちょうど 30日で完全に削除）・残りの日数', () => {
    expect(isTrashExpired(entry, T0 + TRASH_RETENTION_MS - 1)).toBe(false)
    expect(isTrashExpired(entry, T0 + TRASH_RETENTION_MS)).toBe(true)
    expect(trashDaysLeft(entry, T0)).toBe(30)
    expect(trashDaysLeft(entry, T0 + 29 * DAY + 1)).toBe(1)
    expect(trashDaysLeft(entry, T0 + 30 * DAY)).toBe(0)
    expect(trashDaysLeft(entry, T0 - 5 * DAY)).toBe(30)
    expect(purgeExpiredTrash(data, T0 + TRASH_RETENTION_MS - 1)).toBe(data)
    const purged = purgeExpiredTrash(data, T0 + TRASH_RETENTION_MS)
    expect(purged.trashEntries).toEqual({})
    expect(purged.trashRecords).toEqual({})
  })

  it('件の無い中身は期限切れの片付けでは消さない（同期で中身が先に届くことがある）', () => {
    const orphan = { ...data, trashEntries: {}, trashRecords: { ...data.trashRecords } }
    expect(purgeExpiredTrash(orphan, T0 + 40 * DAY)).toBe(orphan)
  })

  it('新しく消した物から順・1件を完全に削除・空にする', () => {
    const two = trashItem({ ...data, items: { i2: mkItem({ id: 'i2' }) } }, 'i2', { at: T0 + 1 }).data
    expect(listTrash(two.trashEntries).map((e) => e.label)).toEqual(['定例会議', '定例会議'])
    expect(listTrash(two.trashEntries)[0].deletedAt).toBe(T0 + 1)
    const left = deleteTrashEntry(two, entry.id)
    expect(Object.keys(left.trashEntries)).toHaveLength(1)
    expect(Object.keys(left.trashRecords)).toHaveLength(1)
    expect(deleteTrashEntry(left, entry.id)).toBe(left)
    expect(emptyTrash(two).trashRecords).toEqual({})
  })
})

describe('戻す', () => {
  it('予定を戻すと、同じ1件が Task List とカレンダーの両方に戻る', () => {
    const item = mkItem({ listed: true, due: '2026-11-12' })
    const trashed = trashItem(dataWith({ items: [item] }), 'i1')
    const { data, result } = restoreTrashEntry(trashed.data, trashed.result)
    expect(data.items.i1).toEqual(item)
    expect(isOnCalendar(data.items.i1) && isInTaskList(data.items.i1, T0)).toBe(true)
    expect(data.trashEntries).toEqual({})
    expect(data.trashRecords).toEqual({})
    expect(result).toMatchObject({ kind: 'event', id: 'i1', copied: false, skipped: [] })
  })

  it('ルーチンはチェックの記録ごと戻り、元の並びの場所へ（直前の記録の後ろ）', () => {
    const data = dataWith({
      routines: [mkRoutine({ id: 'a', order: 0 }), mkRoutine({ id: 'b', order: 1 }), mkRoutine({ id: 'c', order: 2 })],
      routineChecks: [mkCheck('b', '2026-11', ['2026-11-10'])],
    })
    const trashed = trashRoutine(data, 'b')
    // 消している間に c を先頭へ動かした
    const moved: AppData = {
      ...trashed.data,
      routines: { ...trashed.data.routines, c: { ...trashed.data.routines.c, order: -1 } },
    }
    const back = restoreTrashEntry(moved, trashed.result).data
    expect(back.routineChecks['b:2026-11'].dates).toEqual(['2026-11-10'])
    const order = Object.values(back.routines)
      .sort((x, y) => x.order - y.order)
      .map((r) => r.id)
    expect(order).toEqual(['c', 'a', 'b'])
    // ほかの記録の order は書き換えない
    expect(back.routines.a).toBe(moved.routines.a)
  })

  it('先頭にあった物は先頭へ戻る（やりたいこと）', () => {
    const data = dataWith({ favorites: [mkFavorite({ id: 'a', order: -1 }), mkFavorite({ id: 'b', order: 0 })] })
    const trashed = trashFavorite(data, 'a')
    const added = { ...trashed.data, favorites: { ...trashed.data.favorites, n: mkFavorite({ id: 'n', order: -3 }) } }
    const back = restoreTrashEntry(added, trashed.result).data
    expect(back.favorites.a.order).toBeLessThan(-3)
  })

  it('済みを片付けた n件はまとめて戻る', () => {
    const data = dataWith({
      favorites: [mkFavorite({ id: 'a', done: true, order: 1 }), mkFavorite({ id: 'b', done: true, order: 2 })],
    })
    const t = trashDoneFavorites(data)
    const back = restoreTrashEntry(t.data, t.result.entryId).data
    expect(back.favorites).toEqual(data.favorites)
  })

  it('内容から作った id（Claude が足した物）は、同じ id がもうあれば戻さない', () => {
    const claude = mkItem({ id: 'ce-abc.def.1', by: 'connector', ai: 'claude', via: 'メール' })
    const trashed = trashItem(dataWith({ items: [claude] }), claude.id)
    // 消した後に、同じ内容がまた足された
    const again = { ...trashed.data, items: { [claude.id]: { ...claude, title: '定例会議（再）' } } }
    expect(() => restoreTrashEntry(again, trashed.result)).toThrow('同じ内容')
    // 無ければ同じ id で戻る
    expect(restoreTrashEntry(trashed.data, trashed.result).data.items[claude.id]).toEqual(claude)
  })

  it('同期の競合の控え（同じ id が残っている）は、新しい id の複製で戻す', () => {
    const kept = mkFavorite({ id: 'f1', text: 'この端末で直した中身' })
    const base = dataWith({ favorites: [mkFavorite({ id: 'f1', text: '今の中身' })] })
    const withConflict = transact(base, (tx) => {
      tx.put('trashRecords', { id: 'tr', entryId: 'te', table: 'favorites', record: kept, createdAt: T0, updatedAt: T0 })
      tx.put('trashEntries', {
        id: 'te',
        kind: 'favorite',
        label: 'x',
        place: 'Favorite List',
        origin: { index: 0 },
        recordIds: ['tr'],
        reason: 'conflict',
        by: 'user',
        ai: null,
        inboxId: null,
        deletedAt: T0,
        createdAt: T0,
        updatedAt: T0,
      })
    }).data
    // putInTrash を使わずに置いた件でも、中身は消えない（元の表から消すのは putInTrash だけ）
    expect(withConflict.favorites.f1.text).toBe('今の中身')
    const { data, result } = restoreTrashEntry(withConflict, 'te')
    expect(result.copied).toBe(true)
    expect(result.id).not.toBe('f1')
    expect(data.favorites.f1.text).toBe('今の中身')
    expect(data.favorites[result.id].text).toBe('この端末で直した中身')
  })

  it('ルーチンを複製で戻す時は、チェックの記録も新しい id で戻す', () => {
    const data = dataWith({ routines: [mkRoutine()], routineChecks: [mkCheck('r1', '2026-11', ['2026-11-10'])] })
    const trashed = trashRoutine(data, 'r1')
    const recreated = { ...trashed.data, routines: { r1: mkRoutine({ title: '別の朝の体操' }) } }
    const { data: back, result } = restoreTrashEntry(recreated, trashed.result)
    expect(result.copied).toBe(true)
    expect(back.routineChecks[`${result.id}:2026-11`]).toMatchObject({ routineId: result.id, dates: ['2026-11-10'] })
    expect(back.routines.r1.title).toBe('別の朝の体操')
  })

  it('もう無い件は戻せない', () => {
    expect(() => restoreTrashEntry(dataWith({}), 'nothing')).toThrow(DomainError)
  })

  it('putInTrash は同じ記録を2回入れない', () => {
    const data = dataWith({ items: [mkItem()] })
    const r = transact(data, (tx) =>
      putInTrash(tx, {
        kind: 'event',
        label: 'x',
        place: 'p',
        origin: { index: 0 },
        records: [
          { table: 'items', record: data.items.i1 },
          { table: 'items', record: data.items.i1 },
        ],
      }),
    )
    expect(r.data.trashEntries[r.result].recordIds).toHaveLength(1)
  })
})
