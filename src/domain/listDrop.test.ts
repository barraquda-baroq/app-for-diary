// Task List の行をカレンダーへ落とす決まり（docs/SPEC.md の 13.6・7.11・6.4。開発）: ①④・カレンダーに出ている1日の物（生まれごと）・
// 複数日の物、今の日は何もしない、違う区分・日付でない・ロック中は落とせない、6.4 で断る日と終了時刻を消す日、時刻は変えない、
// お知らせの字、6週のマンスリーのマス目の落とせる日（2.10 の単体: ドラッグで動かせる日）、drag.ts の fitTimes
import { describe, expect, it } from 'vitest'
import { monthWeeks, toYmd } from './dates'
import { fitTimes, type DatePatch } from './drag'
import { isOnCalendar, periodOf } from './items'
import { canGrabTaskRow, listDropDays, listDropPatch, listDropToast } from './listDrop'
import { moveItemDates } from './ops'
import { T0, dataWith, mkItem, mkTask } from './testData'
import type { Item } from './types'

const drop = (item: Item, date: string, kind = item.kind) => listDropPatch(item, { date, kind })
const patch = (start: string | null, due: string | null, clearEnd = false): DatePatch => ({ start, due, clearEnd })

const none = mkTask({ id: 'none' }) // ①
const startOnly = mkTask({ id: 'start', start: '2026-11-12' }) // ④
const due = mkTask({ id: 'due', due: '2026-11-10' }) // ② 1日
const sameDay = mkTask({ id: 'same', start: '2026-11-10', due: '2026-11-10' }) // ③ 1日
const span = mkTask({ id: 'span', start: '2026-11-09', due: '2026-11-12' }) // ③ 複数日
const cal = mkItem({ id: 'cal', start: '2026-11-10', listed: true }) // カレンダー生まれ 1日
const calDue = mkItem({ id: 'cal-due', start: '2026-11-10', due: '2026-11-10', listed: true })
const calSpan = mkItem({ id: 'cal-span', start: '2026-11-09', due: '2026-11-12', listed: true })

describe('落とすと変わる物（13.6・7.11。開発）', () => {
  it.each([
    ['① → 締め切り日を D に', none, '2026-11-14', patch(null, '2026-11-14')],
    ['④（開始日が D 以前）→ 締め切り日を D に（期間になる）', startOnly, '2026-11-15', patch('2026-11-12', '2026-11-15')],
    ['④（開始日 = D）→ 1日', startOnly, '2026-11-12', patch('2026-11-12', '2026-11-12')],
    ['④（開始日が D より後）→ 開始日も D に', startOnly, '2026-11-10', patch('2026-11-10', '2026-11-10')],
    ['② 1日（list 生まれ）→ due = D（start は null のまま）', due, '2026-11-13', patch(null, '2026-11-13')],
    ['③ 1日（list 生まれ・start あり）→ start = D・due = D', sameDay, '2026-11-13', patch('2026-11-13', '2026-11-13')],
    ['カレンダー生まれの1日 → start = D（due は null のまま）', cal, '2026-11-13', patch('2026-11-13', null)],
    ['カレンダー生まれの1日（due あり）→ start = D・due = D', calDue, '2026-11-08', patch('2026-11-08', '2026-11-08')],
    ['複数日（list 生まれ）→ 締め切り日だけ', span, '2026-11-14', patch('2026-11-09', '2026-11-14')],
    ['複数日 → 開始日に落とすと1日になる', span, '2026-11-09', patch('2026-11-09', '2026-11-09')],
    ['複数日 → 期間の中へ縮める', span, '2026-11-10', patch('2026-11-09', '2026-11-10')],
    ['複数日（カレンダー生まれ）→ 締め切り日だけ', calSpan, '2026-11-20', patch('2026-11-09', '2026-11-20')],
  ] as const)('%s（S3-FRAME-205..207・S3-TASK-187..189・S3-TASK-121 と同じ）', (_name, item, date, want) => {
    expect(drop(item, date)).toEqual(want)
  })

  it('今の日に落とすと何もしない（1日の物は from、複数日は to。S3-TASK-191）', () => {
    for (const item of [due, sameDay, cal, calDue]) expect(drop(item, '2026-11-10'), item.id).toBe('same')
    expect(drop(span, '2026-11-12')).toBe('same')
    expect(drop(calSpan, '2026-11-12')).toBe('same')
    // カレンダーに出ていない物には「今の日」が無い
    expect(drop(startOnly, '2026-11-12')).not.toBe('same')
  })

  it('複数日は開始日より前の日には落とせない（S3-FRAME-207・S3-TASK-189）', () => {
    expect(drop(span, '2026-11-08')).toBeNull()
    expect(drop(calSpan, '2026-11-01')).toBeNull()
  })

  it('違う区分の段・日付でない所には落とせない（区分は変えない。S3-TASK-183 の段）', () => {
    expect(drop(none, '2026-11-14', 'private')).toBeNull()
    expect(drop(mkTask({ kind: 'private' }), '2026-11-14', 'work')).toBeNull()
    expect(drop(mkTask({ kind: 'private' }), '2026-11-14', 'private')).toEqual(patch(null, '2026-11-14'))
    expect(drop(none, '2026-11-31')).toBeNull()
    expect(drop(none, '')).toBeNull()
  })

  it('ロック中は掴めず、落としても変えない（13.6・7.10）', () => {
    const locked = { ...due, locked: true }
    expect(canGrabTaskRow(locked)).toEqual({ ok: false, reason: 'locked' })
    expect(canGrabTaskRow(due)).toEqual({ ok: true })
    expect(drop(locked, '2026-11-13')).toBeNull()
    expect(listDropDays(locked, ['2026-11-13']).size).toBe(0)
  })

  it('完了した物も動かせる（7.11 と同じ）', () => {
    expect(drop({ ...due, done: true, doneAt: T0, doneOn: '2026-11-10' }, '2026-11-11')).toEqual(patch(null, '2026-11-11'))
  })

  it('時刻は変えない（日付だけ。S3-TASK-191・開発）', () => {
    const timed = mkTask({ id: 't', due: '2026-11-10', startTime: '10:00', endTime: '11:00' })
    const r = drop(timed, '2026-11-12') as DatePatch
    expect(Object.keys(r).sort()).toEqual(['clearEnd', 'due', 'start'])
    expect(r).toEqual(patch(null, '2026-11-12'))
  })
})

