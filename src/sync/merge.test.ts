// 同期の3者マージ（docs/SPEC.md の 6.10）。表ごとの指定の行ごと、メモ・やりたいこと・MIM の本文のつなぎ、done の組、受け取り箱の強さ、
// weekdays・dates の並べ直し、MIM の欄の競合、共通の履歴が無い時
import { describe, expect, it } from 'vitest'
import { mkCheck, mkFavorite, mkInbox, mkItem, mkMim, mkRoutine } from '../domain/testData'
import type { InboxRecord } from '../domain/types'
import {
  FIELD_GROUPS,
  LIST_FIELDS,
  NORMALIZE,
  TEXT_FIELDS,
  TEXT_TABLES,
  contentEqual,
  deepEqual,
  mergeList,
  mergeMimFields,
  mergeRecordLegacy,
  mergeRemote as mergeRemoteRec,
  stableStringify,
  type Rec,
} from './merge'
import type { TableName } from '../domain/types'

const D = { device: 'iPhone' }

/** 記録の型のまま渡す（テストを読みやすく） */
const mergeRemote = (
  table: TableName,
  base: object | null,
  mine: object | null,
  theirs: object | null,
  opts: Parameters<typeof mergeRemoteRec>[4],
) => mergeRemoteRec(table, base as Rec | null, mine as Rec | null, theirs as Rec | null, opts)

describe('比較（src/domain/equal.ts から再び公開）', () => {
  it('キーの順番と undefined の項目は問わない', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(deepEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true)
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}')
    expect(contentEqual({ id: 'a', updatedAt: 1 }, { id: 'a', updatedAt: 2 })).toBe(true)
  })
})

describe('6.10 の表ごとの指定', () => {
  it('長い文章・並び・削除と編集の控えの表', () => {
    expect(TEXT_FIELDS).toEqual({ items: ['memo'], favorites: ['text'], mimNotes: ['body'] })
    expect(Object.keys(LIST_FIELDS).sort()).toEqual(['mimNotes', 'routineChecks', 'routines', 'trashEntries'])
    expect(Object.keys(LIST_FIELDS.mimNotes!).sort()).toEqual(['qrs', 'secrets'])
    expect([...TEXT_TABLES].sort()).toEqual(['favorites', 'items', 'mimNotes', 'routines'])
    expect(FIELD_GROUPS.items).toEqual([['done', 'doneAt', 'doneOn']])
    expect(Object.keys(NORMALIZE).sort()).toEqual(['routineChecks', 'routines'])
  })
})

describe('項目（items）', () => {
  const base = mkItem({ memo: '元', title: '会議' })
  it('別々の項目を変えたら両方残り、同じ項目はこの端末を優先', () => {
    const mine = { ...base, title: 'この端末', requester: '山田' }
    const theirs = { ...base, title: '相手', label: 'sky-l' }
    const r = mergeRemote('items', base, mine, theirs, D)
    expect(r.record).toMatchObject({ title: 'この端末', requester: '山田', label: 'sky-l' })
  })
  it('メモを両方で書き換えたら、相手の後ろにこの端末の文章を印付きでつなぐ', () => {
    const r = mergeRemote('items', base, { ...base, memo: 'A' }, { ...base, memo: 'B' }, D)
    expect((r.record as typeof base).memo).toBe('B\n\n――――（同期の競合: iPhoneで同時に書かれた内容）――――\nA')
    expect(r.joined).toEqual(['memo'])
  })
  it('done・doneAt・doneOn は変えた側の組をまとめて採る（片方だけが混ざらない）', () => {
    const done = { ...base, done: true, doneAt: 5, doneOn: '2026-11-10' }
    // 相手が完了にし、この端末は件名だけ直した
    const r1 = mergeRemote('items', base, { ...base, title: '直した' }, done, D).record as typeof base
    expect([r1.done, r1.doneAt, r1.doneOn, r1.title]).toEqual([true, 5, '2026-11-10', '直した'])
    // 両方で変えた: この端末の組
    const undone = { ...base, done: false, doneAt: null, doneOn: null }
    const both = mergeRemote('items', done, undone, { ...done, doneAt: 9, doneOn: '2026-11-11' }, D).record as typeof base
    expect([both.done, both.doneAt, both.doneOn]).toEqual([false, null, null])
  })
  it('片方で削除・片方で編集: 削除を優先して編集を返す（ゴミ箱へ）。クラウドに無かった物は残す', () => {
    expect(mergeRemote('items', base, null, { ...base, memo: '編集' }, D)).toMatchObject({
      record: null,
      deletedEdit: { memo: '編集' },
    })
    expect(mergeRemote('items', base, { ...base, memo: '編集' }, null, D)).toMatchObject({
      record: null,
      deletedEdit: { memo: '編集' },
    })
    expect(mergeRemote('items', null, base, null, D).record).toBe(base)
  })
  it('知らない項目（新しい版が足した値）も残る', () => {
    const b = { ...base, extra: 'x' } as typeof base
    const r = mergeRemote('items', b, { ...b, title: '直した' }, { ...b, extra: 'y' } as typeof base, D)
    expect((r.record as unknown as { extra: string }).extra).toBe('y')
  })
})

