// 同期のテスト（*.emu.test.ts）の、Firebase エミュレーターの管理者の道具。Authorization: Bearer owner はエミュレーターの管理者で、
// アクセスルールを通さない（作者が Firebase の画面で操作するのと同じ）。src/sync/sync.emu.test.ts・src/sync/upgrade.emu.test.ts から使う。

/** エミュレーターのプロジェクト（firebase.emu.json・src/sync/firebaseConfig.ts の EMULATOR_PROJECT_ID） */
export const EMU_PROJECT = 'demo-diary-studio'

const FIRESTORE = 'http://127.0.0.1:8080'
const DOCS = `/v1/projects/${EMU_PROJECT}/databases/(default)/documents`

/** エミュレーターの Firestore に管理者の権限で頼む（返事の JSON を返す） */
export async function emulatorRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${FIRESTORE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  const text = await res.text()
  return text ? (JSON.parse(text) as unknown) : null
}

/** アクセスルールを入れ替える（本番の firestore.rules か、エミュレーター用の firestore.emu.rules） */
export async function useRules(content: string): Promise<void> {
  await emulatorRequest('PUT', `/emulator/v1/projects/${EMU_PROJECT}:securityRules`, {
    rules: { files: [{ name: 'firestore.rules', content }] },
  })
}

/** エミュレーターの文書を全部消す */
export async function clearFirestore(): Promise<void> {
  await emulatorRequest('DELETE', `/emulator/v1/projects/${EMU_PROJECT}/databases/(default)/documents`)
}

/** 持ち主の記録 config/owner を管理者の権限で作る（作者が Firebase の画面で作るのと同じ。形1・docs/manual/5-owner-record.md） */
export async function adminCreateOwner(uid: string): Promise<void> {
  await emulatorRequest('PATCH', `${DOCS}/config/owner`, {
    fields: { uid: { stringValue: uid }, createdAt: { timestampValue: new Date().toISOString() } },
  })
}

/** 持ち主の記録 config/owner を管理者の権限で消す（持ち主を移す途中など） */
export async function adminDeleteOwner(): Promise<void> {
  await emulatorRequest('DELETE', `${DOCS}/config/owner`)
}

/** 管理者の権限で、そのアカウントの記録の文書の id を並べる（アプリが何を書いたかを、ルールを通さずに見る） */
export async function adminRecordIds(uid: string): Promise<string[]> {
  const r = (await emulatorRequest('GET', `${DOCS}/users/${uid}/records?pageSize=300`)) as {
    documents?: { name: string }[]
  } | null
  return (r?.documents ?? []).map((d) => decodeURIComponent(d.name.split('/').pop() ?? ''))
}

/** 管理者の権限で文書があるかを見る（path は documents の下。例 'users/u/meta/app'） */
export async function adminExists(path: string): Promise<boolean> {
  const res = await fetch(`${FIRESTORE}${DOCS}/${path}`, { headers: { Authorization: 'Bearer owner' } })
  if (res.status === 404) return false
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`)
  return true
}
