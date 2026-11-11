// 登録・詳細の画面の欄の初めの値と「詳しく」を開いて出すかの決め方（docs/SPEC.md の 12.2・12.3・6.12。D11・D48・AMB-ITEMS-02・26）
import { describe, expect, it } from 'vitest'
import { mkItem, mkTask } from '../../domain/testData'
import { mkItem as mk } from '../../domain/testData'
import { deleteConfirmText, IN_TASK_LIST_NOTE } from './deleteItem'
import {
  detailForm,
  hasDetails,
  hasDraftText,
  memoParts,
  offCalendarTask,
  oneLine,
  rawTitleOf,
  registerForm,
  whenChanges,
  whenOf,
} from './itemForm'

describe('登録の画面の初めの値（12.2・ITEMS-172・177・183）', () => {
  it('件名は空・区分は仕事・開始日だけ・時刻なし・詳しくは全部空', () => {
    expect(registerForm({ start: '2026-11-10' })).toEqual({
      origin: 'calendar',
      start: '2026-11-10',
      due: null,
      startTime: null,
      endTime: null,
      title: '',
      kind: 'work',
      label: null,
      requester: '',
      locked: false,
      listed: false,
      memo: '',
    })
  })

  it('開いた場所の区分・タイムスケジュールの時刻・段階3の件名とメモを受け取る（D50）', () => {
    const f = registerForm({
      start: '2026-11-12',
      kind: 'private',
      startTime: '23:30',
      endTime: '24:00',
      title: '本',
      memo: 'メモ',
    })
    expect(f).toMatchObject({
      kind: 'private',
      start: '2026-11-12',
      startTime: '23:30',
      endTime: '24:00',
      title: '本',
      memo: 'メモ',
    })
  })
})

describe('詳細の画面の初めの値', () => {
  it('表示用の記録の値をそのまま欄に入れる（区分・ラベル・依頼者・ロック・Task List・メモ）', () => {
    const item = mkItem({ kind: 'private', label: 'peony-l', requester: '総務', locked: true, listed: true, memo: 'a' })
    expect(detailForm(item, item.title)).toMatchObject({
      title: item.title,
      kind: 'private',
      label: 'peony-l',
      requester: '総務',
      locked: true,
      listed: true,
      memo: 'a',
      origin: 'calendar',
      start: '2026-11-10',
    })
  })

  it('知らないラベルのキーは「ラベルなし」（6.12・ITEMS-025）', () => {
    expect(detailForm(mkItem({ label: 'gold-x' })).label).toBeNull()
  })

  it('端末の記録の件名が空なら、欄は空（プレースホルダで「（件名なし）」。D48）。本当の件名「（件名なし）」はそのまま', () => {
    const shown = mkItem({ title: '（件名なし）' })
    expect(detailForm(shown, '').title).toBe('')
    expect(detailForm(shown, '  ').title).toBe('')
    expect(detailForm(shown, '（件名なし）').title).toBe('（件名なし）')
    expect(detailForm(shown).title).toBe('（件名なし）')
  })

  it('rawTitleOf: 記録が無ければ undefined、件名が文字でなければ空（null・項目が無い）', () => {
    expect(rawTitleOf(undefined)).toBeUndefined()
    expect(rawTitleOf({ title: 'a' })).toBe('a')
    expect(rawTitleOf({ title: null })).toBe('')
    expect(rawTitleOf({ title: 3 })).toBe('')
    expect(rawTitleOf({})).toBe('')
    expect(detailForm(mkItem({ title: '（件名なし）' }), rawTitleOf({ title: null })).title).toBe('')
  })
})

describe('「詳しく」を開いて出すか（D11・AMB-ITEMS-02）', () => {
  const base = registerForm({ start: '2026-11-10' })
  it.each([
    ['何も無い', {}, false],
    ['ラベル', { label: 'sky-l' as const }, true],
    ['依頼者', { requester: '営業部' }, true],
    ['依頼者が空白だけ', { requester: '  ' }, false],
    ['ロック', { locked: true }, true],
    ['calendar 生まれで Task List にも出す', { listed: true }, true],
    ['メモ', { memo: '持ち物' }, true],
    ['メモが空白だけ', { memo: '\n ' }, false],
  ])('%s → %s', (_name, patch, open) => {
    expect(hasDetails({ ...base, ...patch })).toBe(open)
  })

  it('list 生まれは Task List に出すのが初めなので、外した時だけ「入っている」とみなす', () => {
    expect(hasDetails(detailForm(mkTask()))).toBe(false)
    expect(hasDetails(detailForm(mkTask({ listed: false, due: '2026-11-20' })))).toBe(true)
  })
})

