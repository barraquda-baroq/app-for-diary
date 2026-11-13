// アプリの履歴（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・■22・■23）: 履歴の形（土台の前後に
// 「戻る」「進む」の印）を押した時に作り、カレンダーの中の行き来は土台を置き換えるだけで増やさない。「戻る」「進む」が来たら、
// iPhone（端からのフリック）はモードを回し、Android・PC（OS の戻る）は閉じるかを聞き、どちらも土台へ戻す（ルーターには渡さない）。
// 登録・詳細の画面・ほかの画面での扱い、ルーターの戻る（閉じる・書きかけの確かめ）、読み込み直し、アプリを閉じる
import type { Location } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screenOf } from '../features/calendar/common/calendarHistory'
import { FakeWindow } from '../test/fakeHistoryWindow'
import { AppHistory, type LeaveResult } from './appHistory'
import type { PopSource } from './popRules'

type Update = Parameters<Parameters<AppHistory['listen']>[0]>[0]

let keySeq = 0
/** ルーターが渡す形の行き先 */
function loc(pathname: string, state: unknown = null): Location {
  return { pathname, search: '', hash: '', state, key: `k${++keySeq}` }
}

const register = { sheet: { kind: 'register', init: { start: '2026-11-10', kind: 'work' } }, sheetPage: 'p' }
const detail = { sheet: { kind: 'detail', id: 'i1' }, sheetPage: 'p' }

interface Setup {
  win: FakeWindow
  h: AppHistory
  updates: Update[]
  ring: ReturnType<typeof vi.fn>
  askExit: ReturnType<typeof vi.fn>
}

function setup(
  hash: string,
  source: PopSource,
  { armOnLeaveFail = false, before = 0, win }: { armOnLeaveFail?: boolean; before?: number; win?: FakeWindow } = {},
): Setup {
  const w = win ?? new FakeWindow(hash, { before })
  const h = new AppHistory({ window: w, source, armOnLeaveFail, screenOf })
  const updates: Update[] = []
  const ring = vi.fn()
  const askExit = vi.fn()
  h.handlers = { ring, askExit }
  h.listen((u) => updates.push(u))
  disposers.push(() => h.dispose())
  return { win: w, h, updates, ring, askExit }
}

const disposers: (() => void)[] = []

/** 履歴が落ち着くまで（ブラウザの go の popstate・待つ時間を進める） */
async function settle(h: AppHistory) {
  await vi.runAllTimersAsync()
  await h.whenIdle()
}

/** 押して、土台と印の履歴を作らせる */
async function arm(s: Setup) {
  s.win.press()
  await settle(s.h)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const d of disposers.splice(0)) d()
  vi.useRealTimers()
})

describe('履歴の形を作る', () => {
  it('開いた直後（まだ押していない）は作らず、最初に押した時に「戻る」の印・土台・「進む」の印にする（ルーターには何も渡さない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    expect(s.h.shape()).toMatchObject({ base: null, buildPending: true })
    await arm(s)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
    expect(s.h.shape()).toMatchObject({ base: 1, cur: 1, shownIdx: 1, buildPending: false, busy: false })
    expect(s.updates).toEqual([])
  })

  it('押していない時のカレンダーの書き込みは今の履歴を置き換え、押した時に作る（指は離した時に「押した」になる）', async () => {
    const s = setup('#/', 'edge-flick')
    s.h.replace(loc('/month/2026-11'))
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    s.win.navigator.userActivation.isActive = false
    s.win.dispatch('pointerdown', Object.assign(new Event('pointerdown'), { pointerType: 'touch' }))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['*/month/2026-11'])
    s.win.press('touch')
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
  })

  it('カレンダーの中の行き来（モードの切り替え・期間）は、積む書き込みでも土台を置き換えるだけ（履歴は増えない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.h.push(loc('/week/2026-11-08'))
    s.h.replace(loc('/week/2026-11-15'))
    s.h.push(loc('/day/2026-11-17'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-17', '[fwd]'])
    expect(s.h.action).toBe('PUSH')
  })
})

