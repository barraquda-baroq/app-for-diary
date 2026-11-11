// 手の操作（docs/SPEC.md の 6.1〜6.9・7.11・12.・13.〜15.）: 出どころ（by・ai・via）・直した日時・6.3 の移り変わり・完了の3つ・
// 休みと呼び名の記録・ルーチンのチェックの記録・やりたいことの並び・Claude が作った記録を直しても by が変わらない・
// 終了 = 開始で終了を空にするのは1日の予定だけ（D36）・ドラッグで日を動かす／元に戻す・複製で写す物と写さない物
import { describe, expect, it } from 'vitest'
import { DATE_REFUSED } from './itemInput'
import { periodOf } from './items'
import {
  UNDO_REFUSED,
  addFavorite,
  addItem,
  addMimNote,
  addRoutine,
  checkRoutine,
  duplicateItem,
  moveItemDates,
  reorder,
  restoreItemDates,
  setItemDone,
  setLabelName,
  setOffDay,
  uncheckRoutine,
  updateFavorite,
  updateItem,
  updateMimNote,
  updateRoutine,
} from './ops'
import { repairData } from './repair'
import { DAY, T0, dataWith, mkCheck, mkFavorite, mkItem, mkOffDay, mkRoutine, mkTask } from './testData'
import { TRASH_KIND_TABLE, trashItem } from './trash'
import { DomainError, emptyData, type Item } from './types'

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

describe('終了 = 開始で終了を空にするのは1日の予定だけ（D36・AMB-ITEMS-03）', () => {
  it('複数日の予定（11/9 10:00〜11/11 10:00）は、ほかの欄を直しても終了 10:00 のまま', () => {
    const span = mkItem({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })
    const data = dataWith({ items: [span] })
    expect(updateItem(data, 'i1', { title: '研修' }).data.items.i1).toMatchObject({ endTime: '10:00', due: '2026-11-11' })
    expect(updateItem(data, 'i1', { endTime: '10:00' }).data.items.i1.endTime).toBe('10:00')
  })

  it('1日の予定は終了を空にする。締め切り日を消して1日の予定になった時も', () => {
    const data = dataWith({ items: [mkItem({ startTime: '10:00', endTime: '11:00' })] })
    expect(updateItem(data, 'i1', { endTime: '10:00' }).data.items.i1.endTime).toBeNull()
    const span = dataWith({ items: [mkItem({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })] })
    expect(updateItem(span, 'i1', { due: null }).data.items.i1).toMatchObject({ due: null, endTime: null })
  })

  it('カレンダーに出ていない list 生まれ（期間が無い）は終了を残す（締め切り日をまた入れると決まりを当てる。ITEMS-213）', () => {
    const t = dataWith({ items: [mkTask({ start: '2026-11-10', startTime: '10:00', endTime: '10:00' })] })
    expect(updateItem(t, 't1', { title: '見積書' }).data.items.t1.endTime).toBe('10:00')
    expect(updateItem(t, 't1', { due: '2026-11-10' }).data.items.t1.endTime).toBeNull()
  })
})

describe('項目を直す時に変えない物（ITEMS-005・016・CALENDAR-014..017・ITEMS-213・272）', () => {
  it('生まれ・作った日時・出どころは patch に入っていても変えない。updatedAt だけ今に', () => {
    const data = dataWith({ items: [mkItem({ id: 'ce-1', by: 'connector', ai: 'claude', via: 'メール: 打ち合わせ' })] })
    const sneaky = { title: '直した', origin: 'list', createdAt: 1, by: 'user', ai: null, via: null, done: true } as never
    const next = updateItem(data, 'ce-1', sneaky, T0 + 9).data.items['ce-1']
    expect(next).toMatchObject({ title: '直した', origin: 'calendar', createdAt: T0, updatedAt: T0 + 9, done: false })
    expect(next).toMatchObject({ by: 'connector', ai: 'claude', via: 'メール: 打ち合わせ' })
  })

  it('calendar 生まれの締め切り日を消すと開始日の1日の予定に、list 生まれはカレンダーから外れて時刻は残る', () => {
    const cal = dataWith({ items: [mkItem({ start: '2026-11-10', due: '2026-11-12' })] })
    expect(periodOf(updateItem(cal, 'i1', { due: null }).data.items.i1)).toEqual({ from: '2026-11-10', to: '2026-11-10' })
    const task = dataWith({ items: [mkTask({ start: '2026-11-10', due: '2026-11-12', startTime: '09:00', endTime: '10:00' })] })
    const off = updateItem(task, 't1', { due: null }).data.items.t1
    expect(periodOf(off)).toBeNull()
    expect(off).toMatchObject({ startTime: '09:00', endTime: '10:00', listed: true })
  })

  it('calendar 生まれは「Task List にも出す」を切り替えられる（CALENDAR-017）', () => {
    const cal = dataWith({ items: [mkItem()] })
    const on = updateItem(cal, 'i1', { listed: true }).data
    expect(on.items.i1.listed).toBe(true)
    expect(updateItem(on, 'i1', { listed: false }).data.items.i1.listed).toBe(false)
  })
})

