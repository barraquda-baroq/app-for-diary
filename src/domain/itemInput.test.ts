// 登録・詳細・複製の入力の決まり（docs/SPEC.md の 6.3・6.4・12.2・12.4・12.7）: 日付のそろえ方（両方向・両方の生まれ）、
// 日付を動かして1日の予定で終了 < 開始になる時は断る、時刻を入れた時の翌日にする・00:00 を 24:00 に・終了 = 開始で終了を空に
// （1日の予定だけ）、打った時刻の読み取り、時刻の一覧と開く所、登録の画面の初めの値、複製の日付
import { describe, expect, it } from 'vitest'
import {
  DATE_REFUSED,
  duplicateDates,
  editDates,
  editTimes,
  limitChars,
  nextDayHint,
  parseTime,
  registerDefaults,
  timeListAnchor,
  timeOptions,
  type When,
  type WhenResult,
} from './itemInput'
import { periodOf } from './items'
import { addItem } from './ops'
import { T0 } from './testData'
import { emptyData } from './types'

const cal = (p: Partial<When> = {}): When => ({
  origin: 'calendar',
  start: '2026-11-10',
  due: null,
  startTime: null,
  endTime: null,
  ...p,
})
const task = (p: Partial<When> = {}): When => ({ origin: 'list', start: null, due: null, startTime: null, endTime: null, ...p })

const okWhen = (r: WhenResult): When => {
  if (!r.ok) throw new Error(`ok でない: ${r.message}`)
  return r.when
}

