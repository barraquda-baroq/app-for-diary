// 登録・詳細の画面の欄の初めの値と「詳しく」を開いて出すかの決め方（docs/SPEC.md の 12.2・12.3・6.12。D11・D48・AMB-ITEMS-02・26）
import { describe, expect, it } from 'vitest'
import { mkItem, mkTask } from '../../domain/testData'
import { detailForm, hasDetails, oneLine, registerForm } from './itemForm'

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
