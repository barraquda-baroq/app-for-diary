// 掴んでいる間の画面の端の決まり（edges.ts。docs/SPEC.md の 7.11・10.4。22. の段階2の終わりの確かめ）: 見えている所、左右の帯、
// 上下の自動のスクロールの速さと向き、左右の帯に留まって前後の週へ移る時（0.6秒・続けて 0.9秒ごと・帯から出ると止める・掴んだ時から
// 帯の中にいた時は一度出てから）
import { describe, expect, it } from 'vitest'
import {
  allowedSpeed,
  bandRect,
  CUE_LABEL_GAP,
  CUE_LABEL_ROOM,
  cueLabel,
  dropHit,
  EDGE_SCROLL_MAX,
  edgeSpeed,
  inDropArea,
  insideBand,
  NOT_MOVED,
  noteMove,
  sideOf,
  startSide,
  stepSide,
  TO_SCREEN,
  visibleBox,
  WEEK_DWELL_MS,
  WEEK_EDGE_PX,
  WEEK_EDGE_SHARE,
  WEEK_REPEAT_MS,
  type Box,
  type Side,
  type SideState,
} from './edges'

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

describe('見えている所（作者の iPhone で「週が動かない」の原因: 端を週の箱から測っていた）', () => {
  // Pixel 7（412×839）で週をいちばん下まで送った時: ページが 263px 送られ、週の上の端（-47）はヘッダーと切り替えの列（0〜92）の下
  const screen = box(0, 0, 412, 839)
  it('上に重なる物の下から、画面の中だけ', () => {
    expect(visibleBox(box(8, -47, 404, 581), screen, 92)).toEqual(box(8, 92, 404, 581))
    // ページのいちばん上: 週の下の端は画面の下に 5px 出ている
    expect(visibleBox(box(8, 216, 404, 844), screen, 216)).toEqual(box(8, 216, 404, 839))
    // iPhone の Chrome の下のバーで、表示されている所が狭い時
    expect(visibleBox(box(8, 216, 404, 844), box(0, 0, 412, 760), 216)).toEqual(box(8, 216, 404, 760))
  })

  it('見えていなければ null', () => {
    expect(visibleBox(box(8, -300, 404, 80), screen, 92)).toBeNull()
    expect(visibleBox(box(8, 900, 404, 1200), screen)).toBeNull()
  })
})

