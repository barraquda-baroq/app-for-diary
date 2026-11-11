// 予定の表記と文（docs/SPEC.md の 3.9・4.11・4.12・7.7・7.11・11.2・12.3・12.5・12.7・12.8）: 時刻・期間の表記の表の全部、
// デイリーのリストの右の端、list 生まれの4つの文、お知らせの文、マスと丸の読み上げ
import { describe, expect, it } from 'vitest'
import { calendarItems, type CalItem } from './calendar'
import { doneLabel, listStatusLine, listTail, monthCellLabel, monthCountLabel, timeLabel, toastText } from './itemText'
import { mkItem, mkTask } from './testData'
import type { Item } from './types'

/** 1件のカレンダーの項目 */
const one = (p: Partial<Item>): CalItem => {
  const [c] = calendarItems({ x: mkItem({ id: 'x', ...p }) })
  return c
}

describe('時刻・期間の表記（7.7）', () => {
  it.each<[string, Partial<Item>, string]>([
    ['1日・時刻なし → 出さない', { start: '2026-11-10' }, ''],
    ['1日・開始だけ → 10:00', { start: '2026-11-10', startTime: '10:00' }, '10:00'],
    ['1日・開始〜終了 → 10:00–11:30（en dash）', { start: '2026-11-10', startTime: '10:00', endTime: '11:30' }, '10:00–11:30'],
    ['1日・22:00〜24:00', { start: '2026-11-10', startTime: '22:00', endTime: '24:00' }, '22:00–24:00'],
    ['時の頭の 0 は落とす（9:00）', { start: '2026-11-10', startTime: '09:05', endTime: '09:30' }, '9:05–9:30'],
    ['0時台も 0:30', { start: '2026-11-10', startTime: '00:30' }, '0:30'],
    ['複数日・時刻なし → 〜11/11', { start: '2026-11-09', due: '2026-11-11' }, '〜11/11'],
    [
      '複数日・時刻あり → 11/9 10:00〜11/11 15:00',
      { start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '15:00' },
      '11/9 10:00〜11/11 15:00',
    ],
    [
      '複数日・開始だけ → 11/9 10:00〜11/11（終了時刻の無い複数日）',
      { start: '2026-11-09', due: '2026-11-11', startTime: '10:00' },
      '11/9 10:00〜11/11',
    ],
    [
      '複数日・時刻あり・頭の 0 を落とす',
      { start: '2026-11-09', due: '2026-11-10', startTime: '09:00', endTime: '08:30' },
      '11/9 9:00〜11/10 8:30',
    ],
    ['月・年をまたぐ（0 で埋めない）', { start: '2026-12-30', due: '2027-01-02' }, '〜1/2'],
  ])('%s', (_, p, expected) => {
    expect(timeLabel(one(p))).toBe(expected)
  })

  it('複数日・時刻なしは、最終日に 11/9〜（ほかの日は 〜11/11）', () => {
    const c = one({ start: '2026-11-09', due: '2026-11-11' })
    expect(timeLabel(c, { on: '2026-11-09' })).toBe('〜11/11')
    expect(timeLabel(c, { on: '2026-11-10' })).toBe('〜11/11')
    expect(timeLabel(c, { on: '2026-11-11' })).toBe('11/9〜')
  })

  it('複数日・時刻ありは、どの日も同じ表記', () => {
    const c = one({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '15:00' })
    expect(timeLabel(c, { on: '2026-11-11' })).toBe('11/9 10:00〜11/11 15:00')
  })

  it('datesOnly（ウィークリーの始点のカードが狭い時。10.2）は、複数日の時刻を除いて 11/28〜12/2', () => {
    expect(
      timeLabel(one({ start: '2026-11-28', due: '2026-12-02', startTime: '10:00', endTime: '15:00' }), { datesOnly: true }),
    ).toBe('11/28〜12/2')
    expect(timeLabel(one({ start: '2026-11-28', due: '2026-12-02', startTime: '10:00' }), { datesOnly: true })).toBe(
      '11/28〜12/2',
    )
    // 時刻の無い複数日は省く時刻が無いので、7.7 の表記のまま（長い 11/28〜12/2 にしない）
    expect(timeLabel(one({ start: '2026-11-28', due: '2026-12-02' }), { datesOnly: true })).toBe('〜12/2')
    expect(timeLabel(one({ start: '2026-11-28', due: '2026-12-02' }), { datesOnly: true, on: '2026-12-02' })).toBe('11/28〜')
    // 1日の予定は変わらない
    expect(timeLabel(one({ start: '2026-11-10', startTime: '10:00' }), { datesOnly: true })).toBe('10:00')
  })

  it('list 生まれも期間（from〜to）で出す（開始日 > 締め切り日は締め切り日の1日）', () => {
    const [a] = calendarItems({ t: mkTask({ id: 't', start: '2026-11-10', due: '2026-11-20' }) })
    expect(timeLabel(a)).toBe('〜11/20')
    const [b] = calendarItems({ t: mkTask({ id: 't', start: '2026-11-25', due: '2026-11-20', startTime: '10:00' }) })
    expect(timeLabel(b)).toBe('10:00')
  })
})

