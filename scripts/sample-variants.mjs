#!/usr/bin/env node
// 段階2の見本で作者に見比べてもらう色の案を作る（docs/SPEC.md の 21.・22.、4.3・4.5・4.6。作者に聞く Q2〜Q6）。
//   node scripts/sample-variants.mjs            → e2e/samples/variants.json に書き出す（いつも同じ結果。リポジトリに入れる）
//   node scripts/sample-variants.mjs --check    → 書き出し済みの e2e/samples/variants.json が src/styles.css と合っているかだけ確かめる
//   node scripts/sample-variants.mjs --emit css --pick hue30,depth-deeper@white
//                                               → 作者が選んだ案の値を、src/styles.css に書く形で出す（段階2の終わり。WP14）
//   node scripts/sample-variants.mjs --emit spec --pick …
//                                               → 同じ値を、仕様書の 4.5・4.6 の表の行の形で出す
// 案（見本のページの A・B・C）:
//   hue30           Q2 B  ラベルの12の色合いを 30° おき（15°・45°…345°）。明るさと彩度は 4.6 の決まりのまま（sRGB に入らなければ彩度を下げる）
//   depth-lighter   Q3 A  区分の地とハイライト（--work/private-soft・area・sheet・marker）を、面（--surface）からの OKLab の差 × 0.7
//   depth-deeper    Q3 C  同じく × 1.4。字の読みやすさ（4.5）を割る所は、割らない所まで戻す
//   highlight-full  Q4 B  件名のハイライトを字の高さいっぱいに（.kind-marker の帯の形だけ。色は替えない）
//   weekend-matched Q5 B  ホワイトとディープダークの --sat・--sun を、ダークと同じ関係（区分の色の半分ほどの彩度・区分の数字と ΔE 0.10 ほど）で作り直す
//   accent-lighter  Q6 A  グレーの差し色（--primary・--primary-hover・--today-bg・--today-ring・--selection・--accent-soft）を
//                         面に近づける向きに OKLCH の L を 0.06（彩度 0）
//   accent-deeper   Q6 C  面から離す向きに 0.06
// 「今」（B・Q4 A・Q5 A）は今の src/styles.css のまま。どの案も、src/styles.test.ts と同じ決まり（字 4.5:1、大きな数字・済んだ物 3:1、
// ラベルと地の明るさの差 0.1、ラベルなしの線と24色の ΔE 0.06 など）で確かめ、通らない案は書き出さずに止める（checkTheme）。
// アプリの中には入らない（見本は e2e/samples/samples.spec.ts が page.addStyleTag で差し込んで撮る）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromaOf,
  contrast,
  deltaE,
  hexToOklab,
  hexToOklch,
  inGamut,
  lightness,
  oklabToRgb,
  oklchToHex,
  rgbToHex,
} from './lib/color.mjs'

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const STYLES_FILE = path.join(repoDir, 'src', 'styles.css')
export const VARIANTS_FILE = path.join(repoDir, 'e2e', 'samples', 'variants.json')

// ---------- 外観とトークン ----------

export const THEMES = ['white', 'dark', 'deep-dark']
export const THEME_NAMES = { white: 'ホワイト', dark: 'ダーク', 'deep-dark': 'ディープダーク' }
/** その外観の色を書く規則（src/styles.css。ホワイトは :root、ほかは :root[data-theme=…]） */
const SELECTORS = { white: ':root', dark: ":root[data-theme='dark']", 'deep-dark': ":root[data-theme='deep-dark']" }
/** 見本に差し込む時のセレクタ（ホワイトも data-theme='white' が入るので、:root より強くして今の値に勝たせる） */
export const SAMPLE_SELECTORS = {
  white: ":root[data-theme='white']",
  dark: ":root[data-theme='dark']",
  'deep-dark': ":root[data-theme='deep-dark']",
}

/** ラベルの24色のキー（並びは 4.6 の番号の順。src/domain/labels.ts の LABEL_KEYS と同じ） */
export const LABEL_KEYS = [
  'rose-l',
  'coral-l',
  'apricot-l',
  'lemon-l',
  'lime-l',
  'mint-l',
  'teal-l',
  'sky-l',
  'blue-l',
  'wisteria-l',
  'violet-l',
  'peony-l',
  'rose-d',
  'coral-d',
  'apricot-d',
  'lemon-d',
  'lime-d',
  'mint-d',
  'teal-d',
  'sky-d',
  'blue-d',
  'wisteria-d',
  'violet-d',
  'peony-d',
]
/** 既定の呼び名（4.6。仕様書の表の行を出す時に使う） */
export const LABEL_NAMES = ['桜', '珊瑚', '杏', '菜の花', '若葉', 'ミント', '青磁', '空', '瑠璃', '藤', '菫', '牡丹']

