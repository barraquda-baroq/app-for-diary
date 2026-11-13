// iPhone の端からのフリックの記録（src/history/swipeLog.ts。docs/SPEC.md の 3.1・18.1 の「開発」）: 設定で記録を取る時だけ控え、
// 新しい物から決めた件数だけ残し、1行に1つ（時刻・種類・中身）の字にする
import { afterEach, describe, expect, it, vi } from 'vitest'

const KEY = 'diary-studio:swipe-log'

/** 読み込み直した時と同じく、記録を取るかを読み直す */
async function load() {
  vi.resetModules()
  return import('./swipeLog')
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('端からのフリックの記録', () => {
  it('記録を取っていない時は控えない。取るにすると端末に覚え（読み込み直しても続ける）、やめると控えた物も消す', async () => {
    const log = await load()
    expect(log.swipeLogEnabled()).toBe(false)
    log.swipeLog('pop', { idx: 1 })
    expect(log.swipeLogText()).toBe('')
    log.setSwipeLogEnabled(true)
    expect(localStorage.getItem(KEY)).toBe('1')
    log.swipeLog('pop', { idx: 2, ua: true })
    log.swipeLog('guard')
    expect(log.swipeLogText().split('\n')).toEqual([
      expect.stringMatching(/^\d+ pop \{"idx":2,"ua":true\}$/),
      expect.stringMatching(/^\d+ guard$/),
    ])
    const again = await load()
    expect(again.swipeLogEnabled()).toBe(true)
    again.swipeLog('settle')
    again.setSwipeLogEnabled(false)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(again.swipeLogText()).toBe('')
  })

  it(`新しい物から決めた件数だけ残す。消すと空になり、その後も控え続ける`, async () => {
    const log = await load()
    log.setSwipeLogEnabled(true)
    for (let i = 0; i < log.SWIPE_LOG_MAX + 20; i++) log.swipeLog('go', { i })
    const lines = log.swipeLogText().split('\n')
    expect(lines).toHaveLength(log.SWIPE_LOG_MAX)
    expect(lines[0]).toMatch(/ go \{"i":20\}$/)
    expect(lines.at(-1)).toMatch(new RegExp(` go \\{"i":${log.SWIPE_LOG_MAX + 19}\\}$`))
    log.clearSwipeLog()
    expect(log.swipeLogText()).toBe('')
    log.swipeLog('raf1', { ms: 312 })
    expect(log.swipeLogText()).toMatch(/^\d+ raf1 \{"ms":312\}$/)
  })

  it('端末に覚えられない時（localStorage が使えない）も止まらない: 取らないとみなし、取るにすればこのページの間だけ控える', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('使えない')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('使えない')
    })
    const log = await load()
    expect(log.swipeLogEnabled()).toBe(false)
    log.setSwipeLogEnabled(true)
    log.swipeLog('blur')
    expect(log.swipeLogText()).toMatch(/^\d+ blur$/)
  })
})