describe('ルーチンとチェックの記録', () => {
  it('weekdays は値で合わせ、マージの後に小さい順・重なりなし', () => {
    const base = mkRoutine({ cycle: 'weekly', weekdays: [1] })
    const r = mergeRemote('routines', base, { ...base, weekdays: [1, 5] }, { ...base, weekdays: [4, 1] }, D)
    expect((r.record as typeof base).weekdays).toEqual([1, 4, 5])
  })
  it('dates は2台で別々に付け外ししても両方の変更が残り、小さい順', () => {
    const base = mkCheck('r1', '2026-11', ['2026-11-02'])
    const r = mergeRemote(
      'routineChecks',
      base,
      { ...base, dates: [] },
      { ...base, dates: ['2026-11-02', '2026-11-09', '2026-11-05'] },
      D,
    )
    expect((r.record as typeof base).dates).toEqual(['2026-11-05', '2026-11-09'])
  })
  it('知らない曜日の値・形の違う日付は、どちらも変えていないマージで消えない（形3）', () => {
    // 新しい版が足した値（祝日の印・時刻付きの日付）を持つ記録を、片方で件名、片方で別の項目を直した
    const base = { ...mkRoutine({ cycle: 'weekly' }), weekdays: [1, 'hol'] } as unknown as ReturnType<typeof mkRoutine>
    const r = mergeRemote('routines', base, { ...base, title: 'この端末' }, { ...base, monthDay: 3 }, D)
    expect((r.record as typeof base).weekdays).toEqual([1, 'hol'])
    const check = { ...mkCheck('r1', '2026-11', []), dates: ['2026-11-09', '2026-11-02T09:00'] } as ReturnType<typeof mkCheck>
    const c = mergeRemote('routineChecks', check, { ...check, via: 'この端末' }, { ...check, by: 'connector' as const }, D)
    expect((c.record as typeof check).dates).toEqual(['2026-11-09', '2026-11-02T09:00'])
  })
  it('両方で変えて要素ごとに合わせた時も、知らない値は捨てずに後ろに残す', () => {
    const base = { ...mkRoutine({ cycle: 'weekly' }), weekdays: [3, 'hol'] } as unknown as ReturnType<typeof mkRoutine>
    const r = mergeRemote('routines', base, { ...base, weekdays: [3, 'hol', 1] }, { ...base, weekdays: [5, 3, 'hol'] }, D)
    expect((r.record as typeof base).weekdays).toEqual([1, 3, 5, 'hol'])
    const check = { ...mkCheck('r1', '2026-11', []), dates: ['2026-11-02T09:00'] } as ReturnType<typeof mkCheck>
    const c = mergeRemote(
      'routineChecks',
      check,
      { ...check, dates: ['2026-11-09', '2026-11-02T09:00'] },
      { ...check, dates: ['2026-11-02T09:00', '2026-11-01', '2026-11-01'] },
      D,
    )
    expect((c.record as typeof check).dates).toEqual(['2026-11-01', '2026-11-09', '2026-11-02T09:00'])
  })
  it('チェックの記録は削除と編集が重なっても控えない', () => {
    const base = mkCheck('r1', '2026-11', ['2026-11-02'])
    const r = mergeRemote('routineChecks', base, { ...base, dates: [] }, null, D)
    expect(r.record).toBeNull()
    expect(TEXT_TABLES.has('routineChecks')).toBe(false)
  })
})