/** ラベルの色の決まり（4.6: 外観ごと・淡（l）／濃（d）ごとの OKLCH の L と C） */
export const LABEL_RULES = {
  white: { l: [0.76, 0.09], d: [0.62, 0.12] },
  dark: { l: [0.86, 0.075], d: [0.75, 0.11] },
  'deep-dark': { l: [0.56, 0.022], d: [0.44, 0.022] },
}
/** 今の12の色合い（4.6。桜→牡丹の順） */
export const HUES_NOW = [10, 40, 68, 98, 128, 160, 192, 225, 258, 288, 318, 350]
/** 30° おきの案（15°・45°…345°） */
export const HUES_30 = HUES_NOW.map((_, i) => 15 + 30 * i)

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** いちばん外側の規則（@media の中は含めない）を、セレクタと中身の組にする（src/styles.test.ts と同じ読み方） */
function topLevelRules(source) {
  const src = stripComments(source)
  const rules = []
  let depth = 0
  let selStart = 0
  let bodyStart = 0
  let selector = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') {
      if (depth === 0) {
        selector = src.slice(selStart, i).trim()
        bodyStart = i + 1
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        rules.push({ selector, body: src.slice(bodyStart, i) })
        selStart = i + 1
      }
    }
  }
  return rules
}

function declarations(body) {
  const map = new Map()
  for (const part of body.split(';')) {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part)
    if (m) map.set(m[1], m[2].replace(/\s+/g, ' '))
  }
  return map
}

/**
 * src/styles.css から、外観ごとに効く変数の値を読む（ホワイトの :root に、ダーク・ディープダークの規則を重ねた物。値は書いたまま。
 * var(--x) もそのまま）。戻り値: { white: Map, dark: Map, 'deep-dark': Map }
 */
export function readThemes(css) {
  const rules = topLevelRules(css)
  const base = new Map()
  for (const r of rules.filter((r) => r.selector === ':root')) for (const [k, v] of declarations(r.body)) base.set(k, v)
  const out = { white: base }
  for (const theme of ['dark', 'deep-dark']) {
    const own = rules.filter((r) => r.selector === SELECTORS[theme])
    if (own.length !== 1) throw new Error(`${SELECTORS[theme]} の規則が1つではありません（${own.length}）`)
    const map = new Map(base)
    for (const [k, v] of declarations(own[0].body)) map.set(k, v)
    out[theme] = map
  }
  return out
}

/** var(--x) をたどった値（16進の色でなければ null） */
export function hexOf(vars, name) {
  let v = vars.get(name)
  for (let i = 0; i < 10 && v; i++) {
    const m = /^var\((--[\w-]+)\)$/.exec(v)
    if (!m) break
    v = vars.get(m[1])
  }
  return typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v) ? v : null
}

/** 変数がほかの変数を指しているか（var(--x)。案では書き換えず、指す先の値に付いていかせる） */
const isReference = (vars, name) => /^var\(--[\w-]+\)$/.test(vars.get(name) ?? '')

/** 案の値を重ねた外観の変数 */
export function withTokens(vars, tokens = {}) {
  const map = new Map(vars)
  for (const [k, v] of Object.entries(tokens)) map.set(k, v)
  return map
}

// ---------- 確かめ（src/styles.test.ts と同じ決まり） ----------

/** 字の色（4.5:1 以上。4.5） */
const TEXTS = [
  '--text',
  '--text-muted',
  '--text-faint',
  '--sat',
  '--sun',
  '--accent',
  '--work-text',
  '--private-text',
  '--off-text',
]
/** 字を置く 12 の地（4.5） */
export const GROUNDS = [
  '--bg',
  '--surface',
  '--surface-2',
  '--surface-3',
  '--off-fill',
  '--work-soft',
  '--private-soft',
  '--work-area',
  '--private-area',
  '--work-sheet',
  '--private-sheet',
  '--accent-soft',
]
/** 主なボタン・今日の印・ログインの画面・選んだ文字・お知らせ・注意の字（4.5:1 以上） */
const PAIRS_45 = [
  ['--on-primary', '--primary'],
  ['--on-primary', '--primary-hover'],
  ['--on-primary', '--today-bg'],
  ['--on-accent', '--accent'],
  ['--accent-strong', '--accent-soft'],
  ['--on-cover', '--cover'],
  ['--text', '--selection'],
  ['--toast-text', '--toast-bg'],
  ['--overdue', '--surface'],
  ['--danger', '--surface'],
  ['--danger', '--danger-soft'],
]
/** 段階2のカレンダーの字と地（styles.test.ts の「段階2のカレンダーの字と地」。ハイライトの組はディープダークを除く） */
const STAGE2_PAIRS = [
  ['--sun', '--off-fill'],
  ['--sat', '--off-fill'],
  ['--off-text', '--off-fill'],
  ['--accent-strong', '--accent-soft'],
  ['--work-text', '--work-soft'],
  ['--private-text', '--private-soft'],
  ['--work-text', '--work-area'],
  ['--private-text', '--private-area'],
  ['--text', '--work-sheet'],
  ['--text', '--private-sheet'],
]
/** 差し色とログインの画面の色（OKLab の彩度 0.015 未満のグレー） */
const GRAY_TOKENS = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--on-accent',
  '--primary',
  '--primary-hover',
  '--primary-border',
  '--on-primary',
  '--today-bg',
  '--today-ring',
  '--switch-on',
  '--selection',
  '--cover',
  '--on-cover',
  '--cover-border',
]
const KIND_GROUNDS = ['--work-soft', '--private-soft', '--work-area', '--private-area', '--work-sheet', '--private-sheet']
/** 区分の地の、面からの OKLab の差の幅（FRAME-180: 領域 0.03〜0.04、詳細 0.04〜0.06。ホワイトとダーク） */
export const GROUND_BANDS = { area: [0.03, 0.04], sheet: [0.04, 0.06] }

