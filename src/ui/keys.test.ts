// キー操作（docs/SPEC.md の 3.10・12.2）: 登録の画面の Ctrl+Enter・⌘+Enter と、その表記
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
  ])('%o → %s', (e, expected) => {
    expect(isSubmitShortcut(e)).toBe(expected)
  })

  it('表記は Mac・iPhone・iPad なら ⌘、ほかは Ctrl', () => {
    expect(submitShortcutLabel('MacIntel')).toBe('⌘+Enter')
    expect(submitShortcutLabel('iPhone')).toBe('⌘+Enter')
    expect(submitShortcutLabel('Win32')).toBe('Ctrl+Enter')
    expect(submitShortcutLabel('Linux x86_64')).toBe('Ctrl+Enter')
  })
})