describe('デイリーのリストの右の端（11.2）', () => {
  const c = one({ start: '2026-11-09', due: '2026-11-11' })

  it('初日「━＞ 〜11/11」、間の日は受けた表示で「━＞ 〜11/11」、最終日は受けた表示で「━●」', () => {
    expect(listTail(c, '2026-11-09')).toEqual({ mark: '━＞', range: '〜11/11', received: false })
    expect(listTail(c, '2026-11-10')).toEqual({ mark: '━＞', range: '〜11/11', received: true })
    expect(listTail(c, '2026-11-11')).toEqual({ mark: '━●', range: null, received: true })
  })

  it('2日だけの予定は初日と最終日だけ', () => {
    const two = one({ start: '2026-11-30', due: '2026-12-01' })
    expect(listTail(two, '2026-11-30')).toEqual({ mark: '━＞', range: '〜12/1', received: false })
    expect(listTail(two, '2026-12-01')).toEqual({ mark: '━●', range: null, received: true })
  })

  it('1日の予定と、期間の外の日は無し', () => {
    expect(listTail(one({ start: '2026-11-10' }), '2026-11-10')).toBeNull()
    expect(listTail(c, '2026-11-08')).toBeNull()
    expect(listTail(c, '2026-11-12')).toBeNull()
  })
})

describe('list 生まれの「今どう出るか」の1行（12.3・6.3 の4通り）', () => {
  it.each<[string, { start: string | null; due: string | null }, string]>([
    ['① どちらも空', { start: null, due: null }, 'カレンダーには出ません（Task List だけ）'],
    [
      '④ 開始日だけ',
      { start: '2026-11-10', due: null },
      '開始日だけではカレンダーに出ません。締め切り日を入れるとカレンダーに出ます',
    ],
    ['② 締め切り日だけ', { start: null, due: '2026-11-20' }, '11/20（金）の1日の予定としてカレンダーに出ます'],
    ['③ 両方', { start: '2026-11-10', due: '2026-11-20' }, '11/10（火）〜11/20（金）の予定としてカレンダーに出ます'],
    ['③ 同じ日', { start: '2026-11-20', due: '2026-11-20' }, '11/20（金）の1日の予定としてカレンダーに出ます'],
    [
      '③ 開始日が締め切り日より後（締め切り日の1日）',
      { start: '2026-11-25', due: '2026-11-20' },
      '11/20（金）の1日の予定としてカレンダーに出ます',
    ],
    ['形の正しくない日付は無いものとみなす', { start: '2026-02-30', due: null }, 'カレンダーには出ません（Task List だけ）'],
  ])('%s', (_, d, expected) => {
    expect(listStatusLine(d)).toBe(expected)
  })
})

describe('お知らせの文（3.9・7.11・12.5・12.7・12.8・6.3）', () => {
  it('ドラッグの後: 1日の予定・始点・終点と list 生まれ', () => {
    expect(toastText.moved('2026-11-12')).toBe('11/12（木）へ移しました')
    expect(toastText.startSet('2026-11-10')).toBe('開始日を 11/10（火）にしました')
    expect(toastText.dueSet('2026-11-14')).toBe('締め切り日を 11/14（土）にしました')
  })

  it('完了・複製・削除・Task List に戻した', () => {
    expect(toastText.done('定例会議')).toBe('『定例会議』を完了にしました')
    expect(toastText.duplicated('2026-11-17')).toBe('11/17（火）に複製しました')
    expect(toastText.duplicated(null)).toBe('Task List に複製しました')
    expect(toastText.deleted('見積書を出す')).toBe('『見積書を出す』を削除しました')
    expect(toastText.relisted).toBe('カレンダーから外れたので Task List に戻しました')
  })
})

describe('読み上げ（4.11・4.12）', () => {
  it('マンスリーのマス: 日付・件数・休み・祝日名をまとめる', () => {
    expect(monthCellLabel('2026-11-10', { work: 4, private: 3 }, true, null)).toBe(
      '11月10日（火）、仕事 4件、プライベート 3件、休み',
    )
    expect(monthCellLabel('2026-11-03', { work: 1, private: 0 }, false, '文化の日')).toBe(
      '11月3日（火）、仕事 1件、プライベート 0件、文化の日',
    )
    expect(monthCellLabel('2026-11-23', { work: 0, private: 2 }, true, '勤労感謝の日')).toBe(
      '11月23日（月）、仕事 0件、プライベート 2件、休み、勤労感謝の日',
    )
  })

  it('どちらも 0件の日は「予定なし」。100 以上は「99+件」', () => {
    expect(monthCellLabel('2026-11-11', { work: 0, private: 0 }, false, null)).toBe('11月11日（水）、予定なし')
    expect(monthCellLabel('2026-11-11', { work: 0, private: 0 }, true, null)).toBe('11月11日（水）、予定なし、休み')
    expect(monthCellLabel('2026-11-12', { work: 120, private: 99 }, false, null)).toBe(
      '11月12日（木）、仕事 99+件、プライベート 99件',
    )
  })

  it('マンスリーの数字のボタン', () => {
    expect(monthCountLabel('work', 4)).toBe('仕事 4件をデイリーで見る')
    expect(monthCountLabel('private', 0)).toBe('プライベート 0件をデイリーで見る')
  })

  it('完了の丸・●: 「『件名』を完了にする」／「『件名』の完了を外す」', () => {
    expect(doneLabel('定例会議', false)).toBe('『定例会議』を完了にする')
    expect(doneLabel('定例会議', true)).toBe('『定例会議』の完了を外す')
  })
})