const fmt = (n, d = 2) => n.toFixed(d)

/**
 * その外観の変数が、src/styles.test.ts の決まりを満たすかを確かめる。戻り値は満たさない所の文（空なら通った）。
 * opts.bandScale: 区分の地の差の幅（FRAME-180）を何倍で見るか（地の濃さの案は × 0.7・× 1.4）。外観ごとに、倍率か
 * { トークン: 倍率 }（決まりを割るので倍率を戻したトークンがある時）
 */
export function checkTheme(theme, vars, opts = {}) {
  const out = []
  const name = THEME_NAMES[theme]
  const hex = (n) => {
    const v = hexOf(vars, n)
    if (!v) out.push(`${name}: ${n} が16進の色になっていません（${vars.get(n)}）`)
    return v ?? '#000000'
  }
  const ratio = (fg, bg, min, why = '') => {
    const r = contrast(hex(fg), hex(bg))
    if (r < min) out.push(`${name}: ${fg} / ${bg} が ${fmt(r)}:1（${min}:1 未満${why}）`)
  }
  const hasMarker = theme !== 'deep-dark'

  for (const fg of TEXTS) {
    for (const bg of GROUNDS) {
      // 例外: ディープダークの休みの地の上では --text-faint を使わず --text-muted で出す（4.5）
      if (theme === 'deep-dark' && fg === '--text-faint' && bg === '--off-fill') continue
      ratio(fg, bg, 4.5)
    }
  }
  if (hasMarker) {
    for (const marker of ['--work-marker', '--private-marker'])
      for (const fg of ['--text', '--text-muted']) ratio(fg, marker, 4.5, '・件名のハイライト')
  }
  for (const [fg, bg] of PAIRS_45) ratio(fg, bg, 4.5)
  for (const [fg, bg] of STAGE2_PAIRS) ratio(fg, bg, 4.5, '・段階2')
  for (const bg of ['--bg', '--surface']) ratio('--numeral', bg, 3, '・大きな数字')
  for (const bg of ['--surface', '--done-bg', ...KIND_GROUNDS]) ratio('--done-text', bg, 3, '・済んだ物')
  for (const t of GRAY_TOKENS) {
    const c = chromaOf(hex(t))
    if (c >= 0.015) out.push(`${name}: ${t} の彩度が ${fmt(c, 4)}（グレーは 0.015 未満）`)
  }
  for (const bg of GROUNDS) ratio('--accent', bg, 3, '・フォーカスの輪')
  ratio('--on-cover', '--cover', 3, '・ログインの画面のフォーカスの輪')
  for (const bg of ['--bg', '--surface', '--surface-3']) ratio('--today-bg', bg, 1.5, '・今日の丸の地')
  for (const bg of ['--bg', '--surface']) ratio('--today-ring', bg, 3, '・今日の輪')
  ratio('--switch-on', '--border-strong', 2, '・切り替えのオンとオフ')
  ratio('--switch-on', '--surface', 3, '・切り替えのオン')

  const labels = LABEL_KEYS.map((k) => [k, hex(`--label-${k}`)])
  // ラベルが無い時の線・●は、24色のどれとも ΔE 0.06 以上（ディープダークは見ない。D20）
  if (theme !== 'deep-dark') {
    for (const line of ['--work-line', '--private-line']) {
      for (const [k, c] of labels) {
        const d = deltaE(hex(line), c)
        if (d < 0.06) out.push(`${name}: ${line} / --label-${k} の ΔE が ${fmt(d, 3)}（0.06 未満）`)
      }
    }
  }
  // カード・領域・詳細の地とラベルの色の明るさの差は 0.1 以上（4.3・FRAME-146）
  for (const ground of KIND_GROUNDS) {
    for (const [k, c] of labels) {
      const dl = Math.abs(lightness(hex(ground)) - lightness(c))
      if (dl < 0.1) out.push(`${name}: ${ground} / --label-${k} の明るさの差が ${fmt(dl, 3)}（0.1 未満）`)
    }
  }
  // ダークの土日の色は区分の数字と ΔE 0.10 ほど離す（CALENDAR-057）
  if (theme === 'dark') {
    for (const [a, b] of [
      ['--sat', '--work-text'],
      ['--sun', '--private-text'],
    ]) {
      const d = deltaE(hex(a), hex(b))
      if (d < 0.1) out.push(`${name}: ${a} / ${b} の ΔE が ${fmt(d, 3)}（0.10 未満）`)
    }
  }
  if (theme === 'deep-dark') {
    // ディープダークは区分の色分けを無くす（領域・詳細の地は --surface、ハイライトは無し、カードの地は両方同じ）
    for (const n of ['--work-area', '--private-area', '--work-sheet', '--private-sheet'])
      if (vars.get(n) !== 'var(--surface)') out.push(`${name}: ${n} は var(--surface) のまま（${vars.get(n)}）`)
    for (const n of ['--work-marker', '--private-marker'])
      if (vars.get(n) !== 'transparent') out.push(`${name}: ${n} は transparent のまま（${vars.get(n)}）`)
    if (hex('--work-soft') !== hex('--private-soft'))
      out.push(`${name}: --work-soft と --private-soft が違う色（ディープダークのカードの地は区分で変えない）`)
  } else {
    // 区分の地の、面からの差（FRAME-180）。案の倍率の分だけ幅を広げ・狭め、丸めの誤差を 0.002 まで見る
    const scale = opts.bandScale?.[theme] ?? 1
    for (const kind of ['work', 'private']) {
      for (const [part, [lo, hi]] of Object.entries(GROUND_BANDS)) {
        const k = typeof scale === 'number' ? scale : (scale[`--${kind}-${part}`] ?? 1)
        const d = deltaE(hex(`--${kind}-${part}`), hex('--surface'))
        if (d < lo * k - 0.002 || d > hi * k + 0.002)
          out.push(`${name}: --${kind}-${part} の面との差が ${fmt(d, 4)}（${fmt(lo * k, 3)}〜${fmt(hi * k, 3)} の外）`)
      }
      const area = deltaE(hex(`--${kind}-area`), hex('--surface'))
      const sheet = deltaE(hex(`--${kind}-sheet`), hex('--surface'))
      if (!(area < sheet))
        out.push(
          `${name}: --${kind}-area の面との差が --${kind}-sheet 以上（${fmt(area, 4)}・${fmt(sheet, 4)}。詳細の地は領域の地より濃くする）`,
        )
    }
  }
  return out
}