describe('iPhone（端からのフリック）', () => {
  it('カレンダー: 左の端から（戻る）でモードを1つ前へ、右の端から（進む）で1つ次へ回し、土台へ戻す。20回払っても履歴は増えない', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    for (let i = 0; i < 10; i++) {
      s.win.userGo(-1)
      await settle(s.h)
      s.win.userGo(1)
      await settle(s.h)
    }
    expect(s.ring.mock.calls.map((c) => c[0])).toEqual(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? -1 : 1)))
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-10', '[fwd]'])
    expect(s.updates).toEqual([])
    expect(s.askExit).not.toHaveBeenCalled()
  })

  it('回した先（ルーターの置き換え）は、印の履歴でなく土台に書く', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.h.handlers.ring = () => s.h.replace(loc('/year/2026'))
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/year/2026', '[fwd]'])
  })

  it('すばやく続けた払いは、戻している間に来た物を捨てる（積み上がらず、土台に落ち着く）', async () => {
    const s = setup('#/week/2026-11-08', 'edge-flick')
    await arm(s)
    s.win.userGo(-1)
    s.win.userGo(1)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    expect(s.ring.mock.calls.length).toBeLessThanOrEqual(2)
    expect(s.h.shape().busy).toBe(false)
  })

  it('登録の画面: どちらへ払っても何もしない（開いたまま。後ろに「進む」の印は置かない）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+register'])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+register'])
    expect(s.updates).toEqual([])
    expect(s.ring).not.toHaveBeenCalled()
  })

  it('詳細の画面: 左の端から（戻る）でも右の端から（進む）でも閉じる（土台へ1つ戻ってルーターに渡す）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail', '[fwd]'])
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/day/2026-11-10', '/day/2026-11-10+detail', '[fwd]'])
    expect(s.updates.map((u) => [u.location.pathname, u.location.state, u.delta])).toEqual([['/day/2026-11-10', null, -1]])
    // もう一度開いて、左の端から
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.length).toBe(2)
    expect(s.updates[1].delta).toBe(-1)
    expect(s.win.index).toBe(1)
    expect(s.ring).not.toHaveBeenCalled()
  })

  it('閉じた詳細の画面が後ろに残っていても、カレンダーで右の端から払うとモードを回す（開き直さない）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    s.h.go(-1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.ring).toHaveBeenCalledWith(1)
    expect(s.win.index).toBe(1)
    expect(s.updates.length).toBe(1)
  })

  it('登録の画面を詳細の画面に置き換えた時（複製のお知らせの［開く］）も後ろに「進む」の印を置き、右の端からでも閉じる', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    s.h.replace(loc('/day/2026-11-10', detail))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/day/2026-11-10', '*/day/2026-11-10+detail', '[fwd]'])
    s.win.userGo(1)
    await settle(s.h)
    expect(s.updates.map((u) => [u.location.state, u.delta])).toEqual([[null, -1]])
    expect(s.win.index).toBe(1)
  })

  it('確かめのダイアログ（詳細の画面の削除の確かめなど）が開いている時は、払ってもダイアログを閉じるだけ（詳細の画面は閉じない）', async () => {
    const s = setup('#/day/2026-11-10', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/day/2026-11-10', detail))
    await settle(s.h)
    let open = true
    s.h.handlers.consumePop = () => {
      if (!open) return false
      open = false
      return true
    }
    s.win.userGo(-1)
    await settle(s.h)
    expect(open).toBe(false)
    expect(s.updates).toEqual([])
    expect(s.win.index).toBe(2)
    // ダイアログが閉じた後は、ふつうに閉じる
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.map((u) => u.delta)).toEqual([-1])
  })

  it('ほかの画面（設定）: どちらへ払っても1つ戻る（カレンダーの方へ）', async () => {
    const s = setup('#/month/2026-11', 'edge-flick')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/settings'))
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.updates.map((u) => u.location.pathname)).toEqual(['/month/2026-11'])
    expect(s.win.index).toBe(1)
  })
})

