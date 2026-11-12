// ウィークリーのドラッグで日を動かす決まり（docs/SPEC.md の 7.10・7.11・13.6）: 7.11 の表の4通り、動かせない時（ロック・
// 違う区分・開始日 > 締め切り日・1日の予定で終了 < 開始）、終了 = 開始で終了を空に、元の日は何もしない、見えていない始点・終点、
// 完了した予定、〆のカード、掴んだ週の外（前後の週）の日、落とせる日の一覧、お知らせの文（CALENDAR-184: ドラッグで動かせる日は
// 単体のテストで全部確かめる）
import { describe, expect, it } from 'vitest'
import { canGrab, dropDays, dropPatch, dropToast, type DatePatch, type Handle, type WeekCtx } from './drag'
import { mkItem, mkTask } from './testData'
import type { Item } from './types'

/** 2026-11-08（日）〜11-14（土） */
const WEEK: WeekCtx = { from: '2026-11-08', to: '2026-11-14' }

const drop = (item: Item, handle: Handle, date: string, kind = item.kind) => dropPatch(item, handle, { date, kind }, WEEK)
const patch = (start: string | null, due: string | null, clearEnd = false): DatePatch => ({ start, due, clearEnd })

const oneDay = mkItem({ id: 'a', start: '2026-11-10' })
const oneDayWithDue = mkItem({ id: 'b', start: '2026-11-10', due: '2026-11-10' })
const dueTask = mkTask({ id: 'c', due: '2026-11-10' })
const sameDayTask = mkTask({ id: 'd', start: '2026-11-10', due: '2026-11-10' })
const span = mkItem({ id: 'e', start: '2026-11-09', due: '2026-11-12', startTime: '10:00', endTime: '15:00' })
const spanTask = mkTask({ id: 'f', start: '2026-11-09', due: '2026-11-12' })

describe('7.11 の表（動かすと変わる物）', () => {
  it.each([
    // [名前, 項目, 掴む所, 落とす日, 変わる物]
    ['1日の予定（calendar 生まれ）: start = D（due は null のまま）', oneDay, 'card', '2026-11-12', patch('2026-11-12', null)],
    [
      '1日の予定（calendar 生まれ・due あり）: start = D・due = D',
      oneDayWithDue,
      'card',
      '2026-11-08',
      patch('2026-11-08', '2026-11-08'),
    ],
    ['1日の予定（list 生まれ・〆）: due = D（start は null のまま）', dueTask, 'card', '2026-11-14', patch(null, '2026-11-14')],
    [
      '1日の予定（list 生まれ・start あり）: due = D・start = D',
      sameDayTask,
      'card',
      '2026-11-13',
      patch('2026-11-13', '2026-11-13'),
    ],
    ['複数日の始点: D ≤ 締め切り日 なら start = D だけ', span, 'start', '2026-11-10', patch('2026-11-10', '2026-11-12')],
    ['複数日の始点: 前の日へ（期間が延びる）', span, 'start', '2026-11-08', patch('2026-11-08', '2026-11-12')],
    ['複数日の始点: 締め切り日に置くと1日の予定', span, 'start', '2026-11-12', patch('2026-11-12', '2026-11-12')],
    ['複数日の終点: D ≥ 開始日 なら due = D だけ', span, 'end', '2026-11-14', patch('2026-11-09', '2026-11-14')],
    ['複数日の終点: 開始日に置くと1日の予定', span, 'end', '2026-11-09', patch('2026-11-09', '2026-11-09')],
    ['list 生まれの複数日の始点', spanTask, 'start', '2026-11-11', patch('2026-11-11', '2026-11-12')],
    ['list 生まれの複数日の終点', spanTask, 'end', '2026-11-13', patch('2026-11-09', '2026-11-13')],
  ] as const)('%s（CALENDAR-168..171・ITEMS-270）', (_name, item, handle, date, want) => {
    expect(drop(item, handle, date)).toEqual(want)
  })

  it('時刻は変えない（日付だけを返す。CALENDAR-172）', () => {
    expect(Object.keys(drop(span, 'start', '2026-11-10') as DatePatch).sort()).toEqual(['clearEnd', 'due', 'start'])
  })

  it('完了した予定も動かせる（CALENDAR-174）', () => {
    const done = { ...oneDay, done: true, doneAt: 1, doneOn: '2026-11-10' }
    expect(drop(done, 'card', '2026-11-11')).toEqual(patch('2026-11-11', null))
    expect(canGrab(done, 'card', WEEK)).toEqual({ ok: true })
  })
})