// ---------- 案を作る ----------

/** 12の色合いからラベルの24色を作る（4.6 の決まり）。戻り値: { theme: { key: { hex, chroma, clipped } } } */
export function labelPalette(hues) {
  const out = {}
  for (const theme of THEMES) {
    out[theme] = {}
    LABEL_KEYS.forEach((key, i) => {
      const [L, C] = LABEL_RULES[theme][key.endsWith('-l') ? 'l' : 'd']
      out[theme][key] = oklchToHex([L, C, hues[i % 12]])
    })
  }
  return out
}

/** Q2 B: 12の色合いを 30° おきに */
function hue30() {
  const palette = labelPalette(HUES_30)
  const tokens = {}
  const notes = []
  for (const theme of THEMES) {
    tokens[theme] = {}
    for (const key of LABEL_KEYS) {
      const p = palette[theme][key]
      tokens[theme][`--label-${key}`] = p.hex
      if (p.clipped) {
        const C = LABEL_RULES[theme][key.endsWith('-l') ? 'l' : 'd'][1]
        notes.push(`${THEME_NAMES[theme]}の ${key} は sRGB に入らないので、彩度を ${C} から ${fmt(p.chroma, 3)} に下げた`)
      }
    }
  }
  return { tokens, notes }
}

/**
 * 面からの OKLab の差を k 倍にした色。sRGB に入らない時は、入る所まで倍率を 1 に近づける
 * （戻り値: { hex, k: 実際の倍率 }）
 */
export function scaledFrom(surface, color, k) {
  const s = hexToOklab(surface)
  const c = hexToOklab(color)
  for (let t = 0; t <= 100; t++) {
    const kk = k + ((1 - k) * t) / 100
    const lab = s.map((v, i) => v + (c[i] - v) * kk)
    const rgb = oklabToRgb(lab)
    if (inGamut(rgb)) return { hex: rgbToHex(rgb), k: kk }
  }
  return { hex: color, k: 1 }
}

/**
 * Q3 A・C: 区分の地とハイライトの濃さ。面（--surface）からの OKLab の差を k 倍にし（色合いと彩度の向きはそのまま）、
 * 決まり（字 4.5:1・ラベルとの明るさの差 0.1 など）を割るトークンは、割らない所まで倍率を 1 に近づける（actual に実際の倍率）。
 * ディープダークは区分の色分けが無いので、カードの地（--work-soft・--private-soft。同じ色）だけを変える
 */
function depth(themes, k) {
  const tokens = {}
  const notes = []
  const actual = {}
  for (const theme of THEMES) {
    const vars = themes[theme]
    const surface = hexOf(vars, '--surface')
    // 詳細の地は領域の地より濃いままにする（checkTheme）。後から動かす方が、もう動かした方と比べられるよう、濃くする時は詳細の地を、
    // 淡くする時は領域の地を先に動かす（逆にすると、まだ今の値の詳細の地を越えないように、領域の地の倍率を余計に戻してしまう）
    const parts = k > 1 ? ['soft', 'sheet', 'area', 'marker'] : ['soft', 'area', 'sheet', 'marker']
    const names = theme === 'deep-dark' ? ['--work-soft'] : parts.flatMap((p) => [`--work-${p}`, `--private-${p}`])
    tokens[theme] = {}
    actual[theme] = {}
    for (const n of names) {
      // 倍率を k から 1 へ 1/50 ずつ戻し、その外観の決まりのうち、このトークンに関わる物がすべて通る所で止める
      const twin = theme === 'deep-dark' ? '--private-soft' : null
      let chosen = null
      for (let t = 0; t <= 50 && !chosen; t++) {
        const cand = scaledFrom(surface, hexOf(vars, n), k + ((1 - k) * t) / 50)
        const trial = { ...tokens[theme], [n]: cand.hex, ...(twin ? { [twin]: cand.hex } : {}) }
        const problems = checkTheme(theme, withTokens(vars, trial), { bandScale: { [theme]: { ...actual[theme], [n]: cand.k } } })
        if (!problems.some((p) => p.includes(n) || (twin && p.includes(twin)))) chosen = cand
      }
      if (!chosen) throw new Error(`${THEME_NAMES[theme]}の ${n} は今の値でも決まりを満たしません`)
      tokens[theme][n] = chosen.hex
      actual[theme][n] = chosen.k
      if (twin) {
        tokens[theme][twin] = chosen.hex
        actual[theme][twin] = chosen.k
      }
      if (Math.abs(chosen.k - k) > 1e-9)
        notes.push(
          `${THEME_NAMES[theme]}の ${n} は × ${k} だと字の読みやすさなどの決まりを割るので、× ${fmt(chosen.k, 2)} にとどめた`,
        )
    }
  }
  return { tokens, notes, actual }
}

