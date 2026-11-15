// 3つのリストの入力欄の決まり（src/features/lists/common/listInputModel.ts。docs/SPEC.md の 3.6・12.1・13.2・14.2・15.1・6.13）:
// Enter で足すか改行か・書きかけの形・［足す］（✓）の押し方。［足す］の押し方は、すばやく足すのテスト
// （src/features/calendar/common/parts/QuickAdd.test.tsx の「［足す］」「変換を決める前に［足す］を押した時」）を1つずつ写した物。
// すばやく足すと違って、リストの入力欄は外れても（キーボードの✓・押した指でスクロール）足さない（S3-FRAME-082・S3-TASK-037・S3-ROUTINE-089）
import { describe, expect, it } from 'vitest'
import {
  addPressStep,
  draftKey,
  EMPTY_DRAFT,
  enterAction,
  INITIAL_ADD_PRESS,
  isBlankDraft,
  parseDraft,
  serializeDraft,
  type AddPressEffect,
  type AddPressEvent,
  type AddPressState,
} from './listInputModel'

/** 出来事を順に当てる（画面がすることを並べて返す。timeout は画面が待ち終えた時に送る物） */
function run(events: AddPressEvent[], from: AddPressState = INITIAL_ADD_PRESS) {
  let state = from
  const effects: AddPressEffect[][] = []
  for (const e of events) {
    const r = addPressStep(state, e)
    state = r.state
    effects.push(r.effects)
  }
  return { state, effects, all: effects.flat(), adds: effects.flat().filter((f) => f === 'add').length }
}

const typing: AddPressEvent = { type: 'compositionstart' }
const down = (pointer = 1, composing = true, hasText = true): AddPressEvent => ({ type: 'down', pointer, composing, hasText })
const up = (pointer = 1, inside = true): AddPressEvent => ({ type: 'up', pointer, inside })
const click = (fromPress: boolean, hasText = true): AddPressEvent => ({ type: 'click', fromPress, hasText })
const end: AddPressEvent = { type: 'compositionend' }
const timeout: AddPressEvent = { type: 'timeout' }

describe('S3 Enter（13.2・14.2・15.1・D6）', () => {
  it.each([
    // [リスト, Shift, 指の端末, 答え]
    ['task', false, false, 'add'],
    ['task', true, false, 'newline'],
    ['task', false, true, 'add'],
    ['task', true, true, 'add'],
    ['favorite', false, false, 'add'],
    ['favorite', true, false, 'newline'],
    ['favorite', false, true, 'newline'],
    ['favorite', true, true, 'newline'],
    ['routine', false, false, 'add'],
    ['routine', true, false, 'add'],
    ['routine', false, true, 'add'],
  ] as const)('%s・Shift %s・指の端末 %s → %s', (list, shift, coarse, want) => {
    expect(enterAction(list, { shift, coarse, composing: false })).toBe(want)
  })

  it('変換中の Enter（isComposing・Safari の keyCode 229）はどのリストでも何もしない（S3-FRAME-090・S3-ROUTINE-090）', () => {
    for (const list of ['task', 'favorite', 'routine'] as const)
      for (const shift of [false, true])
        for (const coarse of [false, true]) expect(enterAction(list, { shift, coarse, composing: true })).toBe('none')
  })
})

describe('S3 書きかけの形（6.13・D23・S3-FRAME-095・096）', () => {
  it('キーは diary-studio:draft:{routine,task,favorite}', () => {
    expect([draftKey('routine'), draftKey('task'), draftKey('favorite')]).toEqual([
      'diary-studio:draft:routine',
      'diary-studio:draft:task',
      'diary-studio:draft:favorite',
    ])
  })

  it('Task List は字とチップを JSON で、ほかは字のまま控え、読み戻す', () => {
    const task = { text: '見積もりの返事\n表紙を先に', start: '2026-11-10', due: '2026-11-13', requester: '営業部' }
    expect(parseDraft('task', serializeDraft('task', task))).toEqual(task)
    expect(serializeDraft('routine', { ...EMPTY_DRAFT, text: 'ストレッチ' })).toBe('ストレッチ')
    expect(parseDraft('routine', 'ストレッチ')).toEqual({ ...EMPTY_DRAFT, text: 'ストレッチ' })
    expect(parseDraft('favorite', '近所のパン屋\n駅の北口')).toEqual({ ...EMPTY_DRAFT, text: '近所のパン屋\n駅の北口' })
  })

  it('空・空白だけの書きかけは控えない（キーを消す）。チップだけの Task List の書きかけは控える', () => {
    expect(serializeDraft('task', EMPTY_DRAFT)).toBeNull()
    expect(serializeDraft('favorite', { ...EMPTY_DRAFT, text: '  \n ' })).toBeNull()
    expect(isBlankDraft({ ...EMPTY_DRAFT, text: ' ' })).toBe(true)
    const chips = { text: '', start: null, due: '2026-11-20', requester: '' }
    expect(isBlankDraft(chips)).toBe(false)
    expect(parseDraft('task', serializeDraft('task', chips))).toEqual(chips)
  })

  it('壊れた値・知らない形は空の書きかけ。Task List の JSON の型の違う欄は、その欄だけ空', () => {
    for (const raw of [null, '', '{壊れた', '[1,2]', '"字だけ"', '42', 'null'])
      expect(parseDraft('task', raw), String(raw)).toEqual(EMPTY_DRAFT)
    expect(
      parseDraft('task', JSON.stringify({ text: 5, start: '11/10', due: '2026-11-20', requester: ['x'], extra: 1 })),
    ).toEqual({
      text: '',
      start: null,
      due: '2026-11-20',
      requester: '',
    })
    expect(parseDraft('routine', null)).toEqual(EMPTY_DRAFT)
  })
})

