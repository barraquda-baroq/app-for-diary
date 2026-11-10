// @vitest-environment node
// vite.config.ts の確かめ（NS の scripts/vite-config.test.mjs から。NS のビルドの日時・ネイティブ用のビルドの部分は DS に無いので外した）
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import config, { PWA_ICONS, PWA_MANIFEST, inlineScripts } from '../vite.config.ts'

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
  /** アイコンの画像を書き出した後だけ、画像の中身を確かめる */
  const rendered = PWA_ICONS.every((icon) => existsSync(new URL(`../public/${icon.src}`, import.meta.url)))

  it('any（スタートメニュー・タスクバー・ウインドウ）は3つの大きさ、maskable は別の名前の2つ。1つの画像を両方には使わない', () => {
    const any = PWA_ICONS.filter((i) => i.purpose === 'any')
    const maskable = PWA_ICONS.filter((i) => i.purpose === 'maskable')
    expect(any.map((i) => i.sizes)).toEqual(['32x32', '192x192', '512x512'])
    expect(maskable.map((i) => i.sizes)).toEqual(['192x192', '512x512'])
    for (const m of maskable) expect(m.src).toMatch(/^pwa-maskable-/)
    expect(new Set(PWA_ICONS.map((i) => i.src)).size).toBe(PWA_ICONS.length)
  })

  it.skipIf(!rendered)('どの画像も public/ にあり、書いてある大きさの PNG。maskable は any と違う絵', () => {
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