/** Q6 で動かすグレーの差し色 */
export const ACCENT_TOKENS = ['--primary', '--primary-hover', '--today-bg', '--today-ring', '--selection', '--accent-soft']
/** Q6 の明るさの動き（OKLCH の L） */
export const ACCENT_STEP = 0.06

/**
 * Q6 A・C: グレーの差し色の濃さ。dir = -1 は面（--surface）に近づける向き（淡い）、+1 は離す向き（濃い）。OKLCH の L を 0.06 動かし、
 * 彩度は 0（色味の無いグレー）。面との明るさの差が 0.06 より小さい地（ダークの --accent-soft など）は、面を越えないよう差の半分まで。
 * 決まり（--on-primary 4.5:1・輪 3:1 など）を割る時は、割らない所まで動きを小さくする。var(--x) のトークンは指す先に付いていく
 */
function accent(themes, dir) {
  const tokens = {}
  const notes = []
  for (const theme of THEMES) {
    const vars = themes[theme]
    const surfaceL = lightness(hexOf(vars, '--surface'))
    tokens[theme] = {}
    for (const n of ACCENT_TOKENS) {
      if (isReference(vars, n)) continue
      const [L] = hexToOklch(hexOf(vars, n))
      // 面から離れる向き（+1）。面より暗い色はマイナス
      const away = L >= surfaceL ? 1 : -1
      const room = Math.abs(L - surfaceL)
      const full = dir < 0 ? Math.min(ACCENT_STEP, room / 2) : ACCENT_STEP
      let chosen = null
      for (let t = 0; t <= 60 && !chosen; t++) {
        const step = full * (1 - t / 60)
        const cand = oklchToHex([L + away * dir * step, 0, 0]).hex
        const relevant = checkTheme(theme, withTokens(vars, { ...tokens[theme], [n]: cand })).filter((p) => mentions(p, n, vars))
        if (relevant.length === 0) chosen = { hex: cand, step }
      }
      if (!chosen) throw new Error(`${THEME_NAMES[theme]}の ${n} は今の値でも決まりを満たしません`)
      tokens[theme][n] = chosen.hex
      if (full < ACCENT_STEP)
        notes.push(
          `${THEME_NAMES[theme]}の ${n} は面との明るさの差が小さいので、面を越えないよう差の半分（${fmt(full, 3)}）だけ動かした`,
        )
      if (chosen.step < full - 1e-9)
        notes.push(`${THEME_NAMES[theme]}の ${n} は ${fmt(full, 3)} 動かすと決まりを割るので、${fmt(chosen.step, 3)} にとどめた`)
    }
  }
  return { tokens, notes }
}

/** 決まりの文が、そのトークン（か、それを var() で指すトークン）に関わるか */
function mentions(problem, name, vars) {
  if (problem.includes(`${name} `) || problem.endsWith(name) || problem.includes(`${name}（`)) return true
  for (const [k, v] of vars) if (v === `var(${name})` && (problem.includes(`${k} `) || problem.includes(`${k}（`))) return true
  return false
}

/** 土日の色と、比べる区分の数字 */
const WEEKEND = [
  ['--sat', '--work-text'],
  ['--sun', '--private-text'],
]
/** 土日の色と区分の数字の、いちばん小さい ΔE（CALENDAR-057 の「0.10 ほど」） */
export const WEEKEND_MIN_DE = 0.1

/**
 * Q5 B: ホワイトとディープダークの土日の色を、ダークと同じ関係で作り直す（CALENDAR-057・FRAME-179）。
 * - 色合い: ダークの --sat・--sun と同じ
 * - 彩度: ダークの「土日の色の彩度 ÷ 区分の数字の彩度」の比（土 0.60・日 0.72 ほど。区分の色の半分ほど）× その外観の区分の数字の彩度。
 *   ディープダークは区分の数字がグレーなので、区分の数字の彩度の代わりに、ダークの区分の数字の彩度をラベルの24色と同じ割合
 *   （ディープダークの彩度 0.022 ÷ ダークの淡の彩度 0.075）で落とした物を使う
 * - 明るさ: 区分の数字との ΔE がダークと同じ（土 0.12・日 0.10 ほど。0.10 より小さくしない）になる所。ダークと同じく区分の数字より
 *   面に近い側（ホワイトは明るい側、ディープダークは暗い側）を先に試し、12 の地の上で 4.5:1 に届かなければ反対の側にする。
 *   反対の側は平日の字（--text）の側なので、区分の数字からいちばん小さい差（0.10）にとどめ、平日の字からできるだけ離す
 *   （ダークと同じ差まで離すと、ホワイトの土曜の色が平日の字と ΔE 0.07 ほどになり、平日の日付と見分けにくい）
 */
