// @vitest-environment node
// 段階2の見本の色の案（scripts/sample-variants.mjs・e2e/samples/variants.json）と色の計算（scripts/lib/color.mjs）の確かめ
// （docs/SPEC.md の 4.3・4.5・4.6・21.）。どの案も src/styles.test.ts と同じ決まりを満たすので、作者がどれを選んでも、その値を
// そのまま src/styles.css に入れられる（段階2の終わり。WP14）。作者の答え（2026-11-12。ANSWERS）の後は、答えた問いの案は答える前の値
// （見本で見比べてもらった時の値。Q2〜Q6 は ASKED_TOKENS、Q9・Q11・Q12・Q13 はラベルの24色だけ ASKED_LABELS。askedFor）から作ったまま
// 残し、答えの値（Q3 A・Q4 B・Q5 B・Q6 B・Q13 G）は src/styles.css に入っている
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  channelDiff,
  chromaOf,
  contrast,
  deltaE,
  hexToOklab,
  hexToOklch,
  hexToRgb,
  lightness,
  oklabToHex,
  oklchToHex,
  rgbToHex,
} from './lib/color.mjs'
import {
  ACCENT_STEP,
  ACCENT_TOKENS,
  ANSWERS,
  ANSWERED_BRIGHT,
  ASKED_GROUND_BANDS,
  ASKED_LABELS,
  ASKED_TOKENS,
  BRIGHT_WHITE,
  BRIGHT_WHITE_GROUNDS,
  BRIGHT_WHITE_MIN_DE,
  C2_WHITE_L,
  COUNT_PAIRS,
  FLUORESCENT,
  GROUND_BANDS,
  GROUNDS,
  HIGHLIGHT_ASKED,
  HIGHLIGHT_FULL,
  HUES_30,
  HUES_ASKED,
  LABEL_KEYS,
  LABEL_LADDER,
  LABEL_NAMES,
  LABEL_QUESTIONS,
  LABEL_RULES,
  LABEL_SETS,
  LADDER_NAMES,
  QUESTIONS,
  SAMPLE_SELECTORS,
  THEMES,
  WEEKEND_MIN_DE,
  askedCss,
  askedFor,
  askedThemes,
  buildVariants,
  checkPick,
  checkTheme,
  closestPair,
  cvdDeltaE,
  cvdOklab,
  emitCss,
  emitNames,
  emitSpec,
  hexOf,
  labelPalette,
  pickNames,
  pickTokens,
  readThemes,
  sameVariants,
  scaledFrom,
  variantsJson,
  withTokens,
} from './sample-variants.mjs'
import { LABEL_DEFAULT_NAMES, LABEL_KEYS as APP_LABEL_KEYS } from '../src/domain/labels.ts'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const committed = readFileSync(new URL('../e2e/samples/variants.json', import.meta.url), 'utf8')
const themes = readThemes(css)
/** 答える前の値（Q2〜Q6 を見本で見比べてもらった時。2026-11-11。Q2〜Q6 の案はこの上で作った） */
const asked = askedThemes(themes)
const variants = buildVariants(css)
const options = variants.options
/** その案を作って確かめた土台（見比べてもらった時の値と区分の地の幅。askedFor） */
const baseOf = (id) => askedFor(options[id].question, themes)
/** 案を重ねたその外観の変数（見比べてもらった時の値に重ねる） */
const applied = (id, theme) => withTokens(baseOf(id).themes[theme], options[id].tokens[theme])

describe('色の計算（scripts/lib/color.mjs）', () => {
  it('16進 ↔ sRGB を行き来できる', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0])
    expect(rgbToHex([1, 128 / 255, 0])).toBe('#ff8000')
    expect(rgbToHex([1.2, -0.1, 0.5])).toBe('#ff0080')
    expect(() => hexToRgb('#fff')).toThrow()
  })

  it('OKLab: 白は L 1・黒は L 0（彩度 0）。行き来しても同じ色に戻る', () => {
    const [L, a, b] = hexToOklab('#ffffff')
    expect(L).toBeCloseTo(1, 4)
    expect(Math.hypot(a, b)).toBeLessThan(1e-4)
    expect(hexToOklab('#000000')[0]).toBeCloseTo(0, 6)
    for (const hex of ['#25282e', '#e499a4', '#039a97', '#8a9bb5', '#f1f5fb']) expect(oklabToHex(hexToOklab(hex))).toBe(hex)
  })

  it('OKLCH → 16進: sRGB に入る色はそのまま、入らない色は彩度を 0.002 ずつ下げる（明るさと色相は保つ）', () => {
    const inside = oklchToHex([0.75, 0.11, 10])
    expect(inside.clipped).toBe(false)
    expect(inside.hex).toBe('#ea909e')
    const outside = oklchToHex([0.62, 0.12, 225])
    expect(outside.clipped).toBe(true)
    expect(outside.chroma).toBeCloseTo(0.116, 6)
    const [L, , h] = hexToOklch(outside.hex)
    expect(L).toBeCloseTo(0.62, 2)
    expect(h).toBeCloseTo(225, 0)
  })

  it('WCAG の比と OKLab の差（src/styles.test.ts と同じ値になる。仕様書 4.5 のダークの土日の比）', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6)
    expect(contrast('#ffffff', '#000000')).toBe(contrast('#000000', '#ffffff'))
    expect(Number(contrast('#8a9bb5', '#17181b').toFixed(2))).toBe(6.29)
    expect(Number(contrast('#c79199', '#272a30').toFixed(2))).toBe(5.44)
    expect(deltaE('#123456', '#123456')).toBe(0)
    expect(deltaE('#8a9bb5', '#9fc1ec')).toBeCloseTo(deltaE('#9fc1ec', '#8a9bb5'), 12)
    expect(lightness('#ffffff')).toBeCloseTo(1, 4)
    expect(chromaOf('#4f5259')).toBeLessThan(0.015)
    expect(channelDiff('#102030', '#112233')).toBe(3)
  })
})

