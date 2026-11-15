// iPhone・iPad のアプリの履歴（docs/SPEC.md の 3.1。22. の ■31〜■33）: ブラウザの履歴はいつも1つのまま（history.replaceState だけで書き、
// pushState・go・location.assign は使わない）。アプリの中の行き先の並び（カレンダー・登録・詳細の画面・MIM・設定）は自分で持ち、
// ルーターの戻る・進む（navigate(-1)・書きかけの確かめの戻す・続ける）は、ブラウザと同じく後で POP として渡す。
// 画面の端からのフリック（flick）は、カレンダーではモードを回し（左の端から＝年→月→週→日→年、右の端から＝その逆。2026-11-14 の
// 作者の答え）、ほかの画面では1つ戻る（登録の画面は書きかけを聞かずに捨てる。■27）。読み込み直した時は、下の行き先を履歴の state から
// 戻す。前の版が残した履歴（印の履歴）へ iPhone の身振りで来た時は、着いた履歴を今の行き先で置き換えて、同じことを1回だけする
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Location } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { PAGE_ID, sheetOf, useItemSheets } from '../features/calendar/common/sheets'
import { testIds } from '../features/calendar/common/testIds'
import { DISCARD_TEST_IDS, RegisterSheet } from '../features/item/RegisterSheet'
import { renderView, setupCalendarTests } from '../test/renderCalendar'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { AppHistory, createAppHistory, historyShape, type HistoryHandlers } from './appHistory'
import { DRAW_WAIT_MS, FLICK_DEDUPE_MS, SingleEntryHistory, WRITE_RETRY_MS } from './singleEntryHistory'
import { clearSwipeLog, setSwipeLogEnabled, swipeLogText } from './swipeLog'

type Update = Parameters<Parameters<SingleEntryHistory['listen']>[0]>[0]

let keySeq = 0
/** ルーターが渡す形の行き先 */
function loc(pathname: string, state: unknown = null): Location {
  return { pathname, search: '', hash: '', state, key: `k${++keySeq}` }
}

const register = { sheet: { kind: 'register', init: { start: '2026-11-10', kind: 'work' } }, sheetPage: 'p' }
const detail = { sheet: { kind: 'detail', id: 'i1' }, sheetPage: 'p' }

type Mode = 'year' | 'month' | 'week' | 'day'
/** 回す先（ring の dir 1 = 年→月→週→日→年、-1 = 日→週→月→年→日） */
const RING_NEXT: Record<Mode, Mode> = { year: 'month', month: 'week', week: 'day', day: 'year' }
const RING_PREV: Record<Mode, Mode> = { year: 'day', month: 'year', week: 'month', day: 'week' }
const PATHS: Record<Mode, string> = {
  year: '/year/2026',
  month: '/month/2026-11',
  week: '/week/2026-11-08',
  day: '/day/2026-11-10',
}
const modeOfPath = (pathname: string) => pathname.split('/')[1] as Mode

interface Setup {
  win: FakeWindow
  h: SingleEntryHistory
  updates: Update[]
  ring: ReturnType<typeof vi.fn>
  flickDiscard: ReturnType<typeof vi.fn>
  /** 起きた順（flickDiscard・ルーターに渡した POP） */
  order: string[]
}

const disposers: (() => void)[] = []

/**
 * hash の行き先で開く（win を渡すとその作り物で。前の版の履歴を並べた時・読み込み直した時）。ring は、CalendarView と同じく
 * ルーターの置き換えでモードを回す。ルーターは POP を受け取った少し後に、その行き先を描く（drawn。src/ui/Layout.tsx の
 * ScrollOnNavigate と同じ）。draws: false の時は描かない（テストが drawn を呼ぶ）
 */
function setup(
  hash = '#/week/2026-11-08',
  { win, handlers = {}, draws = true }: { win?: FakeWindow; handlers?: HistoryHandlers; draws?: boolean } = {},
): Setup {
  const w = win ?? new FakeWindow(hash, { swipes: true })
  const h = new SingleEntryHistory({
    window: w,
    source: 'edge-flick',
    armOnLeaveFail: false,
    screenOf,
    isLoginPath: (p) => p === '/login',
    now: () => Date.now(),
  })
  const updates: Update[] = []
  const order: string[] = []
  const ring = vi.fn((dir: 1 | -1) => {
    const next = (dir === 1 ? RING_NEXT : RING_PREV)[modeOfPath(h.location.pathname)]
    h.replace(loc(PATHS[next]))
  })
  const flickDiscard = vi.fn(() => order.push('discard'))
  h.handlers = { ring, flickDiscard, ...handlers }
  h.listen((u) => {
    updates.push(u)
    order.push(`pop ${u.delta}`)
    if (draws) setTimeout(() => h.drawn(u.location.key), 0)
  })
  disposers.push(() => h.dispose())
  return { win: w, h, updates, ring, flickDiscard, order }
}

/** 後で渡す POP（マイクロタスク）と、描いた後のスクロールの戻し（描く時）が済むまで */
async function settle(s: Setup) {
  await vi.runAllTimersAsync()
  await s.h.whenIdle()
}