function weekendMatched(themes) {
  const tokens = { white: {}, 'deep-dark': {} }
  const notes = []
  const dark = themes.dark
  const deepScale = LABEL_RULES['deep-dark'].l[1] / LABEL_RULES.dark.l[1]
  for (const theme of ['white', 'deep-dark']) {
    const vars = themes[theme]
    const surfaceL = lightness(hexOf(vars, '--surface'))
    for (const [tok, kindTok] of WEEKEND) {
      const [, dc, dh] = hexToOklch(hexOf(dark, tok))
      const darkKind = hexOf(dark, kindTok)
      const ratioC = dc / chromaOf(darkKind)
      const targetDE = Math.max(WEEKEND_MIN_DE, deltaE(hexOf(dark, tok), darkKind))
      const kindHex = hexOf(vars, kindTok)
      const refC = theme === 'deep-dark' ? chromaOf(darkKind) * deepScale : chromaOf(kindHex)
      const C = ratioC * refC
      const kindL = lightness(kindHex)
      const toward = surfaceL > kindL ? 1 : -1
      const passes = (hex) =>
        checkTheme(theme, withTokens(vars, { ...tokens[theme], [tok]: hex })).filter((p) => p.includes(`${tok} `)).length === 0
      /** 区分の数字から side の向きへ明るさを動かし、ΔE が de になる色（無ければ null） */
      const atDE = (side, de) => {
        let lo = 0
        let hi = 0.6
        for (let i = 0; i < 50; i++) {
          const mid = (lo + hi) / 2
          if (deltaE(oklchToHex([kindL + side * mid, C, dh]).hex, kindHex) < de) lo = mid
          else hi = mid
        }
        const L = kindL + side * hi
        return L > 0 && L < 1 ? oklchToHex([L, C, dh]).hex : null
      }
      let chosen = null
      for (const side of [toward, -toward]) {
        // 面に近い側: ダークと同じ ΔE から 0.10 まで小さくしながら、12 の地の上で 4.5:1 に届く所を探す。
        // 反対の側: 0.10 から大きくしながら探す（平日の字から離れた所を先に）
        for (let t = 0; t <= 20 && !chosen; t++) {
          const step = ((targetDE - WEEKEND_MIN_DE) * t) / 20
          const de = side === toward ? targetDE - step : WEEKEND_MIN_DE + step
          const hex = atDE(side, de + 0.001)
          if (hex && passes(hex) && deltaE(hex, kindHex) >= WEEKEND_MIN_DE) chosen = { hex, side }
        }
        if (chosen) break
      }
      if (!chosen) throw new Error(`${THEME_NAMES[theme]}の ${tok} をダークに合わせて作れません`)
      tokens[theme][tok] = chosen.hex
      if (chosen.side !== toward)
        notes.push(
          `${THEME_NAMES[theme]}の ${tok} は、${kindTok} より面に近い側では 4.5:1 に届かないので、反対の側（${chosen.side > 0 ? '明るい' : '暗い'}側）にした。` +
            `${kindTok} との差は ${fmt(deltaE(chosen.hex, kindHex), 3)}、平日の字（--text）との差は ${fmt(deltaE(chosen.hex, hexOf(vars, '--text')), 3)}`,
        )
    }
  }
  return { tokens, notes }
}

/** Q4 B: 件名のハイライトを字の高さいっぱいに（帯の形だけ。src/styles.css の .kind-marker の background を差し替える） */
export const HIGHLIGHT_FULL = 'linear-gradient(var(--kind-marker, transparent), var(--kind-marker, transparent))'

/** 作者に聞く問い（見本のページの並び。now は今の src/styles.css のまま） */
export const QUESTIONS = {
  2: {
    title: '色合いの間隔',
    appearances: THEMES,
    options: [
      { letter: 'A', id: 'now', label: '今の色' },
      { letter: 'B', id: 'hue30', label: '12の色合いを同じ間隔（30°おき）にずらした色' },
    ],
  },
  3: {
    title: '仕事・プライベートの地の濃さ',
    appearances: THEMES,
    options: [
      { letter: 'A', id: 'depth-lighter', label: '淡い' },
      { letter: 'B', id: 'now', label: '今' },
      { letter: 'C', id: 'depth-deeper', label: '濃い' },
    ],
  },
  4: {
    title: '件名の帯の形',
    appearances: ['white', 'dark'],
    options: [
      { letter: 'A', id: 'now', label: '字の下 6割' },
      { letter: 'B', id: 'highlight-full', label: '字の高さいっぱい' },
    ],
  },
  5: {
    title: '土日祝の日付の色（ホワイトとディープダーク）',
    appearances: ['white', 'deep-dark'],
    reference: ['dark'],
    options: [
      { letter: 'A', id: 'now', label: '今の色' },
      { letter: 'B', id: 'weekend-matched', label: 'ダークに合わせて作り直した色' },
    ],
  },
  6: {
    title: 'グレーの差し色の濃さ',
    appearances: THEMES,
    options: [
      { letter: 'A', id: 'accent-lighter', label: '淡い' },
      { letter: 'B', id: 'now', label: '今' },
      { letter: 'C', id: 'accent-deeper', label: '濃い' },
    ],
  },
}