describe('Android・PC（OS の戻る）', () => {
  it('カレンダー: 「戻る」で閉じるかを聞き（もう一度でもまた聞く）、「進む」は何もしない。どちらも土台へ戻す', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(1)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(2)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(2)
    expect(s.win.describe()).toEqual(['[back]', '*/month/2026-11', '[fwd]'])
    expect(s.updates).toEqual([])
    expect(s.ring).not.toHaveBeenCalled()
  })

  it('詳細の画面: 「戻る」で閉じ（ルーターに渡す）、次の「戻る」は閉じるかを聞く。後ろに「進む」の印は置かない', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '/month/2026-11', '*/month/2026-11+detail'])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.map((u) => [u.location.state, u.delta])).toEqual([[null, -1]])
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(1)
  })

  it('登録の画面: 「戻る」はルーターに渡し、書きかけの確かめで止めた時のルーターの戻し（go(1)）と続け（go(-1)）も渡す', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    await arm(s)
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    // 書きかけの確かめ（useBlocker）: 来た「戻る」を止めて go(1) で戻す
    let blocked = false
    s.h.listen((u) => {
      s.updates.push(u)
      if (!blocked && u.delta === -1) {
        blocked = true
        s.h.go(1)
      }
    })
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates.map((u) => u.delta)).toEqual([-1, 1])
    expect(s.win.index).toBe(2)
    // ［捨てる］: 止めた「戻る」を続ける
    s.h.go(-1)
    await settle(s.h)
    expect(s.updates.map((u) => u.delta)).toEqual([-1, 1, -1])
    expect(s.win.index).toBe(1)
  })

  it('確かめのダイアログが開いている・ドラッグの途中の「戻る」は、片付けるだけ（詳細の画面を閉じない・閉じるかを聞かない）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    s.h.handlers.consumePop = () => true
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.updates).toEqual([])
    expect(s.win.index).toBe(2)
    s.h.go(-1)
    await settle(s.h)
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).not.toHaveBeenCalled()
    expect(s.win.index).toBe(1)
  })

  it('閉じた登録の画面が後ろに残っていても、PC の「進む」で開き直さない（何もしない）', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    await arm(s)
    s.h.push(loc('/day/2026-11-10', register))
    await settle(s.h)
    s.h.go(-1)
    await settle(s.h)
    s.win.userGo(1)
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.updates.length).toBe(1)
  })
})

describe('ほかの画面とカレンダーの行き来', () => {
  it('設定の画面からカレンダーへ移る（左のアイコン）と、土台まで戻ってそこを置き換える（履歴は増えない）', async () => {
    const s = setup('#/day/2026-11-10', 'os-back')
    await arm(s)
    s.h.push(loc('/settings'))
    await settle(s.h)
    s.h.push(loc('/'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/', '/settings'])
    s.h.push(loc('/settings'))
    s.h.push(loc('/'))
    await settle(s.h)
    expect(s.win.entries.length).toBe(3)
  })

  it('設定の画面を直接開いた時は作らず、カレンダーへ移った時（押した時）に、その履歴を「戻る」の印にして作る', async () => {
    const s = setup('#/settings', 'os-back')
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ base: null, buildPending: false })
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/'))
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/', '[fwd]'])
  })

  it('アドレス欄で # を書き換えた時は、今の次に積まれた物として番号を付けて描く（カレンダーならそこを土台にする）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    s.win.typeHash('#/week/2026-11-08')
    await settle(s.h)
    expect(s.updates.map((u) => u.location.pathname)).toEqual(['/week/2026-11-08'])
    expect(s.h.shape()).toMatchObject({ base: 2, cur: 2 })
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(2)
  })
})

describe('読み込み直す', () => {
  it('土台で読み込み直すと、今の形をそのまま使う（作り直さない・履歴を増やさない）', async () => {
    const first = setup('#/week/2026-11-08', 'edge-flick')
    await arm(first)
    first.h.dispose()
    const s = setup('', 'edge-flick', { win: first.win })
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ base: 1, cur: 1, buildPending: false })
    s.win.press()
    await settle(s.h)
    expect(s.win.describe()).toEqual(['[back]', '*/week/2026-11-08', '[fwd]'])
    s.win.userGo(1)
    await settle(s.h)
    expect(s.ring).toHaveBeenCalledWith(1)
  })

  it('印の履歴で読み込み直すと、土台へ戻ってルーターに渡す', async () => {
    const first = setup('#/week/2026-11-08', 'os-back')
    await arm(first)
    first.h.dispose()
    first.win.index = 0
    const s = setup('', 'os-back', { win: first.win })
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.updates.map((u) => [u.location.pathname, u.delta])).toEqual([['/week/2026-11-08', 1]])
  })
})

