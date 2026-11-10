// 内容から作る id（docs/SPEC.md の 2.10・19.4・19.7）: 材料に入れる物・入れない物、文字のそろえ方、出どころの鍵、id の形、決まった id
import { describe, expect, it } from 'vitest'
import {
  derivedFavoriteId,
  derivedItemId,
  derivedRoutineId,
  isDerivedId,
  labelNameId,
  normalizeIdText,
  offDayId,
  parseRoutineCheckId,
  routineCheckId,
} from './derivedId'
import { stableStringify } from './equal'
import { hashJson } from './hash'

const MAIL_A = '<CAF=abc123@mail.gmail.com>'

describe('予定・タスクの id（19.4）', () => {
  it('形は ce-（予定）・ct-（タスク）＋指紋', () => {
    expect(derivedItemId({ origin: 'calendar', start: '2026-12-03', title: '打ち合わせ' })).toMatch(/^ce-[0-9a-z.]+$/)
    expect(derivedItemId({ origin: 'list', title: '見積書を出す' })).toMatch(/^ct-[0-9a-z.]+$/)
  })

  it('材料は19.4 のとおりのオブジェクト（コネクタと同じ計算）', () => {
    const material = { table: 'items', origin: 'calendar', from: '2026-12-03', to: '2026-12-03', startTime: '10:00', title: '打ち合わせ' }
    expect(derivedItemId({ origin: 'calendar', start: '2026-12-03', startTime: '10:00', title: '打ち合わせ' })).toBe(
      `ce-${hashJson(stableStringify(material))}`,
    )
    const keyed = { table: 'items', origin: 'calendar', sourceKey: MAIL_A, from: '2026-12-03', to: '2026-12-03' }
    expect(derivedItemId({ origin: 'calendar', start: '2026-12-03', title: '打ち合わせ' }, MAIL_A)).toBe(
      `ce-${hashJson(stableStringify(keyed))}`,
    )
  })

  it('同じメールで期間の違う物は別の id、同じ期間なら件名の書き方が変わっても同じ id（19.7）', () => {
    const a = derivedItemId({ origin: 'calendar', start: '2026-12-03', title: '打ち合わせ' }, MAIL_A)
    const again = derivedItemId({ origin: 'calendar', start: '2026-12-03', startTime: '10:00', title: '山田さんと打ち合わせ' }, MAIL_A)
    const other = derivedItemId({ origin: 'calendar', start: '2026-12-10', title: '打ち合わせ' }, MAIL_A)
    expect(again).toBe(a)
    expect(other).not.toBe(a)
    // 同じメールで同じ期間の2件目は「#2」を足す
    expect(derivedItemId({ origin: 'calendar', start: '2026-12-03', title: '懇親会' }, `${MAIL_A}#2`)).not.toBe(a)
    // 出どころの鍵の有無で別の id
    expect(derivedItemId({ origin: 'calendar', start: '2026-12-03', title: '打ち合わせ' })).not.toBe(a)
  })

  it('memo・requester・label・kind・endTime・listed・ai・via の違いは同じ id（材料に入れない）', () => {
    const base = { origin: 'calendar' as const, start: '2026-12-03', startTime: '10:00', title: '打ち合わせ' }
    const id = derivedItemId(base)
    const noisy = { ...base, memo: '議題', requester: '山田', label: 'sky-l', kind: 'private', endTime: '11:00', listed: true, ai: 'claude', via: 'メール' }
    expect(derivedItemId(noisy)).toBe(id)
    // 開始時刻・件名・期間・生まれは材料
    expect(derivedItemId({ ...base, startTime: '11:00' })).not.toBe(id)
    expect(derivedItemId({ ...base, title: '定例' })).not.toBe(id)
    expect(derivedItemId({ ...base, due: '2026-12-04' })).not.toBe(id)
  })

  it('件名の全角と半角・空白・大文字と小文字の違いは同じ id', () => {
    const id = derivedItemId({ origin: 'calendar', start: '2026-12-03', title: 'Zoom 打ち合わせ' })
    expect(derivedItemId({ origin: 'calendar', start: '2026-12-03', title: 'ＺＯＯＭ　　打ち合わせ ' })).toBe(id)
    expect(derivedItemId({ origin: 'calendar', start: '2026-12-03', title: ' zoom  打ち合わせ' })).toBe(id)
    expect(normalizeIdText('  Ａｂｃ　 Ｄ\n e ')).toBe('abc d e')
  })

  it('カレンダーに出ないタスクは from・to が null（開始日だけを変えても同じ id）。締め切りがあれば期間が材料', () => {
    const t1 = derivedItemId({ origin: 'list', title: '見積書を出す' })
    expect(derivedItemId({ origin: 'list', start: '2026-11-10', title: '見積書を出す' })).toBe(t1)
    const t2 = derivedItemId({ origin: 'list', start: '2026-11-10', due: '2026-11-20', title: '見積書を出す' })
    expect(t2).not.toBe(t1)
    expect(derivedItemId({ origin: 'list', due: '2026-11-20', title: '見積書を出す' })).not.toBe(t2)
    // 予定とタスクは同じ件名・期間でも別の id
    expect(derivedItemId({ origin: 'calendar', start: '2026-11-20', title: '見積書を出す' })).not.toBe(
      derivedItemId({ origin: 'list', due: '2026-11-20', title: '見積書を出す' }).replace(/^ct-/, 'ce-'),
    )
  })
})

