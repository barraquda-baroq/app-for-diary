// @vitest-environment node
// 公開の前の確かめ（scripts/deploy.mjs の checkConfig。docs/DEPLOY.md の 1 の 7・docs/SPEC.md の 2.6）。
// 読み込んだだけでは公開を始めない（直接動かした時だけ main が動く）ことも、この読み込みで確かめている
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_PROJECT, checkConfig } from './deploy.mjs'

const realConfig = readFileSync(new URL('../src/sync/firebaseConfig.ts', import.meta.url), 'utf8')
const realRc = readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8')

/** 作者が差し替えた後の形（値は例） */
const filled = (id = 'diary-studio-1a2b3', quote = "'") =>
  [
    'export const firebaseConfig = {',
    `  apiKey: ${quote}AIzaSyExampleExampleExampleExample00${quote},`,
    `  authDomain: ${quote}${id}.firebaseapp.com${quote},`,
    `  projectId: ${quote}${id}${quote},`,
    `  appId: ${quote}1:123456789012:web:abcdef0123456789${quote},`,
    '}',
  ].join('\n')
const rc = (id = 'diary-studio-1a2b3') => JSON.stringify({ projects: { default: id } })

describe('checkConfig（公開を始めてよいか）', () => {
  it('差し替えた値で、2つのプロジェクトがそろっていれば公開してよい', () => {
    expect(checkConfig(filled(), rc())).toEqual({ projectId: 'diary-studio-1a2b3', problems: [] })
    // " で書いてあってもよい
    expect(checkConfig(filled('diary-studio-1a2b3', '"'), rc()).problems).toEqual([])
  })

  it('リポジトリの今の値（差し替え用の仮の値）は、仮のままの所をすべて挙げて止める', () => {
    const { projectId, problems } = checkConfig(realConfig, realRc)
    // 作者が docs/DEPLOY.md の手順で差し替えた後は、ここは問題なしになる
    if (realRc.includes(PLACEHOLDER_PROJECT)) {
      expect(projectId).toBeNull()
      expect(problems.join('\n')).toMatch(/apiKey が仮の値/)
      expect(problems.join('\n')).toMatch(/projectId が仮の値/)
      expect(problems.join('\n')).toMatch(/\.firebaserc のプロジェクトが仮の値/)
    } else {
      expect(problems).toEqual([])
    }
    // どちらの時も、形（export の行・半角の引用符）は崩れていない
    expect(problems.join('\n')).not.toMatch(/飾りの引用符|export const firebaseConfig|形が崩れて/)
  })

  it('2つのプロジェクトが食い違っていたら止める', () => {
    const { problems } = checkConfig(filled('diary-studio-1a2b3'), rc('diary-studio-other'))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/食い違っています/)
  })

  it('飾りの引用符（Mac のスマート引用符）は知らせ、値はそのまま読める', () => {
    const { problems } = checkConfig(filled('diary-studio-1a2b3', '‘').replace(/‘,/g, '’,'), rc())
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/飾りの引用符/)
  })

  it('export の行を消した・.firebaserc が壊れている・無い・設定のファイルが無い時も止める', () => {
    expect(checkConfig(filled().replace('export const firebaseConfig = {', '{'), rc()).problems.join('\n')).toMatch(
      /export const firebaseConfig/,
    )
    expect(checkConfig(filled(), '{ "projects": ').problems.join('\n')).toMatch(/形が崩れて/)
    expect(checkConfig(filled(), null).problems.join('\n')).toMatch(/\.firebaserc が見つかりません/)
    expect(checkConfig(null, rc()).problems.join('\n')).toMatch(/firebaseConfig\.ts が見つかりません/)
  })
})