describe('ドラッグで日を動かす（7.11・D25）', () => {
  const span = mkItem({ start: '2026-11-09', due: '2026-11-12', startTime: '10:00', endTime: '15:00', label: 'sky-l' })

  it('渡した開始日・締め切り日をそのまま書き、時刻・ほかの項目は変えない。戻り値は動かす前の値（CALENDAR-172）', () => {
    const data = dataWith({ items: [span] })
    const r = moveItemDates(data, 'i1', { start: '2026-11-10', due: '2026-11-12', clearEnd: false }, T0 + 5)
    expect(r.result).toEqual({ start: '2026-11-09', due: '2026-11-12', endTime: '15:00' })
    expect(r.data.items.i1).toEqual({ ...span, start: '2026-11-10', updatedAt: T0 + 5 })
  })

  it('片側だけのそろえ方は当てない（開始日 > 締め切り日はそろえずに断る）', () => {
    const data = dataWith({ items: [span] })
    expect(() => moveItemDates(data, 'i1', { start: '2026-11-13', due: '2026-11-12', clearEnd: false })).toThrow(DomainError)
  })

  it('clearEnd・1日の予定で終了 = 開始になる時は終了時刻を空に。終了 < 開始になる日付は断る', () => {
    const tenToTen = dataWith({
      items: [mkItem({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })],
    })
    expect(
      moveItemDates(tenToTen, 'i1', { start: '2026-11-09', due: '2026-11-09', clearEnd: true }).data.items.i1.endTime,
    ).toBeNull()
    expect(
      moveItemDates(tenToTen, 'i1', { start: '2026-11-09', due: '2026-11-09', clearEnd: false }).data.items.i1.endTime,
    ).toBeNull()
    const night = dataWith({ items: [mkItem({ start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })] })
    expect(() => moveItemDates(night, 'i1', { start: '2026-11-11', due: '2026-11-11', clearEnd: false })).toThrow('終わりの時刻')
  })

  it('完了した予定も動かせ、完了の3つは変えない（CALENDAR-174）。ロック中・無い予定は動かせない', () => {
    const done = mkItem({ done: true, doneAt: T0, doneOn: '2026-11-10' })
    const moved = moveItemDates(dataWith({ items: [done] }), 'i1', { start: '2026-11-12', due: null, clearEnd: false }).data
    expect(moved.items.i1).toMatchObject({ start: '2026-11-12', done: true, doneAt: T0, doneOn: '2026-11-10' })
    const locked = dataWith({ items: [mkItem({ locked: true })] })
    expect(() => moveItemDates(locked, 'i1', { start: '2026-11-12', due: null, clearEnd: false })).toThrow('ロック中')
    expect(() => moveItemDates(emptyData(), 'i1', { start: '2026-11-12', due: null, clearEnd: false })).toThrow(DomainError)
  })

  it('〆のカード（list 生まれ）は締め切り日が変わり、Claude が足した物を動かしても by・ai・via は変わらない（ITEMS-016・270）', () => {
    const task = mkTask({ id: 'ce-t', due: '2026-11-10', by: 'connector', ai: 'claude', via: 'メール: 見積もりの依頼' })
    const next = moveItemDates(dataWith({ items: [task] }), 'ce-t', { start: null, due: '2026-11-14', clearEnd: false }, T0 + 1)
    expect(next.data.items['ce-t']).toMatchObject({
      due: '2026-11-14',
      by: 'connector',
      ai: 'claude',
      createdAt: T0,
      updatedAt: T0 + 1,
    })
  })

  it('［元に戻す］は開始日・締め切り日・終了時刻だけを戻す（後で直した件名はそのまま）', () => {
    const tenToTen = mkItem({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })
    const moved = moveItemDates(dataWith({ items: [tenToTen] }), 'i1', { start: '2026-11-09', due: '2026-11-09', clearEnd: true })
    const edited = updateItem(moved.data, 'i1', { title: '後で直した' }).data
    const back = restoreItemDates(edited, 'i1', moved.result, T0 + 7).items.i1
    expect(back).toMatchObject({
      start: '2026-11-09',
      due: '2026-11-11',
      endTime: '10:00',
      title: '後で直した',
      updatedAt: T0 + 7,
    })
    // もう戻っていれば何もしない
    const same = dataWith({ items: [tenToTen] })
    expect(restoreItemDates(same, 'i1', { start: '2026-11-09', due: '2026-11-11', endTime: '10:00' })).toBe(same)
  })

  it('［元に戻す］は、ゴミ箱へ移した・無い・戻すと決まりに合わない時は断る（D25）', () => {
    const data = dataWith({ items: [span] })
    const moved = moveItemDates(data, 'i1', { start: '2026-11-11', due: '2026-11-12', clearEnd: false })
    const trashed = trashItem(moved.data, 'i1', { at: T0 }).data
    expect(() => restoreItemDates(trashed, 'i1', moved.result)).toThrow(UNDO_REFUSED)
    expect(() => restoreItemDates(emptyData(), 'i1', moved.result)).toThrow(UNDO_REFUSED)
    // 動かした後に時刻を 23:00〜01:00 に直すと、1日の予定に戻せない
    const one = mkItem({ start: '2026-11-10', due: null, startTime: '10:00', endTime: '11:00' })
    const spread = moveItemDates(dataWith({ items: [one] }), 'i1', { start: '2026-11-10', due: null, clearEnd: false })
    const stretched = updateItem(spread.data, 'i1', { due: '2026-11-11', startTime: '23:00', endTime: '01:00' }).data
    expect(() => restoreItemDates(stretched, 'i1', { start: '2026-11-10', due: null, endTime: '01:00' })).toThrow(UNDO_REFUSED)
    expect(UNDO_REFUSED).toBe('元に戻せませんでした（予定が見つからないか、今の内容に合いません）')
  })
})

