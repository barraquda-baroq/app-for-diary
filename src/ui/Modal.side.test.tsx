// 小さな画面の出し方 side（src/ui/Modal.tsx の placement。docs/SPEC.md の 3.6・3.8・4.9）: L では右の列（[data-testid=side-column]）の
// 上に重ねるパネル（右の列と同じ所・幅・高さ。右から 180ms。後ろは透明な背景）、S・M は下からのシート。開いたまま幅を替えても閉じず、
// 出し方だけが替わる（中の物は作り直さない）。外を押すと閉じ、押した出来事は背景が受ける（後ろの画面は操作できない）。Esc は
// いちばん上の物だけ・変換を取り消す Esc では閉じない。Tab は中を回る（見えている物だけ）。閉じるとフォーカスを開いた所へ戻す
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WIDTH_L } from './hooks'
import { Modal } from './Modal'

// テストでは CSS を import すると（?raw でも）中身が空になるので、ファイルを読む（src/styles.test.ts と同じ）
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
// （new URL(…, import.meta.url) は Vite が置き換えるので、このファイルの場所から作る）
const HERE = decodeURIComponent(new URL(import.meta.url).pathname).replace(/[^/]*$/, '')
const panelCss = readFileSync(`${HERE}panel.css`, 'utf8')

/** 幅を替えると change を知らせる matchMedia（(min-width: …px) だけに答える） */
function liveWidth(initial: number) {
  let width = initial
  const lists = new Set<{ query: string; matches: boolean; listeners: Set<() => void> }>()
  const evaluate = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    return Boolean(min || max) && (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
  }
  window.matchMedia = ((query: string) => {
    const entry = { query, matches: evaluate(query), listeners: new Set<() => void>() }
    lists.add(entry)
    return {
      get matches() {
        return entry.matches
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, fn: () => void) => entry.listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => entry.listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList
  }) as typeof window.matchMedia
  return (next: number) => {
    width = next
    act(() => {
      for (const entry of lists) {
        const matches = evaluate(entry.query)
        if (matches === entry.matches) continue
        entry.matches = matches
        for (const fn of [...entry.listeners]) fn()
      }
    })
  }
}

/** L の右の列（TopPage の aside）を置き、その箱を決める */
function sideColumn(rect = { top: 56, left: 1084, width: 300, height: 828 }): HTMLElement {
  const aside = document.createElement('aside')
  aside.dataset.testid = 'side-column'
  document.body.appendChild(aside)
  vi.spyOn(aside, 'getBoundingClientRect').mockImplementation(
    () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }) as DOMRect,
  )
  return aside
}

const panel = () => screen.getByTestId('panel')
const backdrop = () => document.querySelector('.modal-backdrop') as HTMLElement
const vars = (el: HTMLElement) =>
  Object.fromEntries(['top', 'left', 'width', 'height'].map((n) => [n, el.style.getPropertyValue(`--panel-${n}`)]))

let originalMatchMedia: typeof window.matchMedia | undefined

beforeEach(() => {
  originalMatchMedia = window.matchMedia
  const root = document.createElement('div')
  root.id = 'root'
  root.innerHTML =
    '<button type="button" data-testid="opener">…</button><button type="button" data-testid="under">下の物</button>'
  document.body.appendChild(root)
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  if (originalMatchMedia) window.matchMedia = originalMatchMedia
  else delete (window as Partial<Window>).matchMedia
})

