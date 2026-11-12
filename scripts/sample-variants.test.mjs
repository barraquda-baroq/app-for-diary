// @vitest-environment node
// 段階2の見本の色の案（scripts/sample-variants.mjs・e2e/samples/variants.json）と色の計算（scripts/lib/color.mjs）の確かめ
// （docs/SPEC.md の 4.3・4.5・4.6・21.）。どの案も src/styles.test.ts と同じ決まりを満たすので、作者がどれを選んでも、その値を
// そのまま src/styles.css に入れられる（段階2の終わり。WP14）。作者の答え（2026-11-12。ANSWERS）の後は、答えた問い（Q2〜Q6）の案は
// 答える前の値（ASKED_TOKENS。見本で見比べてもらった時の値）から作ったまま残し、答えの値は src/styles.css に入っている
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
  ASKED_GROUND_BANDS,
  ASKED_TOKENS,
  COUNT_PAIRS,
  GROUND_BANDS,
  GROUNDS,
  HIGHLIGHT_ASKED,
  HIGHLIGHT_FULL,
  HUES_30,
  HUES_NOW,
  LABEL_KEYS,
  LABEL_NAMES,
  LABEL_RULES,
  LABEL_SETS,
  QUESTIONS,
  SAMPLE_SELECTORS,
  THEMES,
  WEEKEND_MIN_DE,
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
/** 答える前の値（見本で見比べてもらった時。答えた問いの案はこの上で作った） */
const asked = askedThemes(themes)
const variants = buildVariants(css)
const options = variants.options
/** 答えた問い（Q2〜Q6）の案か */
const answered = (id) => options[id].question in ANSWERS
/** 案を重ねたその外観の変数（答えた問いの案は答える前の値に、まだ答えの無い問いの案は今の値に重ねる） */
const applied = (id, theme) => withTokens((answered(id) ? asked : themes)[theme], options[id].tokens[theme])

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

  it.each(THEMES)('%s: 今の値は確かめ（checkTheme。src/styles.test.ts と同じ決まり）を通る', (theme) => {
    expect(checkTheme(theme, themes[theme])).toEqual([])
  })

  it.each(THEMES)('%s: 答える前の値（今の値に ASKED_TOKENS を重ねた物）も、答える前の区分の地の幅で確かめを通る', (theme) => {
    expect(checkTheme(theme, asked[theme], { bands: ASKED_GROUND_BANDS })).toEqual([])
  })

  it('作者の答え（Q3 A・Q4 B・Q5 B・Q6 B）の案を答える前の値に重ねると、今の src/styles.css の値になる（--emit css の値がそのまま入っている）', () => {
    expect(ANSWERS).toEqual({ 2: 'labels', 3: 'depth-lighter', 4: 'highlight-full', 5: 'weekend-matched', 6: 'now' })
    const pick = Object.values(ANSWERS)
      .filter((id) => id in options)
      .join(',')
    expect(pick).toBe('depth-lighter,highlight-full,weekend-matched')
    const tokens = pickTokens(variants, pick)
    for (const t of THEMES) {
      // 答えで替えたトークンは、ASKED_TOKENS に答える前の値を残したトークンと同じ
      expect(Object.keys(tokens[t]).sort(), t).toEqual(Object.keys(ASKED_TOKENS[t]).sort())
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

  it('区分の地の面からの差の幅（FRAME-180）は、答える前の幅の 0.7 倍（Q3 A の「面からの差 × 0.7」）', () => {
    for (const part of ['area', 'sheet'])
      GROUND_BANDS[part].forEach((v, i) => expect(v, part).toBeCloseTo(ASKED_GROUND_BANDS[part][i] * 0.7, 6))
  })

  it('確かめは、決まりを割る値を見つける', () => {
    const w = themes.white
    expect(checkTheme('white', withTokens(w, { '--text-faint': '#9a9a9a' })).join('\n')).toMatch(/--text-faint \/ --bg/)
    expect(checkTheme('white', withTokens(w, { '--work-line': '#5787ce' })).join('\n')).toMatch(
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
    // マンスリーの件数（大きな字）は、件数を置く3つの地の上で 3:1 以上
    expect(COUNT_PAIRS).toHaveLength(6)
    expect(checkTheme('white', withTokens(w, { '--private-count': '#e0a0b4' })).join('\n')).toMatch(
      /--private-count \/ --off-fill が .*（3:1 未満・マンスリーの件数/,
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

  it('4.6 の明るさ・彩度・色相から作り直すと、表の24色（3つの外観）と同じになる（1/255 以内）', () => {
    const palette = labelPalette(HUES_NOW)
    for (const theme of THEMES) {
      for (const key of LABEL_KEYS) {
        const now = hexOf(themes[theme], `--label-${key}`)
        expect(
          channelDiff(palette[theme][key].hex, now),
          `${theme} ${key} ${palette[theme][key].hex} / ${now}`,
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

  it('問い（Q2〜Q6・Q9）の選ぶ物は、どれも「今」か作った案', () => {
    expect(Object.keys(QUESTIONS).map(Number)).toEqual([2, 3, 4, 5, 6, 9])
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
  // ラベルなしの線と24色の ΔE 0.06・差し色はグレー・今日の印・ディープダークの決まり）を満たす
  const cases = Object.keys(options).flatMap((id) => THEMES.map((t) => [id, t]))
  it.each(cases)('%s（%s）は決まりを満たす', (id, theme) => {
    const scale = options[id].question === 3 ? bandScaleOf(id, theme) : undefined
    const bands = answered(id) ? ASKED_GROUND_BANDS : GROUND_BANDS
    expect(checkTheme(theme, applied(id, theme), { bandScale: scale, bands })).toEqual([])
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

describe('Q9: ラベルの24色の作り直し（labels-a・labels-b。■1・■2 の答え）', () => {
  const SETS = ['labels-a', 'labels-b']
  const colorsOf = (id, theme) => Object.fromEntries(LABEL_KEYS.map((k) => [k, options[id].tokens[theme][`--label-${k}`]]))
  const nowColors = (theme) => Object.fromEntries(LABEL_KEYS.map((k) => [k, hexOf(themes[theme], `--label-${k}`)]))
  const both = (bases) => bases.flatMap((b) => [`${b}-l`, `${b}-d`])
  /** 作者が「特に近い」と言った2つの仲間（青の仲間・左のピンクの仲間） */
  const FAMILIES = { 青: both(['teal', 'sky', 'blue', 'wisteria']), ピンク: both(['rose', 'coral', 'peony']) }
  const familyMin = (colors, keys) => {
    let min = Infinity
    for (const a of keys) for (const b of keys) if (a < b) min = Math.min(min, deltaE(colors[a], colors[b]))
    return min
  }
  const hueGap = (a, b) => (b - a + 360) % 360

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

  it('labels-a・labels-b は Q2 の hue30 と同じトークンを書き換えるので、一緒には選べない', () => {
    expect(() => pickTokens(variants, 'hue30,labels-a')).toThrow(/両方/)
    expect(() => pickTokens(variants, 'labels-a,labels-b')).toThrow(/両方/)
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

  // 答えた問い（Q3〜Q6）は答えの値のまま（今の src/styles.css）。まだ答えの無いラベルの24色（Q9: 今のまま・案A・案B）は、
  // どれを選んでも、答えを入れた今の値の上で決まりを満たす（--emit css --pick labels-a などをそのまま入れられる）
  it.each(THEMES)('%s: まだ答えの無い Q9 のどれを選んでも、答えを入れた今の値の上で決まりを満たす（checkPick）', (theme) => {
    for (const pick of ['', 'labels-a', 'labels-b']) expect(checkPick(variants, pick, css), `${theme}: ${pick}`).toEqual([])
  })

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