describe('今の値（src/styles.css）と 4.6 の決まり', () => {
  it('src/styles.css の3つの外観を読める（表の値・var() のまま）', () => {
    expect(themes.white.get('--surface')).toBe('#ffffff')
    expect(themes.dark.get('--sat')).toBe('#8a9bb5')
    expect(themes['deep-dark'].get('--work-area')).toBe('var(--surface)')
    expect(hexOf(themes['deep-dark'], '--work-area')).toBe('#0e0f11')
    expect(hexOf(themes.white, '--today-bg')).toBe('#4f5259')
    expect(hexOf(themes['deep-dark'], '--work-marker')).toBeNull()
  })

  it.each(THEMES)(
    '%s: 今の値は確かめ（checkTheme。src/styles.test.ts と同じ決まり）を通る（ホワイトの蛍光の黄・緑は、答えで選んだ案G の例外で見る）',
    (theme) => {
      expect(ANSWERED_BRIGHT).toEqual(['lemon-d', 'mint-d'])
      expect(checkTheme(theme, themes[theme], { bright: ANSWERED_BRIGHT })).toEqual([])
      // 例外を使わないと、ホワイトの菜の花・濃とミント・濃の、区分の地との明るさの差だけを割る（ダーク・ディープダークは例外なしで通る）
      const plain = checkTheme(theme, themes[theme])
      if (theme === 'white') {
        expect(plain.length).toBeGreaterThan(0)
        expect(
          plain.every((p) => /明るさの差/.test(p) && /--label-(lemon|mint)-d /.test(p)),
          plain.join('\n'),
        ).toBe(true)
      } else expect(plain).toEqual([])
    },
  )

  it.each(THEMES)('%s: 答える前の値（今の値に ASKED_TOKENS を重ねた物）も、答える前の区分の地の幅で確かめを通る', (theme) => {
    expect(checkTheme(theme, asked[theme], { bands: ASKED_GROUND_BANDS })).toEqual([])
  })

  it.each(THEMES)(
    '%s: Q9・Q11・Q12・Q13 を見比べてもらった時の値（今の値のラベルの24色だけを ASKED_LABELS に戻した物）も、例外なしで確かめを通る',
    (theme) => {
      const base = askedFor(13, themes)
      expect(base.bands).toBe(GROUND_BANDS)
      expect(checkTheme(theme, base.themes[theme], { bands: base.bands })).toEqual([])
      for (const [k, v] of base.themes[theme]) {
        if (k.startsWith('--label-')) expect(v, `${theme} ${k}`).toBe(ASKED_LABELS[theme][k])
        else expect(v, `${theme} ${k}`).toBe(themes[theme].get(k))
      }
    },
  )

  it('askedFor: 答えた Q2〜Q6 は 2026-11-11 の値と答える前の幅、答えたラベルの24色の問い（Q9〜Q13）は今の値に答える前の24色', () => {
    expect(LABEL_QUESTIONS).toEqual([9, 11, 12, 13])
    for (const q of [2, 3, 4, 5, 6]) {
      const base = askedFor(q, themes)
      expect(base.bands, String(q)).toBe(ASKED_GROUND_BANDS)
      for (const t of THEMES) expect([...base.themes[t]], `${q} ${t}`).toEqual([...asked[t]])
    }
    for (const q of LABEL_QUESTIONS) {
      const base = askedFor(q, themes)
      expect(base.bands, String(q)).toBe(GROUND_BANDS)
      expect(hexOf(base.themes.white, '--label-lemon-d'), String(q)).toBe('#9a861b')
      expect(hexOf(base.themes.white, '--work-soft'), String(q)).toBe(hexOf(themes.white, '--work-soft'))
    }
    // まだ答えの無い問い（今は無い）は、今の値と今の幅
    const none = askedFor(99, themes)
    expect(none.themes).toBe(themes)
    expect(none.bands).toBe(GROUND_BANDS)
  })

  it('作者の答え（Q3 A・Q4 B・Q5 B・Q6 B・Q13 G）の案を答える前の値に重ねると、今の src/styles.css の値になる（--emit css の値がそのまま入っている）', () => {
    expect(ANSWERS).toEqual({
      2: 'labels',
      3: 'depth-lighter',
      4: 'highlight-full',
      5: 'weekend-matched',
      6: 'now',
      9: 'labels',
      11: 'labels',
      12: 'labels',
      13: 'labels-g',
    })
    const pick = Object.values(ANSWERS)
      .filter((id) => id in options)
      .join(',')
    expect(pick).toBe('depth-lighter,highlight-full,weekend-matched,labels-g')
    const tokens = pickTokens(variants, pick)
    for (const t of THEMES) {
      // 答えで替えたトークンは、ASKED_TOKENS に答える前の値を残したトークンと同じ（ラベルの24色は ASKED_LABELS）
      expect(Object.keys(tokens[t]).sort(), t).toEqual(Object.keys(ASKED_TOKENS[t]).sort())
      for (const [k, v] of Object.entries(ASKED_LABELS[t])) expect(ASKED_TOKENS[t][k], `${t} ${k}`).toBe(v)
      for (const [k, v] of Object.entries(tokens[t])) {
        expect(themes[t].get(k), `${t} ${k}`).toBe(v)
        expect(ASKED_TOKENS[t][k], `${t} ${k}`).not.toBe(v)
      }
      // Q6 B（今）: グレーの差し色は答える前のまま
      for (const k of ACCENT_TOKENS) expect(ASKED_TOKENS[t][k], `${t} ${k}`).toBeUndefined()
    }
    expect(emitCss(variants, pick)).toContain(`background: ${HIGHLIGHT_FULL};`)
    expect(checkPick(variants, pick, css)).toEqual([])
  })

  it('答えた問いの切り抜きの下に敷く CSS（variants.json の asked）は、答える前の値と答える前の件名のハイライトの形（下 6割）', () => {
    expect(variants.asked.questions).toEqual(
      Object.keys(ANSWERS)
        .map(Number)
        .filter((q) => !LABEL_QUESTIONS.includes(q)),
    )
    expect(variants.asked.questions).toEqual([2, 3, 4, 5, 6])
    // Q9・Q11・Q12・Q13 の案は24色をすべて書き換えるので、敷かずに撮る（ラベル以外は Q3〜Q6 の答えを入れた今の値のまま）
    for (const q of LABEL_QUESTIONS) expect(variants.asked.questions).not.toContain(q)
    for (const id of ['labels-a', 'labels-b', 'labels-c', 'labels-d', 'labels-c2', 'labels-e', 'labels-f', 'labels-g'])
      for (const t of THEMES)
        expect(Object.keys(options[id].tokens[t]).sort(), `${id} ${t}`).toEqual(Object.keys(ASKED_LABELS[t]).sort())
    expect(variants.asked.tokens).toEqual(ASKED_TOKENS)
    expect(variants.asked.css).toBe(askedCss())
    expect(variants.asked.css).toContain(`.kind-marker {\n  background: ${HIGHLIGHT_ASKED} !important;\n}`)
    for (const t of THEMES) {
      for (const [k, v] of Object.entries(ASKED_TOKENS[t])) {
        expect(variants.asked.css, `${t} ${k}`).toContain(`  ${k}: ${v};`)
        // 敷く値は今の値と違う（敷かないと、「今」の絵が選んだ案と同じになる）
        expect(themes[t].get(k), `${t} ${k}`).not.toBe(v)
      }
    }
    // 案の CSS は同じ形のセレクタで、後から差し込むので、敷いた値より案が勝つ
    expect(options['depth-lighter'].css.split('{')[0]).toBe(variants.asked.css.split('{')[0])
  })

  it('区分の地の面からの差の幅（FRAME-180）は、答える前の幅の 0.7 倍（Q3 A の「面からの差 × 0.7」）', () => {
    for (const part of ['area', 'sheet'])
      GROUND_BANDS[part].forEach((v, i) => expect(v, part).toBeCloseTo(ASKED_GROUND_BANDS[part][i] * 0.7, 6))
  })

  it('確かめは、決まりを割る値を見つける', () => {
    const w = themes.white
    expect(checkTheme('white', withTokens(w, { '--text-faint': '#9a9a9a' })).join('\n')).toMatch(/--text-faint \/ --bg/)
    expect(checkTheme('white', withTokens(w, { '--work-line': hexOf(w, '--label-blue-d') })).join('\n')).toMatch(
      /--work-line \/ --label-blue-d の ΔE/,
    )
    expect(checkTheme('white', withTokens(w, { '--work-soft': '#c0c8d0' })).join('\n')).toMatch(
      /--work-soft \/ --label-.* の明るさの差/,
    )
    expect(checkTheme('white', withTokens(w, { '--primary': '#4f5a79' })).join('\n')).toMatch(/--primary の彩度/)
    expect(checkTheme('white', withTokens(w, { '--work-area': '#e4edf8' })).join('\n')).toMatch(/--work-area の面との差/)
    expect(checkTheme('dark', withTokens(themes.dark, { '--sat': '#9fc1ec' })).join('\n')).toMatch(/--sat \/ --work-text の ΔE/)
    expect(checkTheme('deep-dark', withTokens(themes['deep-dark'], { '--work-area': '#141518' })).join('\n')).toMatch(
      /--work-area は var\(--surface\)/,
    )
    expect(checkTheme('white', withTokens(w, { '--done-text': '#c8c8c8' })).join('\n')).toMatch(/--done-text \/ --surface/)
    // マンスリーの件数は、件数を置く3つの地の上で 4.5:1 以上（太字の大きな字の 3:1 には頼らない。#b64f6f は休みの地の上で 4.07:1）
    expect(COUNT_PAIRS).toHaveLength(6)
    expect(checkTheme('white', withTokens(w, { '--private-count': '#b64f6f' })).join('\n')).toMatch(
      /--private-count \/ --off-fill が 4\.07:1（4\.5:1 未満・マンスリーの件数）/,
    )
    // 詳細の地が領域の地より淡い（逆さま）時は、そのとおりに書く
    expect(checkTheme('white', withTokens(w, { '--work-area': '#ecf2fa' })).join('\n')).toMatch(
      /--work-area の面との差が --work-sheet 以上/,
    )
    expect(checkTheme('deep-dark', withTokens(themes['deep-dark'], { '--work-soft': '#151619' })).join('\n')).toMatch(
      /--work-soft と --private-soft が違う色/,
    )
  })

  it('ラベルのキーと既定の呼び名は、アプリ（src/domain/labels.ts）と同じ', () => {
    expect(LABEL_KEYS).toEqual([...APP_LABEL_KEYS])
    LABEL_KEYS.forEach((key, i) => {
      expect(`${LABEL_NAMES[i % 12]}・${key.endsWith('-l') ? '淡' : '濃'}`).toBe(LABEL_DEFAULT_NAMES[key])
    })
  })

  it('4.6 の表の24色（今の src/styles.css）は、作者が選んだ案G（LABEL_SETS の labels-g）と同じ。ホワイトとダークは同じ値', () => {
    const g = options['labels-g']
    for (const theme of THEMES) {
      for (const key of LABEL_KEYS) {
        const now = hexOf(themes[theme], `--label-${key}`)
        expect(now, `${theme} ${key}`).toBe(g.tokens[theme][`--label-${key}`])
        expect(now, `${theme} ${key}`).toBe(oklchToHex(LABEL_SETS['labels-g'].oklch[key][theme]).hex)
      }
    }
    for (const key of LABEL_KEYS) expect(hexOf(themes.white, `--label-${key}`), key).toBe(hexOf(themes.dark, `--label-${key}`))
    // ディープダークは案C のディープダーク（ほぼグレー。D20）
    for (const key of LABEL_KEYS)
      expect(hexOf(themes['deep-dark'], `--label-${key}`), key).toBe(options['labels-c'].tokens['deep-dark'][`--label-${key}`])
  })

  it('答える前の24色（ASKED_LABELS。見本で見比べてもらった時の 4.6 の表）は、その時の明るさ・彩度・色相（LABEL_RULES・HUES_ASKED）から作った値（1/255 以内）', () => {
    const palette = labelPalette(HUES_ASKED)
    for (const theme of THEMES) {
      expect(Object.keys(ASKED_LABELS[theme])).toEqual(LABEL_KEYS.map((k) => `--label-${k}`))
      for (const key of LABEL_KEYS) {
        const before = ASKED_LABELS[theme][`--label-${key}`]
        expect(
          channelDiff(palette[theme][key].hex, before),
          `${theme} ${key} ${palette[theme][key].hex} / ${before}`,
        ).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('案（e2e/samples/variants.json）', () => {
  it('書き出したファイルは、今の src/styles.css から作った物と同じ（作り直し忘れが無い）', () => {
    expect(sameVariants(committed, variantsJson(css))).toBe(true)
  })

  it('同じ中身かは、空白と改行の違い（Prettier で整えた時など）を見ず、値の違いと読めない物は違いとする', () => {
    const json = variantsJson(css)
    // 配列を1行にまとめるなど、整え方だけが違う
    const reformatted = JSON.stringify(JSON.parse(json), null, 4).replace(
      /\[\s+"white",\s+"dark",\s+"deep-dark"\s+\]/g,
      '["white", "dark", "deep-dark"]',
    )
    expect(reformatted).not.toBe(json)
    expect(sameVariants(reformatted, json)).toBe(true)
    expect(sameVariants(json.replace(options.hue30.tokens.white['--label-rose-l'], '#000000'), json)).toBe(false)
    expect(sameVariants('{', json)).toBe(false)
    expect(sameVariants(null, json)).toBe(false)
  })

  it('問い（Q2〜Q6・Q9・Q11・Q12・Q13）の選ぶ物は、どれも「今」か作った案', () => {
    expect(Object.keys(QUESTIONS).map(Number)).toEqual([2, 3, 4, 5, 6, 9, 11, 12, 13])
    const ids = Object.values(QUESTIONS).flatMap((q) => q.options.map((o) => o.id))
    for (const id of ids) expect(id === 'now' || id in options, id).toBe(true)
    for (const id of Object.keys(options)) expect(ids).toContain(id)
    for (const [id, o] of Object.entries(options)) {
      const q = QUESTIONS[o.question]
      expect(q.options.find((x) => x.id === id)?.letter).toBe(o.letter)
      for (const t of o.appearances) expect(q.appearances).toContain(t)
    }
  })

  // どの案も、案を当てた外観で、src/styles.test.ts の決まり（字 4.5:1・大きな数字と済んだ物 3:1・ラベルと地の明るさの差 0.1・
  // ラベルなしの線と24色の ΔE 0.06・差し色はグレー・今日の印・ディープダークの決まり）を満たす。案G（Q13）だけは、ホワイトの蛍光の黄・緑
  // （BRIGHT_WHITE）を、明るさの差 0.1 の代わりに白い地と ΔE 0.15 以上で見る
  const cases = Object.keys(options).flatMap((id) => THEMES.map((t) => [id, t]))
  it.each(cases)('%s（%s）は決まりを満たす', (id, theme) => {
    const scale = options[id].question === 3 ? bandScaleOf(id, theme) : undefined
    const { bands } = baseOf(id)
    expect(checkTheme(theme, applied(id, theme), { bandScale: scale, bands, bright: BRIGHT_WHITE[id] })).toEqual([])
  })

  it('見本に差し込む CSS は、外観ごとの :root[data-theme=…] の中に案の値だけを書く', () => {
    for (const [id, o] of Object.entries(options)) {
      if (id === 'highlight-full') continue
      for (const t of THEMES) {
        const tokens = o.tokens[t] ?? {}
        if (!Object.keys(tokens).length) {
          expect(o.css).not.toContain(SAMPLE_SELECTORS[t])
          continue
        }
        const block = new RegExp(`${SAMPLE_SELECTORS[t].replace(/[[\]]/g, '\\$&')} \\{\\n([^}]*)\\}`).exec(o.css)
        expect(block, `${id} ${t}`).not.toBeNull()
        const written = Object.fromEntries([...block[1].matchAll(/(--[\w-]+): ([^;]+);/g)].map((m) => [m[1], m[2]]))
        expect(written).toEqual(tokens)
        for (const v of Object.values(tokens)) expect(v).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })
})

/** 地の濃さの案で、実際に使った倍率（値から逆に求める。トークンごと） */
function bandScaleOf(id, theme) {
  if (theme === 'deep-dark') return undefined
  const surface = hexOf(asked[theme], '--surface')
  const out = {}
  for (const [k, v] of Object.entries(options[id].tokens[theme]))
    out[k] = deltaE(v, surface) / deltaE(hexOf(asked[theme], k), surface)
  return { [theme]: out }
}

describe('Q2 B: 12の色合いを 30° おき（hue30）', () => {
  it('色合いは 15°・45°…345°（同じ間隔）', () => {
    expect(HUES_30).toEqual([15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345])
  })

  it('3つの外観の24色を、4.6 の明るさと彩度（sRGB に入らない時は彩度を下げる）で作る', () => {
    const o = options.hue30
    expect(o.appearances).toEqual(THEMES)
    for (const theme of THEMES) {
      expect(Object.keys(o.tokens[theme])).toEqual(LABEL_KEYS.map((k) => `--label-${k}`))
      LABEL_KEYS.forEach((key, i) => {
        const hex = o.tokens[theme][`--label-${key}`]
        const [L, C] = LABEL_RULES[theme][key.endsWith('-l') ? 'l' : 'd']
        const [l, c, h] = hexToOklch(hex)
        expect(l, `${theme} ${key}`).toBeCloseTo(L, 2)
        expect(c, `${theme} ${key}`).toBeLessThanOrEqual(C + 0.002)
        // 彩度の低いディープダークは、8ビットに丸めると色相が数度ずれる
        expect(Math.abs(((h - HUES_30[i % 12] + 540) % 360) - 180), `${theme} ${key} の色相`).toBeLessThan(
          theme === 'deep-dark' ? 6 : 1.5,
        )
      })
    }
  })

  it('桜（15°）と牡丹（345°）の間も 30°（今は 20°）', () => {
    const near = (theme, a, b) => deltaE(options.hue30.tokens[theme][`--label-${a}`], options.hue30.tokens[theme][`--label-${b}`])
    const now = (theme, a, b) => deltaE(hexOf(asked[theme], `--label-${a}`), hexOf(asked[theme], `--label-${b}`))
    for (const theme of ['white', 'dark'])
      expect(near(theme, 'rose-l', 'peony-l')).toBeGreaterThan(now(theme, 'rose-l', 'peony-l'))
  })
})

describe('Q3 A・C: 区分の地とハイライトの濃さ（depth-lighter・depth-deeper）', () => {
  const PARTS = ['soft', 'area', 'sheet', 'marker']
  it.each([
    ['depth-lighter', 0.7],
    ['depth-deeper', 1.4],
  ])('%s: 面からの OKLab の差を × %s にする（決まりを割る所は割らない所まで戻し、そのことを書き残す）', (id, k) => {
    const o = options[id]
    expect(o.appearances).toEqual(THEMES)
    for (const theme of ['white', 'dark']) {
      const surface = hexOf(asked[theme], '--surface')
      expect(Object.keys(o.tokens[theme]).sort()).toEqual(PARTS.flatMap((p) => [`--work-${p}`, `--private-${p}`]).sort())
      for (const [name, hex] of Object.entries(o.tokens[theme])) {
        const ratio = deltaE(hex, surface) / deltaE(hexOf(asked[theme], name), surface)
        const noted = o.notes.some((n) => n.includes(name) && n.includes(theme === 'white' ? 'ホワイト' : 'ダーク'))
        if (noted) {
          // 戻した物は 1 と k の間
          expect(ratio, `${theme} ${name}`).toBeGreaterThan(Math.min(1, k) - 0.02)
          expect(ratio, `${theme} ${name}`).toBeLessThan(Math.max(1, k) + 0.02)
        } else expect(ratio, `${theme} ${name}`).toBeCloseTo(k, 1)
        // 色合いの向きは今のまま（仕事は青み・プライベートはピンクみ）
        const hNow = hexToOklch(hexOf(asked[theme], name))[2]
        const hNew = hexToOklch(hex)[2]
        expect(Math.abs(((hNew - hNow + 540) % 360) - 180), `${theme} ${name} の色合い`).toBeLessThan(8)
      }
      // 詳細の地は、領域の地より面との差が大きいまま
      for (const kind of ['work', 'private']) {
        const v = applied(id, theme)
        expect(deltaE(hexOf(v, `--${kind}-sheet`), surface)).toBeGreaterThan(deltaE(hexOf(v, `--${kind}-area`), surface))
      }
    }
    // ディープダーク: 区分の色分けは無いまま（カードの地だけ。仕事とプライベートは同じ色）
    expect(Object.keys(o.tokens['deep-dark']).sort()).toEqual(['--private-soft', '--work-soft'])
    expect(o.tokens['deep-dark']['--work-soft']).toBe(o.tokens['deep-dark']['--private-soft'])
  })

  // 倍率を戻したのは、その倍率のままだと（ほかのトークンは書き出した値で）本当に決まりを割る時だけ。並べ方の都合
  // （詳細の地をまだ動かす前に、領域の地を比べてしまう、など）で戻していない
  it.each([
    ['depth-lighter', 0.7],
    ['depth-deeper', 1.4],
  ])('%s: 倍率を戻したトークンは、倍率どおりだと決まりを割る', (id, k) => {
    const o = options[id]
    for (const theme of ['white', 'dark']) {
      const surface = hexOf(asked[theme], '--surface')
      const scale = bandScaleOf(id, theme)[theme]
      for (const name of Object.keys(o.tokens[theme])) {
        const noted = o.notes.some((n) => n.includes(`${name} `) && n.includes(theme === 'white' ? 'ホワイト' : 'ダーク'))
        if (!noted) continue
        const full = scaledFrom(surface, hexOf(asked[theme], name), k)
        const problems = checkTheme(theme, withTokens(asked[theme], { ...o.tokens[theme], [name]: full.hex }), {
          bands: ASKED_GROUND_BANDS,
          bandScale: { [theme]: { ...scale, [name]: full.k } },
        })
        expect(
          problems.filter((p) => p.includes(name)),
          `${theme} ${name}`,
        ).not.toEqual([])
      }
    }
  })

  it('濃い案のホワイトの領域の地は、字の読みやすさを割らないので × 1.4 のまま', () => {
    const o = options['depth-deeper']
    const surface = hexOf(asked.white, '--surface')
    for (const name of ['--work-area', '--private-area']) {
      const ratio = deltaE(o.tokens.white[name], surface) / deltaE(hexOf(asked.white, name), surface)
      expect(ratio, name).toBeCloseTo(1.4, 1)
    }
  })

  it('淡い案は今より面に近く、濃い案は今より面から遠い（ホワイトのハイライトは字の読みやすさのため、ほぼ今のまま）', () => {
    for (const theme of THEMES) {
      const surface = hexOf(asked[theme], '--surface')
      for (const name of Object.keys(options['depth-lighter'].tokens[theme])) {
        const now = deltaE(hexOf(asked[theme], name), surface)
        expect(deltaE(options['depth-lighter'].tokens[theme][name], surface), `${theme} ${name}`).toBeLessThan(now)
        expect(deltaE(options['depth-deeper'].tokens[theme][name], surface), `${theme} ${name}`).toBeGreaterThan(now)
      }
    }
  })
})

describe('Q4 B: 件名のハイライトを字の高さいっぱいに（highlight-full）', () => {
  it('色は替えず、.kind-marker の帯の形だけを差し替える（ハイライトのあるホワイトとダーク）', () => {
    const o = options['highlight-full']
    expect(o.tokens).toEqual({})
    expect(o.appearances).toEqual(['white', 'dark'])
    expect(o.css).toContain(`.kind-marker {\n  background: ${HIGHLIGHT_FULL} !important;`)
    // 答える前の形（A。字の下 6割）は 40% の境のある帯。答え B の形が src/styles.css に入っている
    expect(HIGHLIGHT_ASKED).toBe('linear-gradient(transparent 40%, var(--kind-marker, transparent) 40%)')
    expect(css).toMatch(/\.kind-marker \{\s*display: inline;\s*background: ([^;]+);/)
    expect(/\.kind-marker \{\s*display: inline;\s*background: ([^;]+);/.exec(css)[1]).toBe(HIGHLIGHT_FULL)
  })
})

describe('Q5 B: 土日祝の色をダークに合わせる（weekend-matched）', () => {
  const o = options['weekend-matched']
  const PAIRS = [
    ['--sat', '--work-text'],
    ['--sun', '--private-text'],
  ]

  it('ホワイトとディープダークの --sat・--sun だけを作り直す（ダークは今のまま）', () => {
    expect(o.appearances).toEqual(['white', 'deep-dark'])
    expect(Object.keys(o.tokens)).toEqual(['white', 'deep-dark'])
    for (const t of o.appearances) expect(Object.keys(o.tokens[t])).toEqual(['--sat', '--sun'])
  })

  it.each(['white', 'deep-dark'])('%s: 区分の数字と ΔE 0.10 以上離れ、12 の地のどれの上でも 4.5:1 以上', (theme) => {
    const v = applied('weekend-matched', theme)
    for (const [a, b] of PAIRS) {
      expect(deltaE(hexOf(v, a), hexOf(v, b)), `${a} / ${b}`).toBeGreaterThanOrEqual(WEEKEND_MIN_DE)
      for (const g of GROUNDS) expect(contrast(hexOf(v, a), hexOf(v, g)), `${a} / ${g}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('色合いはダークと同じ、彩度はダークと同じく区分の色の半分ほど（色の付いた灰色）', () => {
    for (const [a, b] of PAIRS) {
      const dark = hexOf(asked.dark, a)
      const darkRatio = chromaOf(dark) / chromaOf(hexOf(asked.dark, b))
      expect(darkRatio).toBeGreaterThan(0.45)
      expect(darkRatio).toBeLessThan(0.85)
      const white = o.tokens.white[a]
      expect(chromaOf(white) / chromaOf(hexOf(asked.white, b))).toBeCloseTo(darkRatio, 1)
      for (const t of ['white', 'deep-dark']) {
        const dh = Math.abs(((hexToOklch(o.tokens[t][a])[2] - hexToOklch(dark)[2] + 540) % 360) - 180)
        expect(dh, `${t} ${a} の色合い`).toBeLessThan(t === 'deep-dark' ? 8 : 2)
      }
      // ディープダークはラベルと同じく、ダークより彩度を落とす
      expect(chromaOf(o.tokens['deep-dark'][a])).toBeLessThan(chromaOf(dark))
    }
  })

  // 区分の数字より面に近い側で 4.5:1 に届かず反対の側（平日の字 --text の側）にした時は、区分の数字からいちばん小さい差
  // （0.10）にとどめ、平日の字からできるだけ離す（土日の色が平日の字の色に見えないように）
  it.each(['white', 'deep-dark'])(
    '%s: 反対の側にした土日の色は、区分の数字と ΔE 0.10 ほどにとどめ、平日の字から離す',
    (theme) => {
      for (const [a, b] of PAIRS) {
        const far = o.notes.some(
          (n) => n.includes(`${a} は`) && n.includes('反対の側') && n.startsWith(theme === 'white' ? 'ホワイト' : 'ディープ'),
        )
        if (!far) continue
        const v = applied('weekend-matched', theme)
        expect(deltaE(hexOf(v, a), hexOf(v, b)), `${a} / ${b}`).toBeLessThan(WEEKEND_MIN_DE + 0.006)
        // 区分の数字に近い所にとどめたので、平日の字（--text）との差は 0.08 より大きい
        expect(deltaE(hexOf(v, a), hexOf(v, '--text')), `${a} / --text`).toBeGreaterThan(0.08)
      }
    },
  )

  it('ホワイトの --sat・--sun は、区分の数字より面に近い側では作れないので、反対の側にしたことを書き残す', () => {
    for (const a of ['--sat', '--sun'])
      expect(o.notes.some((n) => n.startsWith(`ホワイトの ${a} は`) && n.includes('反対の側'))).toBe(true)
  })

  it('答える前のホワイトの日曜の色はプライベートの数字に近すぎた（ΔE 0.03）ので、案では離れる', () => {
    expect(deltaE(hexOf(asked.white, '--sun'), hexOf(asked.white, '--private-text'))).toBeLessThan(0.05)
    expect(deltaE(o.tokens.white['--sun'], hexOf(asked.white, '--private-text'))).toBeGreaterThanOrEqual(WEEKEND_MIN_DE)
  })
})

describe('Q6 A・C: グレーの差し色の濃さ（accent-lighter・accent-deeper）', () => {
  it.each([
    ['accent-lighter', -1],
    ['accent-deeper', 1],
  ])('%s: 明るさだけを動かした色味の無いグレー。淡いは面に近く、濃いは面から遠く', (id, dir) => {
    const o = options[id]
    expect(o.appearances).toEqual(THEMES)
    for (const theme of THEMES) {
      const surfaceL = lightness(hexOf(asked[theme], '--surface'))
      for (const name of ACCENT_TOKENS) {
        // var(--primary) のトークン（ホワイト・ダークの --today-bg）は書かず、指す先に付いていく
        if (/^var\(/.test(asked[theme].get(name))) {
          expect(o.tokens[theme][name]).toBeUndefined()
          continue
        }
        const hex = o.tokens[theme][name]
        expect(hex, `${theme} ${name}`).toMatch(/^#[0-9a-f]{6}$/)
        expect(chromaOf(hex), `${theme} ${name}`).toBeLessThan(0.002)
        const now = Math.abs(lightness(hexOf(asked[theme], name)) - surfaceL)
        const next = Math.abs(lightness(hex) - surfaceL)
        expect(Math.abs(next - now), `${theme} ${name}`).toBeLessThanOrEqual(ACCENT_STEP + 0.01)
        // 決まりのために動きを小さくした物を除き、向きどおりに動く
        const limited = o.notes.some((n) => n.includes(`${name} `) && n.includes('決まりを割る'))
        if (!limited || Math.abs(next - now) > 0.005) expect(Math.sign(next - now), `${theme} ${name}`).toBe(dir)
        // 面を越えない（面より暗い色・明るい色の側のまま）
        expect(Math.sign(lightness(hex) - surfaceL)).toBe(Math.sign(lightness(hexOf(asked[theme], name)) - surfaceL))
      }
    }
  })
})

// ラベルの24色の案（Q9・Q11・Q12・Q13）の確かめに使う物
const colorsOf = (id, theme) => Object.fromEntries(LABEL_KEYS.map((k) => [k, options[id].tokens[theme][`--label-${k}`]]))
/** 見比べてもらった時の「今」の24色（答える前のパステルの24色 ASKED_LABELS。下のテストの名前の「今」はこの色） */
const nowColors = (theme) => Object.fromEntries(LABEL_KEYS.map((k) => [k, ASKED_LABELS[theme][`--label-${k}`]]))
const both = (bases) => bases.flatMap((b) => [`${b}-l`, `${b}-d`])
/** 作者が「特に近い」と言った2つの仲間（青の仲間・左のピンクの仲間） */
const FAMILIES = { 青: both(['teal', 'sky', 'blue', 'wisteria']), ピンク: both(['rose', 'coral', 'peony']) }
const familyMin = (colors, keys) => {
  let min = Infinity
  for (const a of keys) for (const b of keys) if (a < b) min = Math.min(min, deltaE(colors[a], colors[b]))
  return min
}
const hueGap = (a, b) => (b - a + 360) % 360
/** 色を選ぶ所の行（淡・濃）が、色合いの順のまま一回りする（どの隣も 180° より近く、間の和が 360°） */
const hueRoundTrip = (oklch, theme, row) => {
  const hs = LABEL_KEYS.filter((k) => k.endsWith(`-${row}`)).map((k) => oklch[k][theme][2])
  const gaps = hs.map((h, i) => hueGap(h, hs[(i + 1) % 12]))
  return gaps.every((g) => g < 180) && gaps.reduce((a, b) => a + b, 0) === 360
}

describe('Q9: ラベルの24色の作り直し（labels-a・labels-b。■1・■2 の答え）', () => {
  const SETS = ['labels-a', 'labels-b']

  it.each(SETS)('%s: キーと並びは今のまま（データはそのまま使える）、3つの外観の24色を OKLCH の値からそのまま作る', (id) => {
    const o = options[id]
    expect(o.question).toBe(9)
    expect(o.appearances).toEqual(THEMES)
    expect(Object.keys(LABEL_SETS[id].oklch)).toEqual(LABEL_KEYS)
    for (const theme of THEMES) {
      expect(Object.keys(o.tokens[theme])).toEqual(LABEL_KEYS.map((k) => `--label-${k}`))
      for (const key of LABEL_KEYS) {
        const lch = LABEL_SETS[id].oklch[key][theme]
        const made = oklchToHex(lch)
        // sRGB に入らない値（彩度を下げて作り直す物）は置かない
        expect(made.clipped, `${theme} ${key}`).toBe(false)
        expect(o.tokens[theme][`--label-${key}`]).toBe(made.hex)
      }
    }
  })

  it.each(SETS)('%s: 既定の呼び名は24色で別々（12字まで）。labels-a は今の呼び名、labels-b は和色の名前と読み', (id) => {
    const names = options[id].names
    expect(Object.keys(names)).toEqual(LABEL_KEYS)
    expect(new Set(Object.values(names)).size).toBe(24)
    for (const n of Object.values(names)) expect(n.length).toBeGreaterThan(0)
    for (const n of Object.values(names)) expect([...n].length).toBeLessThanOrEqual(12)
    if (id === 'labels-a') expect(names).toEqual({ ...LABEL_DEFAULT_NAMES })
    else {
      expect(names['rose-d']).toBe('紅')
      expect(Object.keys(options[id].readings)).toEqual(LABEL_KEYS)
      for (const r of Object.values(options[id].readings)) expect(r).toMatch(/^[ぁ-ゖー]+$/)
    }
  })

  // ■1・■2: 24色のどの2色も、今よりはっきり離れる（今はホワイト 0.031・ダーク 0.026。桜・淡と牡丹・淡）。青の仲間とピンクの仲間も
  it.each(SETS.flatMap((id) => THEMES.map((t) => [id, t])))(
    '%s（%s）: どの2色も今より離れ、青の仲間・ピンクの仲間も離れる',
    (id, theme) => {
      const mine = colorsOf(id, theme)
      const now = nowColors(theme)
      const floor = theme === 'deep-dark' ? 0.025 : 0.08
      expect(closestPair(now).d).toBeLessThan(theme === 'deep-dark' ? 0.01 : 0.035)
      expect(closestPair(mine).d).toBeGreaterThanOrEqual(floor)
      for (const [name, keys] of Object.entries(FAMILIES)) {
        expect(familyMin(mine, keys), `${name}の仲間`).toBeGreaterThanOrEqual(floor)
        expect(familyMin(mine, keys), `${name}の仲間`).toBeGreaterThan(1.5 * familyMin(now, keys))
      }
      // 色覚の違い（1型・2型）で見ても、今よりいちばん近い2色が離れる
      for (const type of ['protan', 'deutan'])
        expect(closestPair(mine, cvdDeltaE(type)).d, type).toBeGreaterThan(closestPair(now, cvdDeltaE(type)).d)
    },
  )

  it.each(SETS)('%s: 行ごとに1つの明るさではなく、色ごとに明るさと彩度が違う（同じ行・同じ色温度の中でも）', (id) => {
    for (const theme of ['white', 'dark']) {
      for (const row of ['l', 'd']) {
        const ls = LABEL_KEYS.filter((k) => k.endsWith(`-${row}`)).map((k) => LABEL_SETS[id].oklch[k][theme][0])
        expect(Math.max(...ls) - Math.min(...ls), `${theme} ${row}`).toBeGreaterThan(0.1)
        // 暖かい側（桜・珊瑚・杏・菜の花）と冷たい側（青磁・空・瑠璃・藤）のそれぞれの中でも、明るさが 0.03 以上違う
        for (const bases of [
          ['rose', 'coral', 'apricot', 'lemon'],
          ['teal', 'sky', 'blue', 'wisteria'],
        ]) {
          const group = bases.map((b) => LABEL_SETS[id].oklch[`${b}-${row}`][theme][0])
          expect(Math.max(...group) - Math.min(...group), `${theme} ${row} ${bases[0]}…`).toBeGreaterThan(0.03)
        }
      }
    }
  })

  it.each(SETS)('%s: 淡は同じ色合いの濃より明るく、色を選ぶ所の行は色合いの順のまま一回り', (id) => {
    for (const theme of THEMES) {
      const o = LABEL_SETS[id].oklch
      for (const base of LABEL_KEYS.slice(0, 12).map((k) => k.slice(0, -2)))
        expect(o[`${base}-l`][theme][0] - o[`${base}-d`][theme][0], `${theme} ${base}`).toBeGreaterThanOrEqual(
          theme === 'deep-dark' ? 0.09 : 0.1,
        )
      for (const row of ['l', 'd']) {
        const hs = LABEL_KEYS.filter((k) => k.endsWith(`-${row}`)).map((k) => o[k][theme][2])
        const gaps = hs.map((h, i) => hueGap(h, hs[(i + 1) % 12]))
        for (const g of gaps) expect(g, `${theme} ${row}`).toBeLessThan(180)
        expect(
          gaps.reduce((a, b) => a + b, 0),
          `${theme} ${row}`,
        ).toBe(360)
      }
    }
  })

  it.each(SETS)('%s: ギラつかない（彩度の上限）・ディープダークはほぼグレー・✓（--on-label）は 3:1 以上', (id) => {
    const limit = { white: 0.155, dark: id === 'labels-a' ? 0.14 : 0.155, 'deep-dark': 0.03 }
    for (const theme of THEMES) {
      for (const key of LABEL_KEYS) {
        const [, c] = LABEL_SETS[id].oklch[key][theme]
        expect(c, `${theme} ${key}`).toBeLessThanOrEqual(limit[theme])
        const hex = options[id].tokens[theme][`--label-${key}`]
        expect(contrast(hexOf(themes[theme], '--on-label'), hex), `${theme} ${key} の✓`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('色覚の違いの見え方: 白と黒はそのまま、赤と緑は1型・2型で近づく', () => {
    for (const type of ['protan', 'deutan']) {
      expect(cvdOklab('#ffffff', type)[0]).toBeCloseTo(1, 3)
      expect(cvdOklab('#000000', type)[0]).toBeCloseTo(0, 6)
      expect(cvdDeltaE(type)('#cc4444', '#448844')).toBeLessThan(deltaE('#cc4444', '#448844') / 2)
    }
    expect(closestPair(nowColors('dark'))).toMatchObject({ a: 'rose-l', b: 'peony-l' })
  })

  it('labels-a・labels-b は Q2 の hue30 と同じトークンを書き換えるので、一緒には選べない（Q11 の案とも）', () => {
    expect(() => pickTokens(variants, 'hue30,labels-a')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'labels-a,labels-b')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'labels-b,labels-c')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'hue30,labels-d')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'labels-c,labels-d')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'labels-c,labels-e')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'labels-e,labels-f')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'hue30,labels-c2')).toThrow(/両方/)
  })
})

describe('Q11: ラベルの24色に原色に近い色を入れる（labels-c・labels-d。Q9 の答え）', () => {
  const SETS = ['labels-c', 'labels-d']
  const BOTH = ['white', 'dark']
  /** その明るさと色合いで sRGB に入るいちばん大きな彩度（0.002 刻み） */
  const maxChroma = (L, h) => oklchToHex([L, 0.5, h]).chroma
  const row = (r) => LABEL_KEYS.filter((k) => k.endsWith(`-${r}`))
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const circ = (a, b) => Math.min(hueGap(a, b), hueGap(b, a))

  it('選ぶ物は A（見比べ用の前回の案A。Q9 と同じ labels-a）・C・D。Q9 は聞いた時のまま残す', () => {
    expect(QUESTIONS[11].appearances).toEqual(THEMES)
    expect(QUESTIONS[11].options.map((o) => [o.letter, o.id])).toEqual([
      ['A', 'labels-a'],
      ['C', 'labels-c'],
      ['D', 'labels-d'],
    ])
    expect(QUESTIONS[9].options.map((o) => [o.letter, o.id])).toEqual([
      ['A', 'labels-a'],
      ['B', 'labels-b'],
    ])
    // Q9・Q11 は、どれも選ばれず作り直した（ANSWERS の labels。見比べてもらった時の値の上で作ったまま残す）
    expect(ANSWERS[9]).toBe('labels')
    expect(ANSWERS[11]).toBe('labels')
  })

  it.each(SETS)(
    '%s: キーと並び・既定の呼び名は今のまま。3つの外観の24色を OKLCH の値からそのまま作り、切り詰めた原色（00・ff の成分）は無い',
    (id) => {
      const o = options[id]
      expect(o.question).toBe(11)
      expect(o.appearances).toEqual(THEMES)
      expect(o.names).toEqual({ ...LABEL_DEFAULT_NAMES })
      expect(Object.keys(LABEL_SETS[id].oklch)).toEqual(LABEL_KEYS)
      for (const theme of THEMES) {
        expect(Object.keys(o.tokens[theme])).toEqual(LABEL_KEYS.map((k) => `--label-${k}`))
        for (const key of LABEL_KEYS) {
          const made = oklchToHex(LABEL_SETS[id].oklch[key][theme])
          expect(made.clipped, `${theme} ${key}`).toBe(false)
          expect(o.tokens[theme][`--label-${key}`]).toBe(made.hex)
          for (const c of hexToRgb(made.hex).map((v) => Math.round(v * 255)))
            expect(c > 0 && c < 255, `${theme} ${key} ${made.hex}`).toBe(true)
        }
      }
    },
  )

  // Q9 の答え「パステルカラーだけだとぱっと見て違いが分かりづらい」: 24色のどの2色も、前回の案A よりはっきり離れる
  it.each(SETS.flatMap((id) => THEMES.map((t) => [id, t])))(
    '%s（%s）: どの2色も案A より離れ、青の仲間・ピンクの仲間・色覚の違い（1型・2型）で見ても案A より離れる',
    (id, theme) => {
      const mine = colorsOf(id, theme)
      const a = colorsOf('labels-a', theme)
      // ホワイトとダークは 0.01 以上（ΔE 0.095 ほど以上）、ほぼグレーのディープダークは案A より離れれば良い
      const margin = theme === 'deep-dark' ? 0 : 0.01
      expect(closestPair(mine).d).toBeGreaterThan(closestPair(a).d + margin)
      // 今（ホワイト 0.031・ダーク 0.026・ディープダーク 0.007）の 3倍以上
      expect(closestPair(mine).d).toBeGreaterThan(3 * closestPair(nowColors(theme)).d)
      for (const [name, keys] of Object.entries(FAMILIES))
        expect(familyMin(mine, keys), `${name}の仲間`).toBeGreaterThan(familyMin(a, keys))
      for (const type of ['protan', 'deutan'])
        expect(closestPair(mine, cvdDeltaE(type)).d, type).toBeGreaterThan(closestPair(a, cvdDeltaE(type)).d)
    },
  )

  it.each(SETS)(
    '%s: 濃は原色に近い（その明るさ・色合いで sRGB に入るいちばん鮮やかな所の 8割以上。行の彩度は案A の 1.3倍以上）',
    (id) => {
      const o = LABEL_SETS[id].oklch
      const a = LABEL_SETS['labels-a'].oklch
      for (const theme of BOTH) {
        for (const k of row('d')) {
          const [L, c, h] = o[k][theme]
          expect(c / maxChroma(L, h), `${theme} ${k}`).toBeGreaterThanOrEqual(0.8)
        }
        const cs = (set) => mean(row('d').map((k) => set[k][theme][1]))
        expect(cs(o), theme).toBeGreaterThan(1.3 * cs(a))
        // ダークの濃は明るすぎない（暗い地の上で光らない）
        for (const k of row('d')) expect(o[k][theme][0], `${theme} ${k}`).toBeLessThanOrEqual(theme === 'dark' ? 0.85 : 0.75)
      }
    },
  )

  it('labels-c: 淡はやわらかいがはっきりした色（白みのある色。sRGB のいちばん小さな成分が 0.28 以上）、濃は白みの少ない色', () => {
    const o = LABEL_SETS['labels-c'].oklch
    for (const theme of BOTH) {
      for (const k of row('l')) {
        const hex = options['labels-c'].tokens[theme][`--label-${k}`]
        expect(Math.min(...hexToRgb(hex)), `${theme} ${k}`).toBeGreaterThanOrEqual(0.28)
        expect(o[k][theme][1], `${theme} ${k}`).toBeGreaterThanOrEqual(0.08)
      }
      for (const k of row('d')) {
        const hex = options['labels-c'].tokens[theme][`--label-${k}`]
        expect(Math.min(...hexToRgb(hex)), `${theme} ${k}`).toBeLessThanOrEqual(0.4)
      }
      // ダークの濃は彩度 0.215 まで（光りすぎない）
      for (const k of row('d')) expect(o[k].dark[1], k).toBeLessThanOrEqual(0.215)
    }
  })

  it('labels-d: 淡も彩度の高いままの色（彩度 0.1 以上・その明るさで入るいちばん鮮やかな所の 7割以上）', () => {
    const o = LABEL_SETS['labels-d'].oklch
    for (const theme of BOTH)
      for (const k of row('l')) {
        const [L, c, h] = o[k][theme]
        expect(c, `${theme} ${k}`).toBeGreaterThanOrEqual(0.1)
        expect(c / maxChroma(L, h), `${theme} ${k}`).toBeGreaterThanOrEqual(0.7)
      }
  })

  it.each(SETS)(
    '%s: 淡は同じ色合いの濃より明るく（案D は明るさ 0.12 以上）、12の色合いの仲間と色を選ぶ所の並びは今のまま',
    (id) => {
      const o = LABEL_SETS[id].oklch
      const floor = id === 'labels-d' ? 0.12 : 0.1
      for (const theme of THEMES) {
        for (const base of row('l').map((k) => k.slice(0, -2))) {
          const dL = o[`${base}-l`][theme][0] - o[`${base}-d`][theme][0]
          expect(dL, `${theme} ${base}`).toBeGreaterThanOrEqual(floor - 1e-9)
          // 16進にしても淡の方が明るい
          const hex = (k) => options[id].tokens[theme][`--label-${k}`]
          expect(lightness(hex(`${base}-l`)) - lightness(hex(`${base}-d`)), `${theme} ${base}`).toBeGreaterThan(floor - 0.01)
        }
        for (const r of ['l', 'd']) expect(hueRoundTrip(o, theme, r), `${theme} ${r}`).toBe(true)
      }
      // ホワイトとダークの色合いは、答える前の12の色合い（HUES_ASKED）から 25° 以内（桜は桜、菜の花は黄、瑠璃は青のまま）
      for (const theme of BOTH)
        for (const r of ['l', 'd'])
          row(r).forEach((k, i) => expect(circ(o[k][theme][2], HUES_ASKED[i]), `${theme} ${k}`).toBeLessThanOrEqual(25))
    },
  )

  it.each(SETS)('%s: ディープダークはほぼグレー（彩度 0.03 以下）、✓（--on-label）はどの外観も 3:1 以上', (id) => {
    for (const theme of THEMES)
      for (const key of LABEL_KEYS) {
        const hex = options[id].tokens[theme][`--label-${key}`]
        if (theme === 'deep-dark') {
          expect(LABEL_SETS[id].oklch[key][theme][1], key).toBeLessThanOrEqual(0.03)
          expect(chromaOf(hex), key).toBeLessThanOrEqual(0.031)
        }
        expect(contrast(hexOf(themes[theme], '--on-label'), hex), `${theme} ${key} の✓`).toBeGreaterThanOrEqual(3)
      }
  })

  it('選んだ時の書き出し: 既定の呼び名は今のまま（桜・淡 … 牡丹・濃）、仕様書の表の行も今の呼び名', () => {
    for (const id of SETS) {
      expect(pickNames(variants, id)).toEqual({ ...LABEL_DEFAULT_NAMES })
      const lines = emitSpec(variants, id, css).trim().split('\n')
      const tok = options[id].tokens
      expect(lines[2]).toBe(
        `| 1 | \`rose-l\` | 桜・淡 | \`${tok.white['--label-rose-l']}\` | \`${tok.dark['--label-rose-l']}\` | \`${tok['deep-dark']['--label-rose-l']}\` |`,
      )
      expect(lines[25]).toMatch(/^\| 24 \| `peony-d` \| 牡丹・濃 \|/)
      expect(emitCss(variants, id)).toContain(`  --label-lemon-d: ${tok.white['--label-lemon-d']};`)
    }
  })
})

describe('Q12: ラベルの24色（はっきりからくすみまで・ホワイトもダークと同じ色。Q11 の答え）', () => {
  const SETS = ['labels-c2', 'labels-e', 'labels-f']
  /** ホワイトとダークにまったく同じ24色を置く案（案C′ はホワイトで明るさを下げる淡の6色だけ違う） */
  const SAME = ['labels-e', 'labels-f']
  const BOTH = ['white', 'dark']
  const maxChroma = (L, h) => oklchToHex([L, 0.5, h]).chroma
  const row = (r) => LABEL_KEYS.filter((k) => k.endsWith(`-${r}`))
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
  const circ = (a, b) => Math.min(hueGap(a, b), hueGap(b, a))
  const lch = (id) => LABEL_SETS[id].oklch
  /** その明るさと色合いで sRGB に入るいちばん鮮やかな所に対する彩度の割合（はっきり 1・くすみ 0 に近い） */
  const vivid = (id, k, theme = 'white') => {
    const [L, c, h] = lch(id)[k][theme]
    return c / maxChroma(L, h)
  }
  const KIND_GROUNDS = ['--work-soft', '--private-soft', '--work-area', '--private-area', '--work-sheet', '--private-sheet']

  it('選ぶ物は C（案C′）・E・F。Q9・Q11 は聞いた時のまま残す', () => {
    expect(QUESTIONS[12].appearances).toEqual(THEMES)
    expect(QUESTIONS[12].options.map((o) => [o.letter, o.id])).toEqual([
      ['C', 'labels-c2'],
      ['E', 'labels-e'],
      ['F', 'labels-f'],
    ])
    expect(QUESTIONS[11].options.map((o) => o.id)).toEqual(['labels-a', 'labels-c', 'labels-d'])
    expect(QUESTIONS[9].options.map((o) => o.id)).toEqual(['labels-a', 'labels-b'])
    // Q9・Q11・Q12 は、どれも選ばれず作り直した（ANSWERS の labels）
    for (const q of [9, 11, 12]) expect(ANSWERS[q], String(q)).toBe('labels')
  })

  it.each(SETS)(
    '%s: キーと並び・既定の呼び名は今のまま。3つの外観の24色を OKLCH の値からそのまま作る（sRGB に入らない値は無い）',
    (id) => {
      const o = options[id]
      expect(o.question).toBe(12)
      expect(o.appearances).toEqual(THEMES)
      expect(o.names).toEqual({ ...LABEL_DEFAULT_NAMES })
      expect(Object.keys(lch(id))).toEqual(LABEL_KEYS)
      for (const theme of THEMES) {
        expect(Object.keys(o.tokens[theme])).toEqual(LABEL_KEYS.map((k) => `--label-${k}`))
        for (const key of LABEL_KEYS) {
          const made = oklchToHex(lch(id)[key][theme])
          expect(made.clipped, `${theme} ${key}`).toBe(false)
          expect(o.tokens[theme][`--label-${key}`]).toBe(made.hex)
        }
      }
    },
  )

  it.each(SAME)('%s: ホワイトとダークは同じ24色（OKLCH の値も16進も）', (id) => {
    for (const key of LABEL_KEYS) {
      expect(lch(id)[key].white, key).toEqual(lch(id)[key].dark)
      expect(options[id].tokens.white[`--label-${key}`], key).toBe(options[id].tokens.dark[`--label-${key}`])
    }
  })

  it('labels-c2: ダークは案C のダークのまま、ホワイトも同じ色。ホワイトで決まりを割る淡の6色だけ、明るさだけを下げる', () => {
    const c = LABEL_SETS['labels-c'].oklch
    const surface = hexOf(themes.white, '--surface')
    const grounds = KIND_GROUNDS.map((g) => lightness(hexOf(themes.white, g)))
    /** ホワイトの決まり: 面の上の 4px の縁が 1.6:1 以上、区分の地との明るさの差が 0.1 以上 */
    const fitsWhite = (hex) => contrast(hex, surface) >= 1.6 && grounds.every((g) => Math.abs(lightness(hex) - g) >= 0.1)
    expect(Object.keys(C2_WHITE_L)).toEqual(['apricot-l', 'lemon-l', 'lime-l', 'teal-l', 'sky-l', 'violet-l'])
    for (const key of LABEL_KEYS) {
      const [L, C, h] = c[key].dark
      expect(lch('labels-c2')[key].dark, key).toEqual([L, C, h])
      expect(options['labels-c2'].tokens.dark[`--label-${key}`]).toBe(options['labels-c'].tokens.dark[`--label-${key}`])
      const darkHex = oklchToHex([L, C, h]).hex
      if (key in C2_WHITE_L) {
        // 案C のダークの値のままではホワイトで決まりを割る（菜の花・淡は白い地とほぼ同じ明るさ）。色合いと彩度はそのまま、明るさだけ下げる
        expect(fitsWhite(darkHex), key).toBe(false)
        expect(lch('labels-c2')[key].white, key).toEqual([C2_WHITE_L[key], C, h])
        expect(C2_WHITE_L[key], key).toBeLessThan(L)
        expect(fitsWhite(options['labels-c2'].tokens.white[`--label-${key}`]), key).toBe(true)
      } else {
        expect(lch('labels-c2')[key].white, key).toEqual([L, C, h])
        expect(fitsWhite(darkHex), key).toBe(true)
      }
    }
  })

  it.each(SETS)('%s: ディープダークは案C のディープダークのまま（ほぼグレー、彩度 0.03 以下）', (id) => {
    for (const key of LABEL_KEYS) {
      expect(lch(id)[key]['deep-dark'], key).toEqual(LABEL_SETS['labels-c'].oklch[key]['deep-dark'])
      expect(lch(id)[key]['deep-dark'][1], key).toBeLessThanOrEqual(0.03)
      expect(chromaOf(options[id].tokens['deep-dark'][`--label-${key}`]), key).toBeLessThanOrEqual(0.031)
    }
  })

  it.each(SETS)(
    '%s: ✓（--on-label は今のまま）はどの外観も 3:1 以上、4px の縁はホワイトの面の上で 1.6:1・ダークの面の上で 2.5:1 以上',
    (id) => {
      for (const theme of THEMES)
        for (const key of LABEL_KEYS) {
          const hex = options[id].tokens[theme][`--label-${key}`]
          expect(contrast(hexOf(themes[theme], '--on-label'), hex), `${theme} ${key} の✓`).toBeGreaterThanOrEqual(3)
          if (theme !== 'deep-dark')
            expect(contrast(hexOf(themes[theme], '--surface'), hex), `${theme} ${key} の縁`).toBeGreaterThanOrEqual(
              theme === 'white' ? 1.6 : 2.5,
            )
        }
    },
  )

  // 「もっとはっきりさせて、はっきりから、くすんだ系統までレンジをもっと」: くすんだ色は互いに近いので、どの2色も ΔE 0.08 以上（案A ほど）
  it.each(SAME.flatMap((id) => BOTH.map((t) => [id, t])))(
    '%s（%s）: どの2色も ΔE 0.08 以上、青の仲間・ピンクの仲間も。色覚の違い（1型・2型）で見ても案A より離れる',
    (id, theme) => {
      const mine = colorsOf(id, theme)
      const a = colorsOf('labels-a', theme)
      expect(closestPair(mine).d).toBeGreaterThanOrEqual(0.08)
      for (const [name, keys] of Object.entries(FAMILIES))
        expect(familyMin(mine, keys), `${name}の仲間`).toBeGreaterThanOrEqual(0.08)
      for (const type of ['protan', 'deutan'])
        expect(closestPair(mine, cvdDeltaE(type)).d, type).toBeGreaterThan(closestPair(a, cvdDeltaE(type)).d)
    },
  )

  it('labels-c2: ダークは案C と同じだけ離れる。ホワイトは明るさを下げた淡が近づく（今よりは離れる）', () => {
    expect(closestPair(colorsOf('labels-c2', 'dark')).d).toBeCloseTo(closestPair(colorsOf('labels-c', 'dark')).d, 6)
    const white = closestPair(colorsOf('labels-c2', 'white'))
    expect(white.d).toBeGreaterThan(closestPair(nowColors('white')).d)
    expect(white.d).toBeLessThan(closestPair(colorsOf('labels-c', 'white')).d)
  })

  it.each(SAME)(
    '%s: 24色が、はっきりした色（いちばん鮮やかな所の 9割以上）からくすんだ色（3割ほど）までに広がる（案C より広い）',
    (id) => {
      const range = (set, theme) => LABEL_KEYS.map((k) => vivid(set, k, theme))
      const mine = range(id, 'white')
      expect(Math.max(...mine)).toBeGreaterThanOrEqual(0.9)
      expect(Math.min(...mine)).toBeLessThanOrEqual(0.31)
      for (const theme of BOTH) {
        const c = range('labels-c', theme)
        expect(Math.max(...mine) - Math.min(...mine), theme).toBeGreaterThan(Math.max(...c) - Math.min(...c) + 0.2)
      }
    },
  )

  it('labels-e: 濃は原色に近い（いちばん鮮やかな所の 85% 以上、行の彩度は案C より高い）、淡はくすんだ色（彩度 0.12 以下・7割ほどまで）', () => {
    const o = lch('labels-e')
    for (const k of row('d')) expect(vivid('labels-e', k), k).toBeGreaterThanOrEqual(0.85)
    for (const theme of BOTH)
      expect(mean(row('d').map((k) => o[k].white[1])), theme).toBeGreaterThan(
        mean(row('d').map((k) => LABEL_SETS['labels-c'].oklch[k][theme][1])),
      )
    for (const k of row('l')) {
      expect(o[k].white[1], k).toBeLessThanOrEqual(0.12)
      expect(vivid('labels-e', k), k).toBeLessThanOrEqual(0.72)
    }
    // いちばんくすんだ淡（杏・瑠璃・青磁）は彩度 0.05 以下
    expect(Math.min(...row('l').map((k) => o[k].white[1]))).toBeLessThanOrEqual(0.05)
    // 濃は暗い地の上で光りすぎない（彩度 0.26 まで）
    for (const k of row('d')) expect(o[k].white[1], k).toBeLessThanOrEqual(0.26)
  })

  it('labels-f: 淡は明るくはっきりした色（いちばん鮮やかな所の 75% 以上・彩度 0.115 以上）、濃は深くくすんだ色（彩度 0.11 以下・56% まで）', () => {
    const o = lch('labels-f')
    for (const k of row('l')) {
      expect(vivid('labels-f', k), k).toBeGreaterThanOrEqual(0.75)
      expect(o[k].white[1], k).toBeGreaterThanOrEqual(0.115)
    }
    for (const k of row('d')) {
      expect(o[k].white[1], k).toBeLessThanOrEqual(0.11)
      expect(vivid('labels-f', k), k).toBeLessThanOrEqual(0.56)
    }
  })

  it.each(SETS)(
    '%s: 淡は同じ色合いの濃より明るく（案F は明るさ 0.1 以上）、12の色合いの仲間と色を選ぶ所の並びは今のまま',
    (id) => {
      const o = lch(id)
      const floor = id === 'labels-f' ? 0.1 : 0.02
      for (const theme of THEMES) {
        for (const base of row('l').map((k) => k.slice(0, -2))) {
          const dL = o[`${base}-l`][theme][0] - o[`${base}-d`][theme][0]
          expect(dL, `${theme} ${base}`).toBeGreaterThanOrEqual((theme === 'deep-dark' ? 0.09 : floor) - 1e-9)
          const hex = (k) => options[id].tokens[theme][`--label-${k}`]
          expect(lightness(hex(`${base}-l`)), `${theme} ${base}`).toBeGreaterThan(lightness(hex(`${base}-d`)))
        }
        for (const r of ['l', 'd']) expect(hueRoundTrip(o, theme, r), `${theme} ${r}`).toBe(true)
      }
      // 色合いは答える前の12の色合い（HUES_ASKED）から 25° 以内（桜は桜、菜の花は黄、瑠璃は青のまま）
      for (const theme of BOTH)
        for (const r of ['l', 'd'])
          row(r).forEach((k, i) => expect(circ(o[k][theme][2], HUES_ASKED[i]), `${theme} ${k}`).toBeLessThanOrEqual(25))
    },
  )

  it('切り詰めた原色（00・ff の成分）は、案C′・案E には無い（案F は 瑠璃・淡 の青だけが ff。明るい青で、光らない）', () => {
    const touching = (id) =>
      THEMES.flatMap((theme) =>
        LABEL_KEYS.filter((k) =>
          hexToRgb(options[id].tokens[theme][`--label-${k}`])
            .map((v) => Math.round(v * 255))
            .some((c) => c === 0 || c === 255),
        ).map((k) => `${theme} ${k}`),
      )
    expect(touching('labels-c2')).toEqual([])
    expect(touching('labels-e')).toEqual([])
    expect(touching('labels-f')).toEqual(['white blue-l', 'dark blue-l'])
  })

  it('選んだ時の書き出し: 既定の呼び名は今のまま（桜・淡 … 牡丹・濃）、仕様書の表の行はホワイトとダークが同じ値', () => {
    for (const id of SETS) {
      expect(pickNames(variants, id)).toEqual({ ...LABEL_DEFAULT_NAMES })
      const lines = emitSpec(variants, id, css).trim().split('\n')
      expect(lines).toHaveLength(2 + 24)
      expect(lines[25]).toMatch(/^\| 24 \| `peony-d` \| 牡丹・濃 \|/)
      const tok = options[id].tokens
      expect(lines[13]).toBe(
        `| 12 | \`peony-l\` | 牡丹・淡 | \`${tok.white['--label-peony-l']}\` | \`${tok.dark['--label-peony-l']}\` | \`${tok['deep-dark']['--label-peony-l']}\` |`,
      )
      expect(tok.white['--label-peony-l']).toBe(tok.dark['--label-peony-l'])
    }
  })
})

describe('Q13: ラベルの24色（蛍光色からくすみまで。labels-g。Q12 の答え）', () => {
  const ID = 'labels-g'
  const BOTH = ['white', 'dark']
  const o = () => LABEL_SETS[ID].oklch
  const hex = (theme, k) => options[ID].tokens[theme][`--label-${k}`]
  const row = (r) => LABEL_KEYS.filter((k) => k.endsWith(`-${r}`))
  const circ = (a, b) => Math.min(hueGap(a, b), hueGap(b, a))
  /** その明るさと色合いで sRGB に入るいちばん鮮やかな所の彩度 */
  const maxChroma = (L, h) => oklchToHex([L, 0.5, h]).chroma
  /** その色合いで sRGB に入るいちばん鮮やかな所（明るさを 0.002 おきに見る）の彩度 */
  const cuspChroma = (h) => {
    let m = 0
    for (let L = 0.3; L <= 0.999; L += 0.002) m = Math.max(m, maxChroma(L, h))
    return m
  }
  const vivid = (k) => {
    const [L, c, h] = o()[k].white
    return c / maxChroma(L, h)
  }
  const bright = BRIGHT_WHITE[ID]
  const whiteGrounds = BRIGHT_WHITE_GROUNDS.map((g) => hexOf(themes.white, g))
  const kindL = ['--work-soft', '--private-soft', '--work-area', '--private-area', '--work-sheet', '--private-sheet'].map((g) =>
    lightness(hexOf(themes.white, g)),
  )

  it('選ぶ物は E（前回の案E）・G（案G）。Q9・Q11・Q12 は聞いた時のまま残す。答えは G（「案Gで」）', () => {
    expect(QUESTIONS[13].title).toBe('ラベルの24色（蛍光色からくすみまで）')
    expect(QUESTIONS[13].appearances).toEqual(THEMES)
    expect(QUESTIONS[13].options.map((x) => [x.letter, x.id])).toEqual([
      ['E', 'labels-e'],
      ['G', 'labels-g'],
    ])
    expect(QUESTIONS[12].options.map((x) => x.id)).toEqual(['labels-c2', 'labels-e', 'labels-f'])
    expect(options['labels-e'].question).toBe(12)
    expect(options[ID]).toMatchObject({ question: 13, letter: 'G', appearances: THEMES })
    for (const q of [9, 11, 12]) expect(ANSWERS[q], String(q)).toBe('labels')
    expect(ANSWERS[13]).toBe('labels-g')
  })

  it('キーと並び・既定の呼び名は今のまま。3つの外観の24色を OKLCH の値からそのまま作る（sRGB に入らない値・切り詰めた値は無い）', () => {
    expect(options[ID].names).toEqual({ ...LABEL_DEFAULT_NAMES })
    expect(Object.keys(o())).toEqual(LABEL_KEYS)
    for (const theme of THEMES) {
      expect(Object.keys(options[ID].tokens[theme])).toEqual(LABEL_KEYS.map((k) => `--label-${k}`))
      for (const k of LABEL_KEYS) {
        const made = oklchToHex(o()[k][theme])
        expect(made.clipped, `${theme} ${k}`).toBe(false)
        expect(hex(theme, k)).toBe(made.hex)
      }
    }
  })

  it('ホワイトとダークは同じ24色（OKLCH の値も16進も。蛍光の黄もホワイトで暗くしない）', () => {
    for (const k of LABEL_KEYS) {
      expect(o()[k].white, k).toEqual(o()[k].dark)
      expect(hex('white', k), k).toBe(hex('dark', k))
    }
    expect(hex('white', 'lemon-d')).toBe('#feff01')
  })

  it('ディープダークは案C のディープダークのまま（ほぼグレー、彩度 0.03 以下）', () => {
    for (const k of LABEL_KEYS) {
      expect(o()[k]['deep-dark'], k).toEqual(LABEL_SETS['labels-c'].oklch[k]['deep-dark'])
      expect(chromaOf(hex('deep-dark', k)), k).toBeLessThanOrEqual(0.031)
    }
    expect(colorsOf(ID, 'deep-dark')).toEqual(colorsOf('labels-e', 'deep-dark'))
  })

  it('蛍光の7色（黄・ピンク・青・緑・オレンジ・赤・紫）は濃の行にあり、その色合いで sRGB に入るいちばん鮮やかな所の 95% 以上', () => {
    expect(FLUORESCENT).toEqual({
      'coral-d': '赤',
      'apricot-d': 'オレンジ',
      'lemon-d': '黄',
      'mint-d': '緑',
      'sky-d': '青',
      'violet-d': '紫',
      'peony-d': 'ピンク',
    })
    for (const k of Object.keys(FLUORESCENT)) {
      const [L, c, h] = o()[k].white
      expect(c / cuspChroma(h), k).toBeGreaterThanOrEqual(0.95)
      expect(c / maxChroma(L, h), k).toBeGreaterThanOrEqual(0.95)
    }
    // 6色は成分に 00 か ff が出る（光る原色）。青は角のすぐ内側（#06acfe）
    const corner = Object.keys(FLUORESCENT).filter((k) =>
      hexToRgb(hex('white', k))
        .map((v) => Math.round(v * 255))
        .some((x) => x === 0 || x === 255),
    )
    expect(corner).toEqual(['coral-d', 'apricot-d', 'lemon-d', 'mint-d', 'violet-d', 'peony-d'])
    // 黄は #ffff00 にほぼ等しい（金色にしない）
    expect(channelDiff(hex('white', 'lemon-d'), '#ffff00')).toBeLessThanOrEqual(2)
  })

  it('段: 蛍光 → はっきり（残りの濃の5色）→ やわらか（淡の7色）→ くすみ（淡の5色）。段の間はどれも前の段より鮮やかさが低い', () => {
    expect(LADDER_NAMES).toEqual({ fluorescent: '蛍光', vivid: 'はっきり', soft: 'やわらか', dusty: 'くすみ' })
    const tiers = Object.values(LABEL_LADDER)
    expect(tiers.flat().sort()).toEqual([...LABEL_KEYS].sort())
    expect(LABEL_LADDER.fluorescent).toEqual(Object.keys(FLUORESCENT))
    expect([...LABEL_LADDER.fluorescent, ...LABEL_LADDER.vivid].sort()).toEqual(row('d').sort())
    expect([...LABEL_LADDER.soft, ...LABEL_LADDER.dusty].sort()).toEqual(row('l').sort())
    const range = (keys) => [Math.min(...keys.map(vivid)), Math.max(...keys.map(vivid))]
    const [f, v, s, d] = tiers.map(range)
    expect(f[0]).toBeGreaterThanOrEqual(0.95)
    expect(v[0]).toBeGreaterThanOrEqual(0.7)
    expect(v[1]).toBeLessThanOrEqual(0.9)
    expect(s[0]).toBeGreaterThanOrEqual(0.38)
    expect(s[1]).toBeLessThan(v[0])
    expect(d[1]).toBeLessThan(s[0])
    // くすみは灰みの色まで（彩度 0.08 以下。灰みの桜・瑠璃は 0.02 以下）
    for (const k of LABEL_LADDER.dusty) expect(o()[k].white[1], k).toBeLessThanOrEqual(0.08)
    expect(Math.min(...LABEL_LADDER.dusty.map((k) => o()[k].white[1]))).toBeLessThanOrEqual(0.02)
    // 12の色合いの仲間のどれにも、蛍光かはっきりの濃が1色ある
    expect(row('d').every((k) => LABEL_LADDER.fluorescent.includes(k) || LABEL_LADDER.vivid.includes(k))).toBe(true)
  })

  it('12の色合いの仲間と色を選ぶ所の並びは今のまま（今の色合いから 25° 以内）。淡は濃より明るい（蛍光の黄・緑の仲間だけは淡の方が暗い）', () => {
    for (const theme of THEMES) for (const r of ['l', 'd']) expect(hueRoundTrip(o(), theme, r), `${theme} ${r}`).toBe(true)
    for (const r of ['l', 'd']) row(r).forEach((k, i) => expect(circ(o()[k].white[2], HUES_ASKED[i]), k).toBeLessThanOrEqual(25))
    const darker = row('l')
      .map((k) => k.slice(0, -2))
      .filter((b) => lightness(hex('white', `${b}-l`)) <= lightness(hex('white', `${b}-d`)))
    expect(darker).toEqual(['lemon', 'mint'])
    for (const b of darker) expect(`${b}-d` in FLUORESCENT, b).toBe(true)
    // ディープダークは今のまま、淡が濃より明るい
    for (const b of row('l').map((k) => k.slice(0, -2)))
      expect(lightness(hex('deep-dark', `${b}-l`)), b).toBeGreaterThan(lightness(hex('deep-dark', `${b}-d`)))
  })

  it('✓（--on-label は今のまま）はどの外観も 3:1 以上。4px の縁はダークの面の上で 2.5:1、ホワイトの面の上で 1.6:1 以上（例外の2色を除く）', () => {
    for (const theme of THEMES)
      for (const k of LABEL_KEYS)
        expect(contrast(hexOf(themes[theme], '--on-label'), hex(theme, k)), `${theme} ${k} の✓`).toBeGreaterThanOrEqual(3)
    for (const k of LABEL_KEYS) {
      expect(contrast(hexOf(themes.dark, '--surface'), hex('dark', k)), `dark ${k}`).toBeGreaterThanOrEqual(2.5)
      const edge = contrast(hexOf(themes.white, '--surface'), hex('white', k))
      if (bright.includes(k)) expect(edge, `white ${k}`).toBeLessThan(1.6)
      else expect(edge, `white ${k}`).toBeGreaterThanOrEqual(1.6)
    }
  })

  it('ホワイトの例外は、白い地より明るい蛍光の黄・緑（菜の花・濃・ミント・濃）だけ。白い地の10色のどれとも ΔE 0.15 以上', () => {
    expect(BRIGHT_WHITE).toEqual({ 'labels-g': ['lemon-d', 'mint-d'] })
    expect(BRIGHT_WHITE_MIN_DE).toBe(0.15)
    expect(BRIGHT_WHITE_GROUNDS).toEqual([
      '--surface',
      '--surface-2',
      '--stripe',
      '--work-soft',
      '--work-area',
      '--work-sheet',
      '--private-soft',
      '--private-area',
      '--private-sheet',
      '--done-bg',
    ])
    for (const k of LABEL_KEYS) {
      const c = hex('white', k)
      const fails = kindL.some((g) => Math.abs(lightness(c) - g) < 0.1)
      // 例外のキーは、区分の地との明るさの差 0.1 に届かない（例外が要る）。ほかのキーは届く
      expect(fails, k).toBe(bright.includes(k))
      if (bright.includes(k)) {
        expect(k in FLUORESCENT, k).toBe(true)
        // 白い地（L 0.93〜1）に近い明るさ（ふつうの淡より明るい）
        expect(lightness(c), k).toBeGreaterThan(Math.max(...row('l').map((x) => lightness(hex('white', x)))))
        for (const g of whiteGrounds) expect(deltaE(g, c), `${k} ${g}`).toBeGreaterThanOrEqual(0.15)
      }
    }
    // ホワイトのラベルなしの線との ΔE 0.06 は、例外の2色にもそのまま
    for (const line of ['--work-line', '--private-line'])
      for (const k of bright) expect(deltaE(hexOf(themes.white, line), hex('white', k))).toBeGreaterThanOrEqual(0.06)
  })

  it('checkTheme の例外は、ホワイトの、名指ししたキーだけ（ダーク・ほかのキー・ほかの決まりは緩めない）', () => {
    const white = withTokens(themes.white, options[ID].tokens.white)
    // 例外なしでは、菜の花・濃とミント・濃の明るさの差だけを割る
    const plain = checkTheme('white', white)
    expect(plain.length).toBeGreaterThan(0)
    expect(
      plain.every((p) => /明るさの差/.test(p) && /--label-(lemon|mint)-d /.test(p)),
      plain.join('\n'),
    ).toBe(true)
    expect(checkTheme('white', white, { bright })).toEqual([])
    // 名指ししないキーに同じ値を置くと割る
    const moved = withTokens(white, { '--label-lemon-l': hex('white', 'lemon-d') })
    expect(checkTheme('white', moved, { bright }).join('\n')).toMatch(/--label-lemon-l の明るさの差/)
    // 白い地に近すぎる蛍光色は、例外のキーでも割る（ΔE 0.15）
    const faint = withTokens(white, { '--label-lemon-d': '#fffde0' })
    expect(checkTheme('white', faint, { bright }).join('\n')).toMatch(/--surface \/ --label-lemon-d の ΔE/)
    // ダークでは例外を使わない（ダークの地の上では蛍光色もふつうの決まりを満たす）
    const dark = withTokens(themes.dark, options[ID].tokens.dark)
    expect(checkTheme('dark', dark)).toEqual([])
    const darkBad = withTokens(dark, { '--label-lemon-d': hexOf(themes.dark, '--work-soft') })
    expect(checkTheme('dark', darkBad, { bright }).join('\n')).toMatch(/--label-lemon-d の明るさの差/)
  })

  it('checkPick: 案G をホワイトに選んだ時だけ例外を使う（ほかの案に例外は無い）', () => {
    expect(checkPick(variants, 'labels-g', css)).toEqual([])
    expect(checkPick(variants, 'labels-g@white', css)).toEqual([])
    expect(checkPick(variants, 'labels-g@dark+deep-dark', css)).toEqual([])
    expect(checkPick(variants, 'depth-lighter,labels-g', css)).toEqual([])
    // ラベルを選び直さない時・ホワイトのラベルを替えない時は、今の値（案G）のホワイトの例外のまま
    expect(checkPick(variants, '', css)).toEqual([])
    expect(checkPick(variants, 'labels-e@dark+deep-dark', css)).toEqual([])
    // ホワイトの24色を例外の無い案で書き換えると、例外は外れる（案E の値はふつうの決まりで通る）
    expect(checkPick(variants, 'labels-e', css)).toEqual([])
    // 案G の値を例外の無い案として選ぶと割る
    const copy = { ...variants, options: { ...options, copy: { ...options[ID] } } }
    expect(checkPick(copy, 'copy', css).join('\n')).toMatch(/--label-lemon-d の明るさの差/)
    expect(() => pickTokens(variants, 'labels-e,labels-g')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'hue30,labels-g')).toThrow(/両方/)
  })

  it.each(BOTH)(
    '%s: どの2色も ΔE 0.09 以上（案E より離れる）、青の仲間・ピンクの仲間も。色覚の違い（1型・2型）で見ても案E より離れる',
    (theme) => {
      const mine = colorsOf(ID, theme)
      const e = colorsOf('labels-e', theme)
      expect(closestPair(mine).d).toBeGreaterThanOrEqual(0.09)
      expect(closestPair(mine).d).toBeGreaterThan(closestPair(e).d)
      for (const [name, keys] of Object.entries(FAMILIES))
        expect(familyMin(mine, keys), `${name}の仲間`).toBeGreaterThanOrEqual(0.09)
      for (const type of ['protan', 'deutan'])
        expect(closestPair(mine, cvdDeltaE(type)).d, type).toBeGreaterThan(closestPair(e, cvdDeltaE(type)).d)
    },
  )

  it('選んだ時の書き出し: 既定の呼び名は今のまま、仕様書の表の行はホワイトとダークが同じ値', () => {
    expect(pickNames(variants, ID)).toEqual({ ...LABEL_DEFAULT_NAMES })
    const lines = emitSpec(variants, ID, css).trim().split('\n')
    expect(lines).toHaveLength(2 + 24)
    expect(lines[17]).toBe(`| 16 | \`lemon-d\` | 菜の花・濃 | \`#feff01\` | \`#feff01\` | \`${hex('deep-dark', 'lemon-d')}\` |`)
    expect(options[ID].notes.join('\n')).toMatch(/菜の花・濃 0\.2\d\d・ミント・濃 0\.2\d\d/)
  })
})

describe('選んだ案を書く形にする（段階2の終わりの --emit css|spec|names --pick）', () => {
  it('pickTokens: 案と外観を選び、同じトークンを2つの案が書き換える時は止める', () => {
    const all = pickTokens(variants, 'hue30')
    for (const t of THEMES) expect(Object.keys(all[t])).toHaveLength(24)
    const one = pickTokens(variants, 'depth-deeper@white,depth-lighter@dark+deep-dark')
    expect(one.white).toEqual(options['depth-deeper'].tokens.white)
    expect(one.dark).toEqual(options['depth-lighter'].tokens.dark)
    expect(one['deep-dark']).toEqual(options['depth-lighter'].tokens['deep-dark'])
    expect(() => pickTokens(variants, 'depth-deeper,depth-lighter')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'nope')).toThrow(/知らない案/)
    expect(() => pickTokens(variants, 'hue30@sepia')).toThrow(/知らない外観/)
    // その外観を変えない案を、その外観に選んだ時（Q5 B はダークを変えない）は、黙って何もしないのではなく止める
    expect(() => pickTokens(variants, 'weekend-matched@dark')).toThrow(/ダーク.*変えません/)
    expect(() => pickTokens(variants, 'highlight-full@deep-dark')).toThrow(/ディープダーク.*変えません/)
  })

  // 答えた問い（Q3〜Q6・Q13）は答えの値のまま（今の src/styles.css。ラベルの24色は案G）。ラベルの24色の案（今の案G のまま・Q9 の案A・案B・
  // Q11 の案C・案D・Q12 の案C′・案E・案F・Q13 の案G）は、どれを選び直しても、答えを入れた今の値の上で決まりを満たす（--emit css --pick labels-c
  // などをそのまま入れられる。案G はホワイトの蛍光の黄・緑の例外 BRIGHT_WHITE を使い、選び直さない時は今の値の例外 ANSWERED_BRIGHT のまま）
  it.each(THEMES)(
    '%s: ラベルの24色（Q9・Q11・Q12・Q13）のどれを選んでも、答えを入れた今の値の上で決まりを満たす（checkPick）',
    (theme) => {
      for (const pick of ['', 'labels-a', 'labels-b', 'labels-c', 'labels-d', 'labels-c2', 'labels-e', 'labels-f', 'labels-g'])
        expect(checkPick(variants, pick, css), `${theme}: ${pick}`).toEqual([])
    },
  )

  it('checkPick: 選んだ値が決まりを割る時は、その文を返す（--emit はそれを出して止まる）', () => {
    const bad = {
      ...variants,
      options: {
        ...options,
        bad: { ...options.hue30, tokens: { white: { '--text-faint': '#9a9a9a' } }, appearances: ['white'] },
      },
    }
    expect(checkPick(bad, 'bad', css).join('\n')).toMatch(/ホワイト: --text-faint \/ --bg/)
    expect(checkPick(variants, '', css)).toEqual([])
  })

  it('emitCss: 外観ごとの規則の中に書く行（とハイライトの形）', () => {
    const out = emitCss(variants, 'weekend-matched,highlight-full')
    expect(out).toContain(`/* ホワイト（:root） */\n  --sat: ${options['weekend-matched'].tokens.white['--sat']};`)
    expect(out).toContain(":root[data-theme='deep-dark']")
    expect(out).not.toContain(":root[data-theme='dark']")
    expect(out).toContain(`background: ${HIGHLIGHT_FULL};`)
    expect(out).not.toContain('!important')
  })

  it('emitSpec: 仕様書の 4.6 の表と 4.5 の表の行（替えない外観は今の値）', () => {
    const labels = emitSpec(variants, 'hue30', css).trim().split('\n')
    expect(labels).toHaveLength(2 + 24)
    expect(labels[2]).toMatch(/^\| 1 \| `rose-l` \| 桜・淡 \| `#[0-9a-f]{6}` \| `#[0-9a-f]{6}` \| `#[0-9a-f]{6}` \|$/)
    const weekend = emitSpec(variants, 'weekend-matched', css)
    const sat = options['weekend-matched'].tokens
    expect(weekend).toContain(`| \`--sat\` | \`${sat.white['--sat']}\` | \`#8a9bb5\` | \`${sat['deep-dark']['--sat']}\` |`)
    // 呼び名を持つ案（Q9）を選んだ時は、その案の呼び名で書く
    const b = emitSpec(variants, 'labels-b,depth-lighter', css).trim().split('\n')
    const tok = options['labels-b'].tokens
    expect(b[2]).toBe(
      `| 1 | \`rose-l\` | 桜 | \`${tok.white['--label-rose-l']}\` | \`${tok.dark['--label-rose-l']}\` | \`${tok['deep-dark']['--label-rose-l']}\` |`,
    )
    expect(b[14]).toMatch(/^\| 13 \| `rose-d` \| 紅 \|/)
    expect(emitSpec(variants, 'labels-a', css).split('\n')[2]).toMatch(/^\| 1 \| `rose-l` \| 桜・淡 \|/)
  })

  it('pickNames・emitNames: 選んだ案の既定の呼び名（呼び名を持つ案を選ばなければ今の呼び名）を labels.ts の行の形に', () => {
    expect(pickNames(variants, '')).toEqual({ ...LABEL_DEFAULT_NAMES })
    expect(pickNames(variants, 'hue30,depth-lighter')).toEqual({ ...LABEL_DEFAULT_NAMES })
    expect(pickNames(variants, 'depth-lighter,labels-b')).toEqual(options['labels-b'].names)
    expect(() => pickNames(variants, 'labels-a,labels-b')).toThrow(/両方/)
    const lines = emitNames(variants, 'labels-b').trimEnd().split('\n')
    expect(lines).toHaveLength(24)
    expect(lines[0]).toBe("  'rose-l': '桜',")
    expect(lines[23]).toBe("  'peony-d': '牡丹',")
  })
})
