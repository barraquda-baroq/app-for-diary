// E2E のテストに、流す端末の印があるかの確かめ（npm run e2e:tags。CI でも流す。docs/SPEC.md の 2.10・D55）。
// playwright.config.ts は端末の印（@pc・@s・@m・@ios）でテストを絞るので、印の無いテストはどこでも流れない（黙って抜ける）。
// それを止めるため、印で絞らずに（E2E_LIST_ALL=1）全部のテストを並べ（ブラウザも開発サーバーも使わない）、印の無い物があれば落とす。
// 知らない印（打ち間違いかもしれない物）と、iPhone（WebKit）で流す数（CI の WebKit の不安定のため、段階0の起動アニメーション・
// 通しの確かめのほかに 15 まで）は知らせるだけ
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** 流す端末の印（playwright.config.ts の projects） */
export const DEVICE_TAGS = ['@pc', '@s', '@m', '@ios']
/** iPhone（WebKit）で流すテストの数の目安（段階0からある起動アニメーション・通しの確かめを除いた数） */
export const IOS_LIMIT = 15
/** 段階0からある iPhone のテスト（目安の数に入れない） */
export const IOS_LEGACY_FILES = ['launch.spec.ts', 'smoke.spec.ts']

/** JSON の一覧（--reporter=json）の、すべてのテスト（{ file, line, title, tags }。tags は @ 付き） */
export function specsOf(report) {
  const out = []
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      const tags = (spec.tags ?? []).map((t) => (t.startsWith('@') ? t : `@${t}`))
      out.push({ file: spec.file, line: spec.line, title: [...titles, spec.title].join(' › '), tags })
    }
    for (const child of suite.suites ?? [])
      walk(child, child.title && child.title !== child.file ? [...titles, child.title] : titles)
  }
  for (const suite of report.suites ?? []) walk(suite, [])
  return out
}

/**
 * 確かめた結果（missing = 端末の印が1つも無いテスト、unknown = 知らない印、counts = 印ごとの数、
 * newIos = 段階0からあるファイルのほかの @ios の数）
 */
export function checkTags(specs) {
  const counts = Object.fromEntries(DEVICE_TAGS.map((t) => [t, 0]))
  const missing = []
  const unknown = []
  let newIos = 0
  for (const s of specs) {
    const device = s.tags.filter((t) => DEVICE_TAGS.includes(t))
    for (const t of device) counts[t] += 1
    if (device.includes('@ios') && !IOS_LEGACY_FILES.includes(s.file)) newIos += 1
    if (device.length === 0) missing.push(s)
    for (const t of s.tags) if (!DEVICE_TAGS.includes(t)) unknown.push({ ...s, tag: t })
  }
  return { missing, unknown, counts, newIos }
}

function main() {
  const require = createRequire(import.meta.url)
  const cli = require.resolve('@playwright/test/cli')
  const env = { ...process.env, E2E_LIST_ALL: '1' }
  delete env.E2E_SAMPLES
  const run = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json', '--project=desktop'], {
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (run.status !== 0 && !run.stdout) {
    console.error(run.stderr)
    console.error('E2E のテストの一覧を作れませんでした')
    process.exit(1)
  }
  const report = JSON.parse(run.stdout)
  if (report.errors?.length) {
    for (const e of report.errors) console.error(e.message ?? e)
    console.error('E2E のテストを読み込めませんでした')
    process.exit(1)
  }
  const specs = specsOf(report)
  if (specs.length === 0) {
    console.error('E2E のテストが1つも見つかりません（playwright.config.ts の testDir・testIgnore を確かめてください）')
    process.exit(1)
  }
  const { missing, unknown, counts, newIos } = checkTags(specs)
  console.log(
    `E2E のテスト ${specs.length} 件: ${DEVICE_TAGS.map((t) => `${t} ${counts[t]}`).join('・')}（1つのテストに印を2つ以上付けられる）`,
  )
  for (const u of unknown) console.warn(`知らない印 ${u.tag}: ${u.file}:${u.line} ${u.title}`)
  if (newIos > IOS_LIMIT) {
    console.warn(
      `iPhone（@ios）のテストが、${IOS_LEGACY_FILES.join('・')} のほかに ${newIos} 件あり、目安の ${IOS_LIMIT} 件を超えています`,
    )
  }
  if (missing.length) {
    for (const s of missing) console.error(`端末の印が無い: ${s.file}:${s.line} ${s.title}`)
    console.error(
      `${missing.length} 件のテストに ${DEVICE_TAGS.join('・')} のどれも付いていないので、どの端末でも流れません。` +
        "test('…', { tag: ['@pc'] }, …) か test.describe('…', { tag: [...] }, …) で付けてください",
    )
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
