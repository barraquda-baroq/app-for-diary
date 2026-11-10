// 項目の計算（docs/SPEC.md の 2.10・6.3・6.4・6.11・7.6・12.4）とラベル（4.6・19.4）:
// カレンダーに出る条件と期間（6.3 の表の全部）・Task List の7日の境目・数え方・決まり・項目の月・ラベルの引き方
import { describe, expect, it } from 'vitest'
import {
  countOn,
  formatCount,
  hasDueMark,
  isInTaskList,
  isMultiDay,
  isOnCalendar,
  itemPackMonth,
  itemProblems,
  monthCounts,
  periodOf,
} from './items'
import { LABEL_DEFAULT_NAMES, LABEL_KEYS, isLabelKey, labelDisplayName, labelKeyOf } from './labels'
import { DAY, HOUR, T0, mkItem, mkLabelName, mkTask } from './testData'

const codes = (it: Parameters<typeof itemProblems>[0]) => itemProblems(it).map((p) => p.code)

describe('カレンダーに出る条件と期間（6.3）', () => {
  it('Task List の4通り（list 生まれ）', () => {
    // ① 開始日なし・締め切り日なし → Task List だけ
    const t1 = mkTask()
    expect(periodOf(t1)).toBeNull()
    expect(isOnCalendar(t1)).toBe(false)
    expect(hasDueMark(t1)).toBe(false)
    // ② 締め切り日だけ → 締め切り日の1日の予定。「〆」
    const t2 = mkTask({ due: '2026-11-20' })
    expect(periodOf(t2)).toEqual({ from: '2026-11-20', to: '2026-11-20' })
    expect(hasDueMark(t2)).toBe(true)
    expect(isMultiDay(t2)).toBe(false)
    // ③ 両方 → 開始日〜締め切り日の予定。「〆」
    const t3 = mkTask({ start: '2026-11-10', due: '2026-11-20' })
    expect(periodOf(t3)).toEqual({ from: '2026-11-10', to: '2026-11-20' })
    expect(hasDueMark(t3)).toBe(true)
    expect(isMultiDay(t3)).toBe(true)
    // ④ 開始日だけ → カレンダーに出ない（I7）
    const t4 = mkTask({ start: '2026-11-10' })
    expect(periodOf(t4)).toBeNull()
    expect(isOnCalendar(t4)).toBe(false)
  })

  it('list 生まれで開始日が締め切り日より後なら、締め切り日の1日（開始日は無いものとみなす）', () => {
    expect(periodOf(mkTask({ start: '2026-11-25', due: '2026-11-20' }))).toEqual({ from: '2026-11-20', to: '2026-11-20' })
  })

  it('calendar 生まれ: 締め切り日が空ならその日1日、あれば期間。「〆」は付けない', () => {
    const e1 = mkItem({ start: '2026-11-10' })
    expect(periodOf(e1)).toEqual({ from: '2026-11-10', to: '2026-11-10' })
    expect(hasDueMark(e1)).toBe(false)
    const e2 = mkItem({ start: '2026-11-10', due: '2026-11-12' })
    expect(periodOf(e2)).toEqual({ from: '2026-11-10', to: '2026-11-12' })
    expect(isMultiDay(e2)).toBe(true)
    // 開始日が締め切り日より後（同期で表示できない形になった時）は開始日の1日（6.12 の修復と同じ）
    expect(periodOf(mkItem({ start: '2026-11-15', due: '2026-11-12' }))).toEqual({ from: '2026-11-15', to: '2026-11-15' })
    // 開始日が無い（壊れた記録）時は締め切り日から
    expect(periodOf(mkItem({ start: null, due: '2026-11-12' }))).toEqual({ from: '2026-11-12', to: '2026-11-12' })
    // 形の正しくない日付は無いものとみなす
    expect(periodOf(mkItem({ start: '2026-11-10', due: '2026-11-31' }))).toEqual({ from: '2026-11-10', to: '2026-11-10' })
  })
})

describe('Task List に出るか（6.3・13.4）', () => {
  it('listed が false なら出ない（カレンダーで入れて「Task List にも出す」がオフ）', () => {
    expect(isInTaskList(mkItem({ listed: false }), T0)).toBe(false)
    expect(isInTaskList(mkItem({ listed: true }), T0)).toBe(true)
  })

  it('済んでから 7日（168時間）を過ぎた物は出ない。ちょうど 168時間はまだ出る', () => {
    const doneAt = T0 - 7 * DAY
    expect(isInTaskList(mkTask({ done: true, doneAt }), T0)).toBe(true)
    expect(isInTaskList(mkTask({ done: true, doneAt }), T0 + 1)).toBe(false)
    expect(isInTaskList(mkTask({ done: true, doneAt: T0 - 167 * HOUR }), T0)).toBe(true)
    // 済んでいない物は何日たっても出る
    expect(isInTaskList(mkTask({ createdAt: T0 - 400 * DAY }), T0)).toBe(true)
  })
})

