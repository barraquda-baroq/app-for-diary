#!/usr/bin/env node
// 公開: npm run deploy（Windows の PowerShell でも Mac のターミナルでも同じ。docs/DEPLOY.md・docs/SPEC.md の 2.6）。
// NS の scripts/deploy.mjs から、Claude 用のコネクタの公開と iPhone・Android のアプリの部分を外した物。
//   0. Firebase の設定値（src/sync/firebaseConfig.ts）と公開先（.firebaserc）が仮の値のままでないかを確かめる。
//      仮のまま・食い違っている時は、何も公開せずに止めて、手順書の場所を出す
//   1. 型を確かめる（tsc -b）
//   2. アプリをビルドする（vite build）
//   3. Firebase Hosting とアクセスルール（Firestore のルール・索引の設定）を公開する（firebase deploy --only hosting,firestore）
// オプション: --check（0 の確かめだけをして、公開はしない）
// npm・npx・シェルを通さず、各ツールの JS を node で直接動かす（&& のつなぎも使わない。PowerShell でも同じに動くように）。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configFile = path.join('src', 'sync', 'firebaseConfig.ts')
const firebasercFile = '.firebaserc'

/** 差し替える前の仮のプロジェクト（src/sync/firebaseConfig.ts・.firebaserc。docs/DEPLOY.md） */
export const PLACEHOLDER_PROJECT = 'diary-studio-xxxx'

const say = (msg = '') => console.log(msg)

/** firebaseConfig.ts の文字から項目の値を取り出す（'…'・"…" のどちらで書いてあってもよい。無ければ null） */
function valueOf(text, key) {
  const m = String(text).match(new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`\\r\\n]*)\\1`))
  return m ? m[2].trim() : null
}

/** .firebaserc の公開先のプロジェクト（無い・読めなければ null） */
function defaultProjectOf(firebasercText) {
  try {
    const p = JSON.parse(firebasercText)?.projects?.default
    return typeof p === 'string' && p.trim() ? p.trim() : null
  } catch {
    return null
  }
}

/**
 * 公開を始めてよいかを確かめる。configText = src/sync/firebaseConfig.ts の中身、firebasercText = .firebaserc の中身（無ければ null）。
 * 戻り値: { projectId, problems }（problems が空なら公開してよい。projectId は公開先のプロジェクト）
 */
