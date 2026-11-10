// 手の操作（docs/SPEC.md の 6.1〜6.9・12.・13.〜15.）: 出どころ（by・ai・via）・直した日時・6.3 の移り変わり・完了の3つ・
// 休みと呼び名の記録・ルーチンのチェックの記録・やりたいことの並び・Claude が作った記録を直しても by が変わらない
import { describe, expect, it } from 'vitest'
import {
  addFavorite,
  addItem,
  addMimNote,
  addRoutine,
  checkRoutine,
  reorder,
  setItemDone,
  setLabelName,
  setOffDay,
  uncheckRoutine,
  updateFavorite,
  updateItem,
  updateMimNote,
  updateRoutine,
} from './ops'
import { DAY, T0, dataWith, mkCheck, mkFavorite, mkItem, mkRoutine, mkTask } from './testData'
import { DomainError, emptyData } from './types'

describe('項目を足す・直す（6.2・6.3）', () => {
  it('手で足すと by: user・ai: null・via: null・v: 1、order は作った時刻', () => {
    const { data, result } = addItem(emptyData(), { origin: 'calendar', title: ' 定例会議 ', start: '2026-11-10' }, T0)
    const it = data.items[result]
    expect(it).toMatchObject({ by: 'user', ai: null, via: null, v: 1, title: '定例会議', kind: 'work', listed: false, order: T0 })
    expect(it.createdAt).toBe(T0)
    expect(it.updatedAt).toBe(T0)
  })

  it('list 生まれは listed: true で始まる。calendar 生まれは「Task List にも出す」で true にできる', () => {
    expect(addItem(emptyData(), { origin: 'list', title: '見積書' }, T0).data.items).toSatisfy((items: object) =>
      Object.values(items).every((i) => i.listed === true),
    )
    const r = addItem(emptyData(), { origin: 'calendar', title: '研修', start: '2026-11-10', listed: true }, T0)
    expect(r.data.items[r.result].listed).toBe(true)
  })

  it('決まりに合わない物は足せない（calendar 生まれの開始日なし・空の件名・終了だけの時刻）', () => {
    expect(() => addItem(emptyData(), { origin: 'calendar', title: '研修' }, T0)).toThrow(DomainError)
    expect(() => addItem(emptyData(), { origin: 'list', title: '  ' }, T0)).toThrow(DomainError)
    expect(() => addItem(emptyData(), { origin: 'calendar', title: 'x', start: '2026-11-10', endTime: '10:00' }, T0)).toThrow(
      DomainError,
    )
  })

  it('list 生まれの締め切り日を消すと、listed が false なら true に戻す（どこにも出ない項目を作らない）', () => {
    const data = dataWith({ items: [mkTask({ due: '2026-11-20', listed: false })] })
    const r = updateItem(data, 't1', { due: null }, T0 + 1)
    expect(r.data.items.t1).toMatchObject({ due: null, listed: true, updatedAt: T0 + 1 })
    expect(r.result.relisted).toBe(true)
    // listed が true のままなら知らせない
    const r2 = updateItem(dataWith({ items: [mkTask({ due: '2026-11-20' })] }), 't1', { due: null }, T0 + 1)
    expect(r2.result.relisted).toBe(false)
  })

  it('開始日を締め切り日より後にすると締め切り日をそろえ、締め切り日を開始日より前にすると開始日をそろえる', () => {
    const data = dataWith({ items: [mkItem({ start: '2026-11-10', due: '2026-11-12' })] })
    expect(updateItem(data, 'i1', { start: '2026-11-15' }).data.items.i1).toMatchObject({
      start: '2026-11-15',
      due: '2026-11-15',
    })
    expect(updateItem(data, 'i1', { due: '2026-11-08' }).data.items.i1).toMatchObject({ start: '2026-11-08', due: '2026-11-08' })
  })

  it('終了 = 開始なら終了を空に、開始を空にすると終了も消す。1日の予定で終了 < 開始の日付にはできない', () => {
    const data = dataWith({ items: [mkItem({ startTime: '10:00', endTime: '11:00' })] })
    expect(updateItem(data, 'i1', { endTime: '10:00' }).data.items.i1.endTime).toBeNull()
    expect(updateItem(data, 'i1', { startTime: null }).data.items.i1).toMatchObject({ startTime: null, endTime: null })
    const night = dataWith({ items: [mkItem({ start: '2026-11-10', due: '2026-11-11', startTime: '22:00', endTime: '02:00' })] })
    expect(() => updateItem(night, 'i1', { due: '2026-11-10' })).toThrow('終わりの時刻')
  })

  it('Task List から外すのは、カレンダーに出ている時だけ', () => {
    expect(updateItem(dataWith({ items: [mkTask({ due: '2026-11-20' })] }), 't1', { listed: false }).data.items.t1.listed).toBe(
      false,
    )
    expect(() => updateItem(dataWith({ items: [mkTask()] }), 't1', { listed: false })).toThrow('Task List から外せません')
  })

  it('完了は done・doneAt・doneOn を組で、戻すと3つとも消す（12.5）', () => {
    const at = new Date(2026, 10, 12, 18, 3).getTime()
    const data = dataWith({ items: [mkItem()] })
    const done = setItemDone(data, 'i1', true, at)
    expect(done.items.i1).toMatchObject({ done: true, doneAt: at, doneOn: '2026-11-12', updatedAt: at })
    expect(setItemDone(done, 'i1', false, at + 1).items.i1).toMatchObject({ done: false, doneAt: null, doneOn: null })
    expect(setItemDone(done, 'i1', true, at + 2)).toBe(done)
  })

  it('Claude が作った記録を作者が直しても by・ai・via は変わらない（6.1）', () => {
    const data = dataWith({ items: [mkItem({ id: 'ce-abc', by: 'connector', ai: 'claude', via: 'メール: 12/3 打ち合わせ' })] })
    const next = updateItem(data, 'ce-abc', { title: '定例の打ち合わせ' }, T0 + 5).data.items['ce-abc']
    expect(next).toMatchObject({ by: 'connector', ai: 'claude', via: 'メール: 12/3 打ち合わせ', title: '定例の打ち合わせ' })
    expect(setItemDone(data, 'ce-abc', true, T0).items['ce-abc'].by).toBe('connector')
  })
})

