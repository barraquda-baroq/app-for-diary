// 色の計算の道具（段階2の見本の色の案を作る scripts/sample-variants.mjs が使う。docs/SPEC.md の 4.3・4.5・4.6）。
// OKLCH ↔ OKLab ↔ sRGB の変換、OKLab の色の差（ΔE）、WCAG のコントラスト比。式は src/styles.test.ts と同じ
// （sRGB の直線化の境 0.04045、Björn Ottosson の OKLab の係数）なので、ここで通った色は styles.test.ts でも同じ比・差になる。
// アプリの中では使わない（公開物に入らない）。色は '#rrggbb'（小文字）、sRGB の値は 0〜1 の [r, g, b]

/** '#rrggbb' → [r, g, b]（0〜1） */
export function hexToRgb(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`色の書き方が違います: ${hex}`)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
}

/** [r, g, b]（0〜1。はみ出しは端にそろえる） → '#rrggbb' */
export function rgbToHex(rgb) {
  return `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** sRGB の値 → 光の量に比例する値（直線化） */
export const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
/** 光の量に比例する値 → sRGB の値 */
export const fromLinear = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055)

/** sRGB の [r, g, b] → OKLab の [L, a, b] */
export function rgbToOklab(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab の [L, a, b] → sRGB の [r, g, b]（sRGB の外に出る時は 0〜1 の外の値のまま返す。inGamut で確かめる） */
export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear)
}

/** OKLCH の [L, C, h（度）] → OKLab の [L, a, b] */
export function oklchToOklab([L, C, h]) {
  const rad = (h * Math.PI) / 180
  return [L, C * Math.cos(rad), C * Math.sin(rad)]
}

/** OKLab の [L, a, b] → OKLCH の [L, C, h（度。0〜360。彩度がほぼ 0 の時は 0）] */
export function oklabToOklch([L, a, b]) {
  const C = Math.hypot(a, b)
  const h = C < 1e-9 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return [L, C, h]
}

export const hexToOklab = (hex) => rgbToOklab(hexToRgb(hex))
export const hexToOklch = (hex) => oklabToOklch(hexToOklab(hex))
export const oklabToHex = (lab) => rgbToHex(oklabToRgb(lab))

/** sRGB の中に入っているか（丸めの誤差 eps まで許す） */
export function inGamut(rgb, eps = 1e-7) {
  return rgb.every((c) => c >= -eps && c <= 1 + eps)
}

/** 彩度を下げる時の刻み（この刻みで下げると、4.6 の表の sRGB に入らなかった2色（ホワイトの青磁・濃と空・濃）も表の値と同じになる） */
export const CHROMA_STEP = 0.002

/**
 * OKLCH → { hex: '#rrggbb', chroma: 使った彩度, clipped: 彩度を下げたか }。sRGB に入らない時は、明るさと色相を保ったまま
 * 彩度だけを CHROMA_STEP ずつ下げ、入った所の色にする（docs/SPEC.md の 4.6「sRGB に入らない時は彩度を下げた」）
 */
export function oklchToHex([L, C, h], step = CHROMA_STEP) {
  const rgbOf = (c) => oklabToRgb(oklchToOklab([L, c, h]))
  let chroma = C
  // 刻みの誤差がたまらないよう、刻みの回数から彩度を作る
  for (let i = 1; !inGamut(rgbOf(chroma)) && chroma > 0; i++) chroma = Math.max(0, +(C - step * i).toFixed(6))
  return { hex: rgbToHex(rgbOf(chroma)), chroma, clipped: chroma !== C }
}

/** OKLab の色の差（ΔE。ユークリッド距離） */
export function deltaE(hexA, hexB) {
  const p = hexToOklab(hexA)
  const q = hexToOklab(hexB)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** OKLab の明るさ（L） */
export const lightness = (hex) => hexToOklab(hex)[0]
/** OKLab の彩度（灰色の軸からの離れ） */
export const chromaOf = (hex) => oklabToOklch(hexToOklab(hex))[1]

/** WCAG の相対輝度 */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG のコントラスト比（1〜21） */
export function contrast(hexA, hexB) {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 2つの色の sRGB の値のいちばん大きい違い（0〜255 の段で数える） */
export function channelDiff(hexA, hexB) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  return Math.max(...a.map((c, i) => Math.round(Math.abs(c - b[i]) * 255)))
}