describe('複製（12.7・ITEMS-014・015・257..259）', () => {
  const src = {
    ...mkItem({
      id: 'ce-src',
      kind: 'private',
      title: '研修',
      start: '2026-11-10',
      due: '2026-11-12',
      startTime: '09:30',
      endTime: '17:00',
      listed: true,
      done: true,
      doneAt: T0,
      doneOn: '2026-11-12',
      locked: true,
      label: 'peony-l',
      requester: '総務',
      memo: '持ち物: 筆記用具',
      order: 5,
      by: 'connector',
      ai: 'claude',
      via: 'メール: 研修のご案内',
      createdAt: T0 - DAY,
      updatedAt: T0 - DAY,
    }),
    extra: { x: 1 },
  } as Item

  it('件名・区分・ラベル・依頼者・時刻・ロック・メモ・生まれ・listed を写し、日付・完了・作った日時・by／ai／via・知らない項目は写さない', () => {
    const data = dataWith({ items: [src] })
    const { data: next, result } = duplicateItem(data, 'ce-src', { start: '2026-11-17', due: '2026-11-19' }, T0 + 3)
    const dup = next.items[result]
    expect(result).not.toBe('ce-src')
    expect(dup).toEqual({
      id: result,
      v: 1,
      kind: 'private',
      title: '研修',
      origin: 'calendar',
      start: '2026-11-17',
      due: '2026-11-19',
      startTime: '09:30',
      endTime: '17:00',
      listed: true,
      done: false,
      doneAt: null,
      doneOn: null,
      locked: true,
      label: 'peony-l',
      requester: '総務',
      memo: '持ち物: 筆記用具',
      order: T0 + 3,
      by: 'user',
      ai: null,
      via: null,
      createdAt: T0 + 3,
      updatedAt: T0 + 3,
    })
    // 元はそのまま
    expect(next.items['ce-src']).toBe(src)
  })

  it('締め切り日の無い list 生まれは listed: true にする（どこにも出ない項目を作らない）。締め切り日があれば元の listed を写す', () => {
    const task = mkTask({ due: '2026-11-20', listed: false, requester: '営業部' })
    const data = dataWith({ items: [task] })
    const noDue = duplicateItem(data, 't1', { start: '2026-11-25', due: null })
    expect(noDue.data.items[noDue.result]).toMatchObject({ origin: 'list', listed: true, start: '2026-11-25', due: null })
    const withDue = duplicateItem(data, 't1', { start: null, due: '2026-11-27' })
    expect(withDue.data.items[withDue.result]).toMatchObject({ origin: 'list', listed: false, due: '2026-11-27' })
    const none = duplicateItem(data, 't1', { start: null, due: null })
    expect(none.data.items[none.result]).toMatchObject({ start: null, due: null, listed: true })
  })

  it('写す時刻で1日の予定の終了 < 開始になる日付にはできない。終了 = 開始になる時は終了を空に（ITEMS-259）', () => {
    const night = mkItem({ start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    const data = dataWith({ items: [night] })
    expect(() => duplicateItem(data, 'i1', { start: '2026-11-17', due: null })).toThrow(DATE_REFUSED)
    const ok = duplicateItem(data, 'i1', { start: '2026-11-17', due: '2026-11-18' })
    expect(ok.data.items[ok.result]).toMatchObject({ startTime: '23:00', endTime: '01:00' })
    const tenToTen = dataWith({
      items: [mkItem({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })],
    })
    const one = duplicateItem(tenToTen, 'i1', { start: '2026-11-17', due: null })
    expect(one.data.items[one.result]).toMatchObject({ startTime: '10:00', endTime: null })
  })

  it('calendar 生まれは開始日が要る。無い予定は複製できない', () => {
    const data = dataWith({ items: [mkItem()] })
    expect(() => duplicateItem(data, 'i1', { start: null, due: null })).toThrow('開始日が要ります')
    expect(() => duplicateItem(data, 'nope', { start: '2026-11-17', due: null })).toThrow(DomainError)
  })
})

describe('項目を足す時の決まり（ITEMS-002・003・008・012・013・015）', () => {
  it('区分は無ければ仕事、件名と依頼者は前後の空白を除き、依頼者は 60字まで、メモは長さの制限なし', () => {
    const r = addItem(emptyData(), { origin: 'calendar', title: ' 打ち合わせ ', start: '2026-11-10', requester: ' 総務 ' }, T0)
    expect(r.data.items[r.result]).toMatchObject({ kind: 'work', title: '打ち合わせ', requester: '総務', listed: false })
    expect(r.result).toMatch(/^[0-9a-f-]{36}$/)
    expect(() => addItem(emptyData(), { origin: 'list', title: 'x', requester: 'あ'.repeat(61) }, T0)).toThrow('依頼者は60字まで')
    expect(() => addItem(emptyData(), { origin: 'list', title: 'x', requester: 'あ'.repeat(60) }, T0)).not.toThrow()
    const long = addItem(emptyData(), { origin: 'list', title: 'x', memo: 'メ'.repeat(100_000) }, T0)
    expect(long.data.items[long.result].memo).toHaveLength(100_000)
  })
})

describe('休み（6.5・CALENDAR-048・049）', () => {
  it('休みはゴミ箱に入れない（外しても記録を残し、ゴミ箱は変わらない）', () => {
    const on = setOffDay(emptyData(), '2026-11-20', true, T0)
    const off = setOffDay(on, '2026-11-20', false, T0 + 1)
    expect(off.offDays['2026-11-20']).toMatchObject({ off: false })
    expect([off.trashEntries, off.trashRecords]).toEqual([{}, {}])
    // ゴミ箱に入れられる表に休みは無い
    expect(Object.values(TRASH_KIND_TABLE)).not.toContain('offDays')
  })

  it('付け外ししても by・ai・via は作った時のまま（Claude が付けた休みを手で外しても connector のまま）', () => {
    const byClaude = mkOffDay('2026-11-21', true, { by: 'connector', ai: 'claude', via: 'メール: 休みの連絡' })
    const off = setOffDay(dataWith({ offDays: [byClaude] }), '2026-11-21', false, T0)
    expect(off.offDays['2026-11-21']).toMatchObject({ off: false, by: 'connector', ai: 'claude', via: 'メール: 休みの連絡' })
    const mine = setOffDay(setOffDay(emptyData(), '2026-11-22', true, T0), '2026-11-22', false, T0 + 1)
    expect(mine.offDays['2026-11-22']).toMatchObject({ by: 'user', ai: null, via: null })
  })
})

describe('日が過ぎても完了していない予定（12.4・ITEMS-238）', () => {
  it('表示用の直しは日付を動かさない（日が過ぎても予定の日付は変わらない）', () => {
    const overdue = mkItem({ start: '2026-10-01', due: '2026-10-03' })
    const data = dataWith({ items: [overdue] })
    expect(repairData(data).data.items.i1).toBe(overdue)
  })
})
