// 選び肢の一覧（OptionList）: ↑↓で移った選び肢を見える所へ出す時は、一覧の中だけを動かす（小さな画面・ページは動かさない）
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollIntoViewWithin } from '../../../ui/scrollWithin'
import { OptionList, optionId } from './OptionList'

// 見える所まで動かすのは src/ui/scrollWithin.ts（中身はそのまま動かし、呼ばれた物を見る）
vi.mock('../../../ui/scrollWithin', { spy: true })

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

const options = ['9:00', '9:05', '9:10', '9:15'].map((v) => ({ value: v, label: v }))

function renderList() {
  const anchor = document.body.appendChild(document.createElement('input'))
  const props = { id: 'start-list', anchor, label: '開始の時刻', options, onPick: () => {}, onClose: () => {} }
  const r = render(<OptionList {...props} active={-1} />)
  return { setActive: (active: number) => r.rerender(<OptionList {...props} active={active} />) }
}

describe('↑↓で移った選び肢を見える所へ', () => {
  it('一覧の中だけを、すぐに動かす（scrollIntoViewWithin。scrollIntoView は小さな画面もページも動かすので使わない）', () => {
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView
    try {
      const list = renderList()
      vi.mocked(scrollIntoViewWithin).mockClear()
      list.setActive(2)
      expect(scrollIntoViewWithin).toHaveBeenCalledWith(document.getElementById(optionId('start-list', 2)), {
        behavior: 'auto',
      })
      list.setActive(3)
      expect(scrollIntoViewWithin).toHaveBeenLastCalledWith(document.getElementById(optionId('start-list', 3)), {
        behavior: 'auto',
      })
      expect(intoView).not.toHaveBeenCalled()
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})
