// 「戻る」「進む」（popstate）が来た時にすること（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・
// ■22・■23・■25）: 端末（端からのフリック・OS の戻る と、閉じ方）× 画面（カレンダー・登録・詳細・ほか）× 向き
import { describe, expect, it } from 'vitest'
import { decidePop, type PopDirection, type ScreenKind } from './popRules'

const both: PopDirection[] = ['back', 'forward']

describe('iPhone・iPad（画面の端からのフリック）', () => {
  it('カレンダー: 左の端から（戻る）は 1つ前のモード（日→週→月→年→日）、右の端から（進む）は1つ次（年→月→週→日→年）', () => {
    expect(decidePop('edge-flick', 'calendar', 'back')).toEqual({ kind: 'ring', dir: -1 })
    expect(decidePop('edge-flick', 'calendar', 'forward')).toEqual({ kind: 'ring', dir: 1 })
  })

  it('登録・詳細の画面とほかの画面: どちらへ払っても閉じる・1つ戻る（登録の画面も詳細と同じ。書きかけは聞かずに捨てる。■27）', () => {
    for (const screen of ['register', 'detail', 'other'] as ScreenKind[])
      for (const d of both) expect(decidePop('edge-flick', screen, d)).toEqual({ kind: 'back-one' })
  })
})

describe('Android・PC（OS の戻る・進む）', () => {
  it('カレンダーの「戻る」はアプリを閉じるかを聞く', () => {
    expect(decidePop('os-back', 'calendar', 'back')).toEqual({ kind: 'ask-exit' })
  })

  it('登録・詳細・ほかの画面の「戻る」は1つ戻る（登録の書きかけの確かめはルーターの所で）', () => {
    for (const screen of ['register', 'detail', 'other'] as ScreenKind[])
      expect(decidePop('os-back', screen, 'back')).toEqual({ kind: 'back-one' })
  })

  it('「進む」はどの画面でも何もしない', () => {
    for (const screen of ['calendar', 'register', 'detail', 'other'] as ScreenKind[])
      expect(decidePop('os-back', screen, 'forward')).toEqual({ kind: 'stay' })
  })
})

describe('ホーム画面から開いた Android のアプリ（閉じ方 press-again。■25）', () => {
  it('カレンダーの「戻る」は聞かずに、もう一度［戻る］で閉じる所にする', () => {
    expect(decidePop('os-back', 'calendar', 'back', 'press-again')).toEqual({ kind: 'arm-exit' })
    expect(decidePop('os-back', 'calendar', 'back', 'ask')).toEqual({ kind: 'ask-exit' })
  })

  it('登録・詳細・ほかの画面の「戻る」は今までどおり1つ戻り、「進む」は何もしない', () => {
    for (const screen of ['register', 'detail', 'other'] as ScreenKind[])
      expect(decidePop('os-back', screen, 'back', 'press-again')).toEqual({ kind: 'back-one' })
    for (const screen of ['calendar', 'register', 'detail', 'other'] as ScreenKind[])
      expect(decidePop('os-back', screen, 'forward', 'press-again')).toEqual({ kind: 'stay' })
  })

  it('端からのフリック（iPhone）は閉じ方に関わらず今までどおり', () => {
    expect(decidePop('edge-flick', 'calendar', 'back', 'press-again')).toEqual({ kind: 'ring', dir: -1 })
    expect(decidePop('edge-flick', 'register', 'back', 'press-again')).toEqual({ kind: 'back-one' })
  })
})