describe('やりたいこと・MIM', () => {
  it('やりたいことの中身はつなぐ', () => {
    const base = mkFavorite({ text: '元' })
    const r = mergeRemote('favorites', base, { ...base, text: 'A' }, { ...base, text: 'B' }, D)
    expect((r.record as typeof base).text).toContain('同期の競合')
  })
  it('MIM の本文はつなぎ、欄は id で並べる（両方で足したら両方）', () => {
    const base = mkMim({ body: '元', secrets: [{ id: 's1', name: 'a', value: '1' }] })
    const mine = { ...base, body: 'A', secrets: [...base.secrets, { id: 's2', name: 'b', value: '2' }] }
    const theirs = { ...base, body: 'B', secrets: [...base.secrets, { id: 's3', name: 'c', value: '3' }] }
    const r = mergeRemote('mimNotes', base, mine, theirs, D)
    const rec = r.record as typeof base
    expect(rec.body).toContain('同期の競合')
    expect(rec.secrets.map((s) => s.id)).toEqual(['s1', 's3', 's2'])
    expect(r.overwritten).toBeUndefined()
  })
  it('1つの欄の中身を両方で変えたら、この端末の中身を採り、相手の記録をまるごと返す（パスワードをつながない）', () => {
    const base = mkMim()
    const mine = { ...base, secrets: [{ id: 's1', name: 'パスワード', value: 'A' }] }
    const theirs = { ...base, secrets: [{ id: 's1', name: 'パスワード', value: 'B' }] }
    const r = mergeRemote('mimNotes', base, mine, theirs, D)
    expect((r.record as typeof base).secrets[0].value).toBe('A')
    expect(r.overwritten).toBe(theirs)
  })
  it('片方で消し・片方で中身を変えた欄は、変えた中身を残す', () => {
    const base = mkMim({
      secrets: [
        { id: 's1', name: 'a', value: '1' },
        { id: 's2', name: 'b', value: '2' },
      ],
    })
    const r = mergeMimFields(
      base.secrets,
      [{ id: 's1', name: 'a', value: '1' }],
      [
        { id: 's1', name: 'a', value: '1' },
        { id: 's2', name: 'b', value: '新' },
      ],
    )
    expect(r).toEqual({
      list: [
        { id: 's1', name: 'a', value: '1' },
        { id: 's2', name: 'b', value: '新' },
      ],
      conflict: false,
    })
  })
})

