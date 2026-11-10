// 動きの共通の決まり（docs/SPEC.md の 4.9）: 視差効果を減らす設定では、なめらかなスクロールをやめる
import { afterEach, describe, expect, it } from 'vitest'
import { prefersReducedMotion, scrollBehavior } from './motion'

const original = window.matchMedia

function setReducedMotion(reduce: boolean | null) {
  window.matchMedia =
    reduce === null
      ? (undefined as unknown as typeof window.matchMedia)
      : (((query: string) => ({
          matches: reduce && query.includes('prefers-reduced-motion: reduce'),
          media: query,
        })) as unknown as typeof window.matchMedia)
}

afterEach(() => {
  window.matchMedia = original
})

describe('scrollBehavior（4.9）', () => {
  it('ふだんは smooth', () => {
    setReducedMotion(false)
    expect(prefersReducedMotion()).toBe(false)
    expect(scrollBehavior()).toBe('smooth')
  })

  it('視差効果を減らす設定では auto', () => {
    setReducedMotion(true)
    expect(prefersReducedMotion()).toBe(true)
    expect(scrollBehavior()).toBe('auto')
  })

  it('matchMedia の無い所では smooth', () => {
    setReducedMotion(null)
    expect(scrollBehavior()).toBe('smooth')
  })
})
