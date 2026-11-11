// 型の表の一覧（6.1）・小さな道具（util・tx・equal・hash）の確かめ。hash は NS と同じ値になること（コネクタと同じ計算。19.4）、
// revOf が直した日時と並びの数で変わらないこと（形2）を見る
import { describe, expect, it } from 'vitest'
import { contentEqual, deepEqual, stableStringify } from './equal'
import { hashJson, recordHash, revOf } from './hash'
import { transact } from './tx'
import { CONTENT_TABLES, TABLE_NAMES, TRASH_TABLES, emptyData, type AppData, type Favorite } from './types'
import { byOrder, charCount, nextOrder, stepOrder, topOrder } from './util'

const fav = (id: string, order: number, text = id): Favorite => ({
  id,
  v: 1,
  text,
  done: false,
  doneAt: null,
  order,
  by: 'user',
  ai: null,
  via: null,
  createdAt: 1,
  updatedAt: 1,
})

describe('表の一覧（6.1）', () => {
  it('TABLE_NAMES と emptyData のキーが同じで、並びが固定（Dexie v1 と同じ）', () => {
    expect([...TABLE_NAMES]).toEqual([
      'items',
      'offDays',
      'labelNames',
      'routines',
      'routineChecks',
      'favorites',
      'mimNotes',
      'inbox',
      'trashEntries',
      'trashRecords',
    ])
    expect(Object.keys(emptyData())).toEqual([...TABLE_NAMES])
    // 毎回新しいオブジェクト（書き換えても次の emptyData に残らない）
    const a = emptyData()
    a.items.x = {} as AppData['items'][string]
    expect(emptyData().items).toEqual({})
  })

  it('中身の表とゴミ箱に入る表', () => {
    expect([...CONTENT_TABLES]).toEqual(['items', 'routines', 'favorites', 'mimNotes'])
    expect(TRASH_TABLES).toContain('routineChecks')
    expect(TRASH_TABLES).not.toContain('offDays')
    expect(TRASH_TABLES).not.toContain('labelNames')
    expect(TRASH_TABLES).not.toContain('inbox')
  })
})

describe('並び（util）', () => {
  it('同じ order は id の小さい順（文字コードで比べ、端末の言語に左右されない）', () => {
    const list = [fav('b', 1), fav('a', 1), fav('B', 1), fav('c', 0)]
    expect(list.sort(byOrder).map((f) => f.id)).toEqual(['c', 'B', 'a', 'b'])
  })

  it('いちばん下・いちばん上に足す order', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder([fav('a', 3), fav('b', -2)])).toBe(4)
    expect(topOrder([])).toBe(0)
    expect(topOrder([fav('a', 3), fav('b', -2)])).toBe(-3)
  })

  it('1つ上・下に動かす（変わった物だけ返す）', () => {
    const changed = stepOrder([fav('a', 0), fav('b', 1), fav('c', 2)], 'c', -1)
    expect(changed.map((f) => [f.id, f.order])).toEqual([
      ['c', 1],
      ['b', 2],
    ])
    expect(stepOrder([fav('a', 0)], 'a', -1)).toEqual([])
  })

  it('文字数は前後の空白を除いたコードポイントの数（6.1）', () => {
    expect(charCount('  打ち合わせ  ')).toBe(5)
    expect(charCount('🎉a')).toBe(2)
  })
})

describe('トランザクション（tx）', () => {
  it('触った表だけを写す（ほかの表は同じ参照のまま）', () => {
    const base = { ...emptyData(), favorites: { a: fav('a', 0) } }
    const { data } = transact(base, (tx) => {
      tx.put('favorites', fav('b', 1))
      tx.delete('items', 'nothing')
    })
    expect(data.favorites).not.toBe(base.favorites)
    expect(Object.keys(data.favorites)).toEqual(['a', 'b'])
    expect('b' in base.favorites).toBe(false)
    expect(data.items).toBe(base.items)
    expect(data.routines).toBe(base.routines)
  })
})

describe('比べる（equal）', () => {
  it('キーの順と undefined の項目は問わない', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1, d: undefined })).toBe(true)
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
  })

  it('stableStringify はキーを並べ替え、undefined を書かない', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: [undefined, 'x'] } })).toBe('{"a":{"c":[null,"x"]},"b":1}')
    expect(stableStringify(undefined)).toBe('null')
  })

  it('contentEqual は updatedAt だけが違えば同じ', () => {
    expect(contentEqual(fav('a', 0), { ...fav('a', 0), updatedAt: 99 })).toBe(true)
    expect(contentEqual(fav('a', 0), { ...fav('a', 0), text: 'x' })).toBe(false)
    expect(contentEqual(null, undefined)).toBe(true)
    expect(contentEqual(fav('a', 0), null)).toBe(false)
  })
})

describe('指紋（hash）', () => {
  it('NS の hashJson と同じ値（同じ計算をコネクタでも使う）', () => {
    expect(hashJson('')).toBe('26c8wzs8fs1.kz98hrb9of.0')
    expect(hashJson('{"a":1}')).toBe('17n1rz14gl4.1nu9hiboiee.7')
    expect(hashJson('打ち合わせ')).toBe('xow8mnkvg3.4qwptymhx6.5')
    expect(hashJson(null)).toBe('')
  })

  it('同期の文書の hash はキーの順で変わらない', () => {
    expect(recordHash({ a: 1, b: 2 })).toBe(recordHash({ b: 2, a: 1 }))
    expect(recordHash({ a: 1 })).toBe(hashJson('{"a":1}'))
  })

  it('revOf は updatedAt と order で変わらず、中身で変わる（形2）', () => {
    const a = fav('a', 0, '本を読む')
    expect(revOf({ ...a, updatedAt: 1_800_000_000_000, order: -5 })).toBe(revOf(a))
    expect(revOf({ ...a, text: '本を2冊読む' })).not.toBe(revOf(a))
    expect(revOf({ ...a, done: true })).not.toBe(revOf(a))
    expect(revOf(null)).toBe('')
    // 渡した記録は書き換えない
    expect(a.updatedAt).toBe(1)
    expect(a.order).toBe(0)
  })
})

/** src/domain の外から import してよい物（ファイル → 部品）。祝日の表は部品の中の表だけで、ネットにつながない（7.2） */
const OUTSIDE_IMPORTS: Record<string, readonly string[]> = { './holidays.ts': ['@holiday-jp/holiday_jp'] }

describe('import の向き', () => {
  it('src/domain は sync・store・db・ui・features・Firebase・React を import しない（段階6のコネクタが同じ計算を使うため）', () => {
    const sources = import.meta.glob(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >
    expect(Object.keys(sources).length).toBeGreaterThan(10)
    for (const [name, src] of Object.entries(sources)) {
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      for (const spec of imports) {
        const local = spec.startsWith('./') && !spec.includes('/', 2)
        expect(local || (OUTSIDE_IMPORTS[name] ?? []).includes(spec), `${name}: ${spec}`).toBe(true)
      }
    }
  })
})
