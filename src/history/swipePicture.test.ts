// iPhone の端からのフリックの間に見える絵のための、画面の側の物（docs/SPEC.md の 3.1。src/history/swipePicture.ts）
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as device from '../ui/device'
import {
  BALLAST_ID,
  hideSheets,
  LEAVING_ATTR,
  overCalendarGone,
  renderWeight,
  screenIsClean,
  setBallast,
  whenScreenClean,
} from './swipePicture'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** 本文に置く */
function put(html: string): void {
  document.body.insertAdjacentHTML('beforeend', html)
}

describe('画面がカレンダーだけか（screenIsClean）', () => {
  it('カレンダーだけなら真。お知らせは出ていてもよい', () => {
    put('<div class="cal"><div class="cal-body"><p>予定</p></div></div><div class="toast" role="status">足しました</div>')
    expect(screenIsClean()).toBe(true)
  })

  it.each([
    ['小さな画面', '<div class="modal-backdrop"><div class="modal" role="dialog"></div></div>'],
    ['確かめ', '<div role="dialog" aria-modal="true"></div>'],
    ['メニュー', '<div role="menu"></div>'],
    ['一覧', '<ul role="listbox"></ul>'],
    ['すばやく足すの入力欄', '<div class="cp-quick"><input /></div>'],
    ['掴んだカード', '<div data-dnd-dragging=""></div>'],
    ['落とした後の動き', '<div data-dnd-dropping=""></div>'],
    ['めくる動き', '<div class="cal-turn is-next"></div>'],
  ])('%sが出ていれば偽', (_name, html) => {
    put('<div class="cal"></div>')
    put(html)
    expect(screenIsClean()).toBe(false)
  })

  it('すばやく足すの入力欄が消えた直後（まだ描かれていない）は偽。少したてば真', () => {
    vi.useFakeTimers()
    put('<div class="cal"></div>')
    overCalendarGone()
    expect(screenIsClean()).toBe(false)
    vi.advanceTimersByTime(200)
    expect(screenIsClean()).toBe(true)
  })

  it('ページが見えていない時は偽', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    expect(screenIsClean()).toBe(false)
  })
})

describe('閉じる前に小さな画面を隠す（hideSheets）', () => {
  it('小さな画面に印を付け（CSS で消す）、返す関数で外す。外した後に出た物には触れない', () => {
    put('<div class="modal-backdrop" id="a"></div><div class="modal-backdrop" id="b"></div>')
    const show = hideSheets()
    expect(document.querySelectorAll(`[${LEAVING_ATTR}]`)).toHaveLength(2)
    put('<div class="modal-backdrop" id="c"></div>')
    show()
    expect(document.querySelectorAll(`[${LEAVING_ATTR}]`)).toHaveLength(0)
    expect(screenIsClean()).toBe(false)
  })
})

describe('描く物の数と見えない描く物（renderWeight・setBallast）', () => {
  it('要素と、字のある文字を数える（空白だけの文字は数えない）', () => {
    put('<div>\n  <span>月</span>\n  <span>火</span>\n</div>')
    expect(renderWeight()).toBe(3 + 2)
  })

  it('見えない描く物は1つの箱に入れ、数には入れない。0 で外す', () => {
    put('<div><span>月</span></div>')
    const before = renderWeight()
    setBallast(500)
    const box = document.getElementById(BALLAST_ID)
    expect(box?.childElementCount).toBe(500)
    expect(box?.getAttribute('aria-hidden')).toBe('true')
    expect(renderWeight()).toBe(before)
    setBallast(20)
    expect(document.querySelectorAll(`#${BALLAST_ID}`)).toHaveLength(1)
    expect(document.getElementById(BALLAST_ID)?.childElementCount).toBe(20)
    setBallast(0)
    expect(document.getElementById(BALLAST_ID)).toBeNull()
  })
})

describe('小さな画面を開く前（whenScreenClean）', () => {
  it('iPhone でカレンダーの上に物が出ている・消えたばかりなら、描かれるのを待ってから開く', () => {
    vi.useFakeTimers()
    vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => setTimeout(() => cb(0), 16) as unknown as number)
    put('<div class="cp-quick"></div>')
    const open = vi.fn()
    whenScreenClean(open)
    expect(open).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(open).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('iPhone で起動アニメーションが消えている途中（下のアプリを押せるが、まだ上に出ている）は、消えるまで待ち、描かれてから開く（1秒で開く）', () => {
    vi.useFakeTimers()
    vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => setTimeout(() => cb(0), 16) as unknown as number)
    let active = true
    const w = window as unknown as { DiaryStudioLaunch?: { active: () => boolean } }
    w.DiaryStudioLaunch = { active: () => active }
    try {
      const open = vi.fn()
      whenScreenClean(open)
      vi.advanceTimersByTime(300)
      expect(open).not.toHaveBeenCalled()
      active = false
      vi.advanceTimersByTime(30)
      expect(open).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(open).toHaveBeenCalledTimes(1)
      // 消えないままでも、1秒で開く
      active = true
      const late = vi.fn()
      whenScreenClean(late)
      vi.advanceTimersByTime(990)
      expect(late).not.toHaveBeenCalled()
      vi.advanceTimersByTime(20)
      expect(late).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(2000)
      expect(open).toHaveBeenCalledTimes(1)
      expect(late).toHaveBeenCalledTimes(1)
    } finally {
      delete w.DiaryStudioLaunch
    }
  })

  it('カレンダーだけの時・ほかの端末は、すぐ開く', () => {
    vi.useFakeTimers()
    vi.advanceTimersByTime(1000)
    vi.spyOn(device, 'currentPopSource').mockReturnValue('edge-flick')
    const open = vi.fn()
    whenScreenClean(open)
    expect(open).toHaveBeenCalledTimes(1)
    vi.mocked(device.currentPopSource).mockReturnValue('os-back')
    put('<div class="cp-quick"></div>')
    whenScreenClean(open)
    expect(open).toHaveBeenCalledTimes(2)
  })
})
