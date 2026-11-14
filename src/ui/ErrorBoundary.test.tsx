// 画面を表示できなかった時の案内（ErrorScreen。docs/SPEC.md の 3.1）の［トップへ］［アプリの設定・バックアップ］: iPhone・iPad では
// ブラウザの履歴を1つのままにする（22. の ■31〜■33）ので、履歴に積まずに今の物を置き換えて移る（# のリンクのまま移ると、ブラウザの
// 履歴が増え、端から払った時にブラウザのめくる動きが戻る）。Android・PC は今までどおり # のリンクで移る
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as device from './device'
import { ErrorScreen } from './ErrorBoundary'

beforeEach(() => {
  window.history.replaceState(null, '', '#/week/2026-11-08')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** # のリンクを押した後の移り（jsdom は次の処理で移る）を待つ */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('画面を表示できなかった時の案内の［トップへ］［アプリの設定・バックアップ］', () => {
  it('iPhone・iPad では履歴に積まずに置き換えて移る（ブラウザの履歴の数は変わらない）', async () => {
    vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
    render(<ErrorScreen message="読めませんでした" />)
    const before = window.history.length
    fireEvent.click(screen.getByText('アプリの設定・バックアップ'))
    await nextTask()
    expect(window.location.hash).toBe('#/settings')
    expect(window.history.length).toBe(before)
    fireEvent.click(screen.getByText('トップへ'))
    await nextTask()
    expect(window.location.hash).toBe('#/')
    expect(window.history.length).toBe(before)
  })

  it('Android・PC は今までどおり # のリンクで移る（ブラウザの履歴に積む）', async () => {
    vi.spyOn(device, 'currentPopSource').mockReturnValue('os-back')
    render(<ErrorScreen message="読めませんでした" />)
    const before = window.history.length
    const settings = screen.getByText('アプリの設定・バックアップ')
    expect(settings.getAttribute('href')).toBe('#/settings')
    expect(screen.getByText('トップへ').getAttribute('href')).toBe('#/')
    fireEvent.click(settings)
    await nextTask()
    expect(window.location.hash).toBe('#/settings')
    expect(window.history.length).toBe(before + 1)
  })
})