describe('左右の帯（どの端末でも。週の端の内側と、その外の画面の端までの余白）', () => {
  it('内側の幅: S 28px、L・M は 40px か日の列の 1/4 の狭い方', () => {
    expect(WEEK_EDGE_PX).toEqual({ S: 28, wide: 40 })
    expect(WEEK_EDGE_SHARE).toBe(0.25)
    // S（Pixel 7 の半分 181px）
    expect(insideBand('S', 181)).toBe(28)
    // L 1400px（列 142px）・960px（列 79px）・M 768px（列 100px）
    expect(insideBand('wide', 142)).toBe(35)
    expect(insideBand('wide', 79)).toBe(19)
    expect(insideBand('wide', 100)).toBe(25)
    expect(insideBand('wide', 400)).toBe(40)
    expect(insideBand('wide', Number.POSITIVE_INFINITY)).toBe(40)
  })

  // L 1400px: 週は 41〜1035、カレンダーの領域の右の端は 1051（その右は右の列）
  const week = box(41, 142, 1035, 867)
  const L = { ...TO_SCREEN, right: 1051 }
  it('内側の帯の中なら左 -1・右 1、真ん中は 0', () => {
    expect(sideOf({ x: 41, y: 500 }, week, 35, L)).toBe(-1)
    expect(sideOf({ x: 76, y: 500 }, week, 35, L)).toBe(-1)
    expect(sideOf({ x: 77, y: 500 }, week, 35, L)).toBe(0)
    expect(sideOf({ x: 600, y: 500 }, week, 35, L)).toBe(0)
    expect(sideOf({ x: 999, y: 500 }, week, 35, L)).toBe(0)
    expect(sideOf({ x: 1000, y: 500 }, week, 35, L)).toBe(1)
    expect(sideOf({ x: 1035, y: 500 }, week, 35, L)).toBe(1)
  })

  it('週の外の余白も帯（画面の端まで。L の右はカレンダーの領域の右の端まで、右の列は帯にしない）。縦は週の見えている所だけ', () => {
    expect(sideOf({ x: 5, y: 500 }, week, 35, L)).toBe(-1)
    expect(sideOf({ x: 0, y: 500 }, week, 35, L)).toBe(-1)
    expect(sideOf({ x: 1043, y: 500 }, week, 35, L)).toBe(1)
    expect(sideOf({ x: 1051, y: 500 }, week, 35, L)).toBe(1)
    expect(sideOf({ x: 1060, y: 500 }, week, 35, L)).toBe(0)
    expect(sideOf({ x: 1200, y: 500 }, week, 35, L)).toBe(0)
    expect(sideOf({ x: 5, y: 100 }, week, 35, L)).toBe(0)
    expect(sideOf({ x: 1000, y: 900 }, week, 35, L)).toBe(0)
    // S（Pixel 7。週は 25〜387、画面は 412）: 画面の端に指を寄せた所
    const s = box(25, 216, 387, 839)
    expect(sideOf({ x: 410, y: 500 }, s, 28)).toBe(1)
    expect(sideOf({ x: 2, y: 500 }, s, 28)).toBe(-1)
    expect(sideOf({ x: 359, y: 500 }, s, 28)).toBe(1)
    expect(sideOf({ x: 358, y: 500 }, s, 28)).toBe(0)
  })

  it('週がとても狭い時は、内側の帯が重ならないよう半分まで', () => {
    expect(sideOf({ x: 29, y: 10 }, box(0, 0, 60, 100), 40)).toBe(-1)
    expect(sideOf({ x: 31, y: 10 }, box(0, 0, 60, 100), 40)).toBe(1)
  })

  it('目印の帯は、その側の帯の画面の中の所（外の端が画面の端の時は画面の端まで）', () => {
    const screen = box(0, 0, 1400, 900)
    expect(bandRect(-1, week, 35, L, screen)).toEqual(box(0, 142, 76, 867))
    expect(bandRect(1, week, 35, L, screen)).toEqual(box(1000, 142, 1051, 867))
    const s = box(25, 216, 387, 839)
    expect(bandRect(1, s, 28, TO_SCREEN, box(0, 0, 412, 839))).toEqual(box(359, 216, 412, 839))
    expect(bandRect(-1, box(0, 0, 60, 100), 40, TO_SCREEN, box(0, 0, 60, 100))).toEqual(box(0, 0, 30, 100))
  })

  it('目印の帯の字は、浮いたカードのすぐ上。上に場所が無い時はすぐ下', () => {
    const r = box(1000, 142, 1051, 867)
    expect(cueLabel(r, { top: 400, bottom: 440 })).toEqual({ place: 'above', edge: 400 - 142 - CUE_LABEL_GAP })
    expect(cueLabel(r, { top: 142 + CUE_LABEL_ROOM, bottom: 300 })).toEqual({
      place: 'above',
      edge: CUE_LABEL_ROOM - CUE_LABEL_GAP,
    })
    expect(cueLabel(r, { top: 142 + CUE_LABEL_ROOM - 1, bottom: 300 })).toEqual({
      place: 'below',
      edge: 300 - 142 + CUE_LABEL_GAP,
    })
  })
})

