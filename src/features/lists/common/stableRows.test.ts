// 作り直した行・かたまり・中身を、前と同じなら前の物に置き換える道具（src/features/lists/common/stableRows.ts）
import { describe, expect, it } from 'vitest'
import { mkTask } from '../../../domain/testData'
import { keep, sameView } from './stableRows'

describe('S3 行に出す物が同じか（sameView）', () => {
  const item = mkTask()
  const row = () => ({ id: 't1', item, done: false, date: { sub: null, main: '11/20', faint: false, aria: '2026年11月20日' } })

  it('どの欄も同じ値なら同じ（日付の列の字のような1段の物は中の欄で比べる）', () => {
    expect(sameView(row(), row())).toBe(true)
  })

  it('1つの欄でも違えば違う（1段の物の中の欄も）', () => {
    expect(sameView(row(), { ...row(), done: true })).toBe(false)
    expect(sameView(row(), { ...row(), date: { ...row().date, main: '11/21' } })).toBe(false)
    expect(sameView(row(), { ...row(), date: { ...row().date, extra: 1 } })).toBe(false)
    expect(sameView(row(), { ...row(), more: 1 })).toBe(false)
  })

  it('記録そのもの（item・routine・favorite）は中を見ず、同じ物の時だけ同じ（直した記録は新しい物）', () => {
    expect(sameView(row(), { ...row(), item: { ...item } })).toBe(false)
    expect(sameView({ routine: item }, { routine: { ...item } })).toBe(false)
    expect(sameView({ favorite: item }, { favorite: item })).toBe(true)
  })

  it('配列は同じ長さで1つずつ同じ物の時だけ同じ（中身の配列を作り直しても、行が同じなら同じ）', () => {
    const a = { id: 'a' }
    const b = { id: 'b' }
    expect(sameView({ open: [a, b], undone: 2 }, { open: [a, b], undone: 2 })).toBe(true)
    expect(sameView({ open: [a, b] }, { open: [b, a] })).toBe(false)
    expect(sameView({ open: [a, b] }, { open: [a] })).toBe(false)
    expect(sameView({ open: [a] }, { open: [{ id: 'a' }] })).toBe(false)
    expect(sameView({ open: [a] }, { open: { 0: a } })).toBe(false)
  })
})

describe('S3 前と同じなら前の物を返す（keep）', () => {
  it('同じ key で同じ中身なら前の物、違えば新しい物を覚えて返す', () => {
    const cache = new Map<string, { n: number }>()
    const first = keep(cache, 'k', { n: 1 })
    expect(keep(cache, 'k', { n: 1 })).toBe(first)
    const second = keep(cache, 'k', { n: 2 })
    expect(second).not.toBe(first)
    expect(second).toEqual({ n: 2 })
    expect(keep(cache, 'k', { n: 2 })).toBe(second)
    // ほかの key は別に覚える
    expect(keep(cache, 'other', { n: 2 })).not.toBe(second)
  })
})