/** ブラウザの履歴が1つのままで、書いたのは置き換えだけ */
function expectSingle(s: Setup) {
  expect(s.win.entries).toHaveLength(1)
  expect(s.win.history.length).toBe(1)
  expect(s.win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
}

describe('iPhone・iPad の1つの履歴の形（SingleEntryHistory）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const d of disposers.splice(0)) d()
    vi.useRealTimers()
    setSwipeLogEnabled(false)
    localStorage.clear()
  })

  // ---------- SE1 ----------
  it('モードを20回回す・詳細を開いて閉じる・登録を払って閉じる・設定と MIM の行き来・左のアイコン・元に戻す・ログインの置き換えの間ずっと、ブラウザの履歴は1つで、書くのは置き換えだけ。iPhone の身振りはどちらの向きにも始まらない', async () => {
    const s = setup('#/day/2026-11-10')
    for (let i = 0; i < 20; i++) s.h.flick(i % 2 === 0 ? -1 : 1)
    expect(s.ring).toHaveBeenCalledTimes(20)
    // 詳細を開いて［×］（ルーターの戻る）で閉じる
    s.h.push(loc('/day/2026-11-10', detail))
    s.h.go(-1)
    await settle(s)
    // 登録を開いて払って閉じる
    s.h.push(loc('/day/2026-11-10', register))
    s.h.flick(-1)
    await settle(s)
    expect(s.flickDiscard).toHaveBeenCalledTimes(1)
    // 設定を開いて［‹ 戻る］
    s.h.push(loc('/settings'))
    s.h.go(-1)
    await settle(s)
    // MIM を開いて右の端から払って戻る
    s.h.push(loc('/mim', { mimFromCalendar: true }))
    s.h.flick(1)
    await settle(s)
    // MIM から設定へ、設定から左のアイコンでカレンダーへ
    s.h.push(loc('/mim', { mimFromCalendar: true }))
    s.h.push(loc('/settings'))
    s.h.push(loc('/month/2026-11'))
    // 元に戻すで移る（置き換え）・ログインの関所の置き換え
    s.h.replace(loc('/week/2026-11-08'))
    s.h.replace(loc('/login'))
    s.h.replace(loc('/'))
    await settle(s)
    expectSingle(s)
    expect(s.h.shape()).toMatchObject({ kind: 'single', depth: 1, index: 0, len: 1, inherited: false, base: null })
    expect(s.win.userGo(-1)).toBe('none')
    expect(s.win.userGo(1)).toBe('none')
    expect(s.updates.map((u) => [u.action, u.location.pathname, u.delta])).toEqual([
      ['POP', '/day/2026-11-10', -1],
      ['POP', '/day/2026-11-10', -1],
      ['POP', '/day/2026-11-10', -1],
      ['POP', '/day/2026-11-10', -1],
    ])
  })

  // ---------- SE2 ----------
  describe('ルーターの戻る・進む（go）', () => {
    it('POP は go が返った後に（マイクロタスクで）、差と一緒に渡す。go(1) で戻り、go(-1) の後に積むと後ろは消える。下の端の go(-1) は何も渡さない', async () => {
      const s = setup()
      const a = loc('/settings')
      const b = loc('/mim', { mimFromCalendar: false })
      s.h.push(a)
      s.h.push(b)
      s.h.go(-1)
      expect(s.updates).toEqual([])
      await Promise.resolve()
      expect(s.updates).toEqual([{ action: 'POP', location: a, delta: -1 }])
      expect(s.win.hashPath()).toBe('/settings')
      s.h.go(1)
      await settle(s)
      expect(s.updates.at(-1)).toEqual({ action: 'POP', location: b, delta: 1 })
      expect(s.h.location).toBe(b)
      s.h.go(-1)
      await settle(s)
      const c = loc('/settings', { other: 1 })
      s.h.push(c)
      expect(s.h.shape()).toMatchObject({ depth: 3, index: 2 })
      const before = s.updates.length
      s.h.go(1)
      await settle(s)
      expect(s.updates).toHaveLength(before)
      // 下の端（カレンダー）
      s.h.go(-2)
      await settle(s)
      expect(s.h.location.pathname).toBe('/week/2026-11-08')
      expect(s.updates.at(-1)?.delta).toBe(-2)
      const n = s.updates.length
      s.h.go(-1)
      await settle(s)
      expect(s.updates).toHaveLength(n)
      expectSingle(s)
    })

    it('POP を受け取った中で go(1) を呼んでも（書きかけの確かめが戻す時）入れ子にならず、元の行き先に着く', async () => {
      const s = setup()
      const sheet = loc('/week/2026-11-08', register)
      s.h.push(sheet)
      let depth = 0
      let maxDepth = 0
      let reverted = false
      s.h.listen((u) => {
        depth++
        maxDepth = Math.max(maxDepth, depth)
        s.updates.push(u)
        if (!reverted && u.delta === -1) {
          reverted = true
          s.h.go(1)
        }
        depth--
      })
      s.h.go(-1)
      await settle(s)
      expect(maxDepth).toBe(1)
      expect(s.updates.map((u) => u.delta)).toEqual([-1, 1])
      expect(s.h.location).toBe(sheet)
      expect(s.win.hashPath()).toBe('/week/2026-11-08')
      expect(screenOf({ pathname: s.h.location.pathname, state: s.h.location.state })).toBe('register')
    })
  })

  // ---------- SE3 ----------
  it('設定からカレンダーの行き先を積む（左のアイコン）と、下のカレンダーまで戻ってそこを置き換える（ルーターには PUSH のまま。POP は渡さない）', async () => {
    const s = setup('#/month/2026-11')
    s.h.push(loc('/settings'))
    s.h.push(loc('/mim', { mimFromCalendar: false }))
    expect(s.h.shape()).toMatchObject({ depth: 3, index: 2 })
    const week = loc('/week/2026-11-15')
    s.h.push(week)
    expect(s.h.action).toBe('PUSH')
    expect(s.h.location).toBe(week)
    expect(s.h.shape()).toMatchObject({ depth: 1, index: 0 })
    expect(s.win.hashPath()).toBe('/week/2026-11-15')
    await settle(s)
    expect(s.updates).toEqual([])
    // その後の戻るは、もう下が無いので何もしない
    s.h.go(-1)
    await settle(s)
    expect(s.updates).toEqual([])
    expectSingle(s)
  })

  // ---------- SE4 ----------
  describe('画面の端からのフリック（flick）', () => {
    it('カレンダー: 左の端から（-1）は ring(1)（年→月→週→日→年）、右の端から（1）は ring(-1)。ルーターへ POP は渡さない', async () => {
      const s = setup('#/month/2026-11')
      s.h.flick(-1)
      expect(s.ring).toHaveBeenLastCalledWith(1)
      expect(s.h.location.pathname).toBe('/week/2026-11-08')
      s.h.flick(1)
      expect(s.ring).toHaveBeenLastCalledWith(-1)
      expect(s.h.location.pathname).toBe('/month/2026-11')
      await settle(s)
      expect(s.updates).toEqual([])
      expectSingle(s)
    })

    it('登録の画面: 左右どちらでも、書きかけを捨ててよいと知らせて（flickDiscard）から1つ戻る（■27）', async () => {
      for (const side of [-1, 1] as const) {
        const s = setup()
        s.h.push(loc('/week/2026-11-08', register))
        s.h.flick(side)
        expect(s.order).toEqual(['discard'])
        await settle(s)
        expect(s.order).toEqual(['discard', 'pop -1'])
        expect(s.h.location.pathname).toBe('/week/2026-11-08')
        expect(sheetOf(s.h.location.state)).toBeNull()
        expect(s.ring).not.toHaveBeenCalled()
      }
    })

    it('詳細の画面・ほかの画面（設定・MIM）: 左右どちらでも1つ戻る（詳細は閉じる・設定と MIM はカレンダーの方へ）', async () => {
      for (const [path, state] of [
        ['/week/2026-11-08', detail],
        ['/settings', null],
        ['/mim', { mimFromCalendar: true }],
      ] as const) {
        for (const side of [-1, 1] as const) {
          const s = setup()
          s.h.push(loc(path, state))
          s.h.flick(side)
          await settle(s)
          expect(s.updates.map((u) => [u.location.pathname, u.delta])).toEqual([['/week/2026-11-08', -1]])
          expect(s.flickDiscard).not.toHaveBeenCalled()
          expect(s.ring).not.toHaveBeenCalled()
          expectSingle(s)
        }
      }
    })

    it('確かめのダイアログが出ている時（consumePop が true）はダイアログを閉じるだけ。ドラッグの途中は何もしない（consumePop も呼ばない）', async () => {
      const consumePop = vi.fn(() => true)
      const s = setup('#/week/2026-11-08', { handlers: { consumePop } })
      s.h.push(loc('/week/2026-11-08', detail))
      s.h.flick(-1)
      await settle(s)
      expect(consumePop).toHaveBeenCalledTimes(1)
      expect(s.updates).toEqual([])
      expect(screenOf(s.h.location)).toBe('detail')
      const dragging = vi.fn(() => true)
      s.h.handlers.dragging = dragging
      s.h.flick(1)
      await settle(s)
      expect(dragging).toHaveBeenCalled()
      expect(consumePop).toHaveBeenCalledTimes(1)
      expect(s.updates).toEqual([])
    })

    it('ログインの画面では何もしない（下にも何も置かない）。設定を出している間にログインの画面へ置き換わった時（下にカレンダーがある）も', async () => {
      const s = setup('#/login')
      expect(s.h.shape()).toMatchObject({ depth: 1, index: 0 })
      const writes = s.win.calls.length
      s.h.flick(-1)
      s.h.flick(1)
      await settle(s)
      expect(s.updates).toEqual([])
      expect(s.ring).not.toHaveBeenCalled()
      expect(s.win.calls).toHaveLength(writes)
      const t = setup('#/week/2026-11-08')
      t.h.push(loc('/settings'))
      t.h.replace(loc('/login'))
      t.h.flick(-1)
      await settle(t)
      expect(t.updates).toEqual([])
      expect(t.h.location.pathname).toBe('/login')
      expect(t.h.shape()).toMatchObject({ depth: 2, index: 1 })
    })

    it('下に何も無い時（読み込み直す前に、下が無いと控えた所）は、小さな画面なら同じ行き先の小さな画面の無い所へ、ほかの画面ならトップへ戻る', async () => {
      const win = new FakeWindow('#/week/2026-11-08', { swipes: true })
      win.seed([{ hash: '#/week/2026-11-08', state: { usr: detail, key: 'd1', idx: 0, ds1: { below: [] } } }], 0)
      const s = setup('', { win })
      expect(s.h.shape()).toMatchObject({ depth: 1, index: 0 })
      s.h.flick(-1)
      await settle(s)
      expect(s.updates.map((u) => [u.location.pathname, u.location.state, u.delta])).toEqual([['/week/2026-11-08', null, -1]])
      const win2 = new FakeWindow('#/settings', { swipes: true })
      win2.seed([{ hash: '#/settings', state: { usr: null, key: 's1', idx: 0, ds1: { below: [] } } }], 0)
      const s2 = setup('', { win: win2 })
      s2.h.flick(1)
      await settle(s2)
      expect(s2.updates.map((u) => [u.location.pathname, u.delta])).toEqual([['/', -1]])
      expectSingle(s2)
    })
  })

  // ---------- SE5 ----------
  describe('読み込み直す', () => {
    it('下の行き先は今の履歴の state に置くので、読み込み直しても設定・詳細の画面の下に、見ていたカレンダー（同じ日・同じ key）が戻る', async () => {
      const s = setup('#/week/2026-11-08')
      const month = loc('/month/2026-11')
      s.h.replace(month)
      s.h.push(loc('/settings'))
      s.h.dispose()
      // 読み込み直した: 同じブラウザの履歴で、新しく作る
      const r = setup('', { win: s.win })
      expect(r.h.location.pathname).toBe('/settings')
      expect(r.h.shape()).toMatchObject({ depth: 2, index: 1 })
      r.h.go(-1)
      await settle(r)
      expect(r.updates).toEqual([{ action: 'POP', location: month, delta: -1 }])

      const t = setup('#/day/2026-11-12')
      t.h.push(loc('/day/2026-11-12', detail))
      t.h.dispose()
      const u = setup('', { win: t.win })
      expect(screenOf(u.h.location)).toBe('detail')
      u.h.flick(-1)
      await settle(u)
      expect(u.updates.map((x) => [x.location.pathname, x.location.state])).toEqual([['/day/2026-11-12', null]])
      expectSingle(u)
    })

    it('state に下の行き先が無い時（前の版の state・直接開いた）は、小さな画面なら同じ行き先、設定・MIM・見つからないならトップを下に置く（ログインには置かない）。idx が無ければ 0 を書く', async () => {
      const settings = setup('#/settings')
      expect(settings.win.history.state).toMatchObject({ idx: 0 })
      expect(settings.h.shape()).toMatchObject({ depth: 2, index: 1 })
      settings.h.go(-1)
      await settle(settings)
      expect(settings.updates.map((u) => [u.location.pathname, u.location.key])).toEqual([['/', 'default']])

      const win = new FakeWindow('#/week/2026-11-08', { swipes: true })
      win.seed([{ hash: '#/week/2026-11-08', state: { usr: detail, key: 'old', idx: 1, ds: { base: 1 } } }], 0)
      const sheet = setup('', { win })
      expect(sheet.h.shape()).toMatchObject({ depth: 2, index: 1, cur: 1 })
      expect(sheet.h.location.key).toBe('old')
      sheet.h.go(-1)
      await settle(sheet)
      expect(sheet.updates.map((u) => [u.location.pathname, u.location.state])).toEqual([['/week/2026-11-08', null]])

      for (const path of ['/mim', '/no/such/page']) {
        const other = setup(`#${path}`)
        expect(other.h.shape(), path).toMatchObject({ depth: 2 })
      }
      expect(setup('#/login').h.shape()).toMatchObject({ depth: 1 })
      expect(setup('#/month/2026-11').h.shape()).toMatchObject({ depth: 1 })
    })
  })

  // ---------- SE6 ----------
  it('積む時に今のスクロールの位置を控え、行き先の替わる POP（設定から戻る）では描いた後にその位置へ戻す。小さな画面を閉じる POP（行き先は同じ）では動かさない', async () => {
    const s = setup('#/month/2026-11')
    s.win.scrollY = 420
    s.h.push(loc('/settings'))
    // 設定は先頭から（Layout の ScrollOnNavigate）、少し送る
    s.win.scrollTo(0, 50)
    s.h.go(-1)
    await settle(s)
    expect(s.win.scrollY).toBe(420)
    s.h.go(1)
    await settle(s)
    expect(s.win.scrollY).toBe(50)
    s.h.go(-1)
    await settle(s)
    expect(s.win.scrollY).toBe(420)
    const scrollTo = vi.spyOn(s.win, 'scrollTo')
    s.h.push(loc('/month/2026-11', detail))
    s.win.scrollY = 300
    s.h.go(-1)
    await settle(s)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(s.win.scrollY).toBe(300)
  })

  it('カレンダーを描き終えるのが遅い時（ルーターが描くのを途中で区切る・重いイヤー）も、ページが届く高さになるまで（1秒ほどの内）待ってから戻す。その間に利用者が触れたらやめる', async () => {
    const s = setup('#/year/2026')
    s.win.scrollY = 420
    s.h.push(loc('/settings'))
    s.win.scrollTo(0, 0)
    // 描き終えるまでは、ページが短く（設定の画面のまま）、送れない
    let tall = false
    s.win.scrollTo = (_x: number, y: number) => {
      s.win.scrollY = tall ? y : 0
    }
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(400)
    expect(s.win.scrollY).toBe(0)
    tall = true
    await settle(s)
    expect(s.win.scrollY).toBe(420)
    // 待っている間に利用者が触れたら（指・ホイール）、戻すのをやめる
    tall = false
    s.h.go(1)
    await settle(s)
    s.win.scrollY = 0
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(100)
    s.win.dispatch('touchstart', new Event('touchstart'))
    tall = true
    await settle(s)
    expect(s.win.scrollY).toBe(0)
  })

  it('ルーターがカレンダーを描くまで（drawn）は、スクロールの位置を戻さない（出ている設定の画面を送らない。ルーターは POP を区切って描くので、前の画面が何コマも残る）。描いた時に、その場で戻す', async () => {
    const s = setup('#/year/2026', { draws: false })
    s.win.scrollY = 400
    s.h.push(loc('/settings'))
    s.win.scrollTo(0, 0)
    const scrollTo = vi.spyOn(s.win, 'scrollTo')
    s.h.flick(-1)
    await vi.advanceTimersByTimeAsync(1000)
    const pop = s.updates.at(-1)
    expect(pop?.location.pathname).toBe('/year/2026')
    expect(scrollTo).not.toHaveBeenCalled()
    expect(s.win.scrollY).toBe(0)
    expect(s.h.shape().busy).toBe(true)
    // ほかの行き先を描いた知らせでは戻さない
    s.h.drawn('another-key')
    expect(scrollTo).not.toHaveBeenCalled()
    // カレンダーを描いた（ScrollOnNavigate の useLayoutEffect。絵にする前）: その場で戻す
    s.h.drawn(pop!.location.key)
    expect(s.win.scrollY).toBe(400)
    await settle(s)
    expect(s.h.shape().busy).toBe(false)
    expect(s.win.scrollY).toBe(400)
  })

  it(`描いた知らせが ${DRAW_WAIT_MS}ms 来ない時は、戻さずにやめる（その後に来ても戻さない）。描く前にほかへ動いた時もやめる`, async () => {
    const s = setup('#/year/2026', { draws: false })
    s.win.scrollY = 400
    s.h.push(loc('/settings'))
    s.win.scrollTo(0, 0)
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(DRAW_WAIT_MS + 50)
    expect(s.h.shape().busy).toBe(false)
    s.h.drawn(s.updates.at(-1)!.location.key)
    expect(s.win.scrollY).toBe(0)
    // カレンダーを 400 まで送ってから設定へ。戻る POP を描く前に、もう一度設定へ動いた（その後にカレンダーを描いた知らせが来ても戻さない）
    s.win.scrollTo(0, 400)
    s.h.go(1)
    await settle(s)
    s.win.scrollTo(0, 0)
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(0)
    const back = s.updates.at(-1)!
    expect(back.location.pathname).toBe('/year/2026')
    s.h.go(1)
    await vi.advanceTimersByTimeAsync(0)
    s.h.drawn(back.location.key)
    expect(s.win.scrollY).toBe(0)
    await settle(s)
    expect(s.h.shape().busy).toBe(false)
    // 描くのを待っている間にモードを回した（ほかへ動いた）: 待つのをすぐやめる（動かし終えたと知らせるのを遅らせない）
    s.win.scrollTo(0, 400)
    s.h.go(-1)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.h.shape().busy).toBe(true)
    s.h.flick(-1)
    expect(s.h.location.pathname).not.toBe('/year/2026')
    expect(s.h.shape().busy).toBe(false)
  })

  // ---------- SE7 ----------
  describe('前の版が残した履歴（更新した後・ログインの行き来の後。アプリを閉じて開き直すまで）', () => {
    /** 前の版の印の履歴 [戻るの印, 土台, 進むの印] の土台にいる */
    function inherited(path = '/week/2026-11-08', handlers: HistoryHandlers = {}): Setup {
      const win = new FakeWindow(`#${path}`, { swipes: true })
      win.seed(
        [
          { hash: `#${path}`, state: { usr: null, key: 'a', idx: 0, ds: { base: 1, mark: 'back' } } },
          { hash: `#${path}`, state: { usr: null, key: 'b', idx: 1, ds: { base: 1 } } },
          { hash: `#${path}`, state: { usr: null, key: 'c', idx: 2, ds: { base: 1, mark: 'fwd' } } },
        ],
        1,
      )
      return setup('', { win, handlers })
    }

    /** iPhone の身振りが終わって絵が外れるまで */
    async function swipe(s: Setup, delta: number) {
      expect(s.win.userGo(delta)).toBe('started')
      await vi.advanceTimersByTimeAsync(1000)
      await s.h.whenIdle()
    }

    it('左の端の身振り（着いた所が前）: 着いた履歴を今の行き先で1回置き換えて（go は使わない）、ring(1)。右の端の身振りは ring(-1)。ルーターへは何も渡さない', async () => {
      const s = inherited('/week/2026-11-08', {})
      s.ring.mockImplementation(() => {})
      expect(s.h.shape()).toMatchObject({ inherited: true, len: 3, cur: 1 })
      const from = s.win.calls.length
      await swipe(s, -1)
      expect(s.win.calls.slice(from).map((c) => c.op)).toEqual(['replaceState'])
      expect(s.ring.mock.calls).toEqual([[1]])
      expect(s.win.history.state).toMatchObject({ idx: 0, key: s.h.location.key })
      expect((s.win.history.state as { ds?: unknown }).ds).toBeUndefined()
      await swipe(s, 1)
      expect(s.ring.mock.calls).toEqual([[1], [-1]])
      expect(s.win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
      expect(s.updates).toEqual([])
      expect(s.win.entries).toHaveLength(3)
    })

    it('詳細の画面を出している時の身振りは、詳細を閉じる（閉じた画面を開き直さない）', async () => {
      const s = inherited()
      s.h.push(loc('/week/2026-11-08', detail))
      await swipe(s, -1)
      expect(s.updates.map((u) => [u.location.pathname, u.location.state, u.delta])).toEqual([['/week/2026-11-08', null, -1]])
      expect(screenOf({ pathname: s.win.hashPath(), state: (s.win.history.state as { usr?: unknown }).usr })).toBe('calendar')
      await swipe(s, 1)
      expect(s.updates).toHaveLength(1)
      expect(s.ring).toHaveBeenCalledWith(-1)
    })

    it(`画面の中で払って回した直後（${FLICK_DEDUPE_MS}ms の内）に来た同じ払いの popstate では回さない（1回の払いで2つ進まない）。その後の払いは回す`, async () => {
      const s = inherited()
      s.ring.mockImplementation(() => {})
      s.h.flick(-1)
      await vi.advanceTimersByTimeAsync(7)
      await swipe(s, -1)
      expect(s.ring.mock.calls).toEqual([[1]])
      expect(s.win.history.state).toMatchObject({ idx: 0 })
      await swipe(s, 1)
      expect(s.ring.mock.calls).toEqual([[1], [-1]])
    })

    it('アプリが作っていない履歴（state の無い #。アドレス欄で書き換えた時など）は、今の次に積まれた物として受け取り、POP（差 1）で描く', async () => {
      const s = setup('#/week/2026-11-08')
      s.win.typeHash('#/settings')
      await settle(s)
      expect(s.updates.map((u) => [u.action, u.location.pathname, u.delta])).toEqual([['POP', '/settings', 1]])
      expect(s.h.shape()).toMatchObject({ depth: 2, index: 1, inherited: true, cur: 1 })
      expect(s.win.history.state).toMatchObject({ idx: 1 })
      s.h.flick(-1)
      await settle(s)
      expect(s.updates.at(-1)).toMatchObject({ delta: -1, location: { pathname: '/week/2026-11-08' } })
    })

    it('# を置き換えて移った時（location.replace。表示できなかった時の案内の［アプリの設定・バックアップ］）は、ブラウザの履歴が増えないので、今の行き先を置き換えた物として受け取る（idx・前の版の履歴かはそのまま）', async () => {
      const s = setup('#/week/2026-11-08')
      s.win.replaceHash('#/settings')
      await settle(s)
      expect(s.updates.map((u) => [u.action, u.location.pathname])).toEqual([['POP', '/settings']])
      expect(s.h.shape()).toMatchObject({ depth: 1, index: 0, inherited: false, cur: 0 })
      expect(s.win.history.state).toMatchObject({ idx: 0, key: s.h.location.key })
      expect(s.h.userPopSince(0)).toBe(false)
      // 払うとトップへ（下に何も無いので、開いた時と同じくトップを下に置いて戻る）
      s.h.flick(-1)
      await settle(s)
      expect(s.updates.at(-1)).toMatchObject({ delta: -1, location: { pathname: '/' } })
      expectSingle(s)
    })

    it('前の版が残した履歴の中で # を置き換えた後も、着いた idx の向きで受け取る（置き換えた所の idx は今のまま。進む の身振りは「進む」）', async () => {
      const s = inherited()
      s.win.replaceHash('#/settings')
      await settle(s)
      expect(s.h.shape()).toMatchObject({ cur: 1, len: 3 })
      expect(s.win.history.state).toMatchObject({ idx: 1 })
      // 進むの身振り（後ろの idx 2 へ）: 設定から1つ戻る（カレンダーの方へ）
      await swipe(s, 1)
      expect(s.updates.at(-1)).toMatchObject({ delta: -1 })
      expect(s.h.location.pathname).not.toBe('/settings')
    })

    it('モードを回す所がまだ無い時（読み込み中・設定を直接開いてカレンダーがまだ無い）に払っても、何もしなかったと控え、すぐ後に来た同じ向きの popstate は使う', async () => {
      setSwipeLogEnabled(true)
      clearSwipeLog()
      const s = inherited()
      const ring = s.h.handlers.ring
      s.h.handlers = {}
      s.h.flick(-1)
      expect(swipeLogText()).toMatch(/ flick \{"side":-1,"screen":"calendar","action":"nothing"\}/)
      s.h.handlers = { ring }
      s.ring.mockImplementation(() => {})
      await swipe(s, -1)
      expect(s.ring.mock.calls).toEqual([[1]])
    })

    it(`前の版の履歴への身振りの popstate の後 ${FLICK_DEDUPE_MS}ms の内に、ページの中でも受け取った同じ払い（flick）は数えない（same-pop）。その後の払いは数える`, async () => {
      setSwipeLogEnabled(true)
      clearSwipeLog()
      const s = inherited()
      s.ring.mockImplementation(() => {})
      expect(s.win.userGo(-1)).toBe('started')
      await vi.advanceTimersByTimeAsync(10)
      expect(s.ring.mock.calls).toEqual([[1]])
      s.h.flick(-1)
      expect(s.ring.mock.calls).toEqual([[1]])
      expect(swipeLogText()).toMatch(/ flick \{"side":-1,"screen":"calendar","action":"same-pop"\}/)
      await vi.advanceTimersByTimeAsync(FLICK_DEDUPE_MS)
      s.h.flick(-1)
      expect(s.ring.mock.calls).toEqual([[1], [1]])
    })

    it('ページの中の払いの後、0.4秒より前（0.35秒）に来た popstate は着いた履歴を置き換えるだけ（pop-skip）、後（0.45秒）に来た物はもう1回する', async () => {
      // 3.1 の「0.4秒の内」（作者の記録では、左の端の身振りは離す出来事を約 7ms 先に送る）
      expect(FLICK_DEDUPE_MS).toBe(400)
      setSwipeLogEnabled(true)
      clearSwipeLog()
      const s = inherited()
      s.ring.mockImplementation(() => {})
      s.h.flick(-1)
      expect(s.win.userGo(-1, { fingerMs: 350 })).toBe('started')
      await vi.advanceTimersByTimeAsync(1000)
      expect(s.ring.mock.calls).toEqual([[1]])
      expect(swipeLogText()).toMatch(/ pop-skip \{"idx":0\}/)
      expect(s.win.history.state).toMatchObject({ idx: 0, key: s.h.location.key })
      s.h.flick(1)
      expect(s.win.userGo(1, { fingerMs: 450 })).toBe('started')
      await vi.advanceTimersByTimeAsync(1000)
      expect(s.ring.mock.calls).toEqual([[1], [-1], [-1]])
    })

    it('userPopSince: popstate が来た後は、その前の時刻には true、その後の時刻には false', async () => {
      const s = inherited()
      s.ring.mockImplementation(() => {})
      const before = Date.now()
      expect(s.h.userPopSince(before)).toBe(false)
      await vi.advanceTimersByTimeAsync(5)
      expect(s.win.userGo(-1)).toBe('started')
      await vi.advanceTimersByTimeAsync(5)
      expect(s.h.userPopSince(before)).toBe(true)
      expect(s.h.userPopSince(Date.now() + 1)).toBe(false)
    })

    it('開いた時にブラウザの履歴が2つ以上なら（前の印の state が無くても）前の版・ほかのページの履歴が残っている（inherited）。1つなら残っていない', () => {
      const win = new FakeWindow('#/week/2026-11-08', { swipes: true })
      win.seed(
        [
          { hash: '#/somewhere', state: null },
          { hash: '#/week/2026-11-08', state: { usr: null, key: 'w', idx: 0 } },
        ],
        1,
      )
      expect(setup('', { win }).h.shape()).toMatchObject({ inherited: true, len: 2 })
      expect(setup('#/week/2026-11-08').h.shape()).toMatchObject({ inherited: false, len: 1 })
    })
  })

  // ---------- SE8 ----------
  it('置き換えが投げた時（WebKit の 10秒に 100回の上限）は、アプリの中の行き先を正として、後でもう一度書く。ルーターへは投げない', async () => {
    const s = setup('#/week/2026-11-08')
    const real = s.win.history.replaceState
    let fail = true
    s.win.history.replaceState = (data, unused, url) => {
      if (fail) throw Object.assign(new Error('too many calls'), { name: 'SecurityError' })
      real(data, unused, url)
    }
    const settings = loc('/settings')
    expect(() => s.h.push(settings)).not.toThrow()
    expect(s.h.location).toBe(settings)
    expect(s.win.hashPath()).toBe('/week/2026-11-08')
    fail = false
    await vi.advanceTimersByTimeAsync(WRITE_RETRY_MS)
    expect(s.win.hashPath()).toBe('/settings')
    expect(s.win.history.state).toMatchObject({ key: settings.key, idx: 0 })
    fail = true
    expect(() => s.h.go(-1)).not.toThrow()
    await Promise.resolve()
    expect(s.updates.map((u) => u.location.pathname)).toEqual(['/week/2026-11-08'])
    fail = false
    await settle(s)
    expect(s.win.hashPath()).toBe('/week/2026-11-08')
  })

  // ---------- SE9 ----------
  it('pushState・go・location.assign は一度も呼ばない（積む・戻る・払う・前の版の履歴へ来た・外から積まれた時も）', async () => {
    const s = setup('#/month/2026-11')
    const pushState = vi.spyOn(s.win.history, 'pushState')
    const go = vi.spyOn(s.win.history, 'go')
    const assign = vi.spyOn(s.win.location, 'assign')
    s.h.push(loc('/month/2026-11', detail))
    s.h.flick(-1)
    s.h.push(loc('/settings'))
    s.h.push(loc('/mim'))
    s.h.go(-2)
    s.h.flick(1)
    s.h.push(loc('/settings'))
    s.h.replace(loc('/settings', { a: 1 }))
    s.h.push(loc('/'))
    await settle(s)
    s.win.typeHash('#/settings')
    await settle(s)
    s.h.flick(-1)
    await settle(s)
    await vi.advanceTimersByTimeAsync(500)
    s.win.userGo(-1)
    await settle(s)
    expect(pushState).not.toHaveBeenCalled()
    expect(go).not.toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('leave は離れず（stayed）、armExit はその所にしない（false）。どちらもカレンダーの「戻る」で閉じる所の無い iPhone では呼ばれない', async () => {
    const s = setup()
    await expect(s.h.leave()).resolves.toBe('stayed')
    await expect(s.h.armExit(1000, () => {})).resolves.toBe(false)
    expectSingle(s)
  })

  it('記録を取る時は、開いた時（start: ブラウザの履歴の数・idx・前の版の印か・端の幅）と払い（flick: 向き・画面・したこと）と行き先の動きを控える', async () => {
    setSwipeLogEnabled(true)
    clearSwipeLog()
    const s = setup('#/week/2026-11-08')
    s.h.flick(-1)
    s.h.push(loc('/settings'))
    s.h.flick(1)
    await settle(s)
    const lines = swipeLogText().split('\n')
    expect(lines[0]).toMatch(/ start \{"len":1,"idx":0,"old":false/)
    expect(lines[0]).toMatch(/"zone":44\}$/)
    expect(lines.some((l) => / flick \{"side":-1,"screen":"calendar","action":"ring\+1"\}/.test(l))).toBe(true)
    expect(lines.some((l) => / flick \{"side":1,"screen":"other","action":"back"\}/.test(l))).toBe(true)
    for (const kind of ['vreplace', 'vpush', 'vpop'])
      expect(
        lines.some((l) => l.split(' ')[1] === kind),
        kind,
      ).toBe(true)
  })
})

// ---------- アプリの履歴を作る所（createAppHistory） ----------
describe('createAppHistory: 端末で作る履歴を選ぶ', () => {
  afterEach(() => {
    for (const d of disposers.splice(0)) d()
  })

  it('iPhone・iPad（edge-flick）は SingleEntryHistory。画面から置いた動き（setHistoryHandler）も届き、historyShape は1つの履歴の形', () => {
    const win = new FakeWindow('#/week/2026-11-08')
    const h = createAppHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf })
    disposers.push(() => h.dispose())
    expect(h).toBeInstanceOf(SingleEntryHistory)
    expect(h).not.toBeInstanceOf(AppHistory)
    expect(historyShape()).toMatchObject({ kind: 'single', source: 'edge-flick', depth: 1 })
  })

  it('Android・PC（os-back）は今までと同じ AppHistory（閉じ方・閉じられなかった時の扱いもそのまま渡す）', () => {
    const win = new FakeWindow('#/week/2026-11-08')
    const h = createAppHistory({ window: win, source: 'os-back', exit: 'press-again', armOnLeaveFail: true, screenOf })
    disposers.push(() => h.dispose())
    expect(h).toBeInstanceOf(AppHistory)
    expect(h).not.toBeInstanceOf(SingleEntryHistory)
    expect(historyShape()).toMatchObject({ source: 'os-back', exit: 'press-again', base: null, buildPending: true })
    expect(historyShape()?.kind).toBeUndefined()
  })
})

