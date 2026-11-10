// @vitest-environment node
// vite.config.ts の確かめ（NS の scripts/vite-config.test.mjs から。NS のビルドの日時・ネイティブ用のビルドの部分は DS に無いので外した）
// と、manifest が指すアイコンの絵（scripts/icon-art.mjs と、それから書き出した public/ の画像）の確かめ
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config, { PWA_ICONS, PWA_MANIFEST, PWA_WORKBOX, inlineScripts } from '../vite.config.ts'
import { BACKGROUND, BLUE, faviconSvg, iconSvg } from './icon-art.mjs'

// 外観と起動アニメーション（src/launch/launch.js）を index.html に埋め込む（読み込みを増やさず、アプリの本体より先に動かす）
describe('inlineScripts（index.html の <script data-inline>）', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../src/launch/launch.js', import.meta.url), 'utf8')
  /** 埋め込んだ script の中身 */
  const scriptOf = (out) => out.slice(out.indexOf('<script>') + '<script>'.length, out.indexOf('</script>'))

  it('開発サーバーでは、ファイルをそのまま埋め込み、その後に index.html の呼び出しを置く', async () => {
    const out = await inlineScripts(html, root, false)
    expect(out).not.toMatch(/<script data-inline/)
    const code = scriptOf(out)
    expect(code).toContain(source.trim())
    expect(code.trim().endsWith('DiaryStudioLaunch.boot()')).toBe(true)
    // アプリの本体より前（<head> の中）
    expect(out.indexOf('DiaryStudioLaunch.boot()')).toBeLessThan(out.indexOf('</head>'))
  })

  it('ビルドではコメントを除いて縮め、そのまま動く', async () => {
    const out = await inlineScripts(html, root, true)
    const code = scriptOf(out)
    expect(code.length).toBeLessThan(source.length / 2)
    expect(code).not.toContain('起動アニメーション')
    // 動かすと window.DiaryStudioLaunch ができる（boot は呼ばずに確かめる）
    const lib = code.slice(0, code.lastIndexOf('DiaryStudioLaunch.boot()'))
    const win = {}
    new Function('window', 'document', lib)(win, {})
    expect(typeof win.DiaryStudioLaunch.boot).toBe('function')
    expect(
      win.DiaryStudioLaunch.decide({
        enabled: true,
        webdriver: false,
        forced: false,
        shownInSession: false,
        reducedMotion: true,
      }),
    ).toBe('still')
  })

  it('埋め込む場所が無ければ何もしない', async () => {
    expect(await inlineScripts('<html><head></head></html>', root, true)).toBe('<html><head></head></html>')
  })
})

// PWA の manifest（docs/SPEC.md の 5.8・5.9）
describe('PWA の manifest', () => {
  it('名前は Diary Studio、地と枠の色は起動アニメーションのダークの地と同じ黒', () => {
    expect(PWA_MANIFEST.name).toBe('Diary Studio')
    expect(PWA_MANIFEST.short_name).toBe('Diary Studio')
    expect(PWA_MANIFEST.lang).toBe('ja')
    expect(PWA_MANIFEST.theme_color).toBe('#050607')
    expect(PWA_MANIFEST.background_color).toBe('#050607')
    expect(PWA_MANIFEST.display).toBe('standalone')
    expect(PWA_MANIFEST.icons).toBe(PWA_ICONS)
  })

  it('PWA のプラグインに入っている', () => {
    const names = config.plugins.flat(Infinity).map((p) => p && p.name)
    expect(names).toContain('vite-plugin-pwa')
    expect(names).toContain('diary-studio:inline-launch-script')
  })
})