describe('S3 ［足す］（✓。12.1。すばやく足すの「［足す］」を写した物）', () => {
  it('字が無い間は押しても何もしない（S3-FRAME-085・S3-TASK-032）', () => {
    expect(run([click(false, false)]).all).toEqual([])
  })

  it('押すと Enter と同じく足す（S3-FRAME-086）', () => {
    expect(run([click(false)]).all).toEqual(['add'])
  })

  it('変換していない時の押した（pointerdown）は、入力欄から外さない（iPhone のキーボードを閉じない。S3-TASK-033）', () => {
    const r = run([down(1, false), up(1), click(false)])
    expect(r.all).toEqual(['add'])
    expect(r.all).not.toContain('blur')
    // 変換を決めた後（変換の終わりの後）の押したも同じ
    expect(run([typing, end, down(1, false), click(false)]).all).toEqual(['add'])
  })

  it('Tab で移った［足す］の Enter・Space も同じ click（空・空白だけなら何もしない。S3-FRAME-089）', () => {
    expect(run([click(false, true)]).all).toEqual(['add'])
    expect(run([click(false, false), click(false, false)]).all).toEqual([])
  })
})

describe('S3 変換を決める前に［足す］を押した時（12.1・■15・P1。すばやく足すの「変換を決める前に［足す］」を写した物。S3-FRAME-087・S3-TASK-038・S3-ROUTINE-091）', () => {
  it('押した時に外して変換を決めてもらい、変換の終わりの後、離した時に1回だけ足す。フォーカスは入力欄へ戻す', () => {
    const r = run([typing, down(), end, up(), click(true)])
    expect(r.effects[1]).toEqual(['blur', 'startWait'])
    expect(r.effects[2]).toEqual(['stopWait'])
    expect(r.effects[3]).toEqual(['refocus', 'add'])
    expect(r.effects[4]).toEqual(['swallowClick', 'refocus'])
    expect(r.adds).toBe(1)
    // 待ちは残らない（後から変換の終わり・待ち終わりが来ても足さない）
    expect(run([end, timeout], r.state).adds).toBe(0)
  })

  it('離した時にまだ変換が終わっていなければ、フォーカスを先に戻し、変換の終わりの後に、ブラウザが決まった字を書いてから（0ms 後）足す', () => {
    const r = run([typing, down(), up()])
    expect(r.effects[2]).toEqual(['refocus'])
    expect(r.adds).toBe(0)
    // 待っている間の Enter（click と同じ）は、押した［足す］の分と重ねない
    const enter = run([click(false)], r.state)
    expect(enter.all).toEqual(['refocus'])
    const after = run([end], enter.state)
    expect(after.all).toEqual(['waitTick'])
    const done = run([timeout], after.state)
    expect(done.all).toEqual(['add'])
    // 変換の終わりがもう一度来ても・待つ長さがたっても、2回は足さない
    expect(run([end, timeout, timeout], done.state).adds).toBe(0)
  })

  it('変換の終わりが来ないまま（iPhone は外れた後に送らないことがある）でも、待ち終えた時（COMMIT_WAIT_MS）に見えている字で1回だけ足す。押し終える前に待ち終えた時は、押し終えた時に足す', () => {
    const quick = run([typing, down(), up(), timeout])
    expect(quick.adds).toBe(1)
    expect(quick.effects[3]).toEqual(['add'])
    const long = run([typing, down(), timeout, up()])
    expect(long.effects[2]).toEqual([])
    expect(long.effects[3]).toEqual(['refocus', 'add'])
    expect(long.adds).toBe(1)
  })

  it('click だけが来た時（押した出来事の無い操作）も、変換中なら外して変換を決めてから足す', () => {
    const r = run([typing, click(false)])
    expect(r.effects[1]).toEqual(['blur', 'startWait', 'refocus'])
    expect(r.adds).toBe(0)
    expect(run([end, timeout], r.state).adds).toBe(1)
  })

  it('指で離した後の mousedown・click は、画面が動いて指の下に来た別の物に来ても止める（押した物の操作にしない）。足すのは1回', () => {
    const r = run([typing, down(7), end, up(7), { type: 'mousedown' }, click(true)])
    expect(r.effects[4]).toEqual(['preventMouseDown'])
    expect(r.effects[5][0]).toBe('swallowClick')
    expect(r.adds).toBe(1)
    // その後の押した物は、ふつうに押せる
    const next = run([{ type: 'windowdown' }, { type: 'mousedown' }], r.state)
    expect(next.all).toEqual([])
  })

  it('指で離した後に click が来なくても（画面が動いて押したことにならなかった）、離した時に決めた分を足す。次に押した時に待つのをやめる', () => {
    const r = run([typing, down(7), up(7), timeout])
    expect(r.adds).toBe(1)
    expect(r.state.press).toEqual({ pointer: 7, up: true })
    expect(run([{ type: 'windowdown' }], r.state).state.press).toBeNull()
  })

  it('マウスを［足す］の外で離した時と、指を横へなぞって［足す］の横の幅の外で離した時は、足さずに入力欄へ戻す（変換は決まったまま）', () => {
    const r = run([typing, down(), end, up(1, false), click(true)])
    expect(r.effects[3]).toEqual(['stopWait', 'refocus'])
    expect(r.adds).toBe(0)
    expect(run([timeout, end], r.state).adds).toBe(0)
    // 決めた後の Enter で足せる
    expect(run([click(false)], r.state).adds).toBe(1)
  })

  it('離して入力欄へ戻した後、変換の終わりを待っている間にキーボードの✓で外れても、押した［足す］の分は足す（外れたことでは何も替えない）', () => {
    // すばやく足すは外れた時に足して閉じる。リストは閉じない: 押した分だけを、待ち終えた時に1回足す
    const r = run([typing, down(), up(), timeout])
    expect(r.adds).toBe(1)
  })

  it('外した時にブラウザが変換中の字を捨てても、足すのは押した時に見えていた字（画面が add で見えていた字を使う。ListInput.test）', () => {
    expect(run([typing, down(), up(), timeout]).all.at(-1)).toBe('add')
  })

  it('押した指でスクロールした（pointercancel）時は、足さず、打った字も残す（すばやく足すと違い、キーボードを閉じた時と同じに足さない）', () => {
    const r = run([typing, down(), { type: 'cancel', pointer: 1 }, timeout, end])
    expect(r.effects[2]).toEqual(['stopWait'])
    expect(r.adds).toBe(0)
    expect(r.state.commit).toBeNull()
  })

  it('変換中の Enter（変換を決める Enter。enterAction が none）は足さず、変換の終わりが来ても足さない。決めた後の Enter で足す（D42）', () => {
    const r = run([typing, end, timeout])
    expect(r.adds).toBe(0)
    expect(run([click(false)], r.state).adds).toBe(1)
  })

  it('変換の終わりを待っている間に欄が外れた（flush）時も、押し終えた［足す］の分は1回だけ足す。押し終えていない分は足さない', () => {
    const pressed = run([typing, down(), up(), { type: 'flush' }, timeout, end])
    expect(pressed.adds).toBe(1)
    const notYet = run([typing, down(), { type: 'flush' }, up(), timeout])
    expect(notYet.adds).toBe(0)
  })

  it('待っている間の2回目の押した（pointerdown）は外さない（重ねない）', () => {
    const r = run([typing, down(1), up(1), down(2), up(2), timeout])
    expect(r.all.filter((f) => f === 'blur')).toHaveLength(1)
    expect(r.adds).toBe(1)
  })

  it('■34 で打ちかけを捨てた（reset）時は、押し終えた分も足さない', () => {
    const r = run([typing, down(), up(), { type: 'reset' }, timeout, end])
    expect(r.adds).toBe(0)
    expect(r.state).toEqual(INITIAL_ADD_PRESS)
  })

  it('入力欄へフォーカスが来た所は変換していない（外れた後に変換の終わりが来ないブラウザで、変換中の印を残さない）', () => {
    const r = run([typing, { type: 'focus' }, down()])
    expect(r.effects[2]).toEqual([])
  })
})