it('件名の欄に貼った改行は空白にする（1行の欄）', () => {
  expect(oneLine('a\nb\r\nc\rd')).toBe('a b c d')
})

describe('詳細の画面で保存する日付・時刻の差分', () => {
  it('決まりを当てた後に変わった物だけ（同じなら空）', () => {
    const cur = whenOf(mk({ start: '2026-11-10', due: null, startTime: '22:00', endTime: null }))
    expect(whenChanges(cur, cur)).toEqual({})
    expect(whenChanges(cur, { ...cur, due: '2026-11-11', endTime: '02:00' })).toEqual({ due: '2026-11-11', endTime: '02:00' })
    expect(whenChanges(cur, { ...cur, startTime: null })).toEqual({ startTime: null })
  })
})

describe('書きかけか（12.2・ITEMS-186）・カレンダーに出ていないタスクか（12.3）', () => {
  it.each([
    [{ title: '', memo: '' }, false],
    [{ title: '  ', memo: '\n' }, false],
    [{ title: '会議', memo: '' }, true],
    [{ title: '', memo: '持ち物' }, true],
  ])('%o → %s', (f, want) => {
    expect(hasDraftText(f)).toBe(want)
  })

  it.each([
    [{ origin: 'list', due: null }, true],
    [{ origin: 'list', due: '2026-11-20' }, false],
    [{ origin: 'calendar', due: null }, false],
  ] as const)('%o → %s', (f, want) => {
    expect(offCalendarTask(f)).toBe(want)
  })
})

describe('メモの URL を押せるリンクにする所（12.3・ITEMS-216）', () => {
  it('字と URL に分ける（文の後の句読点・括弧は URL に入れない。改行はそのまま）', () => {
    expect(memoParts('地図 https://example.com/map?a=1&b=2。\n予備（http://example.org/x）')).toEqual([
      { text: '地図 ' },
      { url: 'https://example.com/map?a=1&b=2' },
      { text: '。\n予備（' },
      { url: 'http://example.org/x' },
      { text: '）' },
    ])
  })

  it.each([
    ['見てください https://example.com/a.', [{ text: '見てください ' }, { url: 'https://example.com/a' }, { text: '.' }]],
    ['URL なし', [{ text: 'URL なし' }]],
    ['', []],
    ['https://', [{ text: 'https://' }]],
    ['ftp://example.com は対象外', [{ text: 'ftp://example.com は対象外' }]],
  ])('%s', (text, want) => {
    expect(memoParts(text)).toEqual(want)
  })
})

describe('削除の確かめの題と文（12.8・ITEMS-263・264・AMB-ITEMS-23）', () => {
  const now = new Date(2026, 10, 10, 9, 0).getTime()
  it('Task List にも出ている時だけ「Task List からも消えます。」を足す', () => {
    const base = 'ゴミ箱に移します。30日後に完全に削除されます（それまではゴミ箱から元に戻せます）。'
    expect(deleteConfirmText(mk({ title: '資料づくり', listed: true }), now)).toEqual({
      title: '『資料づくり』を削除しますか？',
      message: base + IN_TASK_LIST_NOTE,
    })
    expect(deleteConfirmText(mk({ listed: false }), now).message).toBe(base)
    // 済んで 7日を過ぎた物は Task List に見えないので足さない
    const old = mk({ listed: true, done: true, doneAt: now - 8 * 24 * 3600 * 1000 })
    expect(deleteConfirmText(old, now).message).toBe(base)
    // 件名が空の記録は「（件名なし）」で出す
    expect(deleteConfirmText(mk({ title: '' }), now).title).toBe('『（件名なし）』を削除しますか？')
  })
})