describe('件数の数え方（7.6）', () => {
  const items = [
    mkItem({ id: 'a', start: '2026-11-10' }),
    mkItem({ id: 'b', start: '2026-11-10', kind: 'private' }),
    // 複数日の予定は期間中の毎日に数える
    mkItem({ id: 'c', start: '2026-11-09', due: '2026-11-11' }),
    // 完了した物は数えない
    mkItem({ id: 'd', start: '2026-11-10', done: true, doneAt: T0, doneOn: '2026-11-10' }),
    // カレンダーに出ないタスクは数えない
    mkTask({ id: 'e', start: '2026-11-10' }),
    // 締め切りのあるタスクは数える
    mkTask({ id: 'f', due: '2026-11-10' }),
    // 月をまたぐ複数日の予定
    mkItem({ id: 'g', start: '2026-10-30', due: '2026-11-02', kind: 'private' }),
  ]

  it('その日・その区分の数', () => {
    expect(countOn(items, '2026-11-10', 'work')).toBe(3)
    expect(countOn(items, '2026-11-10', 'private')).toBe(1)
    expect(countOn(items, '2026-11-11', 'work')).toBe(1)
    expect(countOn(items, '2026-11-12', 'work')).toBe(0)
  })

  it('月の日ごと（月をまたぐ予定はその月の分だけ）', () => {
    const m = monthCounts(items, 2026, 11)
    expect(Object.keys(m)).toHaveLength(30)
    expect(m['2026-11-10']).toEqual({ work: 3, private: 1 })
    expect(m['2026-11-09']).toEqual({ work: 1, private: 0 })
    expect(m['2026-11-01']).toEqual({ work: 0, private: 1 })
    expect(m['2026-11-02']).toEqual({ work: 0, private: 1 })
    expect(m['2026-11-03']).toEqual({ work: 0, private: 0 })
    expect(monthCounts(items, 2026, 10)['2026-10-31']).toEqual({ work: 0, private: 1 })
  })

  it('完了すると期間中のすべての日から −1（完了は予定全体で1回）', () => {
    const done = items.map((it) => (it.id === 'c' ? { ...it, done: true } : it))
    expect(countOn(done, '2026-11-09', 'work')).toBe(0)
    expect(countOn(done, '2026-11-11', 'work')).toBe(0)
  })

  it('100 以上は「99+」', () => {
    expect(formatCount(99)).toBe('99')
    expect(formatCount(100)).toBe('99+')
    expect(formatCount(0)).toBe('0')
  })
})