/** 案のトークンを、見本に差し込む CSS にする（外観ごとに :root[data-theme=…]） */
export function tokensCss(tokens) {
  return THEMES.filter((t) => tokens[t] && Object.keys(tokens[t]).length)
    .map(
      (t) =>
        `${SAMPLE_SELECTORS[t]} {\n${Object.entries(tokens[t])
          .map(([k, v]) => `  ${k}: ${v};\n`)
          .join('')}}\n`,
    )
    .join('')
}

/**
 * すべての案を作り、確かめる。css = src/styles.css の中身。戻り値は e2e/samples/variants.json の中身。
 * 案が決まりを満たさない時は投げる（書き出さない）
 */
export function buildVariants(css) {
  const themes = readThemes(css)
  for (const theme of THEMES) {
    const problems = checkTheme(theme, themes[theme])
    if (problems.length) throw new Error(`今の src/styles.css が決まりを満たしていません:\n${problems.join('\n')}`)
  }
  const made = {
    hue30: { question: 2, letter: 'B', ...hue30() },
    'depth-lighter': { question: 3, letter: 'A', ...depth(themes, 0.7) },
    'depth-deeper': { question: 3, letter: 'C', ...depth(themes, 1.4) },
    'highlight-full': { question: 4, letter: 'B', tokens: {}, notes: [] },
    'weekend-matched': { question: 5, letter: 'B', ...weekendMatched(themes) },
    'accent-lighter': { question: 6, letter: 'A', ...accent(themes, -1) },
    'accent-deeper': { question: 6, letter: 'C', ...accent(themes, 1) },
  }
  const options = {}
  for (const [id, m] of Object.entries(made)) {
    const q = QUESTIONS[m.question]
    const opt = q.options.find((o) => o.id === id)
    const tokens = Object.fromEntries(THEMES.filter((t) => m.tokens[t]).map((t) => [t, m.tokens[t]]))
    let css = tokensCss(tokens)
    if (id === 'highlight-full') css = `.kind-marker {\n  background: ${HIGHLIGHT_FULL} !important;\n}\n`
    for (const theme of THEMES) {
      const bandScale = m.actual ? { [theme]: m.actual[theme] } : undefined
      const problems = checkTheme(theme, withTokens(themes[theme], tokens[theme]), { bandScale })
      if (problems.length) throw new Error(`案 ${id} が決まりを満たしていません:\n${problems.join('\n')}`)
    }
    options[id] = {
      question: m.question,
      letter: m.letter,
      label: opt.label,
      appearances: q.appearances.filter((t) => id === 'highlight-full' || tokens[t]),
      tokens,
      css,
      notes: m.notes,
    }
  }
  return {
    generatedBy: 'scripts/sample-variants.mjs',
    note: '段階2の見本の色の案（docs/SPEC.md の 21.・22.）。手で直さず、node scripts/sample-variants.mjs で作り直す',
    themes: THEMES,
    questions: QUESTIONS,
    options,
  }
}

/** 書き出す JSON の文字（いつも同じ並び・改行） */
export function variantsJson(css) {
  return `${JSON.stringify(buildVariants(css), null, 2)}\n`
}

/**
 * 書き出し済みの JSON の文字が、作り直した物と同じ中身か（空白・改行の違いは見ない。Prettier などで整えても、作り直し忘れとは
 * 言わない）。読めない・無い時は違うとする
 */
export function sameVariants(text, json) {
  try {
    return text !== null && JSON.stringify(JSON.parse(text)) === JSON.stringify(JSON.parse(json))
  } catch {
    return false
  }
}

// ---------- 選んだ案を書く形にする（段階2の終わり。WP14） ----------

/**
 * --pick の文字を読む: 'hue30,depth-deeper@white,accent-lighter@dark+deep-dark'。
 * 戻り値: { theme: { token: value } }（同じ外観の同じトークンを2つの案が書き換える時は投げる）
 */
