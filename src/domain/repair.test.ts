// 修復（docs/SPEC.md の 2.10・6.12）と保存の時の書き戻し（形3）: 6.12 の項目ごと、知らない項目が残る、2回かけても同じ、直した数、
// 保存の時に書き戻すのは日付と時刻の並びの直しだけ（知らない kind・label・項目は残す）
import { describe, expect, it } from 'vitest'
import { isInTaskList } from './items'
import { itemDateFixes, repairData, storedData, storedRecord, untitledByRepair } from './repair'
import { T0, dataWith, mkCheck, mkFavorite, mkItem, mkMim, mkOffDay, mkRoutine, mkTask } from './testData'
import { emptyData, type AppData, type Item } from './types'

const repairOne = (it: Item) => repairData(dataWith({ items: [it] })).data.items[it.id]

describe('項目（6.12）', () => {
  it('日付・時刻の形が正しくない値は null とみなす', () => {
    const r = repairOne(mkItem({ start: '2026-11-10', due: '2026/11/12', startTime: '9:00', endTime: '25:00' }))
    expect(r).toMatchObject({ start: '2026-11-10', due: null, startTime: null, endTime: null })
  })

  it('calendar 生まれで start が無い → due、それも無ければ createdAt の暦の日付', () => {
    expect(repairOne(mkItem({ start: null, due: '2026-11-12' })).start).toBe('2026-11-12')
    expect(repairOne(mkItem({ start: null, due: null, createdAt: new Date(2026, 10, 3, 23, 30).getTime() })).start).toBe(
      '2026-11-03',
    )
  })

  it('start > due → calendar 生まれは due = start、list 生まれは start を無いものとみなす（締め切り日は動かさない）', () => {
    expect(repairOne(mkItem({ start: '2026-11-15', due: '2026-11-12' }))).toMatchObject({
      start: '2026-11-15',
      due: '2026-11-15',
    })
    expect(repairOne(mkTask({ start: '2026-11-15', due: '2026-11-12' }))).toMatchObject({ start: null, due: '2026-11-12' })
  })

  it('startTime が無いのに endTime がある → endTime を無視。1日の予定で endTime ≤ startTime → endTime を無視', () => {
    expect(repairOne(mkItem({ endTime: '11:00' })).endTime).toBeNull()
    expect(repairOne(mkItem({ startTime: '10:00', endTime: '09:00' })).endTime).toBeNull()
    expect(repairOne(mkItem({ startTime: '10:00', endTime: '10:00' })).endTime).toBeNull()
    // 複数日なら残す
    expect(repairOne(mkItem({ due: '2026-11-11', startTime: '22:00', endTime: '02:00' })).endTime).toBe('02:00')
  })

  it('list 生まれで due が無く listed が false → listed = true とみなす（2.10: 片方で Task List から外し、片方で締め切り日を消した）', () => {
    // 端末 A: 締め切りのあるタスクを Task List から外した（listed: false）。端末 B: 締め切り日を消した（due: null）。
    // 項目ごとに合わせた結果は「list 生まれ・締め切りなし・listed: false」で、どこにも出ない
    const merged = mkTask({ due: null, listed: false })
    const shown = repairOne(merged)
    expect(shown.listed).toBe(true)
    expect(isInTaskList(shown, T0)).toBe(true)
  })

  it('知らない kind → work、知らない label → なし、空の件名 → 「（件名なし）」', () => {
    const r = repairOne(mkItem({ kind: 'family' as never, label: 'gold-l', title: '  ' }))
    expect(r).toMatchObject({ kind: 'work', label: null, title: '（件名なし）' })
  })

  it('untitledByRepair: 表示の「（件名なし）」が、端末の記録の空の件名を直した物か（本当の件名「（件名なし）」・まだ端末に無い記録は違う。D48）', () => {
    const shown = { title: '（件名なし）' }
    expect(untitledByRepair(shown, { title: '' })).toBe(true)
    expect(untitledByRepair(shown, { title: '  ' })).toBe(true)
    expect(untitledByRepair(shown, { title: null })).toBe(true)
    expect(untitledByRepair(shown, {})).toBe(true)
    expect(untitledByRepair(shown, { title: '（件名なし）' })).toBe(false)
    expect(untitledByRepair(shown, undefined)).toBe(false)
    // このタブで件名を直した後（端末の記録はまだ空）
    expect(untitledByRepair({ title: '直した件名' }, { title: '' })).toBe(false)
  })

  it('知らない項目は消さずに残す（新しい版のアプリが足した項目）', () => {
    const r = repairOne({ ...mkItem(), place: '会議室A' } as Item)
    expect((r as unknown as { place: string }).place).toBe('会議室A')
  })

  it('決まりどおりの記録は同じオブジェクトのまま（参照で比べられる）', () => {
    const it = mkItem({ startTime: '10:00', endTime: '11:00' })
    const data = dataWith({ items: [it] })
    const { data: out, fixes } = repairData(data)
    expect(out.items.i1).toBe(it)
    expect(fixes).toEqual([])
  })
})