// インストールした Web 版のアイコン（manifest の icons。画像は scripts/render-icons.mjs が public/ に書き出す）
describe('PWA_ICONS（manifest のアイコン）', () => {
  const file = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url))
  /** PNG の幅と高さ（IHDR） */
  const pngSize = (buf) => `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`

  it('any（スタートメニュー・タスクバー・ウインドウ）は3つの大きさ、maskable は別の名前の2つ。1つの画像を両方には使わない', () => {
    const any = PWA_ICONS.filter((i) => i.purpose === 'any')
    const maskable = PWA_ICONS.filter((i) => i.purpose === 'maskable')
    expect(any.map((i) => i.sizes)).toEqual(['32x32', '192x192', '512x512'])
    expect(maskable.map((i) => i.sizes)).toEqual(['192x192', '512x512'])
    for (const m of maskable) expect(m.src).toMatch(/^pwa-maskable-/)
    expect(new Set(PWA_ICONS.map((i) => i.src)).size).toBe(PWA_ICONS.length)
  })

  // 画像はリポジトリに入れる物なので、無ければ飛ばさずに落とす（manifest が無い画像を指したまま公開しないように）
  it('どの画像も public/ にあり、書いてある大きさの PNG。maskable は any と違う絵', () => {
    for (const icon of PWA_ICONS) {
      expect(
        existsSync(new URL(`../public/${icon.src}`, import.meta.url)),
        `public/${icon.src} がありません。node scripts/render-icons.mjs で書き出してください`,
      ).toBe(true)
    }
    for (const icon of PWA_ICONS) {
      const buf = file(icon.src)
      expect(buf.subarray(1, 4).toString()).toBe('PNG')
      expect(pngSize(buf), icon.src).toBe(icon.sizes)
      expect(icon.type).toBe('image/png')
    }
    for (const m of PWA_ICONS.filter((i) => i.purpose === 'maskable')) {
      const a = PWA_ICONS.find((i) => i.purpose === 'any' && i.sizes === m.sizes)
      expect(file(a.src).equals(file(m.src))).toBe(false)
    }
  })
})

// アプリのアイコンの青（scripts/icon-art.mjs。docs/SPEC.md の 5.4・5.8）
describe('アイコンの青と、書き出したアイコン', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('点の青は、OKLCH の L を 0.03 下げた暗い案の #52b6f5（初めの案 #5cc0ff）。点の光の明るい2色も同じ規則で下げた値', () => {
    expect(BLUE).toBe('#52b6f5')
    const svg = iconSvg()
    expect(svg).toContain('stop-color="#e0ebf5"')
    expect(svg).toContain('stop-color="#93c5f5"')
    // 初めの案の青が残っていない
    for (const old of ['#5cc0ff', '#eaf5ff', '#9ccfff']) expect(svg).not.toContain(old)
    expect(BACKGROUND).toBe('#050607')
  })

  it('起動アニメーションのダークのロゴ・レーザーと同じ青', () => {
    const win = {}
    new Function('window', 'document', read('../src/launch/launch.js'))(win, {})
    expect(win.DiaryStudioLaunch.PALETTES.dark.logo).toBe(BLUE)
    expect(win.DiaryStudioLaunch.PALETTES.dark.laser).toBe(BLUE)
  })

  // PNG は中身を比べられないので、同じ時に書き出す SVG で、icon-art.mjs を変えた後に書き出し直したかを確かめる
  it('public/ の icon.svg・favicon.svg は、今の icon-art.mjs から書き出した物（node scripts/render-icons.mjs）', () => {
    expect(read('../public/icon.svg')).toBe(iconSvg({ radius: 224 }))
    expect(read('../public/favicon.svg')).toBe(faviconSvg())
  })
})

// サービスワーカーの事前キャッシュと、オフライン用のアプリの画面に差し替えない行き先（docs/SPEC.md の 2.8・4.7）
describe('PWA_WORKBOX（サービスワーカー）', () => {
  /** Workbox の NavigationRoute と同じく、行き先のパスが denylist のどれかに当たるか */
  const denied = (pathname) => PWA_WORKBOX.navigateFallbackDenylist.some((re) => re.test(pathname))

  it('アプリの本体・書体の woff2・書体のライセンスの全文を事前キャッシュに入れる', () => {
    expect(PWA_WORKBOX.globPatterns).toContain('**/*.{js,css,html,woff2}')
    expect(PWA_WORKBOX.globPatterns).toContain('licenses/*.txt')
  })

  it('Firebase のログイン画面とライセンスの全文はアプリの画面に差し替えず、アプリの行き先は差し替える', () => {
    expect(denied('/__/auth/handler')).toBe(true)
    expect(denied('/licenses/RobotoMono-OFL.txt')).toBe(true)
    expect(denied('/')).toBe(false)
    expect(denied('/index.html')).toBe(false)
  })
})

// 同梱する書体のライセンス（SIL Open Font License 1.1 の全文を公開物に入れる。docs/SPEC.md の 4.7）
describe('Roboto Mono のライセンス', () => {
  it('public/licenses/RobotoMono-OFL.txt に、@fontsource/roboto-mono の LICENSE と同じ全文がある', () => {
    const copied = readFileSync(new URL('../public/licenses/RobotoMono-OFL.txt', import.meta.url), 'utf8')
    const original = readFileSync(new URL('../node_modules/@fontsource/roboto-mono/LICENSE', import.meta.url), 'utf8')
    expect(copied).toBe(original)
    expect(copied).toContain('Copyright 2015 The Roboto Mono Project Authors')
    expect(copied).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })
})
