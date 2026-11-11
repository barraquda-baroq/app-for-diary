// カレンダーの部品が予定を出す時の小さな決まり（itemLook.ts）: 件名・区分・ラベルの表示用の値（6.12）、data-kind・data-label の印
// （4.3・4.6）、日付と曜日の色（7.1）、AI の札（7.7）
import { describe, expect, it } from 'vitest'
import { weekdayOfYmd } from '../../../../domain/dates'
import { holidaysOfYear } from '../../../../domain/holidays'
import { LABEL_KEYS } from '../../../../domain/labels'
import { mkItem } from '../../../../domain/testData'
import type { Item } from '../../../../domain/types'
import { aiTagText, cls, dayTone, displayTitle, hasAiTag, itemAttrs, kindOf, labelOf } from './itemLook'

describe('表示用の件名・区分・ラベル（6.12・ITEMS-036・FRAME-193）', () => {
  it.each([
    ['資料の確認', '資料の確認'],
    ['', '（件名なし）'],
    ['   ', '（件名なし）'],
  ])('件名 %j → %j', (title, shown) => {
    expect(displayTitle({ title })).toBe(shown)
  })

  it('知らない区分は仕事', () => {
    expect(kindOf({ kind: 'private' })).toBe('private')
    expect(kindOf({ kind: 'family' as Item['kind'] })).toBe('work')
  })

  it('知らないラベルのキーは「ラベルなし」（null）', () => {
    expect(labelOf({ label: 'sky-l' })).toBe('sky-l')
    expect(labelOf({ label: 'gold-l' })).toBeNull()
    expect(labelOf({ label: null })).toBeNull()
  })

  it('24色のどのキーでも data-label を付ける', () => {
    for (const key of LABEL_KEYS)
      expect(itemAttrs({ kind: 'work', label: key })).toEqual({ 'data-kind': 'work', 'data-label': key })
  })

  it('ラベルが無い・知らないキーの時は data-label を付けない（一辺・帯・線は無し、●は土台の色。CALENDAR-264）', () => {
    expect(itemAttrs({ kind: 'private', label: null })).toEqual({ 'data-kind': 'private' })
    expect(itemAttrs({ kind: 'private', label: 'gold-l' })).toEqual({ 'data-kind': 'private' })
    expect('data-label' in itemAttrs({ kind: 'work', label: 'gold-l' })).toBe(false)
    expect(itemAttrs({ kind: 'family' as Item['kind'], label: 'rose-d' })).toEqual({
      'data-kind': 'work',
      'data-label': 'rose-d',
    })
  })
})

describe('日付と曜日の色（7.1・CALENDAR-053）', () => {
  it.each([
    ['2026-11-08', 'sun'],
    ['2026-11-09', null],
    ['2026-11-10', null],
    ['2026-11-14', 'sat'],
    // 祝日（文化の日は火曜）
    ['2026-11-03', 'sun'],
    // 祝日でない次の日
    ['2026-11-04', null],
    // 年をまたぐ週の土曜・日曜
    ['2027-01-02', 'sat'],
    ['2026-12-27', 'sun'],
  ] as const)('%s → %s', (date, tone) => {
    expect(dayTone(date)).toBe(tone)
  })

  it('土曜の祝日は祝日の色（--sun）', () => {
    const saturday = [...holidaysOfYear(2025).keys()].find((d) => weekdayOfYmd(d) === 6)
    expect(saturday).toBeDefined()
    expect(dayTone(saturday as string)).toBe('sun')
  })

  it('祝日の表の外の年（2051年）は土日だけ（元日の次の月曜 1/2 も色なし）', () => {
    expect(dayTone('2051-01-02')).toBeNull()
    expect(dayTone('2051-01-01')).toBe('sun')
    expect(dayTone('2051-01-07')).toBe('sat')
  })
})

describe('AI の札（7.7・CALENDAR-108〜110）', () => {
  it('Claude が足した物（by が connector）にだけ付ける', () => {
    expect(hasAiTag(mkItem({ by: 'connector', ai: 'claude', via: 'メール: 打ち合わせの候補日について' }))).toBe(true)
    expect(hasAiTag(mkItem({ by: 'user' }))).toBe(false)
  })

  it('作者が手で作った物を Claude が直しても付けない（by は作った時のまま）', () => {
    expect(hasAiTag(mkItem({ by: 'user', ai: 'claude', via: '依頼で直した' }))).toBe(false)
  })

  it.each([
    ['claude', 'Claude'],
    ['gemini', 'AI'],
    ['', 'AI'],
    [null, 'AI'],
  ] as const)('ai %j → 「%s」', (ai, text) => {
    expect(aiTagText({ ai })).toBe(text)
  })
})

it('cls は空の物を除いてつなぐ', () => {
  expect(cls('a', false, null, undefined, '', 'b')).toBe('a b')
})