describe('ルーチン・チェック・ほかの表（6.12）', () => {
  it('知らない cycle → daily、範囲の外・合わない指定・月日の片方だけ → 指定なし', () => {
    const d = repairData(
      dataWith({
        routines: [
          mkRoutine({ id: 'a', cycle: 'hourly' as never, weekdays: [1] }),
          mkRoutine({ id: 'b', cycle: 'weekly', weekdays: [1, 9, 4, 1] }),
          mkRoutine({ id: 'c', cycle: 'monthly', monthDay: 32 }),
          mkRoutine({ id: 'd', cycle: 'monthly', weekdays: [2], monthDay: 25 }),
          mkRoutine({ id: 'e', cycle: 'yearly', yearMonth: 3, yearDay: null }),
        ],
      }),
    ).data.routines
    expect(d.a).toMatchObject({ cycle: 'daily', weekdays: [] })
    expect(d.b.weekdays).toEqual([1, 4])
    expect(d.c.monthDay).toBeNull()
    expect(d.d).toMatchObject({ weekdays: [], monthDay: 25 })
    expect(d.e).toMatchObject({ yearMonth: null, yearDay: null })
  })

  it('親（ルーチン）の無いチェックの記録は見えなくする。チェックした日は並べ直す', () => {
    const d = repairData(
      dataWith({
        routines: [mkRoutine()],
        routineChecks: [
          mkCheck('r1', '2026-11', ['2026-11-10', '2026-11-02', '2026-11-10']),
          mkCheck('gone', '2026-11', ['2026-11-01']),
        ],
      }),
    )
    expect(Object.keys(d.data.routineChecks)).toEqual(['r1:2026-11'])
    expect(d.data.routineChecks['r1:2026-11'].dates).toEqual(['2026-11-02', '2026-11-10'])
    expect(d.fixes).toContain('ルーチンの無いチェックの記録を見えなくしました')
  })

  it('id の合わない記録・オブジェクトでない記録は見えなくする', () => {
    const data = { ...emptyData(), favorites: { x: mkFavorite({ id: 'y' }), z: 'broken' } } as unknown as AppData
    expect(repairData(data).data.favorites).toEqual({})
  })

  it('MIM の欄の壊れた要素を除く。休み・やりたいことの形を補う', () => {
    const mim = mkMim({ secrets: [{ id: 's1', name: 'x', value: 'y' }, null, { name: 'no id' }] as never })
    const d = repairData(
      dataWith({
        mimNotes: [mim],
        offDays: [{ ...mkOffDay('2026-11-20'), off: 'yes' as never }],
        favorites: [{ ...mkFavorite(), done: undefined as never }],
      }),
    )
    expect(d.data.mimNotes.m1.secrets).toEqual([{ id: 's1', name: 'x', value: 'y' }])
    expect(d.data.offDays['2026-11-20'].off).toBe(false)
    expect(d.data.favorites.f1.done).toBe(false)
  })

  it('ゴミ箱: 種類の分からない件・件の無い中身・中身の無い件を見えなくする', () => {
    const data = dataWith({})
    data.trashEntries = {
      e1: {
        id: 'e1',
        kind: 'event',
        label: 'x',
        place: 'p',
        origin: { index: 0 },
        recordIds: ['r1'],
        reason: 'deleted',
        by: 'user',
        ai: null,
        inboxId: null,
        deletedAt: T0,
        createdAt: T0,
        updatedAt: T0,
      },
      e2: { id: 'e2', kind: 'unknown' } as never,
      e3: { id: 'e3', kind: 'task', recordIds: [] } as never,
    }
    data.trashRecords = {
      r1: { id: 'r1', entryId: 'e1', table: 'items', record: mkItem(), createdAt: T0, updatedAt: T0 },
      r2: { id: 'r2', entryId: 'nothing', table: 'items', record: mkItem({ id: 'i2' }), createdAt: T0, updatedAt: T0 },
    }
    const d = repairData(data).data
    expect(Object.keys(d.trashEntries)).toEqual(['e1'])
    expect(Object.keys(d.trashRecords)).toEqual(['r1'])
  })

  it('受け取り箱はそのまま（新しい版の依頼に触らない）', () => {
    const rec = { id: 'xa-1', v: 2, op: 'add', somethingNew: true } as never
    const d = repairData({ ...emptyData(), inbox: { 'xa-1': rec } })
    expect(d.data.inbox['xa-1']).toBe(rec)
  })
})

