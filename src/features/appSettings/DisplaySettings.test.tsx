// 設定の「表示」（docs/SPEC.md の 4.2・5.2・18.1）: 外観4つの切り替えと起動アニメーションのオン・オフを、この端末に保存する。
// 選んだ外観が <html data-theme> とブラウザの枠の色に入ること（PrefsEffect）も合わせて確かめる
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, PREFS_KEY, THEME_COLORS, usePrefs } from '../../store/uiStore'
import { PrefsEffect } from '../../ui/Layout'
import { APPEARANCE_OPTIONS, DisplaySettings } from './DisplaySettings'

const saved = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Record<string, unknown> | null

beforeEach(() => {
  localStorage.clear()
  usePrefs.setState(DEFAULT_PREFS)
  document.documentElement.removeAttribute('data-theme')
  document.querySelector('meta[name="theme-color"]')?.remove()
})

afterEach(cleanup)

describe('DisplaySettings', () => {
  it('「表示」の区切りに、外観の4つを仕様書の順に出す（初めは「端末の設定に合わせる」）', () => {
    render(<DisplaySettings />)
    expect(screen.getByRole('region', { name: '表示' })).toBeTruthy()
    const group = screen.getByRole('group', { name: '外観' })
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((b) => b.textContent)).toEqual(['端末の設定に合わせる', 'ホワイト', 'ダーク', 'ディープダーク'])
    expect(APPEARANCE_OPTIONS.map((o) => o.value)).toEqual(['system', 'white', 'dark', 'deep-dark'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
  })

  it('外観を押すと選んだ状態になり、この端末（diary-studio:prefs の appearance）に保存する', async () => {
    const user = userEvent.setup()
    render(<DisplaySettings />)
    for (const { value } of APPEARANCE_OPTIONS.slice().reverse()) {
      await user.click(screen.getByTestId(`appearance-${value}`))
      expect(usePrefs.getState().appearance).toBe(value)
      expect(saved()).toMatchObject({ v: 1, appearance: value })
      expect(screen.getByTestId(`appearance-${value}`).getAttribute('aria-pressed')).toBe('true')
      const pressed = screen.getAllByRole('button', { pressed: true })
      expect(pressed).toHaveLength(1)
    }
  })

  it('起動アニメーションは初めオン。切り替えるとオフになり、保存する', async () => {
    const user = userEvent.setup()
    render(<DisplaySettings />)
    const sw = screen.getByRole('switch', { name: '起動アニメーション' }) as HTMLInputElement
    expect(sw.checked).toBe(true)
    expect(screen.getByTestId('launch-switch').textContent).toContain('オン')
    await user.click(sw)
    expect(sw.checked).toBe(false)
    expect(usePrefs.getState().launchAnimation).toBe(false)
    expect(saved()).toMatchObject({ launchAnimation: false })
    expect(screen.getByTestId('launch-switch').textContent).toContain('オフ')
    await user.click(sw)
    expect(usePrefs.getState().launchAnimation).toBe(true)
    expect(saved()).toMatchObject({ launchAnimation: true })
  })

  it('ほかの所で設定が変わったら、その場で表示も替わる', () => {
    render(<DisplaySettings />)
    act(() => usePrefs.getState().setPrefs({ appearance: 'deep-dark', launchAnimation: false }))
    expect(screen.getByTestId('appearance-deep-dark').getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('switch', { name: '起動アニメーション' }) as HTMLInputElement).checked).toBe(false)
  })

  it('選んだ外観が <html data-theme> とブラウザの枠の色に入る（端末の設定に合わせるは、ダークでない端末ならホワイト）', async () => {
    const user = userEvent.setup()
    render(
      <>
        <PrefsEffect />
        <DisplaySettings />
      </>,
    )
    const root = document.documentElement
    const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
    expect(root.getAttribute('data-theme')).toBe('white')
    expect(meta()).toBe(THEME_COLORS.white)
    for (const value of ['dark', 'deep-dark', 'white'] as const) {
      await user.click(screen.getByTestId(`appearance-${value}`))
      expect(root.getAttribute('data-theme')).toBe(value)
      expect(meta()).toBe(THEME_COLORS[value])
    }
    await user.click(screen.getByTestId('appearance-system'))
    expect(root.getAttribute('data-theme')).toBe('white')
  })
})
