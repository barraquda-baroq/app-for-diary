// Favorite List の決まり（docs/SPEC.md の 15.・6.8）: 並び（新しい物が上・同じ order は id）、済みの並び、2行以上の見分け（改行で数える）、
// 1行目と残り、足した日（よその年）、20字の名前、［Task List へ移す］の件名とメモ（空の1行目・200字を超えた分）、［予定にする］の初めの値
import { describe, expect, it } from 'vitest'
import { registerDefaults } from './itemInput'
import { addedLabel, favoriteListView, favoriteRowView, favoriteToRegister, favoriteToTask } from './favoriteList'
import { addFavorite, addItem, updateFavorite } from './ops'
import { taskInputOf } from './taskList'
import { DAY, T0, dataWith, mkFavorite } from './testData'
import { emptyData } from './types'
import { UNTITLED } from './repair'

const TODAY = '2026-11-10'

describe('並び（15.1・15.3・開発）', () => {
  it('まだの物は order の小さい順（同じなら id の小さい順）、済みは済んだ新しい順（同じなら id。S3-ROUTINE-031・開発）', () => {
    const favs = [
      mkFavorite({ id: 'b', order: 0 }),
      mkFavorite({ id: 'a', order: 0 }),
      mkFavorite({ id: 'top', order: -3 }),
      mkFavorite({ id: 'd1', done: true, doneAt: T0 - DAY, order: -9 }),
      mkFavorite({ id: 'd3', done: true, doneAt: T0, order: 5 }),
      mkFavorite({ id: 'd2', done: true, doneAt: T0, order: 1 }),
      mkFavorite({ id: 'd0', done: true, doneAt: null }),
    ]
    const v = favoriteListView(favs, TODAY)
    expect(v.open.map((r) => r.id)).toEqual(['top', 'a', 'b'])
    expect(v.done.map((r) => r.id)).toEqual(['d2', 'd3', 'd1', 'd0'])
    expect(v.undone).toBe(3)
  })

  it('新しい物はいちばん上に足す（order = 済みも含めていちばん小さい値 − 1。S3-FRAME-274・S3-ROUTINE-175）', () => {
    let data = dataWith({
      favorites: [mkFavorite({ id: 'old', order: 0 }), mkFavorite({ id: 'done', order: -2, done: true, doneAt: T0 })],
    })
    const first = addFavorite(data, '近所のパン屋に行ってみる', T0)
    data = first.data
    expect(data.favorites[first.result].order).toBe(-3)
    const second = addFavorite(data, '積んでいる本を読む', T0 + 1)
    const v = favoriteListView(Object.values(second.data.favorites), TODAY)
    expect(v.open.map((r) => r.id)).toEqual([second.result, first.result, 'old'])
    expect(second.data.favorites[second.result]).toMatchObject({
      v: 1,
      done: false,
      doneAt: null,
      by: 'user',
      ai: null,
      via: null,
      createdAt: T0 + 1,
      updatedAt: T0 + 1,
    })
  })

  it('済みにする・外すと済みの所とまだの所を行き来する（doneAt は今・null。15.3）', () => {
    let data = dataWith({ favorites: [mkFavorite({ id: 'f' })] })
    data = updateFavorite(data, 'f', { done: true }, T0)
    expect(favoriteListView(Object.values(data.favorites), TODAY)).toMatchObject({ open: [], undone: 0 })
    expect(data.favorites.f.doneAt).toBe(T0)
    data = updateFavorite(data, 'f', { done: false }, T0 + 1)
    expect(favoriteListView(Object.values(data.favorites), TODAY).open.map((r) => r.id)).toEqual(['f'])
    expect(data.favorites.f.doneAt).toBeNull()
  })

  it('中身は1字以上で長さの制限は無い（空・空白だけは足さない。S3-FRAME-094）', () => {
    expect(() => addFavorite(emptyData(), '  \n ', T0)).toThrow('中身を入れてください。')
    const long = 'あ'.repeat(10_000)
    const { data, result } = addFavorite(emptyData(), long, T0)
    expect(data.favorites[result].text).toBe(long)
  })
})

