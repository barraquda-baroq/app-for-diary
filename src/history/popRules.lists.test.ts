// 「戻る」「進む」の決まりの「リスト」の行（docs/SPEC.md の 3.1・22. の ■34 の作者の答え）: S・M のカレンダーの画面で、見ている所が
// 開いているリストの時（listOpen）は、iPhone・iPad の端からのフリック（左右どちら）と Android・PC の OS の「戻る」で、そのリストを
// 畳む（close-list）。「進む」は何もしない。もう一度［戻る］で閉じる所にもしない（■25 の閉じ方でも）。登録・詳細・ほかの画面では
// listOpen を見ない（リストの［詳しく］・［予定にする］を先に閉じる）。listOpen を渡さない時は今までの行のまま
import { describe, expect, it } from 'vitest'
import { decidePop, type ExitStyle, type PopDirection, type PopSource, type ScreenKind } from './popRules'

const both: PopDirection[] = ['back', 'forward']
const exits: ExitStyle[] = ['ask', 'press-again']
const sources: PopSource[] = ['edge-flick', 'os-back']
const others: ScreenKind[] = ['register', 'detail', 'other']

describe('S3 リストの行（S3-FRAME-007〜010）', () => {
  it('iPhone・iPad: カレンダーで開いているリストを見ている時は、左右どちらのフリックでもそのリストを畳む（S3-FRAME-007）', () => {
    for (const d of both)
      for (const exit of exits) expect(decidePop('edge-flick', 'calendar', d, exit, true)).toEqual({ kind: 'close-list' })
  })

  it('Android・PC: カレンダーで開いているリストを見ている時の「戻る」は、閉じるかを聞かずに畳む（S3-FRAME-008）。ホーム画面の Android でも、もう一度［戻る］で閉じる所にしない（■25）', () => {
    expect(decidePop('os-back', 'calendar', 'back', 'ask', true)).toEqual({ kind: 'close-list' })
    expect(decidePop('os-back', 'calendar', 'back', 'press-again', true)).toEqual({ kind: 'close-list' })
  })

  it('PC の「進む」は、開いているリストを見ていても何もしない（S3-FRAME-009）', () => {
    for (const exit of exits) expect(decidePop('os-back', 'calendar', 'forward', exit, true)).toEqual({ kind: 'stay' })
  })

  it('開いているリストを見ていない時（L・カレンダーを見ている・畳んでいる。listOpen false）は、カレンダーの行のまま（S3-FRAME-010）', () => {
    expect(decidePop('edge-flick', 'calendar', 'back', 'ask', false)).toEqual({ kind: 'ring', dir: 1 })
    expect(decidePop('edge-flick', 'calendar', 'forward', 'ask', false)).toEqual({ kind: 'ring', dir: -1 })
    expect(decidePop('os-back', 'calendar', 'back', 'ask', false)).toEqual({ kind: 'ask-exit' })
    expect(decidePop('os-back', 'calendar', 'back', 'press-again', false)).toEqual({ kind: 'arm-exit' })
  })

  it('listOpen を渡さない時（既定）は、今までの行と同じ', () => {
    for (const source of sources)
      for (const screen of ['calendar', ...others] as ScreenKind[])
        for (const d of both)
          for (const exit of exits) expect(decidePop(source, screen, d, exit)).toEqual(decidePop(source, screen, d, exit, false))
  })

  it('登録・詳細・ほかの画面では listOpen を見ない（リストの［詳しく］・［予定にする］の登録・MIM を先に閉じる。S3-FRAME-011・013）', () => {
    for (const source of sources)
      for (const screen of others)
        for (const d of both)
          for (const exit of exits)
            expect(decidePop(source, screen, d, exit, true)).toEqual(decidePop(source, screen, d, exit, false))
  })
})