describe('受け取り箱の結果の組（6.10）', () => {
  const pending = mkInbox({ id: 'xa-1', op: 'add', table: 'items', targetId: 'ce-1' })
  const applied: InboxRecord = {
    ...pending,
    status: 'applied',
    appliedAt: 10,
    message: null,
    undo: { created: true, afterHash: 'h' },
    updatedAt: 10,
  }
  const rejected: InboxRecord = {
    ...pending,
    status: 'rejected',
    reason: 'duplicate',
    message: 'もうあります',
    appliedAt: 5,
    updatedAt: 5,
  }
  it('両方で変えたら強い方の組をまとめて採る（applied ＞ rejected。appliedAt が早くても弱い組は採らない）', () => {
    for (const [m, t] of [
      [rejected, applied],
      [applied, rejected],
    ]) {
      const r = mergeRemote('inbox', pending, m, t, D).record as InboxRecord
      expect([r.status, r.reason, r.message, r.appliedAt]).toEqual(['applied', null, null, 10])
      expect(r.undo).toEqual({ created: true, afterHash: 'h' })
    }
  })
  it('applied どうしは、元に戻す値のある組を「もう当たっていました」の組より先に採る', () => {
    const already: InboxRecord = { ...applied, appliedAt: 1, undo: { afterHash: 'h' }, message: 'もう当たっていました' }
    const real: InboxRecord = {
      ...applied,
      appliedAt: 20,
      undo: { before: { a: 1 }, after: { a: 2 }, beforeHash: 'b', afterHash: 'h' },
    }
    const r = mergeRemote('inbox', pending, already, real, D).record as InboxRecord
    expect(r.undo).toEqual(real.undo)
    expect(r.appliedAt).toBe(20)
  })
  it('片方だけが変えたらその組（conflict → rejected（expired）を、変えていない側の conflict に戻さない）', () => {
    const conflict: InboxRecord = { ...pending, op: 'update', id: 'xe-1', status: 'conflict', reason: 'changed', appliedAt: 3 }
    const expired: InboxRecord = { ...conflict, status: 'rejected', reason: 'expired', appliedAt: 99 }
    const r = mergeRemote('inbox', conflict, expired, conflict, D).record as InboxRecord
    expect([r.status, r.reason]).toEqual(['rejected', 'expired'])
  })
  it('提案は accepted ＞ declined。元に戻した日時は入っている方', () => {
    const p = mkInbox({ id: 'xp-1', op: 'propose', proposeOp: 'update', table: 'items', targetId: 'i1' })
    const acc: InboxRecord = { ...p, status: 'accepted', answeredVia: 'app', appliedAt: 9 }
    const dec: InboxRecord = { ...p, status: 'declined', answeredVia: 'app', appliedAt: 1, undoneAt: null }
    const r = mergeRemote('inbox', p, dec, { ...acc, undoneAt: 30 }, D).record as InboxRecord
    expect([r.status, r.answeredVia, r.appliedAt, r.undoneAt]).toEqual(['accepted', 'app', 9, 30])
  })
  it('共通の履歴が無い時も、強い方の組', () => {
    const r = mergeRemote('inbox', null, rejected, applied, { ...D, noHistory: true }).record as InboxRecord
    expect(r.status).toBe('applied')
  })
})

describe('共通の履歴が無い時（初めてのログイン）', () => {
  it('クラウド側を正とし、この端末にしか無い内容は控え、並びには足す', () => {
    const theirs = mkRoutine({ cycle: 'weekly', weekdays: [3], title: 'クラウド' })
    const mine = { ...theirs, weekdays: [1], title: 'この端末' }
    const r = mergeRemote('routines', null, mine, theirs, { ...D, noHistory: true })
    expect((r.record as typeof theirs).title).toBe('クラウド')
    expect((r.record as typeof theirs).weekdays).toEqual([1, 3])
    expect(r.keptCopy).toBe(mine)
  })
})

describe('並びのマージ', () => {
  const id = (x: unknown) => String(x)
  it('相手が消したものは消え、こちらが消したものは戻らない', () => {
    expect(mergeList(['a', 'b', 'c'], ['c', 'b', 'a'], ['a', 'c', 'd'], id)).toEqual(['c', 'd', 'a'])
    expect(mergeList(['a', 'b'], ['a'], ['b', 'a', 'x'], id)).toEqual(['a', 'x'])
  })
  it('控えの作り方を渡さない時は、この端末が変えた項目を重ねる', () => {
    const base = mkItem()
    const r = mergeRecordLegacy(
      base,
      { ...base, title: 'A', updatedAt: 5 } as Rec,
      { ...base, memo: 'B', updatedAt: 9 } as Rec,
      'items',
    )
    expect(r).toMatchObject({ title: 'A', memo: 'B', updatedAt: 9 })
  })
})
