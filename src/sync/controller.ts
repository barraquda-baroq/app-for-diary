// 同期の司令塔（段階0はログインの状態だけ）。NS の src/sync/controller.ts のうち、ログインの状態を見る部分を写した物。
// DS は最初にログインの画面を出す（docs/SPEC.md の 2.5）ので、NS と違い、起動のたびに Firebase（ログイン）を読み込んで状態を確かめる。
// 同期のエンジンを動かす部分・持ち主の確かめ・別のアカウントの確かめは段階1（データと同期）で足す
import { create } from 'zustand'

export interface SyncUser {
  uid: string
  name: string
  email: string
}

export interface SyncState {
  /** idle = まだ確かめていない、checking = 確かめている（Firebase を読み込んでいる） */
  auth: 'idle' | 'checking' | 'signedOut' | 'signedIn'
  user: SyncUser | null
  /** ログイン・ログアウトの途中 */
  busy: boolean
  /** ログインの画面に出す失敗の言葉 */
  error: string | null
}

const initial: SyncState = { auth: 'idle', user: null, busy: false, error: null }

export const useSync = create<SyncState>(() => ({ ...initial }))

const firebaseModule = () => import('./firebase')

let booted: Promise<void> | null = null
/** 画面のテスト用に、Firebase を使わずにログインした状態にしている（fakeSignInForTest） */
let faked = false

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function boot(): Promise<void> {
  booted ??= (async () => {
    // 画面のテスト用にもうログインした状態にしてあれば、その状態を上書きしない（確かめている間も 'signedIn' のまま）
    if (!faked) useSync.setState({ auth: 'checking' })
    try {
      const fb = await firebaseModule()
      fb.firebase()
      // リダイレクトでログインして戻ってきた時は、その結果を受け取る
      await fb.completeRedirect().catch((e) => {
        const text = fb.describeAuthError(e)
        if (text) useSync.setState({ error: text })
      })
      fb.watchUser((user) => {
        if (faked) return
        if (user) {
          useSync.setState({
            auth: 'signedIn',
            user: { uid: user.uid, name: user.displayName ?? '', email: user.email ?? '' },
            error: null,
          })
        } else {
          useSync.setState({ auth: 'signedOut', user: null })
        }
      })
    } catch (e) {
      // Firebase を読み込めない（初めて開いた時に電波が無い など）: ログインの画面を出す
      console.warn('ログインの状態を確かめられませんでした', e)
      if (!faked) useSync.setState({ auth: 'signedOut', user: null, error: message(e) })
    }
  })()
  return booted
}

/** 起動時に呼ぶ。ログインの状態を確かめ始める */
export function initSync(): Promise<void> {
  return boot()
}

/** ログインの状態が分かった（ログインの画面かトップ画面のどちらを出すか決まった）時に終わる */
export function whenAuthKnown(): Promise<void> {
  const known = (s: SyncState) => s.auth === 'signedIn' || s.auth === 'signedOut'
  if (known(useSync.getState())) return Promise.resolve()
  return new Promise((resolve) => {
    const off = useSync.subscribe((s) => {
      if (!known(s)) return
      off()
      resolve()
    })
  })
}

/** ［Google でログイン］ */
export async function signIn(): Promise<void> {
  useSync.setState({ busy: true, error: null })
  try {
    await boot()
    const fb = await firebaseModule()
    // リダイレクトでのログインが、Firebase を読み込んだ時点で済んでいることがある
    if (fb.firebase().auth.currentUser) return
    await fb.signInWithGoogle()
  } catch (e) {
    const fb = await firebaseModule().catch(() => null)
    const text = fb ? fb.describeAuthError(e) : message(e)
    if (text) useSync.setState({ error: text })
  } finally {
    useSync.setState({ busy: false })
  }
}

/** ［ログアウト］（ログインの画面に戻る。端末の中のデータは消さない） */
export async function signOut(): Promise<void> {
  useSync.setState({ busy: true, error: null })
  try {
    if (faked) {
      faked = false
      useSync.setState({ auth: 'signedOut', user: null })
      return
    }
    const fb = await firebaseModule()
    await fb.signOutUser()
  } catch (e) {
    useSync.setState({ error: message(e) })
  } finally {
    useSync.setState({ busy: false })
  }
}

/** テスト用: エミュレーターの仮のアカウントでログインする（開発サーバーだけ。公開するビルドでは中身がビルドで消える） */
export async function signInForTest(sub: string): Promise<void> {
  if (!import.meta.env.DEV) throw new Error('開発サーバーだけで使えます')
  await boot()
  const fb = await firebaseModule()
  await fb.signInForTest(sub)
}

/**
 * 画面のテスト用（開発サーバーだけ。src/main.tsx の window.__ds）: Firebase を使わずに、ログインした状態にする
 * （エミュレーターの無い E2E で、トップ画面・設定の画面を開くため）
 */
export function fakeSignInForTest(user: SyncUser = { uid: 'test-user', name: 'テスト', email: 'test@example.com' }): void {
  if (!import.meta.env.DEV) throw new Error('開発サーバーだけで使えます')
  faked = true
  useSync.setState({ auth: 'signedIn', user, error: null })
}

/** テスト用 */
export function resetSyncForTests(): void {
  booted = null
  faked = false
  useSync.setState({ ...initial })
}
