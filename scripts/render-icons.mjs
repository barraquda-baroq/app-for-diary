// アプリのアイコン「ドットの DS」（scripts/icon-art.mjs。docs/SPEC.md の 5.8）を書き出す。PNG は Playwright の Chromium で描く。
// NS の scripts/render-icons.mjs から。DS は Web 版だけなので、アプリ（iPhone / Android）のアイコンの書き出しは無い。
// 使い方（リポジトリの直下で。ふだんは要らない。アイコンを変えた時だけ。できたファイルはリポジトリに入れる）:
//   node scripts/render-icons.mjs
//   入っている Chromium を使う時は PW_CHROMIUM_PATH にその場所を入れる（playwright.config.ts と同じ。
//   Playwright の版と入っているブラウザの版が違う環境）
// できるもの（public/。名前は vite.config.ts の PWA_ICONS・includeAssets と index.html が指している物）:
//   icon.svg              角を丸めたアイコン（ヘッダーの左のアイコン。SVG をそのまま出すブラウザ用）
//   favicon.svg           タブのアイコン（32 四方の升目にそろえた、小さくてもにじまない形。index.html）
//   apple-touch-icon.png  180px、角を丸めない（iPhone・iPad のホーム画面。角は iOS が丸める）
//   pwa-192.png・pwa-512.png  ふだんのアイコン（apple-touch-icon と同じ絵。角を丸めない）。manifest の any（インストールした
//                         Web 版のスタートメニュー・タスクバー・ウインドウ。vite.config.ts）
//   pwa-32.png            32px（favicon.svg と同じ、小さくてもにじまない形）。manifest の any（Windows のタスクバー・タイトルバーの大きさ）
//   pwa-maskable-192.png・pwa-maskable-512.png  DS を小さめにして、真ん中の 80% の円（丸などに切り抜かれる時の安全な範囲）に収める。
//                         manifest の maskable（Android などが丸などに切り抜く時）だけに使う
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { faviconSvg, iconSvg } from './icon-art.mjs'

const out = (name) => new URL(`../public/${name}`, import.meta.url)

await mkdir(out(''), { recursive: true })
await writeFile(out('icon.svg'), iconSvg({ radius: 224 }))
await writeFile(out('favicon.svg'), faviconSvg())

const executablePath = process.env.PW_CHROMIUM_PATH
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const page = await browser.newPage()
for (const [name, size, svg] of [
  ['apple-touch-icon.png', 180, iconSvg()],
  ['pwa-192.png', 192, iconSvg()],
  ['pwa-512.png', 512, iconSvg()],
  ['pwa-32.png', 32, faviconSvg()],
  ['pwa-maskable-192.png', 192, iconSvg({ grid: 17 })],
  ['pwa-maskable-512.png', 512, iconSvg({ grid: 17 })],
]) {
  await page.setViewportSize({ width: size, height: size })
  // 一番外の <svg> の大きさを、書き出す大きさにする（favicon は 32 のまま）
  const sized = svg.replace(/width="\d+" height="\d+">/, `width="${size}" height="${size}" style="display:block">`)
  await page.setContent(`<html><body style="margin:0;background:#000">${sized}</body></html>`)
  // 透明にしない（iOS は透明の所を黒にする。PWA の maskable は四角いっぱいに描く）
  await page.screenshot({ path: out(name).pathname, clip: { x: 0, y: 0, width: size, height: size } })
}
await browser.close()
console.log('public/ にアイコンを書き出しました')