describe('休み・ラベルの呼び名（6.5・6.6）', () => {
  it('休みは off を切り替え、記録は消さない', () => {
    const on = setOffDay(emptyData(), '2026-11-20', true, T0)
    expect(on.offDays['2026-11-20']).toEqual({
      id: '2026-11-20',
      date: '2026-11-20',
      off: true,
      updatedAt: T0,
      by: 'user',
      ai: null,
      via: null,
    })
    const off = setOffDay(on, '2026-11-20', false, T0 + 1)
    expect(off.offDays['2026-11-20']).toMatchObject({ off: false, updatedAt: T0 + 1 })
    // 記録の無い日を外しても何も作らない
    expect(setOffDay(emptyData(), '2026-11-21', false, T0)).toEqual(emptyData())
    expect(() => setOffDay(emptyData(), '2026-11-31', true)).toThrow(DomainError)
  })

  it('呼び名は消す時も空にするだけ。12字まで。知らないキーは付けられない', () => {
    const named = setLabelName(emptyData(), 'sky-l', ' 会議 ', T0)
    expect(named.labelNames['sky-l']).toMatchObject({ id: 'sky-l', name: '会議', by: 'user' })
    expect(setLabelName(named, 'sky-l', '', T0 + 1).labelNames['sky-l']).toMatchObject({ name: '', updatedAt: T0 + 1 })
    expect(() => setLabelName(emptyData(), 'sky-l', 'あ'.repeat(13))).toThrow(DomainError)
    expect(() => setLabelName(emptyData(), 'gold', '金')).toThrow(DomainError)
  })
})