export function pickTokens(variants, pick) {
  const out = Object.fromEntries(THEMES.map((t) => [t, {}]))
  const from = Object.fromEntries(THEMES.map((t) => [t, {}]))
  for (const part of String(pick ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [id, only] = part.split('@')
    const opt = variants.options[id]
    if (!opt) throw new Error(`知らない案: ${id}（${Object.keys(variants.options).join('・')}）`)
    const themes = only ? only.split('+') : THEMES
    for (const t of themes) {
      if (!THEMES.includes(t)) throw new Error(`知らない外観: ${t}`)
      // 外観を名指ししたのに、その案がその外観を変えない時（Q5 B のダークなど）は、黙って何もしないで済ませない
      if (only && !opt.appearances.includes(t))
        throw new Error(
          `案 ${id} は${THEME_NAMES[t]}を変えません（${opt.appearances.map((a) => THEME_NAMES[a]).join('・')}だけ）`,
        )
      for (const [k, v] of Object.entries(opt.tokens[t] ?? {})) {
        if (from[t][k] && from[t][k] !== id)
          throw new Error(`${THEME_NAMES[t]}の ${k} を ${from[t][k]} と ${id} の両方が書き換えます`)
        out[t][k] = v
        from[t][k] = id
      }
    }
  }
  return out
}

/**
 * 選んだ案をまとめて今の src/styles.css に重ね、外観ごとに決まり（checkTheme）を確かめる。戻り値は満たさない所の文（空なら通った）。
 * 案は1つずつ確かめてあるが、問いをまたいだ組み合わせ（地を濃くして差し色も淡くする、など）は、ここで初めて確かめる。
 * 区分の地の差の幅（FRAME-180）は、地の濃さの案で動かしたトークンだけ、実際に動かした倍率で見る
 */
export function checkPick(variants, pick, css) {
  const tokens = pickTokens(variants, pick)
  const themes = readThemes(css)
  const out = []
  for (const t of THEMES) {
    const vars = themes[t]
    const surface = hexOf(vars, '--surface')
    const scale = {}
    for (const [k, v] of Object.entries(tokens[t])) {
      if (!/^--(work|private)-(area|sheet)$/.test(k)) continue
      const before = deltaE(hexOf(vars, k), surface)
      if (before > 0) scale[k] = deltaE(v, surface) / before
    }
    out.push(...checkTheme(t, withTokens(vars, tokens[t]), { bandScale: { [t]: scale } }))
  }
  return out
}

/** 選んだ案を src/styles.css に書く形（外観ごとの規則の中の行）にする */
export function emitCss(variants, pick) {
  const tokens = pickTokens(variants, pick)
  const lines = []
  for (const t of THEMES) {
    const entries = Object.entries(tokens[t])
    if (!entries.length) continue
    lines.push(`/* ${THEME_NAMES[t]}（${SELECTORS[t]}） */`)
    for (const [k, v] of entries) lines.push(`  ${k}: ${v};`)
  }
  if (
    String(pick)
      .split(',')
      .some((p) => p.trim().split('@')[0] === 'highlight-full')
  )
    lines.push('/* 件名のハイライト（.kind-marker） */', `  background: ${HIGHLIGHT_FULL};`)
  return `${lines.join('\n')}\n`
}

/** 選んだ案を仕様書の表の行（4.6 のラベルの表・4.5 のトークンの表）の形にする。今の値のままの所は src/styles.css の値 */
export function emitSpec(variants, pick, css) {
  const tokens = pickTokens(variants, pick)
  const themes = readThemes(css)
  const value = (t, k) => tokens[t][k] ?? themes[t].get(k)
  const changed = new Set(THEMES.flatMap((t) => Object.keys(tokens[t])))
  const lines = []
  const labelRows = LABEL_KEYS.filter((k) => changed.has(`--label-${k}`))
  if (labelRows.length) {
    lines.push('| 番号 | キー | 既定の呼び名 | ホワイト | ダーク | ディープダーク |', '|---|---|---|---|---|---|')
    LABEL_KEYS.forEach((k, i) => {
      if (!changed.has(`--label-${k}`)) return
      const nameJa = `${LABEL_NAMES[i % 12]}・${k.endsWith('-l') ? '淡' : '濃'}`
      lines.push(`| ${i + 1} | \`${k}\` | ${nameJa} | ${THEMES.map((t) => `\`${value(t, `--label-${k}`)}\``).join(' | ')} |`)
    })
  }
  const tokenRows = [...changed].filter((k) => !k.startsWith('--label-'))
  if (tokenRows.length) {
    if (lines.length) lines.push('')
    lines.push('| トークン | ホワイト | ダーク | ディープダーク |', '|---|---|---|---|')
    for (const k of tokenRows) lines.push(`| \`${k}\` | ${THEMES.map((t) => `\`${value(t, k)}\``).join(' | ')} |`)
  }
  return `${lines.join('\n')}\n`
}

// ---------- 動かした時 ----------

function main() {
  const args = process.argv.slice(2)
  const flag = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? (args[i + 1] ?? '') : null
  }
  const css = fs.readFileSync(STYLES_FILE, 'utf8')
  const emit = flag('--emit')
  if (emit !== null) {
    const variants = JSON.parse(variantsJson(css))
    const pick = flag('--pick') ?? ''
    const problems = checkPick(variants, pick, css)
    if (problems.length) throw new Error(`選んだ案を合わせると決まりを満たしません:\n${problems.join('\n')}`)
    if (emit === 'css') process.stdout.write(emitCss(variants, pick))
    else if (emit === 'spec') process.stdout.write(emitSpec(variants, pick, css))
    else throw new Error(`--emit は css か spec です（${emit}）`)
    return
  }
  const json = variantsJson(css)
  const rel = path.relative(repoDir, VARIANTS_FILE)
  if (args.includes('--check')) {
    const now = fs.existsSync(VARIANTS_FILE) ? fs.readFileSync(VARIANTS_FILE, 'utf8') : null
    if (!sameVariants(now, json)) {
      console.error(`${rel} が src/styles.css と合っていません。node scripts/sample-variants.mjs で作り直してください`)
      process.exit(1)
    }
    console.log(`${rel} は src/styles.css と合っています`)
    return
  }
  fs.mkdirSync(path.dirname(VARIANTS_FILE), { recursive: true })
  fs.writeFileSync(VARIANTS_FILE, json)
  const variants = JSON.parse(json)
  console.log(`${rel} に ${Object.keys(variants.options).length} の案を書き出しました`)
  for (const [id, o] of Object.entries(variants.options)) for (const n of o.notes) console.log(`  ${id}: ${n}`)
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()
if (isMain) main()