export function checkConfig(configText, firebasercText) {
  const problems = []
  if (configText == null) {
    problems.push(`${configFile} が見つかりません（リポジトリを取ってき直してください）。`)
    return { projectId: null, problems }
  }
  if (/[‘’“”]/.test(configText))
    problems.push(
      `${configFile} に飾りの引用符（‘ ’ “ ”）が入っています。半角の ' か " に直してください` +
        '（Mac のテキストエディットで直す時は、先に「編集 → 自動置換 → スマート引用符」をオフにする）。',
    )
  if (!/export\s+const\s+firebaseConfig\s*=\s*\{/.test(configText))
    problems.push(
      `${configFile} の「export const firebaseConfig = {」の行が無くなっています。` +
        'この行と「}」は残して、その間の値だけを差し替えてください（docs/DEPLOY.md の 1 の 7）。',
    )
  // 飾りの引用符は上で知らせたので、値はそれを半角に読み替えて確かめる（同じことを2回言わないように）
  const plain = configText.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  const apiKey = valueOf(plain, 'apiKey')
  const appProject = valueOf(plain, 'projectId')
  if (!apiKey || apiKey.startsWith('REPLACE_'))
    problems.push(
      `${configFile} の apiKey が仮の値のままです（Firebase のコンソールの設定値に差し替える。docs/DEPLOY.md の 1 の 7）。`,
    )
  if (!appProject || appProject === PLACEHOLDER_PROJECT)
    problems.push(`${configFile} の projectId が仮の値（${PLACEHOLDER_PROJECT}）のままです（docs/DEPLOY.md の 1 の 7）。`)

  const rcProject = firebasercText == null ? null : defaultProjectOf(firebasercText)
  if (firebasercText == null) problems.push(`${firebasercFile} が見つかりません（リポジトリを取ってき直してください）。`)
  else if (!rcProject)
    problems.push(
      `${firebasercFile} の形が崩れています。docs/DEPLOY.md の 1 の 7 の形（"default": "プロジェクトの ID"）に直してください。`,
    )
  else if (rcProject === PLACEHOLDER_PROJECT)
    problems.push(`${firebasercFile} のプロジェクトが仮の値（${PLACEHOLDER_PROJECT}）のままです（docs/DEPLOY.md の 1 の 7）。`)

  // 2つが別のプロジェクトだと、公開したアプリが別のプロジェクトにログインしに行く
  if (
    appProject &&
    rcProject &&
    appProject !== PLACEHOLDER_PROJECT &&
    rcProject !== PLACEHOLDER_PROJECT &&
    appProject !== rcProject
  )
    problems.push(
      `${configFile} の projectId（${appProject}）と ${firebasercFile} のプロジェクト（${rcProject}）が食い違っています。` +
        'どちらも Firebase のコンソールの「プロジェクト ID」にそろえてください。',
    )
  return { projectId: problems.length ? null : rcProject, problems }
}

function readText(rel) {
  try {
    return fs.readFileSync(path.join(repoDir, rel), 'utf8')
  } catch {
    return null
  }
}

/** パッケージの CLI の JS ファイル（リポジトリの node_modules から見つける。無ければ null） */
function binOf(pkg, binName) {
  const require = createRequire(path.join(repoDir, 'package.json'))
  let pkgJson
  try {
    pkgJson = require.resolve(`${pkg}/package.json`)
  } catch {
    return null
  }
  const pj = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
  const bin = typeof pj.bin === 'string' ? pj.bin : pj.bin?.[binName ?? pkg]
  return bin ? path.join(path.dirname(pkgJson), bin) : null
}

function need(pkg, bin) {
  const p = binOf(pkg, bin)
  if (!p) {
    say(`${pkg} が入っていません。リポジトリの直下で npm ci を実行してから、もう一度試してください。`)
    process.exit(1)
  }
  return p
}

/** node でスクリプトを動かす（画面の表示はそのまま出す）。env の undefined の値は、子の環境から外れる */
function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: repoDir, env: { ...process.env, ...env }, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function step(label, script, args, env, hints = []) {
  say(`\n▶ ${label}`)
  const code = await runNode(script, args, env)
  if (code !== 0) {
    say(`✗ ${label} に失敗しました（上の表示を見てください）`)
    for (const h of hints) say(`  ・${h}`)
    process.exit(code || 1)
  }
}

/** Firebase の公開に失敗した時によくある原因（docs/DEPLOY.md の 6） */
const FIREBASE_HINTS = [
  '「Failed to authenticate」「not logged in」などと出た時: npx firebase login でログインしてから、もう一度 npm run deploy',
  '「403」「permission」と出た時: プロジェクトを作ったのと別の Google アカウントでログインしています。npx firebase logout の後に npx firebase login',
  '「database (default) does not exist」「Cloud Firestore API has not been used」と出た時: Firestore をまだ作っていません（docs/DEPLOY.md の 1 の 5）',
  '「Hosting」の site が見つからないと出た時: Firebase のコンソールで Hosting の「始める」をまだしていません（docs/DEPLOY.md の 1 の 6）',
]

async function main() {
  const flags = new Set(process.argv.slice(2))
  if (Number(process.versions.node.split('.')[0]) < 22) {
    say(`Node.js の版が古すぎます（いま ${process.version}）。Node.js 24 LTS を入れ直してください（docs/DEPLOY.md の 1 の 1）。`)
    process.exit(1)
  }

  const { projectId, problems } = checkConfig(readText(configFile), readText(firebasercFile))
  if (problems.length) {
    say('公開を始める前に止めました（何も公開していません）。')
    for (const p of problems) say(`  ✗ ${p}`)
    say('\n手順は docs/DEPLOY.md の「1. 一度だけ行うこと」にあります（Firebase のプロジェクトを作って、設定値を差し替える）。')
    process.exit(1)
  }
  say(`公開先: https://${projectId}.web.app（Firebase のプロジェクト ${projectId}）`)
  if (flags.has('--check')) {
    say('設定値の確かめだけをしました（公開はしていません）。')
    return
  }

  // 開発用の値（エミュレーター）は公開するアプリに入れない: PowerShell の $env: は画面を閉じるまで残るので、
  // 開発サーバーを動かした画面で npm run deploy をすると、公開するアプリがエミュレーターにつながってしまうため
  const env = { VITE_FIREBASE_EMULATOR: undefined }
  if (process.env.VITE_FIREBASE_EMULATOR) say('エミュレーターの設定（VITE_FIREBASE_EMULATOR）は公開するアプリには入れません')

  await step('型の確かめ（tsc -b）', need('typescript', 'tsc'), ['-b'], env)
  await step('アプリのビルド（vite build）', need('vite', 'vite'), ['build'], env)
  // 公開先は .firebaserc のプロジェクト（firebase use で別のプロジェクトを選んでいても、確かめた所へ送る）
  await step(
    'Firebase Hosting とアクセスルールの公開（firebase deploy）',
    need('firebase-tools', 'firebase'),
    ['deploy', '--only', 'hosting,firestore', '--project', projectId],
    {},
    FIREBASE_HINTS,
  )
  say(`\n公開しました: https://${projectId}.web.app`)
  say('（初めて公開した時は、docs/DEPLOY.md の 1 の 10「ログインの戻り先を登録する」もしてください）')
}

// このファイルを直接動かした時だけ公開する（テストから checkConfig を読み込んだ時は動かさない）
function isMain() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) await main()
