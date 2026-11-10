// Firebase のログイン（Google）の初期化。NS の src/sync/firebase.ts から、iPhone / Android のアプリ（Capacitor）の分岐を外した物
// （docs/SPEC.md の 2.2・2.3・2.5）。クラウドの保存先（Firestore）は src/sync/firestore.ts（同期を始める時に読み込む。起動の時に
// ログインの状態を確かめるだけなら、Firestore の大きな部品を読み込まずに済むように分けた）。
// PC はポップアップ、ホーム画面に追加した iPhone（navigator.standalone）とポップアップが塞がれた時はページを切り替える方式（リダイレクト）
import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  getRedirectResult,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { EMULATOR_PROJECT_ID, firebaseConfig } from './firebaseConfig'

/**
 * 開発・テスト用: エミュレーターのホスト（例: 127.0.0.1）。設定するとクラウドではなくエミュレーターにつなぐ。
 * 公開するビルドでは使わない（環境変数が残ったままビルドしても、公開したアプリがエミュレーターにつながらないように）
 */
export const emulatorHost: string | undefined = import.meta.env.DEV ? import.meta.env.VITE_FIREBASE_EMULATOR : undefined
// 公開するビルドでは false に決まり、エミュレーター用の分岐（プロジェクト名・テスト用のログイン）はビルドで消える
export const usingEmulator = import.meta.env.DEV && Boolean(emulatorHost)

/**
 * Firebase Hosting に置いた時は、ログインの画面も同じドメインで開く
 * （Safari などでサードパーティの保存領域が使えなくてもログインできるように）
 */
function authDomain(): string {
  if (typeof location !== 'undefined' && /\.(web\.app|firebaseapp\.com)$/.test(location.hostname)) return location.host
  return firebaseConfig.authDomain
}

export interface FirebaseServices {
  app: FirebaseApp
  auth: Auth
}

let services: FirebaseServices | null = null

export function firebase(): FirebaseServices {
  if (services) return services
  const app = initializeApp({
    ...firebaseConfig,
    authDomain: authDomain(),
    ...(usingEmulator ? { projectId: EMULATOR_PROJECT_ID } : {}),
  })
  // ログインの状態は端末に覚える（一度ログインした端末は、次からログインの画面を出さない。電波が無くても開ける）
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  })
  if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true })
  services = { app, auth }
  return services
}

export function watchUser(fn: (user: User | null) => void): () => void {
  return onAuthStateChanged(firebase().auth, fn)
}

/** ホーム画面に追加した iPhone のアプリなど、ポップアップが使いにくい環境 */
function prefersRedirect(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true
}

/** リダイレクトでログインに出かける印（戻ってきた時に、その結果を受け取るため。docs/SPEC.md の 6.13） */
export const REDIRECT_MARK = 'diary-studio:auth-redirect'

async function redirectSignIn(auth: Auth, provider: GoogleAuthProvider): Promise<void> {
  try {
    localStorage.setItem(REDIRECT_MARK, String(Date.now()))
  } catch {
    /* noop */
  }
  await signInWithRedirect(auth, provider)
}

export async function signInWithGoogle(): Promise<void> {
  const { auth } = firebase()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  if (prefersRedirect()) {
    await redirectSignIn(auth, provider)
    return
  }
  try {
    await signInWithPopup(auth, provider)
  } catch (e) {
    const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await redirectSignIn(auth, provider)
      return
    }
    throw e
  }
}

/** リダイレクトでログインして戻ってきた時の結果を受け取る */
export async function completeRedirect(): Promise<void> {
  try {
    await getRedirectResult(firebase().auth)
  } finally {
    try {
      localStorage.removeItem(REDIRECT_MARK)
    } catch {
      /* noop */
    }
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(firebase().auth)
}

/** テスト用: エミュレーターの仮のアカウントでログインする（開発サーバーだけ。公開するビルドでは中身がビルドで消える） */
export async function signInForTest(sub: string, email = `${sub}@example.com`): Promise<void> {
  if (!import.meta.env.DEV || !usingEmulator) throw new Error('エミュレーターを使っている時だけ使えます')
  const cred = GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: sub }))
  await signInWithCredential(firebase().auth, cred)
}

/** ログインの失敗を利用者向けの言葉にする（閉じただけなら null） */
export function describeAuthError(e: unknown): string | null {
  const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: unknown }).code) : ''
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled')
    return null
  if (code === 'auth/network-request-failed') return 'インターネットにつながっていないため、ログインできませんでした。'
  if (code === 'auth/unauthorized-domain')
    return 'このアドレスからはログインできません。Firebase の Authentication の「承認済みドメイン」に追加してください。'
  if (code === 'auth/popup-blocked') return 'ポップアップがブロックされました。ブラウザの設定で許可してください。'
  if (code === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.' || code === 'auth/invalid-api-key')
    return 'Firebase の設定がまだ仮の値です。docs/DEPLOY.md の手順で src/sync/firebaseConfig.ts を差し替えてください。'
  return `ログインできませんでした（${code || (e instanceof Error ? e.message : String(e))}）`
}