describe('やりたいこと・ルーチンの id（19.4）', () => {
  it('やりたいことは中身から（cf-）。そろえ方は件名と同じ', () => {
    const id = derivedFavoriteId({ text: '積んでいる本を読む' })
    expect(id).toMatch(/^cf-/)
    expect(derivedFavoriteId({ text: ' 積んでいる本を読む ' })).toBe(id)
    expect(derivedFavoriteId({ text: '積んでいる本を2冊読む' })).not.toBe(id)
    expect(derivedFavoriteId({ text: '何でも' }, MAIL_A)).not.toBe(derivedFavoriteId({ text: '何でも' }))
  })

  it('ルーチンは件名・種類・指定から（cr-）', () => {
    const id = derivedRoutineId({ title: '朝の体操', cycle: 'weekly', weekdays: [1, 4] })
    expect(id).toMatch(/^cr-/)
    expect(derivedRoutineId({ title: '朝の体操', cycle: 'weekly', weekdays: [1, 4], monthDay: null })).toBe(id)
    expect(derivedRoutineId({ title: '朝の体操', cycle: 'weekly', weekdays: [1] })).not.toBe(id)
    expect(derivedRoutineId({ title: '朝の体操', cycle: 'daily' })).not.toBe(id)
  })
})

describe('id の見分けと決まった id', () => {
  it('内容から作った id か（ce-・ct-・cf-・cr-）', () => {
    expect(isDerivedId(derivedItemId({ origin: 'list', title: 'x' }))).toBe(true)
    expect(isDerivedId('cf-abc.def.1')).toBe(true)
    expect(isDerivedId('cx-abc')).toBe(false)
    expect(isDerivedId('3f2a1c9e-1111-4222-8333-444455556666')).toBe(false)
    expect(isDerivedId('xa-123')).toBe(false)
    expect(isDerivedId(null)).toBe(false)
  })

  it('休み・ラベルの呼び名・チェックの記録', () => {
    expect(offDayId('2026-11-20')).toBe('2026-11-20')
    expect(labelNameId('sky-l')).toBe('sky-l')
    expect(routineCheckId('cr-abc.def.9', '2026-11')).toBe('cr-abc.def.9:2026-11')
    expect(parseRoutineCheckId('cr-abc.def.9:2026-11')).toEqual({ routineId: 'cr-abc.def.9', month: '2026-11' })
    expect(parseRoutineCheckId('r1:2026-13')).toBeNull()
    expect(parseRoutineCheckId('r1')).toBeNull()
  })
})