describe('日付の欄を決めた（6.3・12.4）', () => {
  it.each([
    // [名前, 今の値, 直した欄, そろえた後の開始日・締め切り日]
    [
      'calendar: 開始日を締め切り日より後 → 締め切り日をそろえる',
      cal({ due: '2026-11-12' }),
      { start: '2026-11-15' },
      ['2026-11-15', '2026-11-15'],
    ],
    [
      'calendar: 締め切り日を開始日より前 → 開始日をそろえる',
      cal({ due: '2026-11-12' }),
      { due: '2026-11-08' },
      ['2026-11-08', '2026-11-08'],
    ],
    ['calendar: 締め切り日を消す → 開始日の1日の予定', cal({ due: '2026-11-12' }), { due: null }, ['2026-11-10', null]],
    [
      'calendar: 両方を一度に渡して開始日が後 → 締め切り日を開始日に',
      cal(),
      { start: '2026-11-20', due: '2026-11-18' },
      ['2026-11-20', '2026-11-20'],
    ],
    [
      'list: 開始日だけを締め切り日より後 → 締め切り日をそろえる',
      task({ start: '2026-11-10', due: '2026-11-12' }),
      { start: '2026-11-15' },
      ['2026-11-15', '2026-11-15'],
    ],
    [
      'list: 締め切り日を開始日より前 → 開始日をそろえる',
      task({ start: '2026-11-10', due: '2026-11-12' }),
      { due: '2026-11-08' },
      ['2026-11-08', '2026-11-08'],
    ],
    [
      'list: 締め切り日だけの物に、その後の開始日 → 締め切り日をそろえる',
      task({ due: '2026-11-12' }),
      { start: '2026-11-14' },
      ['2026-11-14', '2026-11-14'],
    ],
    [
      'list: 開始日を消す（締め切り日の1日の予定）',
      task({ start: '2026-11-10', due: '2026-11-12' }),
      { start: null },
      [null, '2026-11-12'],
    ],
    ['list: 両方とも消せる（Task List だけ）', task({ due: '2026-11-12' }), { due: null }, [null, null]],
  ] as const)('%s（CALENDAR-018..020・ITEMS-227・228・272）', (_name, cur, patch, [start, due]) => {
    const r = editDates(cur, patch)
    expect(okWhen(r)).toMatchObject({ start, due })
    expect(r.ok && r.hint).toBeNull()
  })

  it('calendar 生まれの開始日は消せない（ITEMS-225）', () => {
    expect(editDates(cal(), { start: null })).toEqual({ ok: false, message: 'カレンダーの予定には開始日が要ります' })
  })

  it('undefined は渡していない欄として扱い、日付の欄の決まりでは時刻を変えない', () => {
    expect(okWhen(editDates(cal({ due: '2026-11-12' }), { start: undefined, due: '2026-11-13' }))).toMatchObject({
      start: '2026-11-10',
      due: '2026-11-13',
    })
    const wide = { due: '2026-11-11', startTime: '12:00' } as Partial<When>
    expect(okWhen(editDates(cal({ startTime: '10:00' }), wide))).toMatchObject({ due: '2026-11-11', startTime: '10:00' })
    expect(okWhen(editTimes(cal(), { startTime: '10:00', due: '2026-11-20' } as Partial<When>))).toMatchObject({
      due: null,
      startTime: '10:00',
    })
  })

  it('形の正しくない日付は断る', () => {
    expect(editDates(cal(), { start: '2026-02-30' }).ok).toBe(false)
    expect(editDates(task(), { due: '11/10' }).ok).toBe(false)
  })

  it('日付を動かして1日の予定で終了 < 開始になる時は、翌日にせず断る（CALENDAR-023・041・042・043・ITEMS-222・232）', () => {
    // 11/10 23:00〜11/11 01:00 の締め切り日を 11/10 に（1日の 23:00〜01:00 になる）
    const night = cal({ due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    expect(editDates(night, { due: '2026-11-10' })).toEqual({ ok: false, message: DATE_REFUSED })
    expect(editDates(night, { start: '2026-11-11' })).toEqual({ ok: false, message: DATE_REFUSED })
    expect(editDates(night, { due: null })).toEqual({ ok: false, message: DATE_REFUSED })
    // list 生まれも同じ
    const t = task({ start: '2026-11-10', due: '2026-11-11', startTime: '22:00', endTime: '02:00' })
    expect(editDates(t, { due: '2026-11-10' })).toEqual({ ok: false, message: DATE_REFUSED })
    // 複数日のままなら動かせる（時刻はそのまま）
    expect(okWhen(editDates(night, { due: '2026-11-13' }))).toMatchObject({
      due: '2026-11-13',
      startTime: '23:00',
      endTime: '01:00',
    })
    expect(DATE_REFUSED).toBe('終わりの時刻が始まりより早いので、この日付にはできません（先に時刻を直してください）')
  })

  it('1日の予定で終了 = 開始になる時は終了時刻を空に、複数日の予定ではそのまま（CALENDAR-022・D36）', () => {
    const span = cal({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00', endTime: '10:00' })
    expect(okWhen(editDates(span, { due: '2026-11-09' }))).toMatchObject({ due: '2026-11-09', startTime: '10:00', endTime: null })
    expect(okWhen(editDates(span, { due: '2026-11-12' }))).toMatchObject({ due: '2026-11-12', endTime: '10:00' })
  })

  it('list 生まれの締め切り日を消してカレンダーから外れても、時刻は消さずに残す（ITEMS-213・CALENDAR-014）', () => {
    const t = task({ start: '2026-11-10', due: '2026-11-12', startTime: '10:00', endTime: '11:00' })
    const w = okWhen(editDates(t, { due: null }))
    expect(w).toMatchObject({ start: '2026-11-10', due: null, startTime: '10:00', endTime: '11:00' })
    expect(periodOf(w)).toBeNull()
    // 締め切り日をまた入れると戻る
    expect(periodOf(okWhen(editDates(w, { due: '2026-11-12' })))).toEqual({ from: '2026-11-10', to: '2026-11-12' })
  })
})

describe('時刻の欄を決めた（6.4・12.4）', () => {
  it.each([
    // [名前, 今の値, 直した欄, そろえた後, hint]
    ['1日の 10:00〜11:30 はそのまま', cal(), { startTime: '10:00', endTime: '11:30' }, { due: null, endTime: '11:30' }, null],
    [
      'calendar: 1日の 22:00〜02:00 → 締め切り日を開始日の翌日に（CALENDAR-039・ITEMS-230）',
      cal(),
      { startTime: '22:00', endTime: '02:00' },
      { start: '2026-11-10', due: '2026-11-11', startTime: '22:00', endTime: '02:00' },
      '翌日 02:00 まで',
    ],
    [
      'list: 締め切り日だけの 22:00〜02:00 → 開始日 = 元の締め切り日・締め切り日 = その翌日',
      task({ due: '2026-11-10' }),
      { startTime: '22:00', endTime: '02:00' },
      { start: '2026-11-10', due: '2026-11-11' },
      '翌日 02:00 まで',
    ],
    [
      'list: 開始日 = 締め切り日の 22:00〜02:00 も同じ',
      task({ start: '2026-11-10', due: '2026-11-10' }),
      { startTime: '22:00', endTime: '02:00' },
      { start: '2026-11-10', due: '2026-11-11' },
      '翌日 02:00 まで',
    ],
    [
      '1日の 22:00〜00:00 → 22:00〜24:00（翌日にしない。CALENDAR-034・035・ITEMS-234）',
      cal(),
      { startTime: '22:00', endTime: '00:00' },
      { due: null, endTime: '24:00' },
      null,
    ],
    ['1日の 22:00〜24:00 はその日だけ', cal(), { startTime: '22:00', endTime: '24:00' }, { due: null, endTime: '24:00' }, null],
    [
      '複数日の終了に 00:00 → 締め切り日を1日前にして 24:00（CALENDAR-038・ITEMS-235）',
      cal({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00' }),
      { endTime: '00:00' },
      { start: '2026-11-09', due: '2026-11-10', endTime: '24:00' },
      null,
    ],
    [
      '複数日の終了に 00:00 で、前の日が開始日なら1日の予定になる（AMB-ITEMS-04）',
      cal({ start: '2026-11-10', due: '2026-11-11', startTime: '10:00' }),
      { endTime: '00:00' },
      { start: '2026-11-10', due: '2026-11-10', endTime: '24:00' },
      null,
    ],
    [
      'list 生まれの複数日の 00:00 も同じ',
      task({ start: '2026-11-10', due: '2026-11-11', startTime: '10:00' }),
      { endTime: '00:00' },
      { start: '2026-11-10', due: '2026-11-10', endTime: '24:00' },
      null,
    ],
    [
      '1日の終了 = 開始 → 終了時刻を空に（ITEMS-233）',
      cal({ startTime: '10:00', endTime: '11:00' }),
      { endTime: '10:00' },
      { endTime: null },
      null,
    ],
    [
      '複数日の終了 = 開始はそのまま（D36）',
      cal({ start: '2026-11-09', due: '2026-11-11', startTime: '10:00' }),
      { endTime: '10:00' },
      { due: '2026-11-11', endTime: '10:00' },
      null,
    ],
    [
      '複数日の終了 < 開始はそのまま（翌日にしない）',
      cal({ start: '2026-11-09', due: '2026-11-11', startTime: '22:00' }),
      { endTime: '02:00' },
      { due: '2026-11-11', endTime: '02:00' },
      null,
    ],
    [
      '開始を空にすると終了も消す（CALENDAR-037・ITEMS-229）',
      cal({ startTime: '10:00', endTime: '11:00' }),
      { startTime: null },
      { startTime: null, endTime: null },
      null,
    ],
    ['開始の無い終了は持てない', cal(), { endTime: '10:00' }, { startTime: null, endTime: null }, null],
    [
      '開始時刻を直して1日の予定で終了 < 開始になった時も翌日に（時刻を直した時）',
      cal({ startTime: '10:00', endTime: '11:00' }),
      { startTime: '12:00' },
      { due: '2026-11-11', startTime: '12:00', endTime: '11:00' },
      '翌日 11:00 まで',
    ],
    [
      '1分単位の時刻も入る（ITEMS-176）',
      cal(),
      { startTime: '09:07', endTime: '09:58' },
      { startTime: '09:07', endTime: '09:58' },
      null,
    ],
  ] as const)('%s', (_name, cur, patch, want, hint) => {
    const r = editTimes(cur, patch)
    expect(okWhen(r)).toMatchObject(want)
    expect(r.ok && r.hint).toBe(hint)
  })

  it('開始時刻に 24:00 は使えない。形の違う時刻は断る（CALENDAR-033）', () => {
    expect(editTimes(cal(), { startTime: '24:00' })).toEqual({ ok: false, message: '開始時刻に 24:00 は使えません' })
    expect(editTimes(cal(), { startTime: '9:00' }).ok).toBe(false)
    expect(editTimes(cal({ startTime: '10:00' }), { endTime: '24:30' }).ok).toBe(false)
  })

  it('カレンダーに出ていない list 生まれ（①④）は、00:00 を 24:00 と読むだけで日付は変えない', () => {
    const r = okWhen(editTimes(task({ start: '2026-11-10' }), { startTime: '22:00', endTime: '02:00' }))
    expect(r).toMatchObject({ start: '2026-11-10', due: null, endTime: '02:00' })
    expect(okWhen(editTimes(task(), { startTime: '22:00', endTime: '00:00' })).endTime).toBe('24:00')
  })

  it('何も渡さなければ今の値をそろえる（登録の画面の［登録］の時。D37）', () => {
    const r = editTimes(cal({ startTime: '22:00', endTime: '02:00' }), {})
    expect(okWhen(r)).toMatchObject({ due: '2026-11-11' })
    expect(r.ok && r.hint).toBe('翌日 02:00 まで')
  })

  it('最後に直した欄の決まりで決める: 時刻なら翌日にする、日付ならできない（ITEMS-239・AMB-ITEMS-29）', () => {
    // 日付 → 時刻の順: 時刻を直した時に翌日にする
    const day = okWhen(editDates(cal({ startTime: '10:00', endTime: '11:00' }), { start: '2026-11-12' }))
    const timed = editTimes(day, { startTime: '23:00', endTime: '01:00' })
    expect(okWhen(timed)).toMatchObject({ start: '2026-11-12', due: '2026-11-13' })
    // 時刻 → 日付の順: 日付で1日の予定にすると断る（値は元のまま）
    expect(editDates(okWhen(timed), { due: '2026-11-12' })).toEqual({ ok: false, message: DATE_REFUSED })
  })

  it('翌日にした時の文（CALENDAR-040・ITEMS-231）', () => {
    expect(nextDayHint('02:00')).toBe('翌日 02:00 まで')
  })
})

describe('打った時刻の読み取り（12.2・AMB-ITEMS-07）', () => {
  it.each([
    ['９：０７', 'start', '09:07'],
    ['907', 'start', '09:07'],
    ['0907', 'start', '09:07'],
    ['9', 'start', '09:00'],
    ['09', 'start', '09:00'],
    ['12', 'start', '12:00'],
    ['9:07', 'start', '09:07'],
    ['23:59', 'start', '23:59'],
    ['1230', 'end', '12:30'],
    ['　９　', 'start', '09:00'],
    ['24:00', 'end', '24:00'],
    ['24', 'end', '24:00'],
    ['2400', 'end', '24:00'],
    ['0:00', 'end', '00:00'],
    ['0', 'end', '00:00'],
    ['', 'start', null],
    ['  ', 'end', null],
    ['24:00', 'start', undefined],
    ['25:00', 'end', undefined],
    ['24:30', 'end', undefined],
    ['9:60', 'start', undefined],
    ['9:7', 'start', undefined],
    ['12345', 'start', undefined],
    ['-1', 'start', undefined],
    ['abc', 'start', undefined],
    ['9時', 'start', undefined],
  ] as const)('%s（%s）→ %s', (text, which, want) => {
    expect(parseTime(text, which)).toBe(want)
  })
})

describe('時刻の一覧と開く所（12.2・CALENDAR-044・ITEMS-236・AMB-ITEMS-06・07）', () => {
  it('開始は 00:00〜23:55、終了は 00:05〜23:55 と 24:00（5分刻み。開始に 24:00、終了に 0:00 は無い）', () => {
    const start = timeOptions('start')
    const end = timeOptions('end')
    expect(start).toHaveLength(288)
    expect([start[0], start[1], start.at(-1)]).toEqual(['00:00', '00:05', '23:55'])
    expect(start).not.toContain('24:00')
    expect(end).toHaveLength(288)
    expect([end[0], end.at(-2), end.at(-1)]).toEqual(['00:05', '23:55', '24:00'])
    expect(end).not.toContain('00:00')
    expect(start.includes('09:07')).toBe(false)
  })

  it.each([
    ['start', '10:30', null, '10:30'],
    ['start', '09:07', null, '09:05'],
    ['start', null, null, '09:00'],
    ['start', null, '10:00', '09:00'],
    ['end', null, '10:00', '11:00'],
    ['end', null, '10:07', '11:05'],
    ['end', null, '23:30', '24:00'],
    ['end', '24:00', '10:00', '24:00'],
    ['end', '00:03', null, '00:05'],
    ['end', null, null, '09:00'],
  ] as const)('%s・値 %s・開始 %s → %s の所を見せる', (which, value, startTime, want) => {
    const anchor = timeListAnchor(which, value, startTime)
    expect(anchor).toBe(want)
    expect(timeOptions(which)).toContain(anchor)
  })
})

describe('登録の画面の初めの値（12.2）', () => {
  it('calendar 生まれ・締め切り日は空・時刻は空・区分は仕事・件名とメモは空（ITEMS-002・177・183）', () => {
    expect(registerDefaults({ start: '2026-11-10' })).toEqual({
      origin: 'calendar',
      start: '2026-11-10',
      due: null,
      startTime: null,
      endTime: null,
      kind: 'work',
      title: '',
      memo: '',
    })
  })

  it('開いた場所で決まる区分・タイムスケジュールの時刻・Favorite の件名とメモを入れる', () => {
    expect(
      registerDefaults({
        start: '2026-11-13',
        kind: 'private',
        startTime: '23:30',
        endTime: '24:00',
        title: '本を返す',
        memo: '2冊',
      }),
    ).toMatchObject({
      start: '2026-11-13',
      kind: 'private',
      startTime: '23:30',
      endTime: '24:00',
      title: '本を返す',
      memo: '2冊',
    })
    // 終了だけは持てない
    expect(registerDefaults({ start: '2026-11-13', endTime: '10:00' })).toMatchObject({ startTime: null, endTime: null })
  })

  it('登録の時も 12.4 の決まりを当ててから足す（addItem はそろえない。ITEMS-194）', () => {
    const form = registerDefaults({ start: '2026-11-10' })
    const r = editTimes(form, { startTime: '22:00', endTime: '00:00' })
    const w = okWhen(r)
    const { data, result } = addItem(emptyData(), { ...w, title: '片付け', kind: form.kind }, T0)
    expect(data.items[result]).toMatchObject({ start: '2026-11-10', due: null, startTime: '22:00', endTime: '24:00' })
    const night = okWhen(editTimes(form, { startTime: '22:00', endTime: '02:00' }))
    expect(addItem(emptyData(), { ...night, title: '夜行バス' }, T0).data.items).toSatisfy((items: object) =>
      Object.values(items).every((i) => i.due === '2026-11-11'),
    )
  })
})

describe('複製する日（12.7・ITEMS-255・256）', () => {
  it.each([
    [
      '複数日 11/10〜11/12 で 11/17 を選ぶ → 11/17〜11/19',
      cal({ due: '2026-11-12' }),
      '2026-11-17',
      ['2026-11-17', '2026-11-19'],
    ],
    [
      '年をまたぐ 12/30〜1/2 で 1/30 を選ぶ → 1/30〜2/2',
      cal({ start: '2026-12-30', due: '2027-01-02' }),
      '2027-01-30',
      ['2027-01-30', '2027-02-02'],
    ],
    ['1日の予定は締め切り日を入れない', cal(), '2026-11-17', ['2026-11-17', null]],
    [
      'list 生まれの複数日も同じ日数',
      task({ start: '2026-11-10', due: '2026-11-12' }),
      '2026-11-17',
      ['2026-11-17', '2026-11-19'],
    ],
    ['list 生まれの締め切り日だけの物は締め切り日を入れない', task({ due: '2026-11-12' }), '2026-11-17', ['2026-11-17', null]],
    ['開始日を空にすると両方空', cal({ due: '2026-11-12' }), null, [null, null]],
  ] as const)('%s', (_name, src, picked, [start, due]) => {
    expect(duplicateDates(src, picked)).toEqual({ start, due })
  })
})

describe('字数の上限（コードポイントで数える。ITEMS-003・237）', () => {
  it('絵文字 200字は入り、201字目は入らない', () => {
    const e200 = '😀'.repeat(200)
    expect(limitChars(e200, 200)).toBe(e200)
    expect(limitChars(e200 + '😀', 200)).toBe(e200)
    expect(limitChars('総務部の山', 4)).toBe('総務部の')
    expect(() => addItem(emptyData(), { origin: 'list', title: e200 }, T0)).not.toThrow()
    expect(() => addItem(emptyData(), { origin: 'list', title: e200 + '😀' }, T0)).toThrow('件名は1〜200字')
  })
})
