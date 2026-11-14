// iPhone・iPad ではブラウザの履歴をいつも1つのままにする（docs/SPEC.md の 3.1。22. の ■31〜■33。どの画面でも履歴を増やさない）ことの
// 見張り: src の本番のコード（テストを除く）で、2つの履歴の物（src/history/appHistory.ts = Android・PC の印の履歴の形、
// src/history/singleEntryHistory.ts = iPhone・iPad の1つの履歴の形。積む・動かすかは、この中で端末に合わせて決める）の外に、ブラウザの
// 履歴を積む・動かす書き方が無いこと。見る物: pushState・history.go・back・forward・location.assign・location.href / hash・location への
// 書き込み・# のリンク（iPhone・iPad では置き換えて移る印 replaceOnEdgeFlick を付けた物は除く。src/ui/ErrorBoundary.tsx）・window.open・
// reloadDocument・Google のログインのページごとの行き来（src/sync/firebase.ts の物だけ。3.1 の「残ること」）。注釈（// と /* */）の中は
// 見ない
import { describe, expect, it } from 'vitest'

/** 確かめるファイル（[src/history/ からの場所, 中身]。このフォルダーの物は ./ で来るので ../history/ にそろえる） */
const SOURCES = Object.fromEntries(
  Object.entries(
    import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx', '!../test/**'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
  ).map(([path, source]) => [path.startsWith('./') ? `../history/${path.slice(2)}` : path, source]),
)

/** 2つの履歴の物 */
const HISTORY_CLASSES = ['../history/appHistory.ts', '../history/singleEntryHistory.ts']

/** 見張る書き方（名前・注釈を除いた行に当てる形・その書き方を使ってよいファイル） */
const GROWTH: { name: string; re: RegExp; allowed?: string[] }[] = [
  { name: 'pushState', re: /\bpushState\b/ },
  { name: 'history.go・back・forward', re: /\bhistory\.(?:go|back|forward)\s*\(/ },
  { name: 'location.assign', re: /\blocation\.assign\s*\(/ },
  { name: 'location.href・hash への書き込み', re: /\blocation\.(?:href|hash)\s*=(?!=)/ },
  { name: 'location への書き込み', re: /\b(?:window|document)\.location\s*=(?!=)/ },
  { name: '# のリンク', re: /\bhref=\{?\s*["'`]#/ },
  { name: 'window.open', re: /\bwindow\.open\s*\(/ },
  { name: 'reloadDocument', re: /\breloadDocument\b/ },
  { name: 'ページごとのログイン', re: /\bsignInWithRedirect\b/, allowed: ['../sync/firebase.ts'] },
]

/** 注釈を除いた行（// は、: の後（URL の //）でない物だけ） */
function codeLines(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
}

/** 見張る書き方を使っている行（「場所:行 名前」） */
export function growthIn(path: string, source: string): string[] {
  const found: string[] = []
  codeLines(source).forEach((line, i) => {
    for (const g of GROWTH) {
      if (!g.re.test(line) || g.allowed?.includes(path)) continue
      if (g.name === '# のリンク' && /\breplaceOnEdgeFlick\b/.test(line)) continue
      found.push(`${path}:${i + 1} ${g.name}`)
    }
  })
  return found
}

describe('ブラウザの履歴を増やす書き方の見張り（iPhone・iPad はどの画面でも増やさない）', () => {
  it('src の本番のコードには、2つの履歴の物の外に、ブラウザの履歴を積む・動かす書き方が無い（# のリンクは iPhone・iPad で置き換えて移る物だけ）', () => {
    const paths = Object.keys(SOURCES)
    expect(paths).toContain('../ui/ErrorBoundary.tsx')
    expect(paths).toContain('../App.tsx')
    for (const p of HISTORY_CLASSES) expect(paths).toContain(p)
    expect(paths.some((p) => /\.test\.tsx?$/.test(p))).toBe(false)
    const found = Object.entries(SOURCES)
      .filter(([p]) => !HISTORY_CLASSES.includes(p))
      .flatMap(([p, source]) => growthIn(p, source))
    expect(found).toEqual([])
  })

  it('見張りの形は、どの書き方も見つける。注釈の中・置き換えて移る印の付いた # のリンク・使ってよいファイルの物は数えない', () => {
    const lines = [
      "history.pushState(null, '', '#/a')",
      'window.history.go(-1)',
      'history.back()',
      'history.forward()',
      "window.location.assign('#/a')",
      "location.hash = '#/a'",
      "window.location.href = '/x'",
      "window.location = '/x'",
      '<a href="#/settings">設定</a>',
      "<a href={'#/'}>トップ</a>",
      "window.open('#/a')",
      '<Link to="/" reloadDocument>',
      'await signInWithRedirect(auth, provider)',
    ]
    for (const line of lines) expect(growthIn('../x.tsx', line), line).toHaveLength(1)
    expect(growthIn('../x.tsx', '<a className="btn" href="#/" onClick={replaceOnEdgeFlick}>')).toEqual([])
    expect(growthIn('../x.ts', '// history.pushState は使わない')).toEqual([])
    expect(growthIn('../x.ts', '/* 積む（pushState）・戻る（history.go）は使わない */')).toEqual([])
    expect(growthIn('../x.ts', "const url = 'https://example.com/#a' // 説明")).toEqual([])
    expect(growthIn('../x.ts', "if (location.hash === '#/a') window.location.replace('#/b')")).toEqual([])
    expect(growthIn('../sync/firebase.ts', 'await signInWithRedirect(auth, provider)')).toEqual([])
  })
})