describe('2回かけても同じ・直した数', () => {
  it('修復した物にもう一度かけても変わらない', () => {
    const data = dataWith({
      items: [
        mkItem({ kind: 'x' as never, start: '2026-11-15', due: '2026-11-12', endTime: '10:00' }),
        mkTask({ listed: false }),
      ],
      routines: [mkRoutine({ cycle: 'weekly', weekdays: [3, 3] })],
      routineChecks: [mkCheck('gone', '2026-11', [])],
    })
    const once = repairData(data)
    expect(once.fixes.length).toBe(4)
    const twice = repairData(once.data)
    expect(twice.fixes).toEqual([])
    expect(twice.data).toEqual(once.data)
    // 渡したデータは書き換えない
    expect(data.items.i1.kind).toBe('x')
  })
})

describe('保存の時に書き戻す物（形3）', () => {
  it('知らない kind・label の項目の件名を直しても、kind・label は raw のまま残る', () => {
    // 新しい版（v0.2）で足した区分「家族」と、24色に無いラベルを持つ項目
    const raw = mkItem({ kind: 'family' as never, label: 'gold-l' })
    const shown = repairOne(raw)
    expect(shown).toMatchObject({ kind: 'work', label: null })
    const edited = { ...shown, title: '家族で食事', updatedAt: T0 + 1 }
    const stored = storedRecord('items', raw, shown, edited)!
    expect(stored).toMatchObject({ kind: 'family', label: 'gold-l', title: '家族で食事', updatedAt: T0 + 1 })
  })

  it('作者が区分を選び直した時は、その値を書く', () => {
    const raw = mkItem({ kind: 'family' as never })
    const shown = repairOne(raw)
    expect(storedRecord('items', raw, shown, { ...shown, kind: 'private' })!.kind).toBe('private')
  })

  it('知らない項目は残す（新しい版が足した項目）', () => {
    const raw = { ...mkItem(), place: '会議室A' } as Item
    const shown = repairOne(raw)
    const stored = storedRecord('items', raw, shown, { ...shown, title: '定例' })!
    expect((stored as unknown as { place: string }).place).toBe('会議室A')
  })

  it('日付と時刻の並びの直しは書き戻す（start > due・終了だけ・1日で終了 ≤ 開始）', () => {
    const raw = mkItem({ start: '2026-11-15', due: '2026-11-12', endTime: '11:00' })
    const shown = repairOne(raw)
    const stored = storedRecord('items', raw, shown, { ...shown, title: '研修' })!
    expect(stored).toMatchObject({ start: '2026-11-15', due: '2026-11-15', endTime: null, title: '研修' })
  })

  it('形の分からない値（新しい版の形かもしれない日付）は、直していなければ書き戻さない', () => {
    const raw = mkItem({ start: '2026-11-10T09:00', due: '2026-11-12' })
    const shown = repairOne(raw)
    expect(shown.start).toBe('2026-11-12')
    expect(storedRecord('items', raw, shown, { ...shown, memo: 'x' })!.start).toBe('2026-11-10T09:00')
    expect(itemDateFixes(raw)).toEqual({})
  })

  it('calendar 生まれで start が無い時の補い（表示だけの直し）は書き戻さない', () => {
    const raw = mkItem({ start: null, due: null, createdAt: new Date(2026, 10, 3, 9, 0).getTime() })
    const shown = repairOne(raw)
    expect(shown.start).toBe('2026-11-03')
    const stored = storedRecord('items', raw, shown, { ...shown, title: '件名を直した' })!
    expect(stored).toMatchObject({ start: null, title: '件名を直した' })
    expect(itemDateFixes(raw)).toEqual({})
    // 日付を選び直した時は、その値を書く
    expect(storedRecord('items', raw, shown, { ...shown, start: '2026-11-20' })!.start).toBe('2026-11-20')
  })

  it('知らない生まれ（origin）の記録は、start > due・終了だけでも保存の時に直さない（新しい版の決まりかもしれない）', () => {
    const raw = mkItem({ origin: 'event2' as never, start: '2026-11-12', due: '2026-11-10', endTime: '11:00' })
    const shown = repairOne(raw)
    expect(shown).toMatchObject({ origin: 'calendar', due: '2026-11-12', endTime: null })
    const stored = storedRecord('items', raw, shown, { ...shown, title: '件名だけ直した' })!
    expect(stored).toMatchObject({ origin: 'event2', start: '2026-11-12', due: '2026-11-10', endTime: '11:00' })
    expect(itemDateFixes(raw)).toEqual({})
  })

  it('チェックした日・毎週の曜日の知らない要素は、その並びを直して保存しても残る', () => {
    const raw = { ...mkCheck('r1', '2026-11', ['2026-11-02']), dates: ['2026-11-02', '2026-11-03T09:00'] } as ReturnType<
      typeof mkCheck
    >
    const data = repairData(dataWith({ routines: [mkRoutine()], routineChecks: [raw] })).data
    const shown = data.routineChecks[raw.id]
    expect(shown.dates).toEqual(['2026-11-02'])
    const stored = storedRecord('routineChecks', raw, shown, { ...shown, dates: ['2026-11-02', '2026-11-10'] })!
    expect(stored.dates).toEqual(['2026-11-02', '2026-11-10', '2026-11-03T09:00'])
    const rr = { ...mkRoutine({ cycle: 'weekly', weekdays: [1] }), weekdays: [1, 'hol'] } as unknown as ReturnType<
      typeof mkRoutine
    >
    const rShown = repairData(dataWith({ routines: [rr] })).data.routines[rr.id]
    expect(storedRecord('routines', rr, rShown, { ...rShown, weekdays: [1, 3] })!.weekdays).toEqual([1, 3, 'hol'])
  })

  it('知らない cycle のルーチンの件名を直しても cycle は残る', () => {
    const raw = mkRoutine({ cycle: 'biweekly' as never, weekdays: [1] })
    const shown = repairData(dataWith({ routines: [raw] })).data.routines.r1
    const stored = storedRecord('routines', raw, shown, { ...shown, title: '隔週の掃除' })!
    expect(stored).toMatchObject({ cycle: 'biweekly', weekdays: [1], title: '隔週の掃除' })
  })

  it('新しく作った記録・消した記録・変えていない記録', () => {
    const it = mkItem()
    expect(storedRecord('items', undefined, undefined, it)).toBe(it)
    expect(storedRecord('items', it, it, undefined)).toBeUndefined()
    const raw = mkItem({ kind: 'family' as never })
    const shown = repairOne(raw)
    expect(storedRecord('items', raw, shown, shown)).toBe(raw)
  })

  it('データ全体: 変えた記録だけを raw に重ね、変えていない表は raw のまま', () => {
    const raw = dataWith({ items: [mkItem({ kind: 'family' as never }), mkItem({ id: 'i2' })], favorites: [mkFavorite()] })
    const shown = repairData(raw).data
    const after: AppData = { ...shown, items: { i1: { ...shown.items.i1, title: '食事' } } }
    const stored = storedData(raw, shown, after)
    expect(stored.items.i1).toMatchObject({ kind: 'family', title: '食事' })
    expect(stored.items.i2).toBeUndefined()
    expect(stored.favorites).toBe(raw.favorites)
  })
})