describe('1行に出す物（15.2・開発）', () => {
  it('1行だけは太くしない（multiLine false）', () => {
    const row = favoriteRowView(mkFavorite({ id: 'f', text: '近所のパン屋に行ってみる' }), TODAY)
    expect(row).toMatchObject({
      firstLine: '近所のパン屋に行ってみる',
      rest: '',
      multiLine: false,
      name: '近所のパン屋に行ってみる',
    })
  })

  it('改行で分けた行が2行以上なら1行目と2行目から（折り返しは数えない。CRLF も）', () => {
    const row = favoriteRowView(mkFavorite({ text: '週末に作りたい料理\r\nカレー\n親子丼' }), TODAY)
    expect(row).toMatchObject({ firstLine: '週末に作りたい料理', rest: 'カレー\n親子丼', multiLine: true })
    expect(favoriteRowView(mkFavorite({ text: 'あ'.repeat(300) }), TODAY).multiLine).toBe(false)
  })

  it('前後の空白・空の行は見ない（終わりの改行だけで2行にしない）', () => {
    expect(favoriteRowView(mkFavorite({ text: '\n  気になる記事  \n\n' }), TODAY)).toMatchObject({
      firstLine: '気になる記事',
      rest: '',
      multiLine: false,
    })
  })

  it('名前は最初の空でない行の 20字（お知らせ・読み上げ）', () => {
    expect(favoriteRowView(mkFavorite({ text: `${'あ'.repeat(25)}\n続き` }), TODAY).name).toBe(`${'あ'.repeat(20)}…`)
    expect(favoriteRowView({ ...mkFavorite(), text: 3 as unknown as string }, TODAY)).toMatchObject({
      firstLine: '',
      name: UNTITLED,
    })
  })

  it('記録そのものを持つ', () => {
    const f = mkFavorite({ id: 'x' })
    expect(favoriteRowView(f, TODAY)).toMatchObject({ id: 'x', favorite: f })
  })
})

