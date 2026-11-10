// アプリのアイコン「ドットの DS」（黒地に、青に光る点の「DS」と、消えている点の並び）を SVG で作る（docs/SPEC.md の 5.8）。
// NS の scripts/icon-art.mjs（「ドットの NS」）と同じ作りで、字を「DS」、点の色を青にした。
// 字は起動アニメーションのロゴと同じ 5×7 の点の字（src/launch/launch.js の GLYPHS）。
// 書き出しは scripts/render-icons.mjs。DS は Web 版だけなので、NS のアプリ用の背景と絵を分ける作り（layer）は外した。

/**
 * 点の青（起動アニメーションのダークのロゴ・レーザーと同じ。docs/SPEC.md の 5.4）。初めの案 #5cc0ff から OKLCH の L だけを
 * 0.03 下げた暗い案（作者が見比べて決めた）。点の光（DEFS の led の明るい2色）も同じ規則で下げてある
 */
export const BLUE = '#52b6f5'
/** 地の色（起動アニメーションのダークの地と同じ。PWA の theme_color・background_color も） */
export const BACKGROUND = '#050607'

const D = ['11110', '10001', '10001', '10001', '10001', '10001', '11110']
const S = ['01111', '10000', '10000', '01110', '00001', '00001', '11110']

const r2 = (n) => +(+n).toFixed(2)

/** 字の点の中心（ox, oy は左上、p は点の間隔） */
function glyphPoints(rows, ox, oy, p) {
  const out = []
  rows.forEach((row, j) => [...row].forEach((c, i) => c === '1' && out.push([ox + i * p + p / 2, oy + j * p + p / 2])))
  return out
}

/** 「DS」の点の中心（D と S の間は gap 列あける） */
function dsPoints(ox, oy, p, gap = 1) {
  return glyphPoints(D, ox, oy, p).concat(glyphPoints(S, ox + (5 + gap) * p, oy, p))
}

/** 点いている点: 柔らかい光（halo）＋ 点（中心が明るい）。d は点の大きさ */
function litDots(points, d, { halo = 1.3, rx = 0.14, led = true } = {}) {
  let s = ''
  if (halo)
    s += `<g fill="url(#halo)">${points.map(([x, y]) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(d * halo)}"/>`).join('')}</g>\n`
  s += `<g fill="${led ? 'url(#led)' : BLUE}">`
  s += points
    .map(([x, y]) => `<rect x="${r2(x - d / 2)}" y="${r2(y - d / 2)}" width="${r2(d)}" height="${r2(d)}" rx="${r2(d * rx)}"/>`)
    .join('')
  return s + '</g>\n'
}

/** 消えている点の並び（真ん中から離れるほど薄く） */
function unlitDots(cols, rows, p, d, litSet, { a0 = 0.075, a1 = 0.012, rmax = 720, rx = 0.14 } = {}) {
  let s = `<g fill="${BLUE}">`
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (litSet.has(`${i},${j}`)) continue
      const x = i * p + p / 2
      const y = j * p + p / 2
      const t = Math.min(1, Math.hypot(x - 512, y - 512) / rmax)
      const a = a0 + (a1 - a0) * t * t
      s += `<rect x="${r2(x - d / 2)}" y="${r2(y - d / 2)}" width="${r2(d)}" height="${r2(d)}" rx="${r2(d * rx)}" opacity="${r2(a)}"/>`
    }
  }
  return s + '</g>\n'
}

const DEFS = {
  bg: '<radialGradient id="bg" cx="50%" cy="48%" r="72%"><stop offset="0" stop-color="#0a1422"/><stop offset="1" stop-color="#030404"/></radialGradient>',
  led: `<radialGradient id="led" cx="50%" cy="46%" r="62%"><stop offset="0" stop-color="#e0ebf5"/><stop offset=".42" stop-color="#93c5f5"/><stop offset="1" stop-color="${BLUE}"/></radialGradient>`,
  halo: `<radialGradient id="halo"><stop offset="0" stop-color="${BLUE}" stop-opacity="0.42"/><stop offset=".38" stop-color="${BLUE}" stop-opacity="0.13"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>`,
}

/**
 * アプリのアイコン（1024 四方の SVG）。
 *   grid: 点の並びの数（奇数）。15 がふだんのアイコン（PWA の any も）。17 は DS が小さめで、丸などに切り抜かれても欠けない
 *     （PWA の maskable だけ。public/pwa-maskable-*.png）
 *   radius: 角の丸み（0 は四角。public/icon.svg は 224 = NS と同じ 21.9%）
 */
export function iconSvg({ grid = 15, radius = 0 } = {}) {
  const p = 1024 / grid
  const d = p * 0.8
  // DS（11列×7行）を真ん中に
  const gx = (grid - 11) / 2
  const gy = (grid - 7) / 2
  const points = dsPoints(gx * p, gy * p, p)
  const litSet = new Set()
  ;[D, S].forEach((rows, k) =>
    rows.forEach((row, j) => [...row].forEach((c, i) => c === '1' && litSet.add(`${gx + i + k * 6},${gy + j}`))),
  )
  const defs = [radius ? `<clipPath id="round"><rect width="1024" height="1024" rx="${radius}"/></clipPath>` : '']
  defs.push(DEFS.bg, DEFS.led, DEFS.halo)
  const body =
    `<g id="background"><rect width="1024" height="1024" fill="${BACKGROUND}"/><rect width="1024" height="1024" fill="url(#bg)"/></g>\n` +
    `<g id="art">\n${unlitDots(grid, grid, p, d, litSet)}${litDots(points, d)}</g>\n`
  const content = radius ? `<g clip-path="url(#round)">\n${body}</g>\n` : body
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n<defs>${defs.join('')}</defs>\n${content}</svg>\n`
}

/** タブのアイコン（32 四方。点を 2 の升目にそろえ、32px・16px でもにじまないようにする） */
export function faviconSvg() {
  const points = dsPoints(4, 8, 2, 2)
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">\n' +
    `<rect width="32" height="32" fill="${BACKGROUND}"/>\n` +
    litDots(points, 1.7, { halo: 0, led: false, rx: 0.1 }) +
    '</svg>\n'
  )
}