describe('6.4（1日の物で終了 < 開始になる日には落とせない。drag.ts の fitTimes）', () => {
  it('締め切り日の無い①④に残っている時刻も、1日になる時は効く（S3-FRAME-208・S3-TASK-190）', () => {
    const night = mkTask({ id: 'n', startTime: '23:00', endTime: '01:00' })
    expect(drop(night, '2026-11-12')).toBeNull()
    const nightStart = mkTask({ id: 'ns', start: '2026-11-12', startTime: '23:00', endTime: '01:00' })
    expect(drop(nightStart, '2026-11-12')).toBeNull()
    expect(drop(nightStart, '2026-11-10')).toBeNull()
    expect(drop(nightStart, '2026-11-13')).toEqual(patch('2026-11-12', '2026-11-13'))
  })

  it('複数日を開始日に縮めて終了 < 開始なら落とせない、終了 = 開始なら終了時刻を消す（S3-FRAME-208・S3-TASK-026 と同じ）', () => {
    const night = mkTask({ id: 'n', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    expect(drop(night, '2026-11-10')).toBeNull()
    expect(drop(night, '2026-11-12')).toEqual(patch('2026-11-10', '2026-11-12'))
    const same = mkItem({ id: 's', start: '2026-11-10', due: '2026-11-11', startTime: '10:00', endTime: '10:00', listed: true })
    expect(drop(same, '2026-11-10')).toEqual(patch('2026-11-10', '2026-11-10', true))
  })

  it('fitTimes を drag.ts から使える（開始日 > 締め切り日は null）', () => {
    expect(fitTimes(none, '2026-11-12', '2026-11-10')).toBeNull()
    expect(fitTimes(none, null, '2026-11-10')).toEqual(patch(null, '2026-11-10'))
  })
})

describe('落とした後のお知らせ（S3-FRAME-211・S3-TASK-193）', () => {
  it('カレンダー生まれの1日の物を丸ごと動かした時は「11/12（木）へ移しました」', () => {
    expect(listDropToast(cal, drop(cal, '2026-11-12') as DatePatch)).toBe('11/12（木）へ移しました')
    expect(listDropToast(calDue, drop(calDue, '2026-11-12') as DatePatch)).toBe('11/12（木）へ移しました')
  })

  it('ほかは「締め切り日を 11/12（木）にしました」（list 生まれの1日・①④・複数日）', () => {
    for (const item of [none, startOnly, due, sameDay, span, calSpan]) {
      const p = drop(item, '2026-11-12')
      const r = p === 'same' ? patch(item.start, '2026-11-12') : (p as DatePatch)
      expect(listDropToast(item, r), item.id).toBe('締め切り日を 11/12（木）にしました')
    }
  })
})

describe('落とした後のお知らせ（日付の無い patch）', () => {
  it('日付の無い patch でも投げない（日付の所が空の字になる）', () => {
    expect(listDropToast(cal, patch(null, null))).toBe('へ移しました')
    expect(listDropToast(none, patch(null, null))).toBe('締め切り日を にしました')
  })
})

describe('落とせる日の印（listDropDays。2.10 の単体: ドラッグで動かせる日。S3-FRAME-342・S3-TASK-203）', () => {
  /** 2027年1月のマンスリーのマス目（6週・42日。前後の月の日も: 2026-12-27（日）〜2027-02-06（土）） */
  const grid = monthWeeks(2027, 1)
    .flat()
    .map((c) => toYmd(c.date))
  const jCal = mkItem({ id: 'jc', start: '2027-01-10', listed: true })
  const jSpan = mkTask({ id: 'js', start: '2027-01-09', due: '2027-01-12' })

  it('マス目は 2026-12-27（日）〜2027-02-06（土）の6週', () => {
    expect(grid).toHaveLength(42)
    expect([grid[0], grid[41]]).toEqual(['2026-12-27', '2027-02-06'])
  })

  it('①はどの日にも落とせる（前後の月の日も。S3-TASK-203）', () => {
    const days = listDropDays(none, grid)
    expect(days.size).toBe(42)
    expect(days.get('2026-12-27')).toEqual(patch(null, '2026-12-27'))
    expect(days.get('2027-02-06')).toEqual(patch(null, '2027-02-06'))
  })

  it('1日の物は今の日が same、ほかの日は丸ごと動かす', () => {
    const days = listDropDays(jCal, grid)
    expect(days.size).toBe(42)
    expect(days.get('2027-01-10')).toBe('same')
    expect(days.get('2026-12-31')).toEqual(patch('2026-12-31', null))
  })

  it('複数日は開始日から後の日だけ（締め切り日は same）', () => {
    const days = listDropDays(jSpan, grid)
    expect([...days.keys()][0]).toBe('2027-01-09')
    // 2026-12-27〜2027-01-08 の 13日は落とせない
    expect(days.size).toBe(42 - 13)
    expect(days.get('2027-01-12')).toBe('same')
    expect(days.get('2027-02-06')).toEqual(patch('2027-01-09', '2027-02-06'))
    expect(days.has('2027-01-08')).toBe(false)
  })

  it('6.4 で断る日は印を付けない（S3-TASK-190）', () => {
    const nightStart = mkTask({ id: 'ns', start: '2027-01-12', startTime: '23:00', endTime: '01:00' })
    const days = listDropDays(nightStart, grid)
    expect([...days.keys()][0]).toBe('2027-01-13')
    // 2026-12-27〜2027-01-12 の 17日は1日の予定になって断られる
    expect(days.size).toBe(42 - 17)
  })

  it('プライベートの物も、仕事の物と同じ日に落とせる（その物の区分の段へ。S3-TASK-203）', () => {
    const priv = mkTask({ id: 'p', kind: 'private' })
    const days = listDropDays(priv, grid)
    expect(days.size).toBe(42)
    expect([...days.keys()]).toEqual([...listDropDays(none, grid).keys()])
    expect(days.get('2027-01-15')).toEqual(patch(null, '2027-01-15'))
    const privSpan = mkTask({ id: 'ps', kind: 'private', start: '2027-01-09', due: '2027-01-12' })
    expect([...listDropDays(privSpan, grid).keys()]).toEqual([...listDropDays(jSpan, grid).keys()])
  })

  it('日付でない値は飛ばす', () => {
    expect([...listDropDays(none, ['x', '2026-11-10']).keys()]).toEqual(['2026-11-10'])
  })
})

describe('ops.moveItemDates に渡すと（落とした後の記録）', () => {
  it('①を落とすとカレンダーに出て〆の1日の予定になる。生まれと時刻は変わらない（S3-TASK-003）', () => {
    const timed = { ...none, startTime: '09:00', endTime: '10:00' }
    const p = drop(timed, '2026-11-12') as DatePatch
    const data = moveItemDates(dataWith({ items: [timed] }), 'none', p, T0).data
    const next = data.items.none
    expect(next).toMatchObject({ origin: 'list', due: '2026-11-12', start: null, startTime: '09:00', endTime: '10:00' })
    expect(isOnCalendar(next)).toBe(true)
    expect(periodOf(next)).toEqual({ from: '2026-11-12', to: '2026-11-12' })
  })

  it('clearEnd の時は終了時刻を空にする', () => {
    const same = mkItem({ id: 's', start: '2026-11-10', due: '2026-11-11', startTime: '10:00', endTime: '10:00', listed: true })
    const data = moveItemDates(dataWith({ items: [same] }), 's', drop(same, '2026-11-10') as DatePatch, T0).data
    expect(data.items.s).toMatchObject({ start: '2026-11-10', due: '2026-11-10', startTime: '10:00', endTime: null })
  })
})