// ---------- SE10: 本物のデータのルーターと、登録の画面の書きかけの確かめ（useBlocker） ----------
describe('データのルーターの上の登録の画面（書きかけの確かめ・端からのフリック）', () => {
  setupCalendarTests()

  const discardDialog = () => screen.queryByRole('dialog', { name: '書きかけを捨てますか？' })

  /** 行き先の state に登録の画面の印があれば出す（SheetHost と同じ閉じ方） */
  function Host() {
    const location = useLocation()
    const { closeSheet } = useItemSheets()
    const sheet = sheetOf(location.state)
    if (sheet?.kind !== 'register') return null
    return <RegisterSheet key={location.key} init={sheet.init} onClose={closeSheet} />
  }

  async function openRegister() {
    const win = new FakeWindow('#/week/2026-11-08', { swipes: true })
    const history = createAppHistory({
      window: win,
      source: 'edge-flick',
      armOnLeaveFail: false,
      screenOf,
    }) as SingleEntryHistory
    const r = await renderView(Host, {}, { history })
    await act(() =>
      r.router.navigate('/week/2026-11-08', {
        state: { sheet: { kind: 'register', init: { start: '2026-11-10', kind: 'work' } }, sheetPage: PAGE_ID },
      }),
    )
    const user = userEvent.setup()
    await user.type(screen.getByTestId(testIds.itemTitle), '会議')
    return { ...r, win, history, user }
  }

  afterEach(() => {
    for (const d of disposers.splice(0)) d()
  })

  it('ルーターの戻る（書きかけ）: 止めて確かめ、戻した POP は使い切る（開いたまま・同じ所）。［捨てる］で閉じる。ブラウザの履歴は1つのまま', async () => {
    const { router, win, history, user } = await openRegister()
    disposers.push(() => {
      router.dispose()
      history.dispose()
    })
    expect(history.shape()).toMatchObject({ depth: 2, index: 1 })
    await act(() => router.navigate(-1))
    await waitFor(() => expect(discardDialog()).not.toBeNull())
    expect(router.state.location.state).toMatchObject({ sheet: { kind: 'register' } })
    expect(history.shape()).toMatchObject({ depth: 2, index: 1 })
    await user.click(screen.getByTestId(DISCARD_TEST_IDS.keep))
    expect(screen.queryByTestId(testIds.itemSheet)).not.toBeNull()
    expect(router.state.location.state).toMatchObject({ sheet: { kind: 'register' } })
    await act(() => router.navigate(-1))
    await waitFor(() => expect(discardDialog()).not.toBeNull())
    await user.click(screen.getByTestId(DISCARD_TEST_IDS.discard))
    await waitFor(() => expect(screen.queryByTestId(testIds.itemSheet)).toBeNull())
    expect(sheetOf(router.state.location.state)).toBeNull()
    expect(history.shape()).toMatchObject({ depth: 2, index: 0 })
    expect(win.entries).toHaveLength(1)
    expect(win.calls.filter((c) => c.op !== 'replaceState')).toEqual([])
  })

  it('［×］（書きかけ）: 「書きかけを捨てますか？」を出し、［捨てる］で閉じる', async () => {
    const { router, history, user } = await openRegister()
    disposers.push(() => {
      router.dispose()
      history.dispose()
    })
    fireEvent.click(within(screen.getByTestId(testIds.itemSheet)).getByTestId('modal-close'))
    expect(discardDialog()).not.toBeNull()
    await user.click(screen.getByTestId(DISCARD_TEST_IDS.discard))
    await waitFor(() => expect(screen.queryByTestId(testIds.itemSheet)).toBeNull())
    expect(history.shape()).toMatchObject({ index: 0 })
  })

  it('設定からカレンダーへ払って戻る（本物のルーターと外枠）: カレンダーを描いた時（src/ui/Layout.tsx の ScrollOnNavigate）に、控えたスクロールの位置へ戻す。設定の画面が出ている間は送らない', async () => {
    const win = new FakeWindow('#/year/2026', { swipes: true })
    const history = createAppHistory({ window: win, source: 'edge-flick', armOnLeaveFail: false, screenOf }) as SingleEntryHistory
    function Pages() {
      const { pathname } = useLocation()
      return pathname === '/settings' ? <div data-testid="pg-settings" /> : <div data-testid="pg-calendar" />
    }
    const r = await renderView(Pages, {}, { history })
    disposers.push(() => {
      r.router.dispose()
      history.dispose()
    })
    win.scrollTo(0, 400)
    await act(() => r.router.navigate('/settings'))
    expect(screen.queryByTestId('pg-settings')).not.toBeNull()
    win.scrollTo(0, 0)
    // 送った時に出ていた画面（S = 設定・C = カレンダー）と送った位置
    const seen: string[] = []
    const scrollTo = win.scrollTo.bind(win)
    win.scrollTo = (x: number, y: number) => {
      seen.push(`${screen.queryByTestId('pg-settings') ? 'S' : 'C'}:${y}`)
      scrollTo(x, y)
    }
    await act(async () => history.flick(-1))
    await waitFor(() => expect(screen.queryByTestId('pg-calendar')).not.toBeNull())
    await act(() => history.whenIdle())
    expect(win.scrollY).toBe(400)
    expect(seen[0]).toBe('C:400')
    expect(seen.filter((c) => c.startsWith('S'))).toEqual([])
    expect(win.entries).toHaveLength(1)
  })

  it('端からのフリック（書きかけ）: 確かめずに閉じる（■27）', async () => {
    const { router, win, history } = await openRegister()
    disposers.push(() => {
      router.dispose()
      history.dispose()
    })
    act(() => history.flick(1))
    await waitFor(() => expect(screen.queryByTestId(testIds.itemSheet)).toBeNull())
    expect(discardDialog()).toBeNull()
    expect(sheetOf(router.state.location.state)).toBeNull()
    expect(win.entries).toHaveLength(1)
  })
})
