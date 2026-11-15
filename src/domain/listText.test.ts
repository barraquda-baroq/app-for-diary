// 3つのリストの字の決まり（docs/SPEC.md の 13.〜15.）: 件名とメモの分け方（改行・頭の空の行・終わりの空白・全部空）、200字で切った残り
// （絵文字はコードポイントで数える）、「今週金曜」（日曜〜土曜のどの日でも。土曜は来週金曜）、20字の名前、入力欄の下のチップの字
import { describe, expect, it } from 'vitest'
import { weekdayOfYmd } from './dates'
import { NAME_MAX, chipLabel, fitTitle, fridayOf, name20, splitEntry, toLf } from './listText'
import { UNTITLED } from './repair'

describe('件名とメモに分ける（splitEntry。13.2・15.4）', () => {
  it('1行だけは件名だけ（メモは空。S3-TASK-036）', () => {
    expect(splitEntry('見積書を出す')).toEqual({ title: '見積書を出す', memo: '' })
  })

  it('2行以上は1行目を件名、2行目からをメモに（S3-FRAME-150・S3-TASK-036）', () => {
    expect(splitEntry('買い物\n牛乳\n卵')).toEqual({ title: '買い物', memo: '牛乳\n卵' })
  })

  it('CRLF・CR だけの改行も LF にそろえる', () => {
    expect(splitEntry('買い物\r\n牛乳\r\n卵')).toEqual({ title: '買い物', memo: '牛乳\n卵' })
    expect(splitEntry('買い物\r牛乳')).toEqual({ title: '買い物', memo: '牛乳' })
    expect(toLf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('頭の空の行（空白だけの行も）を飛ばし、件名の前後の空白を除く（S3-FRAME-092・開発）', () => {
    expect(splitEntry('\n   \n\t 件名 　\nメモ')).toEqual({ title: '件名', memo: 'メモ' })
  })

  it('メモの終わりの空白・空の行は除き、メモの中の空の行と行頭の空白は残す', () => {
    expect(splitEntry('件名\n  一段下げた行\n\n次の段落\n\n  \n')).toEqual({ title: '件名', memo: '  一段下げた行\n\n次の段落' })
    expect(splitEntry('件名\n   \n\n')).toEqual({ title: '件名', memo: '' })
  })

  it('どの行も空なら null（足さない。S3-ROUTINE-093）', () => {
    expect(splitEntry('')).toBeNull()
    expect(splitEntry('  \n\t\n　')).toBeNull()
  })

  it('件名の字数はここでは見ない（201字でも分けるだけ）', () => {
    const long = 'あ'.repeat(201)
    expect(splitEntry(`${long}\nメモ`)).toEqual({ title: long, memo: 'メモ' })
  })
})

describe('件名を 200字で切る（fitTitle。開発）', () => {
  it('200字までは切らない（overflow は空）', () => {
    const t = 'あ'.repeat(200)
    expect(fitTitle(t)).toEqual({ title: t, overflow: '' })
  })

  it('201字は 200字と残りの1字に分ける', () => {
    expect(fitTitle(`${'あ'.repeat(200)}い`)).toEqual({ title: 'あ'.repeat(200), overflow: 'い' })
  })

  it('絵文字はコードポイントで数え、サロゲートペアの途中で切らない（S3-FRAME-092）', () => {
    const emoji = '😀'.repeat(201)
    const r = fitTitle(emoji)
    expect(Array.from(r.title)).toHaveLength(200)
    expect(r.overflow).toBe('😀')
    expect(r.title + r.overflow).toBe(emoji)
    expect(fitTitle('😀'.repeat(200)).overflow).toBe('')
  })

  it('上限を渡せる', () => {
    expect(fitTitle('abcdef', 4)).toEqual({ title: 'abcd', overflow: 'ef' })
  })
})

describe('「今週金曜」（fridayOf。13.2・13.5）', () => {
  // 2026-11-08（日）〜11-14（土）の週
  it.each([
    ['2026-11-08', 0, '2026-11-13', '今週金曜'],
    ['2026-11-09', 1, '2026-11-13', '今週金曜'],
    ['2026-11-10', 2, '2026-11-13', '今週金曜'],
    ['2026-11-11', 3, '2026-11-13', '今週金曜'],
    ['2026-11-12', 4, '2026-11-13', '今週金曜'],
    ['2026-11-13', 5, '2026-11-13', '今週金曜'],
    ['2026-11-14', 6, '2026-11-20', '来週金曜'],
  ] as const)('%s（曜日 %i）→ %s %s（S3-FRAME-145・S3-TASK-058）', (today, w, date, label) => {
    expect(weekdayOfYmd(today)).toBe(w)
    expect(fridayOf(today)).toEqual({ date, label })
  })

  it('月・年をまたぐ週も（2026-12-31（木）→ 2027-01-01、2027-01-02（土）→ 来週金曜 2027-01-08）', () => {
    expect(fridayOf('2026-12-31')).toEqual({ date: '2027-01-01', label: '今週金曜' })
    expect(fridayOf('2027-01-02')).toEqual({ date: '2027-01-08', label: '来週金曜' })
  })
})

describe('20字の名前（name20。お知らせ・読み上げ）', () => {
  it('20字までは切らない', () => {
    expect(name20('近所のパン屋に行ってみる')).toBe('近所のパン屋に行ってみる')
    expect(name20('あ'.repeat(NAME_MAX))).toBe('あ'.repeat(20))
  })

  it('21字からは 20字で切って「…」', () => {
    expect(name20('あ'.repeat(21))).toBe(`${'あ'.repeat(20)}…`)
    expect(name20('😀'.repeat(25))).toBe(`${'😀'.repeat(20)}…`)
  })

  it('最初の空でない行だけ（前後の空白を除く）', () => {
    expect(name20('\n  週末に作りたい料理  \nカレー\n親子丼')).toBe('週末に作りたい料理')
  })

  it('どの行も空なら「（件名なし）」', () => {
    expect(name20('  \n ')).toBe(UNTITLED)
  })
})

describe('入力欄の下のチップの字（chipLabel。13.2）', () => {
  it('開始日は「開始 11/10」、締め切り日は「〆 11/20」（月日は 0 で埋めない。S3-TASK-061 の字）', () => {
    expect(chipLabel('start', '2026-11-10')).toBe('開始 11/10')
    expect(chipLabel('due', '2026-11-20')).toBe('〆 11/20')
    expect(chipLabel('due', '2027-01-05')).toBe('〆 1/5')
  })
})