/** パネルを開く物（中に字を打つ欄と2つのボタン。閉じると外す） */
function Harness({ onClose = () => {}, initial = true }: { onClose?: () => void; initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  if (!open) return null
  return (
    <Modal
      title="タスク"
      placement="side"
      testId="panel"
      onClose={() => {
        onClose()
        setOpen(false)
      }}
    >
      <input data-testid="field" />
      <button type="button" data-testid="last">
        削除
      </button>
    </Modal>
  )
}

describe('S3 L の右の列の上のパネル（S3-FRAME-075・101・TASK-140）', () => {
  it('L では右の列と同じ所・幅・高さのパネル（is-side・右から出る panel-in）で、後ろの背景は透明な is-side', () => {
    liveWidth(1400)
    sideColumn()
    render(<Harness />)
    expect(panel().className).toBe('modal is-side panel-in')
    expect(backdrop().className).toBe('modal-backdrop is-side')
    expect(vars(panel())).toEqual({ top: '56px', left: '1084px', width: '300px', height: '828px' })
    expect(panel().getAttribute('role')).toBe('dialog')
    expect(panel().getAttribute('aria-modal')).toBe('true')
  })

  it('右の列の大きさ・ウインドウの大きさが替わると合わせ直す', () => {
    liveWidth(1400)
    const rect = { top: 56, left: 1084, width: 300, height: 828 }
    sideColumn(rect)
    render(<Harness />)
    rect.height = 600
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(vars(panel()).height).toBe('600px')
    rect.left = 900
    act(() => {
      ;(window.ResizeObserver as unknown as { resizeAll: (w: number, h: number) => void }).resizeAll(300, 600)
    })
    expect(vars(panel()).left).toBe('900px')
  })

  it('右の列が無い時は、画面の右の端から 16px 内の幅 300px（上下も 16px 空ける）', () => {
    liveWidth(1400)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    render(<Harness />)
    expect(vars(panel())).toEqual({ top: '16px', left: '1084px', width: '300px', height: '868px' })
  })

  it('S・M では下からのシート（パネルの印も、合わせる位置も付けない）', () => {
    for (const width of [412, 768]) {
      liveWidth(width)
      sideColumn()
      render(<Harness />)
      expect(panel().className).toBe('modal')
      expect(backdrop().className).toBe('modal-backdrop')
      expect(vars(panel())).toEqual({ top: '', left: '', width: '', height: '' })
      cleanup()
    }
  })

  it('placement を渡さない（auto）時は、L でも今までどおり真ん中の小さな画面', () => {
    liveWidth(1400)
    sideColumn()
    render(
      <Modal title="予定" onClose={() => {}} testId="m">
        中身
      </Modal>,
    )
    expect(screen.getByTestId('m').className).toBe('modal')
    expect(backdrop().className).toBe('modal-backdrop')
  })
})

describe('S3 幅を替えても閉じない（S3-FRAME-106・TASK-149）', () => {
  it('L ↔ S・M を行き来しても開いたまま、出し方だけが替わる。中の物は作り直さない（打った字・フォーカスはそのまま）', () => {
    const setWidth = liveWidth(1400)
    sideColumn()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const dialog = panel()
    const field = screen.getByTestId('field') as HTMLInputElement
    fireEvent.change(field, { target: { value: '書いている字' } })
    field.focus()
    setWidth(WIDTH_L - 1)
    expect(panel()).toBe(dialog)
    expect(dialog.className).toBe('modal')
    expect(vars(dialog)).toEqual({ top: '', left: '', width: '', height: '' })
    expect(screen.getByTestId('field')).toBe(field)
    expect(field.value).toBe('書いている字')
    expect(document.activeElement).toBe(field)
    setWidth(WIDTH_L)
    expect(panel()).toBe(dialog)
    expect(dialog.className).toBe('modal is-side panel-in')
    expect(vars(dialog).width).toBe('300px')
    expect(document.activeElement).toBe(field)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('S3 閉じ方・フォーカス（S3-FRAME-103〜105・107・TASK-148・154）', () => {
  it('外（透明な背景）を押すと閉じる。押した出来事は背景が受け、開いている間の後ろの画面は操作できない（inert・読み上げない）', () => {
    liveWidth(1400)
    sideColumn()
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const root = document.getElementById('root') as HTMLElement & { inert: boolean }
    expect(root.inert).toBe(true)
    expect(root.getAttribute('aria-hidden')).toBe('true')
    // パネルの中を押しても閉じない
    fireEvent.mouseDown(screen.getByTestId('field'))
    expect(onClose).not.toHaveBeenCalled()
    const under = vi.fn()
    screen.getByTestId('under').addEventListener('mousedown', under)
    fireEvent.mouseDown(backdrop())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(under).not.toHaveBeenCalled()
    expect(root.inert).toBe(false)
    expect(root.hasAttribute('aria-hidden')).toBe(false)
  })

  it('［×］・Esc で閉じる。変換を取り消す Esc（isComposing・keyCode 229）では閉じない', () => {
    liveWidth(1400)
    sideColumn()
    const onClose = vi.fn()
    const r = render(<Harness onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    r.unmount()
    render(<Harness onClose={onClose} />)
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('パネルの上に重ねた小さな画面（削除の確かめなど）がある時の Esc は、上の物だけを閉じる', () => {
    liveWidth(1400)
    sideColumn()
    const onPanel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <>
        <Harness onClose={onPanel} />
        <Modal title="削除しますか？" onClose={onConfirm} testId="confirm">
          <button type="button">削除</button>
        </Modal>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onPanel).not.toHaveBeenCalled()
  })

  it('開くとフォーカスを中へ移し（描いた直後）、Tab は中を回る（最後の次は最初・最初の前は最後）', () => {
    liveWidth(1400)
    sideColumn()
    // jsdom は配置も checkVisibility も持たないので、どれも見えている物にする
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { configurable: true, writable: true, value: () => true })
    try {
      render(<Harness />)
      const field = screen.getByTestId('field')
      expect(document.activeElement).toBe(field)
      const close = screen.getByTestId('modal-close')
      const last = screen.getByTestId('last')
      last.focus()
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(close)
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility')
    }
  })

  it('閉じると、開いた時にフォーカスのあった所（行の「…」）へ戻す', () => {
    liveWidth(1400)
    sideColumn()
    const opener = screen.getByTestId('opener')
    opener.focus()
    function Opened() {
      const [open, setOpen] = useState(true)
      return open ? (
        <Modal title="タスク" placement="side" testId="panel" onClose={() => setOpen(false)}>
          <input data-testid="field" />
        </Modal>
      ) : null
    }
    render(<Opened />)
    expect(document.activeElement).toBe(screen.getByTestId('field'))
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(screen.queryByTestId('panel')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('S3 パネルの CSS（src/ui/panel.css。S3-FRAME-108・311・TASK-153・155）', () => {
  const rule = (selector: string) => {
    const i = panelCss.indexOf(`${selector} {`)
    expect(i, selector).toBeGreaterThanOrEqual(0)
    return panelCss.slice(i, panelCss.indexOf('}', i))
  }

  it('背景は透明で画面いっぱい（ほかの小さな画面と同じ z-index 100 の .modal-backdrop のまま。暗くしない・動かさない）', () => {
    const css = rule('.modal-backdrop.is-side')
    expect(css).toContain('background: transparent')
    expect(css).toContain('animation: none')
    expect(css).not.toContain('z-index')
  })

  it('パネルは右の列の所（Modal が合わせる変数）・角は --radius・右から 180ms（--dur-panel の slide-in-right。視差効果を減らす設定では styles.css の決まりで止まる）', () => {
    const css = rule('.modal.is-side')
    for (const v of ['--panel-top', '--panel-left', '--panel-width', '--panel-height']) expect(css).toContain(`var(${v}`)
    expect(css).toContain('position: fixed')
    expect(css).toContain('border-radius: var(--radius)')
    expect(css).toContain('animation: slide-in-right var(--dur-panel) ease-out')
  })
})