describe('決まり（6.2・6.4・12.4）', () => {
  it('決まりどおりの予定・タスクは問題なし', () => {
    expect(itemProblems(mkItem({ startTime: '10:00', endTime: '11:00' }))).toEqual([])
    expect(itemProblems(mkItem({ startTime: '22:00', endTime: '24:00' }))).toEqual([])
    expect(itemProblems(mkTask())).toEqual([])
    // 複数日の予定は、最終日の終了が開始の時刻より前でもよい（11/10 22:00〜11/11 02:00）
    expect(itemProblems(mkItem({ due: '2026-11-11', startTime: '22:00', endTime: '02:00' }))).toEqual([])
  })

  it('24:00 は終了だけ。開始の無い終了は持てない', () => {
    expect(codes(mkItem({ startTime: '24:00' }))).toContain('startTime')
    expect(codes(mkItem({ endTime: '11:00' }))).toEqual(['endWithoutStart'])
    expect(codes(mkItem({ startTime: '10:00', endTime: '00:00' }))).toContain('endMidnight')
  })

  it('1日の予定で終了が開始より前か同じ', () => {
    expect(codes(mkItem({ startTime: '10:00', endTime: '09:00' }))).toEqual(['endBeforeStart'])
    expect(codes(mkItem({ startTime: '10:00', endTime: '10:00' }))).toEqual(['endBeforeStart'])
    // カレンダーに出ないタスクの時刻は出し方に使わないので問わない
    expect(codes(mkTask({ start: '2026-11-10', startTime: '10:00', endTime: '09:00' }))).toEqual([])
  })

  it('開始日が締め切り日より後・calendar 生まれで開始日なし・どこにも出ない', () => {
    expect(codes(mkItem({ start: '2026-11-12', due: '2026-11-10' }))).toEqual(['startAfterDue'])
    expect(codes(mkTask({ start: '2026-11-12', due: '2026-11-10' }))).toEqual(['startAfterDue'])
    expect(codes(mkItem({ start: null, due: '2026-11-10' }))).toEqual(['startRequired'])
    expect(codes(mkTask({ listed: false }))).toEqual(['nowhere'])
    // カレンダーに出ていれば Task List から外してよい
    expect(codes(mkTask({ due: '2026-11-20', listed: false }))).toEqual([])
  })

  it('文字数（件名 1〜200字・依頼者 60字まで）・知らない区分・ラベル・形', () => {
    expect(codes(mkItem({ title: '  ' }))).toEqual(['title'])
    expect(codes(mkItem({ title: 'あ'.repeat(200) }))).toEqual([])
    expect(codes(mkItem({ title: 'あ'.repeat(201) }))).toEqual(['title'])
    expect(codes(mkItem({ requester: 'や'.repeat(61) }))).toEqual(['requester'])
    expect(codes(mkItem({ kind: 'family' as never }))).toEqual(['kind'])
    expect(codes(mkItem({ label: 'gold-l' }))).toEqual(['label'])
    expect(codes(mkItem({ label: 'sky-l' }))).toEqual([])
    expect(codes(mkItem({ start: '2026-11-31' }))).toContain('start')
    expect(codes(mkItem({ startTime: '9:00' }))).toContain('startTime')
    // 決まりに関わる項目（受け取り箱は、直す項目に関わる物だけで断る）
    expect(itemProblems(mkItem({ start: '2026-11-12', due: '2026-11-10' }))[0].fields).toEqual(['start', 'due'])
  })
})

describe('項目の月（6.11 の月の束）', () => {
  it('カレンダーに出ている物は to の月', () => {
    expect(itemPackMonth(mkItem({ start: '2026-06-28', due: '2026-07-02' }))).toBe('2026-07')
    expect(itemPackMonth(mkTask({ due: '2026-05-20' }))).toBe('2026-05')
  })

  it('出ていない物は doneOn、無ければ createdAt の暦の日付の月', () => {
    expect(itemPackMonth(mkTask({ done: true, doneOn: '2026-04-03', createdAt: new Date(2026, 1, 1).getTime() }))).toBe('2026-04')
    expect(itemPackMonth(mkTask({ createdAt: new Date(2026, 2, 31, 23, 59).getTime() }))).toBe('2026-03')
  })
})

describe('ラベル（4.6・19.4）', () => {
  it('24色の並び（淡の12色 → 濃の12色）と既定の呼び名', () => {
    expect(LABEL_KEYS).toHaveLength(24)
    expect(LABEL_KEYS[0]).toBe('rose-l')
    expect(LABEL_KEYS[7]).toBe('sky-l')
    expect(LABEL_KEYS[12]).toBe('rose-d')
    expect(LABEL_KEYS[23]).toBe('peony-d')
    expect(new Set(LABEL_KEYS).size).toBe(24)
    expect(LABEL_DEFAULT_NAMES['sky-l']).toBe('空・淡')
    expect(isLabelKey('sky-l')).toBe(true)
    expect(isLabelKey('sky')).toBe(false)
  })

  it('キーか設定で付けた呼び名で引ける（全角と半角・大文字と小文字は同じ）。見つからなければ null', () => {
    const names = {
      'sky-l': mkLabelName('sky-l', '会議'),
      'rose-d': mkLabelName('rose-d', 'Ｐｒｉｖａｔｅ'),
      'mint-l': mkLabelName('mint-l', ''),
    }
    expect(labelKeyOf('sky-l', names)).toBe('sky-l')
    expect(labelKeyOf('ＳＫＹ-Ｌ', names)).toBe('sky-l')
    expect(labelKeyOf('会議', names)).toBe('sky-l')
    expect(labelKeyOf(' 会議 ', names)).toBe('sky-l')
    expect(labelKeyOf('private', names)).toBe('rose-d')
    expect(labelKeyOf('PRIVATE', names)).toBe('rose-d')
    // 既定の呼び名・空の呼び名・知らない名前では引かない
    expect(labelKeyOf('空・淡', names)).toBeNull()
    expect(labelKeyOf('', names)).toBeNull()
    expect(labelKeyOf('打ち合わせ', names)).toBeNull()
    expect(labelDisplayName('sky-l', names)).toBe('会議')
    expect(labelDisplayName('mint-l', names)).toBe('ミント・淡')
  })
})