describe('落とす所の当たり（離した時の指の所で決める。7.11・CALENDAR-178。CI 46: 右の列で離したのに土曜へ落ちた）', () => {
  // L 1400px（CI 46 の時の形）: 週は 41〜1035・142〜867、カレンダーの領域の右の端は 1051、右の列の「Routine List」は 1093〜1308・75〜91。
  // 仕事の段の見えている所は 218〜526、土曜の仕事の列は 893〜1035（段の中で 66px 送ると、列の箱は 152〜653 まで。見えているのは
  // 218〜526 だけ）
  const week = box(41, 142, 1035, 867)
  const L = { ...TO_SCREEN, right: 1051 }
  const satVisible = box(893, 218, 1035, 526)

  it('落とす所を探すのは、見えている週の中と左右の帯（週の外の余白も）だけ。右の列・週の上のヘッダー・週の下の外は探さない', () => {
    expect(inDropArea({ x: 600, y: 500 }, week, 35, L)).toBe(true)
    // 日の見出しの上（週の中）
    expect(inDropArea({ x: 961, y: 186 }, week, 35, L)).toBe(true)
    // 週の右の端とカレンダーの領域の右の端の間の余白（帯）・画面の左の端（帯）
    expect(inDropArea({ x: 1043, y: 500 }, week, 35, L)).toBe(true)
    expect(inDropArea({ x: 5, y: 500 }, week, 35, L)).toBe(true)
    // 右の列（週と同じ高さでも）・「Routine List」の上
    expect(inDropArea({ x: 1071, y: 372 }, week, 35, L)).toBe(false)
    expect(inDropArea({ x: 1200, y: 83 }, week, 35, L)).toBe(false)
    // 週の上（カレンダーの見出し・アプリのヘッダー）と下の外。余白の所でも週の高さの外
    expect(inDropArea({ x: 600, y: 100 }, week, 35, L)).toBe(false)
    expect(inDropArea({ x: 600, y: 880 }, week, 35, L)).toBe(false)
    expect(inDropArea({ x: 1043, y: 129 }, week, 35, L)).toBe(false)
    // S・M は画面の端まで帯
    expect(inDropArea({ x: 410, y: 500 }, box(25, 216, 387, 839), 28)).toBe(true)
  })

  it('指が落とす所の見えている所の上なら pointer（真ん中に近いほど強い）', () => {
    expect(dropHit({ x: 964, y: 372 }, satVisible, box(896, 349, 1033, 395))).toEqual({ by: 'pointer', value: Infinity })
    const near = dropHit({ x: 964, y: 380 }, satVisible, null)!
    const far = dropHit({ x: 964, y: 500 }, satVisible, null)!
    expect(near.by).toBe('pointer')
    expect(near.value).toBeGreaterThan(far.value)
  })

  it('指が上に無ければ、浮いたカードとの重なり（割合が大きく、真ん中が指に近いほど強い）。重ならなければ当たらない', () => {
    // 週の外の余白（1043）で、浮いたカードの左の所（967〜1035）が土曜の列に掛かる
    const hit = dropHit({ x: 1043, y: 372 }, satVisible, box(967, 349, 1104, 395))!
    expect(hit.by).toBe('overlap')
    expect(hit.value).toBeGreaterThan(0)
    const less = dropHit({ x: 1043, y: 372 }, satVisible, box(1000, 349, 1137, 395))!
    expect(less.value).toBeLessThan(hit.value)
    expect(dropHit({ x: 1043, y: 372 }, satVisible, box(1036, 349, 1173, 395))).toBeNull()
    expect(dropHit({ x: 1043, y: 372 }, satVisible, null)).toBeNull()
  })

  it('見えていない落とす所（null）には当たらない。段の中で送って隠れた所は、見えている所に入れないので当たらない', () => {
    expect(dropHit({ x: 964, y: 372 }, null, box(896, 349, 1033, 395))).toBeNull()
    // 日の見出しの上の指（186）は、送った列の箱（152〜）には入るが、見えている所（218〜）には入らない。浮いたカード（163〜209）も
    // 見えている所に掛からない
    expect(dropHit({ x: 961, y: 186 }, satVisible, box(893, 163, 1030, 209))).toBeNull()
    expect(dropHit({ x: 961, y: 186 }, box(893, 152, 1035, 653), box(893, 163, 1030, 209))?.by).toBe('pointer')
  })
})