describe('足した日（15.2・開発）', () => {
  it('createdAt の端末の暦の日付を「11/10」で（S3-FRAME-278・S3-ROUTINE-182）', () => {
    expect(addedLabel(T0, TODAY)).toBe('11/10')
    expect(addedLabel(new Date(2026, 10, 9, 23, 59).getTime(), TODAY)).toBe('11/9')
    expect(addedLabel(new Date(2026, 10, 10, 0, 0).getTime(), TODAY)).toBe('11/10')
    expect(favoriteRowView(mkFavorite({ createdAt: new Date(2026, 0, 5, 12).getTime() }), TODAY).added).toBe('1/5')
  })

  it('年が今日と違う時は年も（「2025/11/10」）', () => {
    expect(addedLabel(new Date(2025, 10, 10, 9).getTime(), TODAY)).toBe('2025/11/10')
    expect(addedLabel(new Date(2027, 0, 1, 9).getTime(), TODAY)).toBe('2027/1/1')
  })

  it('作った時刻が数でない時は 1970/1/1 として出す（並びや画面を壊さない）', () => {
    expect(addedLabel(Number.NaN, TODAY)).toMatch(/^19(69|70)\//)
    expect(addedLabel(T0, 'x')).toBe('11/10')
  })
})

describe('［Task List へ移す］（favoriteToTask。15.4・開発）', () => {
  /** そのまま Task List の入力欄の決まりに通して足す */
  const asTask = (text: string) => {
    const r = taskInputOf(favoriteToTask(text))
    if (!r.ok) throw new Error(r.message)
    return r.input
  }

  it('1行目を件名、2行目からをメモに（日付・依頼者なし。S3-FRAME-286）', () => {
    expect(favoriteToTask('週末に作りたい料理\nカレー\n親子丼')).toEqual({
      text: '週末に作りたい料理\nカレー\n親子丼',
      start: null,
      due: null,
      requester: '',
    })
    expect(asTask('週末に作りたい料理\nカレー\n親子丼')).toMatchObject({
      origin: 'list',
      kind: 'work',
      listed: true,
      title: '週末に作りたい料理',
      memo: 'カレー\n親子丼',
    })
  })

  it('頭の空の行は飛ばし、最初の空でない行を件名に', () => {
    expect(asTask('\n\n  気になる記事 \nhttps://example.com/article')).toMatchObject({
      title: '気になる記事',
      memo: 'https://example.com/article',
    })
  })

  it('件名が 200字を超える分はメモの頭へ回す（足せる件名にする。開発）', () => {
    const head = 'あ'.repeat(200)
    const t = asTask(`${head}いう\n二行目`)
    expect(t.title).toBe(head)
    expect(t.memo).toBe('いう\n二行目')
    expect(asTask(`${head}え`)).toMatchObject({ title: head, memo: 'え' })
    expect(asTask('😀'.repeat(203))).toMatchObject({ title: '😀'.repeat(200), memo: '😀😀😀' })
  })

  it('済みの項目から移しても、タスクは済みにしない（addItem は done: false で作る）', () => {
    const input = asTask(mkFavorite({ text: '新しいノートを買う', done: true, doneAt: T0 }).text)
    const { data, result } = addItem(emptyData(), input, T0)
    expect(data.items[result]).toMatchObject({ done: false, doneAt: null, title: '新しいノートを買う' })
  })

  it('どの行も空なら空の書きかけ（Task List の決まりで断られる）', () => {
    expect(favoriteToTask('  \n ')).toEqual({ text: '', start: null, due: null, requester: '' })
    expect(taskInputOf(favoriteToTask('  \n ')).ok).toBe(false)
  })
})

describe('［予定にする］（favoriteToRegister。15.4・12.2・開発）', () => {
  it('開始日は今日・仕事・件名に1行目・メモに2行目から（元の項目は残す。S3-FRAME-284・S3-FRAME-285）', () => {
    expect(favoriteToRegister('旅行で行きたい所\n海の見える公園\n山の上の展望台', TODAY)).toEqual({
      start: TODAY,
      kind: 'work',
      title: '旅行で行きたい所',
      memo: '海の見える公園\n山の上の展望台',
    })
  })

  it('件名は 200字まで、あふれた分はメモの頭へ（開発）', () => {
    const r = favoriteToRegister(`${'あ'.repeat(205)}\n続き`, TODAY)
    expect(r.title).toBe('あ'.repeat(200))
    expect(r.memo).toBe('あああああ\n続き')
  })

  it('200字の切れ目がちょうど空白の時は、件名の終わりに空白を残さない（その空白はメモにも入れない。開発）', () => {
    const text = `${'あ'.repeat(199)} い\n次`
    const r = favoriteToRegister(text, TODAY)
    expect(r.title).toBe('あ'.repeat(199))
    expect(r.memo).toBe('い\n次')
    const t = favoriteToTask(text)
    expect(t.text).toBe(`${'あ'.repeat(199)}\nい\n次`)
    expect(taskInputOf(t)).toMatchObject({ ok: true })
  })

  it('登録の画面の初めの値になる（calendar 生まれ・締め切り日なし・時刻なし）', () => {
    expect(registerDefaults(favoriteToRegister('近所のパン屋に行ってみる', TODAY))).toEqual({
      origin: 'calendar',
      start: TODAY,
      due: null,
      startTime: null,
      endTime: null,
      kind: 'work',
      title: '近所のパン屋に行ってみる',
      memo: '',
    })
  })

  it('どの行も空なら件名もメモも空', () => {
    expect(favoriteToRegister('', TODAY)).toEqual({ start: TODAY, kind: 'work', title: '', memo: '' })
  })
})
