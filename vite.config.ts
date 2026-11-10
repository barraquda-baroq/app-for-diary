/// <reference types="vitest/config" />
// 開発サーバー・ビルド・PWA・単体テストの設定。NS（Novel Studio）の vite.config.ts から、ネイティブ用のビルド（Capacitor）と
// Claude 用のコネクタの部分を外して写した物（docs/SPEC.md の 2.1・2.2・5.1）
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'

/** index.html の <script data-inline="ファイル">…</script> */
const INLINE_SCRIPT = /<script data-inline="([^"]+)">([\s\S]*?)<\/script>/g

/**
 * index.html の <script data-inline="ファイル">…</script> の先頭に、そのファイルの中身を埋め込む（src/launch/launch.js: 外観と起動アニメーション）。
 * 最初の描画の前に、アプリの本体の読み込みを待たずに動かすため（読み込みを1つも増やさない）。minify ではコメントを除いて縮める（ビルド）
 */
export async function inlineScripts(html: string, root: string, minify: boolean): Promise<string> {
  let out = ''
  let last = 0
  for (const m of html.matchAll(INLINE_SCRIPT)) {
    const file = path.resolve(root, m[1])
    let code = readFileSync(file, 'utf8')
    // 古い端末でも動く書き方のまま縮める（埋め込むので Vite の変換を通らない）
    if (minify) code = (await transformWithEsbuild(code, file, { minify: true, target: 'es2020', legalComments: 'none' })).code
    if (/<\/script/i.test(code)) throw new Error(`${m[1]} に </script> があると埋め込めません`)
    out += `${html.slice(last, m.index)}<script>\n${code.trim()}\n${m[2].trim()}\n</script>`
    last = m.index + m[0].length
  }
  return out + html.slice(last)
}

/**
 * インストールした Web 版のアイコン（manifest の icons。画像は scripts/render-icons.mjs が public/ に書き出す。docs/SPEC.md の 5.8）。
 * any はふだんのアイコン（apple-touch-icon と同じ絵。インストールした Web 版のスタートメニュー・タスクバー・ウインドウ）。
 * 32px は favicon と同じ、小さくてもにじまない形（Windows のタスクバー・タイトルバー）。
 * maskable だけ、DS を小さめにして真ん中の 80% の円（丸などに切り抜かれる時の安全な範囲）に収めたもの
 */
export const PWA_ICONS = [
  { src: 'pwa-32.png', sizes: '32x32', type: 'image/png', purpose: 'any' },
  { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

/** インストールした Web 版の manifest（docs/SPEC.md の 5.8・5.9） */
export const PWA_MANIFEST = {
  name: 'Diary Studio',
  short_name: 'Diary Studio',
  description: '仕事とプライベートの予定・タスク・ルーチン・やりたいことを1画面で',
  lang: 'ja',
  // アイコン（黒地に青い点の「DS」）と起動アニメーションのダークの地の色。ホーム画面から開いた時に端末が一瞬出す
  // 無地の画面もこの色にして、アニメーションにつなげる（docs/SPEC.md の 5.9）。ウインドウの枠の色は、開いた後は外観に合わせる
  // （index.html の theme-color）
  theme_color: '#050607',
  background_color: '#050607',
  display: 'standalone',
  start_url: './',
  scope: './',
  // any はふだんのアイコン、maskable だけ DS を小さめにしたもの（PWA_ICONS）
  icons: PWA_ICONS,
} satisfies Partial<ManifestOptions>

function inlineLaunchScript(): Plugin {
  const root = fileURLToPath(new URL('.', import.meta.url))
  let minify = false
  return {
    name: 'diary-studio:inline-launch-script',
    configResolved(config) {
      minify = config.command === 'build'
    },
    configureServer(server) {
      // 開発中に書き換えたら読み込み直す（モジュールのつながりの外にあるので、Vite は見ていない）
      const file = path.resolve(root, 'src/launch/launch.js')
      server.watcher.add(file)
      server.watcher.on('change', (changed) => {
        if (path.resolve(changed) === file) server.ws.send({ type: 'full-reload' })
      })
    },
    transformIndexHtml: { order: 'pre', handler: (html) => inlineScripts(html, root, minify) },
  }
}

export default defineConfig({
  // 相対パスで出力しておくと、静的ホスティングにそのまま載せられる（HashRouter。docs/SPEC.md の 2.1）
  base: './',
  // ログイン（Firebase）は使う時に読み込む。開発サーバーで途中に依存を最適化し直して再読み込みしないよう、先にまとめておく
  optimizeDeps: { include: ['firebase/app', 'firebase/auth'] },
  plugins: [
    react(),
    inlineLaunchScript(),
    VitePWA({
      // 入力中に勝手に再読み込みしないよう、更新はユーザーが「更新する」を押した時に適用する（docs/SPEC.md の 2.8）
      registerType: 'prompt',
      workbox: {
        // 書体（Roboto Mono の woff2）も事前キャッシュに入れ、オフラインでも等幅の字で出す（既定は js・css・html だけ。
        // woff は古いブラウザ用なので入れない。docs/SPEC.md の 4.7）
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // Firebase のログイン画面（/__/auth/…）はオフライン用のアプリの画面に差し替えない
        navigateFallbackDenylist: [/^\/__\//],
      },
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      manifest: PWA_MANIFEST,
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // scripts/ はスクリプトの部品のテスト（Node の環境。各ファイルの先頭の @vitest-environment node）
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // 同期のテストは Firebase エミュレーターの中で動かす（段階1で足す。docs/SPEC.md の 2.10）
    exclude: ['src/**/*.emu.test.ts', 'node_modules/**'],
  },
})