describe('上下の自動のスクロールの速さ（見えている所の上下の端から 60px）', () => {
  it('端に近いほど速く、真ん中は 0。見えている所の外（ヘッダーの下に隠れた所）はいちばん速い', () => {
    expect(edgeSpeed(500, 92, 839)).toBe(0)
    expect(edgeSpeed(152, 92, 839)).toBeCloseTo(0)
    expect(edgeSpeed(122, 92, 839)).toBeCloseTo(-EDGE_SCROLL_MAX / 2)
    expect(edgeSpeed(92, 92, 839)).toBe(-EDGE_SCROLL_MAX)
    expect(edgeSpeed(60, 92, 839)).toBe(-EDGE_SCROLL_MAX)
    expect(edgeSpeed(809, 92, 839)).toBeCloseTo(EDGE_SCROLL_MAX / 2)
    expect(edgeSpeed(839, 92, 839)).toBe(EDGE_SCROLL_MAX)
  })

  it('掴んだ後にその向きへ動かした時だけ（掴んだ所がもう端の近くでも、すぐには動かさない）', () => {
    let m = NOT_MOVED
    expect(allowedSpeed(-1, m)).toBe(0)
    expect(allowedSpeed(1, m)).toBe(0)
    m = noteMove(m, { x: 0, y: 800 }, { x: 0, y: 805 })
    expect(allowedSpeed(1, m)).toBe(1)
    expect(allowedSpeed(-1, m)).toBe(0)
    m = noteMove(m, { x: 0, y: 805 }, { x: 0, y: 300 })
    expect(allowedSpeed(-1, m)).toBe(-1)
    // 横に動かしただけでは変わらない
    expect(noteMove(NOT_MOVED, { x: 0, y: 1 }, { x: 9, y: 1 })).toBe(NOT_MOVED)
  })
})

describe('左右の帯に留まると前後の週へ（0.6秒。留まっている間は 0.9秒ごと）', () => {
  /** 時刻と帯の並びで進め、移った時刻と向きを返す */
  function run(start: Side, steps: [number, Side, boolean?][]): [number, Side][] {
    let s: SideState = startSide(start)
    const out: [number, Side][] = []
    for (const [now, side, scrollable = false] of steps) {
      const r = stepSide(s, { now, side, scrollable })
      s = r.state
      if (r.shift !== 0) out.push([now, r.shift])
    }
    return out
  }

  it('右の帯に 0.6秒留まると次の週、続けて 0.9秒ごと。左は前の週', () => {
    expect(WEEK_DWELL_MS).toBe(600)
    expect(WEEK_REPEAT_MS).toBe(900)
    const steps: [number, Side][] = [[0, 0]]
    for (let t = 100; t <= 2600; t += 50) steps.push([t, 1])
    expect(run(0, steps)).toEqual([
      [700, 1],
      [1600, 1],
      [2500, 1],
    ])
    expect(
      run(0, [
        [0, -1],
        [599, -1],
        [600, -1],
      ]),
    ).toEqual([[600, -1]])
  })

  it('帯から出ると止める（入り直すと 0.6秒から数え直す）。反対の帯へ移っても数え直す', () => {
    expect(
      run(0, [
        [0, 1],
        [500, 1],
        [550, 0],
        [600, 1],
        [1100, 1],
        [1200, 1],
      ]),
    ).toEqual([[1200, 1]])
    expect(
      run(0, [
        [0, 1],
        [500, -1],
        [1000, -1],
        [1100, -1],
      ]),
    ).toEqual([[1100, -1]])
  })

  it('掴んだ時から帯の中にいた時は、一度帯の外へ出てから入った時だけ数える（端の近くの物を掴んだだけでは移らない）', () => {
    expect(
      run(1, [
        [0, 1],
        [1000, 1],
        [2000, 1],
      ]),
    ).toEqual([])
    expect(
      run(1, [
        [0, 1],
        [100, 0],
        [200, 1],
        [800, 1],
      ]),
    ).toEqual([[800, 1]])
    // 右の帯で掴んだ時も、左の帯は初めから数える
    expect(
      run(1, [
        [0, -1],
        [600, -1],
      ]),
    ).toEqual([[600, -1]])
  })

  it('週がまだ横にスクロールできる間・上下の端で週の中を送っている間は、スクロールが先（留まった時間を数えない）', () => {
    expect(
      run(0, [
        [0, 1, true],
        [1000, 1, true],
        [1100, 1, false],
        [1600, 1, false],
        [1700, 1, false],
      ]),
    ).toEqual([[1700, 1]])
  })

  it('目印の帯の満ちる時間: 初めは 0.6秒、移った後は 0.9秒', () => {
    let s = stepSide(startSide(0), { now: 0, side: 1, scrollable: false }).state
    expect(s).toMatchObject({ side: 1, due: 600, period: 600 })
    s = stepSide(s, { now: 600, side: 1, scrollable: false }).state
    expect(s).toMatchObject({ side: 1, due: 1500, period: 900 })
    s = stepSide(s, { now: 700, side: 0, scrollable: false }).state
    expect(s.side).toBe(0)
  })
})