describe('ルーチン（6.7・14.）', () => {
  it('足すとその種類のいちばん下へ', () => {
    const data = dataWith({
      routines: [
        mkRoutine({ id: 'a', order: 0 }),
        mkRoutine({ id: 'b', order: 3 }),
        mkRoutine({ id: 'c', cycle: 'weekly', order: 9 }),
      ],
    })
    const r = addRoutine(data, { title: '日記を書く', cycle: 'daily' }, T0)
    expect(r.data.routines[r.result]).toMatchObject({ order: 4, weekdays: [], monthDay: null, by: 'user' })
    expect(() => addRoutine(data, { title: 'x', cycle: 'daily', weekdays: [1] })).toThrow(DomainError)
  })

  it('種類を変えると、合わない指定を外し、新しい種類のいちばん下へ', () => {
    const data = dataWith({
      routines: [mkRoutine({ id: 'a', cycle: 'weekly', weekdays: [1, 4] }), mkRoutine({ id: 'b', cycle: 'monthly', order: 2 })],
    })
    const next = updateRoutine(data, 'a', { cycle: 'monthly', monthDay: 25 }, T0 + 1).routines.a
    expect(next).toMatchObject({ cycle: 'monthly', weekdays: [], monthDay: 25, order: 3, updatedAt: T0 + 1 })
  })

  it('チェックはその月の記録に今日を足す（記録が無ければ作る）。外すといちばん新しい戻る日以後を消す（前の月の記録からも）', () => {
    const data = dataWith({ routines: [mkRoutine({ id: 'q', cycle: 'quarterly' })] })
    const checked = checkRoutine(data, 'q', '2026-11-10', T0)
    expect(checked.routineChecks['q:2026-11']).toEqual(mkCheck('q', '2026-11', ['2026-11-10'], { updatedAt: T0 }))
    expect(checkRoutine(checked, 'q', '2026-11-10', T0 + 1)).toBe(checked)
    const withOct = {
      ...checked,
      routineChecks: { ...checked.routineChecks, 'q:2026-10': mkCheck('q', '2026-10', ['2026-10-05']) },
    }
    const unchecked = uncheckRoutine(withOct, 'q', '2026-11-10', T0 + 2)
    expect(unchecked.routineChecks['q:2026-11'].dates).toEqual([])
    expect(unchecked.routineChecks['q:2026-10'].dates).toEqual([])
    // 前の四半期（7〜9月）の記録は残す
    const withSep = {
      ...withOct,
      routineChecks: { ...withOct.routineChecks, 'q:2026-09': mkCheck('q', '2026-09', ['2026-09-30']) },
    }
    expect(uncheckRoutine(withSep, 'q', '2026-11-10').routineChecks['q:2026-09'].dates).toEqual(['2026-09-30'])
  })
})

describe('やりたいこと・MIM・並べ替え（6.8・6.9）', () => {
  it('やりたいことはいちばん上に足す（今のいちばん小さい値 − 1）', () => {
    const data = dataWith({ favorites: [mkFavorite({ id: 'a', order: 0 }), mkFavorite({ id: 'b', order: -2 })] })
    const r = addFavorite(data, '美術館に行く', T0)
    expect(r.data.favorites[r.result].order).toBe(-3)
    expect(() => addFavorite(data, ' ')).toThrow(DomainError)
  })

  it('済みにすると doneAt を今に、外すと null', () => {
    const data = dataWith({ favorites: [mkFavorite()] })
    const done = updateFavorite(data, 'f1', { done: true }, T0 + DAY)
    expect(done.favorites.f1).toMatchObject({ done: true, doneAt: T0 + DAY })
    expect(updateFavorite(done, 'f1', { done: false }).favorites.f1.doneAt).toBeNull()
  })

  it('MIM は by: user で作り、題名は 100字・欄の名前は 40字まで', () => {
    const r = addMimNote(emptyData(), { title: '銀行' }, T0)
    expect(r.data.mimNotes[r.result]).toMatchObject({ title: '銀行', by: 'user', secrets: [], qrs: [] })
    expect(() => updateMimNote(r.data, r.result, { title: 'あ'.repeat(101) })).toThrow(DomainError)
    expect(() => updateMimNote(r.data, r.result, { secrets: [{ id: 's', name: 'な'.repeat(41), value: '' }] })).toThrow(
      DomainError,
    )
  })

  it('並べ替えは今の order の値を並べ直して使い、変わった物だけ書く', () => {
    const data = dataWith({
      favorites: [mkFavorite({ id: 'a', order: -1 }), mkFavorite({ id: 'b', order: 0 }), mkFavorite({ id: 'c', order: 5 })],
    })
    const next = reorder(data, 'favorites', ['c', 'a', 'b'], T0 + 1)
    expect([next.favorites.c.order, next.favorites.a.order, next.favorites.b.order]).toEqual([-1, 0, 5])
    expect(next.favorites.a.updatedAt).toBe(T0 + 1)
  })
})
