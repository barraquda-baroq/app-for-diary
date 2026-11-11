// 決まりの部分が画面・保存の仕組みに頼らないこと（docs/SPEC.md の 2.9。段階6のコネクタが src/domain をそのまま使う）。
// src/domain の下と、画面の形を決める純粋な関数（src/features の *Model.ts・行き先・期間の表記・スワイプ・ロック中の掴み方）は、
// React・画面の部品（src/ui。どれも React か画面に頼る）・状態の入れ物（zustand・src/store）・同期（src/sync・Firebase）・
// 端末の保存（src/db・Dexie）・dnd-kit を読み込まない（型だけの読み込みも。モードや幅の区分の型は common/types.ts から読む）
import { describe, expect, it } from 'vitest'

/** 確かめるファイル（[src/ からの場所, 中身]）。まだ無いファイルは読まれないだけ */
const PURE = import.meta.glob(
  [
    '../../domain/**/*.ts',
    '../**/*Model.ts',
    './common/calendarRoute.ts',
    './common/calendarHeading.ts',
    './common/swipe.ts',
    './week/dnd/gesture.ts',
    '!../../**/*.test.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

/** 読み込んでいる物の名前（import … from '…'・import '…'・export … from '…'・import('…')） */
export function importsOf(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const out: string[] = []
  for (const m of code.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  for (const m of code.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1])
  return out
}

/** 読み込んではいけない物か（理由。よければ null）。inDomain は src/domain の中のファイル（domain の外の自分のコードも読まない） */
export function impurity(specifier: string, inDomain: boolean): string | null {
  if (/^react(?:-dom|-router|-router-dom)?(?:\/|$)/.test(specifier)) return 'React'
  if (/^zustand(?:\/|$)/.test(specifier)) return 'zustand'
  if (/^(?:firebase|@firebase\/)/.test(specifier)) return 'Firebase'
  if (/^dexie(?:\/|$)/.test(specifier)) return 'Dexie'
  if (/^@dnd-kit\//.test(specifier)) return 'dnd-kit'
  if (specifier.startsWith('.')) {
    const segments = specifier.split('/')
    if (segments.some((s) => s === 'store' || s === 'sync' || s === 'db')) return 'src/store・src/sync・src/db'
    if (segments.includes('ui')) return 'src/ui'
    if (inDomain && specifier.startsWith('../')) return 'src/domain の外'
  }
  return null
}

describe('確かめる道具', () => {
  it('読み込んでいる物の名前を拾う（型だけの読み込み・まとめての書き出し・後から読み込む物も）', () => {
    const src = [
      "import { a } from './a'",
      "import type { B } from '../store/uiStore'",
      "import 'fake-indexeddb/auto'",
      "export { c } from './c'",
      "const m = await import('react')",
      "// import x from 'zustand'",
      "const url = 'https://example.com/x'",
    ].join('\n')
    expect(importsOf(src)).toEqual(['./a', '../store/uiStore', './c', 'fake-indexeddb/auto', 'react'])
  })

  it.each([
    ['react', false, 'React'],
    ['react-dom/client', false, 'React'],
    ['zustand', false, 'zustand'],
    ['firebase/firestore', false, 'Firebase'],
    ['dexie', false, 'Dexie'],
    ['@dnd-kit/dom', false, 'dnd-kit'],
    ['../store', false, 'src/store・src/sync・src/db'],
    ['../../../store/appStore', false, 'src/store・src/sync・src/db'],
    ['../sync/controller', false, 'src/store・src/sync・src/db'],
    ['../../domain/dates', false, null],
    ['../../../ui/hooks', false, 'src/ui'],
    ['../common/types', false, null],
    ['./types', true, null],
    ['../ui/hooks', true, 'src/ui'],
    ['../routes', true, 'src/domain の外'],
    ['@holiday-jp/holiday_jp', true, null],
  ] as const)('%s（domain の中 %s）→ %s', (specifier, inDomain, reason) => {
    expect(impurity(specifier, inDomain)).toBe(reason)
  })
})

describe('決まりの部分は React・保存・同期の仕組みに頼らない（2.9）', () => {
  it('src/domain の決まりのファイルを読めている', () => {
    const names = Object.keys(PURE)
    expect(names).toContain('../../domain/dates.ts')
    expect(names).toContain('../../domain/items.ts')
    expect(names.some((n) => n.endsWith('.test.ts'))).toBe(false)
  })

  it('読み込んではいけない物を読み込んでいない', () => {
    const found: string[] = []
    for (const [file, source] of Object.entries(PURE)) {
      const inDomain = file.startsWith('../../domain/')
      for (const spec of importsOf(source)) {
        const reason = impurity(spec, inDomain)
        if (reason) found.push(`${file}: ${spec}（${reason}）`)
      }
    }
    expect(found).toEqual([])
  })
})
