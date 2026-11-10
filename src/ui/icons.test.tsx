// 線のアイコン（docs/SPEC.md の 4.10・4.11）: どれも同じ作り（24 四方・線 1.8・丸い端・文字の色）か、DS で足す物がそろっているか
import { cleanup, render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import * as icons from './icons'
import { BagIcon, DotCheckIcon, HomeIcon, ICON_STROKE, ICON_STROKE_SMALL, KindIcon, type IconProps } from './icons'

afterEach(cleanup)

/** 線のアイコン（名前が …Icon の物。区分を選ぶ KindIcon と、作りの違う点線の丸 DotCheckIcon は別に確かめる） */
const LINE_ICONS = Object.entries(icons).filter(
  ([name, value]) => name.endsWith('Icon') && typeof value === 'function' && name !== 'KindIcon' && name !== 'DotCheckIcon',
) as [string, ComponentType<IconProps>][]

const svgOf = (el: HTMLElement) => el.querySelector('svg') as SVGSVGElement

describe('線のアイコン', () => {
  it('DS で足すアイコン（docs/SPEC.md の 4.10 の表）がそろっている', () => {
    const names = LINE_ICONS.map(([name]) => name)
    for (const name of [
      'CalendarIcon',
      'LockIcon',
      'KeyIcon',
      'QrIcon',
      'EyeIcon',
      'EyeOffIcon',
      'BagIcon',
      'HomeIcon',
      'RepeatIcon',
      'HeartIcon',
      'ListCheckIcon',
      'ClockIcon',
      'GripIcon',
      'PrintIcon',
      'CloudIcon',
      'CloudOffIcon',
    ]) {
      expect(names, name).toContain(name)
    }
  })

  it('NS 専用のアイコン（本・本棚・比較など）は削ってある', () => {
    for (const name of ['BookIcon', 'ShelfIcon', 'OpenBookIcon', 'CompareIcon', 'BulbIcon', 'TargetIcon', 'CameraIcon']) {
      expect(name in icons, name).toBe(false)
    }
  })

  it.each(LINE_ICONS)('%s: 24 四方・線 1.8・丸い端・文字と同じ色の飾り', (_name, Icon) => {
    const { container } = render(<Icon />)
    const svg = svgOf(container)
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('class')).toBe('icon')
    expect(svg.getAttribute('fill')).toBe('none')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe(String(ICON_STROKE))
    expect(svg.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.getAttribute('stroke-linejoin')).toBe('round')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.children.length).toBeGreaterThan(0)
  })

  it.each(LINE_ICONS)('%s: 四角と丸は 24 四方の中に収まっている', (_name, Icon) => {
    const { container } = render(<Icon />)
    for (const rect of container.querySelectorAll('rect')) {
      const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => Number(rect.getAttribute(a)))
      expect(x).toBeGreaterThanOrEqual(1)
      expect(y).toBeGreaterThanOrEqual(1)
      expect(x + w).toBeLessThanOrEqual(23)
      expect(y + h).toBeLessThanOrEqual(23)
    }
    for (const circle of container.querySelectorAll('circle')) {
      const [cx, cy, r] = ['cx', 'cy', 'r'].map((a) => Number(circle.getAttribute(a)))
      expect(cx - r).toBeGreaterThanOrEqual(1)
      expect(cy - r).toBeGreaterThanOrEqual(1)
      expect(cx + r).toBeLessThanOrEqual(23)
      expect(cy + r).toBeLessThanOrEqual(23)
    }
  })

  it('title を渡すと、読み上げる絵になる', () => {
    const { container } = render(<icons.LockIcon title="ロック中" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.hasAttribute('aria-hidden')).toBe(false)
    expect(svg.querySelector('title')?.textContent).toBe('ロック中')
  })

  it('small は 14px より小さく出す時の形（12px・線 2.4）', () => {
    const { container } = render(<BagIcon small />)
    const svg = svgOf(container)
    expect(svg.getAttribute('class')).toBe('icon icon-sm')
    expect(svg.getAttribute('stroke-width')).toBe(String(ICON_STROKE_SMALL))
    expect(ICON_STROKE_SMALL).toBe(2.4)
  })

  it('区分のアイコンは、仕事がかばん・プライベートが家', () => {
    const work = render(<KindIcon kind="work" small />).container.innerHTML
    const bag = render(<BagIcon small />).container.innerHTML
    const home = render(<HomeIcon small />).container.innerHTML
    const priv = render(<KindIcon kind="private" small />).container.innerHTML
    expect(work).toBe(bag)
    expect(priv).toBe(home)
    expect(work).not.toBe(priv)
  })
})

describe('点線の丸のチェック（docs/SPEC.md の 4.11）', () => {
  it('ふだんは直径 18px・線 1.5px の点線の丸（線とすき間は 2.6px 前後で、丸の周りにちょうど並ぶ）', () => {
    const { container } = render(<DotCheckIcon />)
    const svg = svgOf(container)
    expect(svg.getAttribute('width')).toBe('18')
    expect(svg.getAttribute('viewBox')).toBe('0 0 18 18')
    expect(svg.getAttribute('stroke-width')).toBe('1.5')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const ring = svg.querySelector('circle.dot-check-ring') as SVGCircleElement
    const r = Number(ring.getAttribute('r'))
    expect(r * 2 + 1.5).toBe(18)
    expect(ring.getAttribute('fill')).toBe('none')
    const [dash, gap] = (ring.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number)
    expect(dash).toBe(gap)
    expect(Math.abs(dash - 2.6)).toBeLessThan(0.15)
    const count = (2 * Math.PI * r) / (dash + gap)
    expect(Math.abs(count - Math.round(count))).toBeLessThan(0.01)
    expect(svg.querySelector('.dot-check-mark')).toBeNull()
  })

  it('済み・完了は丸を塗り、中に✓を出す（点線にしない）', () => {
    const { container } = render(<DotCheckIcon done />)
    const svg = svgOf(container)
    expect(svg.getAttribute('data-done')).toBe('true')
    const ring = svg.querySelector('circle.dot-check-ring') as SVGCircleElement
    expect(ring.getAttribute('fill')).toBe('currentColor')
    expect(ring.hasAttribute('stroke-dasharray')).toBe(false)
    expect(svg.querySelector('path.dot-check-mark')).not.toBeNull()
  })

  it('カード・予定の中は直径 16px', () => {
    const { container } = render(<DotCheckIcon size={16} />)
    const svg = svgOf(container)
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    const ring = svg.querySelector('circle.dot-check-ring') as SVGCircleElement
    expect(Number(ring.getAttribute('r')) * 2 + 1.5).toBe(16)
  })
})