describe('アプリを閉じる', () => {
  async function leave(s: Setup): Promise<LeaveResult> {
    const result = s.h.leave()
    await settle(s.h)
    return result
  }

  it('アプリの前にほかのページの履歴があれば、そこまで戻る（ページが離れる）', async () => {
    const s = setup('#/month/2026-11', 'os-back', { before: 1 })
    await arm(s)
    expect(await leave(s)).toBe('left')
    expect(s.win.left).toBe(true)
    expect(s.win.index).toBe(0)
  })

  it('前が無い時は window.close() を試し、Android では最初の履歴へ戻って「もう一度［戻る］で閉じる」所にする。押すと土台へ戻る', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    expect(await leave(s)).toBe('armed')
    expect(s.win.closeCalls).toBe(1)
    expect(s.win.index).toBe(0)
    expect(s.h.shape().exitArmed).toBe(true)
    s.win.press()
    await settle(s.h)
    expect(s.win.index).toBe(1)
    expect(s.h.shape().exitArmed).toBe(false)
  })

  it('前が無いと分かる時（ホーム画面から開いた Android のアプリ）は、前へ戻って待たずに、すぐ「もう一度［戻る］で閉じる」所にする', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    let result: LeaveResult | null = null
    void s.h.leave().then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(50)
    expect(result).toBe('armed')
    expect(s.win.closeCalls).toBe(1)
    expect(s.win.index).toBe(0)
  })

  it('「もう一度［戻る］で閉じる」所から、押さずに自分で土台へ戻った（今日へ戻すなど）後の「戻る」は、また閉じるかを聞く', async () => {
    const s = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(s)
    expect(await leave(s)).toBe('armed')
    s.win.navigator.userActivation.isActive = false
    s.h.replace(loc('/month/2026-12'))
    await settle(s.h)
    expect(s.h.shape()).toMatchObject({ cur: 1, base: 1, exitArmed: false })
    s.win.userGo(-1)
    await settle(s.h)
    expect(s.askExit).toHaveBeenCalledTimes(1)
    expect(s.win.index).toBe(1)
  })

  it('前が無く、Android でない時はそのまま（離れられなかった）', async () => {
    const s = setup('#/month/2026-11', 'os-back')
    await arm(s)
    expect(await leave(s)).toBe('stayed')
    expect(s.win.index).toBe(1)
  })

  it('土台で読み込み直した後（土台の後ろの数は分からない）は、前が無いと決めずに前へ戻る: アドレス欄で # を書き換えて土台が最後の履歴でも離れる', async () => {
    const first = setup('#/month/2026-11', 'os-back', { before: 1 })
    await arm(first)
    // アドレス欄の書き換えで、新しい土台が最後の履歴になる（後ろの「進む」の印は消える）。押さずに読み込み直す
    first.win.typeHash('#/month/2026-12')
    await settle(first.h)
    first.h.dispose()
    const s = setup('', 'os-back', { win: first.win })
    await settle(s.h)
    expect(s.win.history.length).toBe(4)
    expect(await leave(s)).toBe('left')
    expect(s.win.left).toBe(true)
  })

  it('土台で読み込み直した後に前が無い時（ホーム画面から開いた Android のアプリ）も、前へ戻ってから「もう一度［戻る］で閉じる」所にする', async () => {
    const first = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(first)
    first.h.dispose()
    const s = setup('', 'os-back', { armOnLeaveFail: true, win: first.win })
    await settle(s.h)
    expect(await leave(s)).toBe('armed')
    expect(s.win.index).toBe(0)
    expect(s.h.shape().exitArmed).toBe(true)
  })

  it('読み込み直した後でも、アプリが積んだ後は数が分かる（前が無ければ待たずに「もう一度［戻る］で閉じる」所にする）', async () => {
    const first = setup('#/month/2026-11', 'os-back', { armOnLeaveFail: true })
    await arm(first)
    first.h.dispose()
    const s = setup('', 'os-back', { armOnLeaveFail: true, win: first.win })
    await settle(s.h)
    // 詳細の画面を開いて閉じる（積んだので、後ろの数が分かる）
    s.win.navigator.userActivation.isActive = true
    s.h.push(loc('/month/2026-11', detail))
    await settle(s.h)
    s.h.go(-1)
    await settle(s.h)
    let result: LeaveResult | null = null
    void s.h.leave().then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(50)
    expect(result).toBe('armed')
    expect(s.win.index).toBe(0)
  })
})