describe('動かせない時（CALENDAR-165・175・177・7.10）', () => {
  it('ロック中は掴めず（揺れる）、どの日にも落とせない', () => {
    const locked = { ...oneDay, locked: true }
    expect(canGrab(locked, 'card', WEEK)).toEqual({ ok: false, reason: 'locked' })
    expect(drop(locked, 'card', '2026-11-12')).toBeNull()
    expect(dropDays(locked, 'card', WEEK).size).toBe(0)
  })

  it('日付でない所には落とせない', () => {
    expect(drop(oneDay, 'card', '2026-13-01')).toBeNull()
    expect(drop(oneDay, 'card', '')).toBeNull()
  })

  it('仕事 ↔ プライベートはまたげない', () => {
    expect(drop(oneDay, 'card', '2026-11-12', 'private')).toBeNull()
    expect(drop({ ...oneDay, kind: 'private' }, 'card', '2026-11-12', 'private')).toEqual(patch('2026-11-12', null))
  })

  it('始点を締め切り日より後・終点を開始日より前には落とせない', () => {
    expect(drop(span, 'start', '2026-11-13')).toBeNull()
    expect(drop(span, 'end', '2026-11-08')).toBeNull()
  })

  it('1日の予定で終了 < 開始になる日には落とせない（例 11/10 23:00〜11/11 01:00 の始点を 11/11 へ。CALENDAR-042・175）', () => {
    const night = mkItem({ id: 'n', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    expect(drop(night, 'start', '2026-11-11')).toBeNull()
    expect(drop(night, 'end', '2026-11-10')).toBeNull()
    // 複数日のままの日には落とせる
    expect(drop(night, 'start', '2026-11-09')).toEqual(patch('2026-11-09', '2026-11-11'))
    expect(drop(night, 'end', '2026-11-12')).toEqual(patch('2026-11-10', '2026-11-12'))
    expect([...dropDays(night, 'start', WEEK).keys()]).toEqual(['2026-11-08', '2026-11-09', '2026-11-10'])
  })

  it('始点が見えていない予定の開始日・終点が見えていない予定の締め切り日は、その週では動かせない（揺らさない。CALENDAR-176・177）', () => {
    const fromLastWeek = mkItem({ id: 'p', start: '2026-11-05', due: '2026-11-10', locked: true })
    expect(canGrab(fromLastWeek, 'start', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
    expect(drop(fromLastWeek, 'start', '2026-11-09')).toBeNull()
    const toNextWeek = mkItem({ id: 'q', start: '2026-11-12', due: '2026-11-18' })
    expect(canGrab(toNextWeek, 'end', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
    expect(canGrab(toNextWeek, 'start', WEEK)).toEqual({ ok: true })
    expect(drop(toNextWeek, 'start', '2026-11-14')).toEqual(patch('2026-11-14', '2026-11-18'))
    // ロック中でも見えていない所は locked ではなく hiddenEndpoint（受けた表示・端の矢印は揺れない）
    expect(canGrab({ ...toNextWeek, locked: true }, 'end', WEEK).ok).toBe(false)
    expect(canGrab({ ...toNextWeek, locked: true }, 'end', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
  })

  it('形の合わない掴む所（複数日のカード・1日の予定の始点や終点）と、カレンダーに出ていない物は掴めない', () => {
    expect(canGrab(span, 'card', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
    expect(canGrab(oneDay, 'start', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
    expect(canGrab(oneDay, 'end', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
    expect(canGrab(mkTask(), 'card', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
    expect(canGrab(mkTask({ start: '2026-11-10' }), 'card', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
    expect(canGrab(mkItem({ start: '2026-11-20' }), 'card', WEEK)).toEqual({ ok: false, reason: 'hiddenEndpoint' })
  })
})

describe('掴んだ週の外（前後の週）の日（掴んだまま左右の端に留まって移った週。22. の段階2の終わりの確かめ）', () => {
  it('1日の予定・〆のカードは、どの週の日へも同じ決まりで移る', () => {
    expect(drop(oneDay, 'card', '2026-11-18')).toEqual(patch('2026-11-18', null))
    expect(drop(oneDayWithDue, 'card', '2026-11-03')).toEqual(patch('2026-11-03', '2026-11-03'))
    expect(drop(dueTask, 'card', '2026-11-21')).toEqual(patch(null, '2026-11-21'))
    expect(drop(sameDayTask, 'card', '2026-12-01')).toEqual(patch('2026-12-01', '2026-12-01'))
  })

  it('始点は締め切り日まで（前の週へは延びる）、終点は開始日から（次の週へは延びる）。開始日 ≤ 締め切り日（I1）', () => {
    expect(drop(span, 'start', '2026-11-02')).toEqual(patch('2026-11-02', '2026-11-12'))
    expect(drop(span, 'end', '2026-11-20')).toEqual(patch('2026-11-09', '2026-11-20'))
    // 次の週へ続く予定（11/12〜11/18）の始点は、次の週の締め切り日まで置ける（その日に置くと1日の予定）
    const toNextWeek = mkItem({ id: 'q', start: '2026-11-12', due: '2026-11-18' })
    expect(drop(toNextWeek, 'start', '2026-11-17')).toEqual(patch('2026-11-17', '2026-11-18'))
    expect(drop(toNextWeek, 'start', '2026-11-18')).toEqual(patch('2026-11-18', '2026-11-18'))
    expect(drop(toNextWeek, 'start', '2026-11-19')).toBeNull()
    // 前の週から続く予定（11/5〜11/10）の終点は、前の週の開始日までしか戻せない
    const fromLastWeek = mkItem({ id: 'p', start: '2026-11-05', due: '2026-11-10' })
    expect(drop(fromLastWeek, 'end', '2026-11-05')).toEqual(patch('2026-11-05', '2026-11-05'))
    expect(drop(fromLastWeek, 'end', '2026-11-04')).toBeNull()
  })

  it('1日の予定で終了 < 開始になる日・違う区分・ロック中は、前後の週でも落とせない（6.4・CALENDAR-165・7.10）', () => {
    const night = mkItem({ id: 'n', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    expect(drop(night, 'end', '2026-11-17')).toEqual(patch('2026-11-10', '2026-11-17'))
    expect(drop(oneDay, 'card', '2026-11-18', 'private')).toBeNull()
    expect(drop({ ...oneDay, locked: true }, 'card', '2026-11-18')).toBeNull()
  })

  it('掴めるかは掴んだ週で決める（掴む所が掴んだ週に見えていない物は、前後の週でも落とせない。CALENDAR-176・177）', () => {
    const nextWeek = { from: '2026-11-15', to: '2026-11-21' }
    // 11/12〜11/18 の終点は 11/8 の週では見えていないので、その週で掴んだことにはならない
    const toNextWeek = mkItem({ id: 'q', start: '2026-11-12', due: '2026-11-18' })
    expect(drop(toNextWeek, 'end', '2026-11-20')).toBeNull()
    expect(dropPatch(toNextWeek, 'end', { date: '2026-11-20', kind: 'work' }, nextWeek)).toEqual(
      patch('2026-11-12', '2026-11-20'),
    )
  })

  it('印を付ける日は、今見ている週の日（掴んだ週で決めた決まりで）', () => {
    const nextWeek = { from: '2026-11-15', to: '2026-11-21' }
    const days = dropDays(oneDay, 'card', WEEK, nextWeek)
    expect([...days.keys()]).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
    ])
    expect(days.get('2026-11-18')).toEqual(patch('2026-11-18', null))
    // 始点は締め切り日（11/12）まで: 次の週には落とせる日が無い。前の週は全部
    expect(dropDays(span, 'start', WEEK, nextWeek).size).toBe(0)
    expect(dropDays(span, 'start', WEEK, { from: '2026-11-01', to: '2026-11-07' }).size).toBe(7)
    // 終点は開始日（11/9）から: 前の週には無い
    expect(dropDays(span, 'end', WEEK, { from: '2026-11-01', to: '2026-11-07' }).size).toBe(0)
    expect(dropDays(span, 'end', WEEK, nextWeek).size).toBe(7)
  })
})

describe('終了 = 開始・元の日（D25）', () => {
  it('動かして1日の予定で終了 = 開始になる時は、終了時刻を空にする', () => {
    const tenToTen = mkItem({ id: 't', start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })
    expect(drop(tenToTen, 'end', '2026-11-09')).toEqual(patch('2026-11-09', '2026-11-09', true))
    expect(drop(tenToTen, 'start', '2026-11-11')).toEqual(patch('2026-11-11', '2026-11-11', true))
    // 複数日のままならそのまま
    expect(drop(tenToTen, 'end', '2026-11-10')).toEqual(patch('2026-11-09', '2026-11-10', false))
  })

  it('元の日に落とした時は same（何もしない。同じ日の中の並べ替えもしない）', () => {
    expect(drop(oneDay, 'card', '2026-11-10')).toBe('same')
    expect(drop(dueTask, 'card', '2026-11-10')).toBe('same')
    expect(drop(span, 'start', '2026-11-09')).toBe('same')
    expect(drop(span, 'end', '2026-11-12')).toBe('same')
  })
})

describe('落とせる日の一覧（掴んだ時に印を付ける日。D25・CALENDAR-184）', () => {
  it('1日の予定は週のどの日も（元の日は same）', () => {
    const days = dropDays(oneDay, 'card', WEEK)
    expect([...days.keys()]).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ])
    expect(days.get('2026-11-10')).toBe('same')
    expect(days.get('2026-11-12')).toEqual(patch('2026-11-12', null))
  })

  it('始点は締め切り日まで、終点は開始日から', () => {
    expect([...dropDays(span, 'start', WEEK).keys()]).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ])
    expect([...dropDays(span, 'end', WEEK).keys()]).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ])
  })

  it('年をまたぐ週（2026-12-27〜2027-01-02）', () => {
    const week = { from: '2026-12-27', to: '2027-01-02' }
    const item = mkItem({ start: '2026-12-31' })
    const days = dropDays(item, 'card', week)
    expect(days.size).toBe(7)
    expect(days.get('2027-01-02')).toEqual(patch('2027-01-02', null))
  })
})

describe('動かした後のお知らせ（CALENDAR-179・ITEMS-270）', () => {
  it.each([
    ['1日の予定', oneDay, 'card', patch('2026-11-12', null), '11/12（木）へ移しました'],
    ['始点', span, 'start', patch('2026-11-10', '2026-11-12'), '開始日を 11/10（火）にしました'],
    ['終点', span, 'end', patch('2026-11-09', '2026-11-14'), '締め切り日を 11/14（土）にしました'],
    ['list 生まれの〆のカード', dueTask, 'card', patch(null, '2026-11-14'), '締め切り日を 11/14（土）にしました'],
    [
      'list 生まれ（開始日あり）の〆のカード',
      sameDayTask,
      'card',
      patch('2026-11-14', '2026-11-14'),
      '締め切り日を 11/14（土）にしました',
    ],
    ['list 生まれの複数日の始点', spanTask, 'start', patch('2026-11-11', '2026-11-12'), '開始日を 11/11（水）にしました'],
  ] as const)('%s', (_name, item, handle, p, text) => {
    expect(dropToast(item, handle, p)).toBe(text)
  })
})
