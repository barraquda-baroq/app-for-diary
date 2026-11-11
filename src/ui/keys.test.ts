// キー操作（docs/SPEC.md の 3.10・12.2）: 登録の画面の Ctrl+Enter・⌘+Enter と、その表記
import { fireEvent, render } from '@testing-library/react'
import { createElement, type KeyboardEvent } from 'react'
import { describe, expect, it } from 'vitest'
import { isSubmitShortcut, submitShortcutLabel } from './keys'

describe('Ctrl+Enter・⌘+Enter（12.2）', () => {
  it.each([
    [{ key: 'Enter', ctrlKey: true, metaKey: false }, true],
    [{ key: 'Enter', ctrlKey: false, metaKey: true }, true],
    [{ key: 'Enter', ctrlKey: false, metaKey: false }, false],
    [{ key: 'a', ctrlKey: true, metaKey: false }, false],
    // 日本語の変換を決める Enter では登録しない
    [{ key: 'Enter', ctrlKey: true, metaKey: false, isComposing: true }, false],
    // React の出来事は変換中かを nativeEvent に持つ
    [{ key: 'Enter', ctrlKey: true, metaKey: false, nativeEvent: { isComposing: true } }, false],
    // Safari は変換を決める Enter に isComposing を付けず keyCode 229 にする
    [{ key: 'Enter', ctrlKey: false, metaKey: true, keyCode: 229 }, false],
    [{ key: 'Enter', ctrlKey: false, metaKey: true, keyCode: 13, nativeEvent: { isComposing: false } }, true],
  ])('%o → %s', (e, expected) => {
    expect(isSubmitShortcut(e)).toBe(expected)
  })

  it('React の onKeyDown の出来事をそのまま渡せる（変換中の Enter を見分ける）', () => {
    const seen: boolean[] = []
    const { container } = render(createElement('textarea', { onKeyDown: (e: KeyboardEvent) => seen.push(isSubmitShortcut(e)) }))
    const field = container.querySelector('textarea')!
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(seen).toEqual([true, false])
  })

  it('表記は Mac・iPhone・iPad なら ⌘、ほかは Ctrl', () => {
    expect(submitShortcutLabel('MacIntel')).toBe('⌘+Enter')
    expect(submitShortcutLabel('iPhone')).toBe('⌘+Enter')
    expect(submitShortcutLabel('Win32')).toBe('Ctrl+Enter')
    expect(submitShortcutLabel('Linux x86_64')).toBe('Ctrl+Enter')
  })
})
