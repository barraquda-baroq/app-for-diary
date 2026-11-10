// クラウドの保存先（Firestore）の初期化（docs/SPEC.md の 2.1・2.4）。NS の src/sync/firebase.ts の Firestore の部分を、同期を始める時に
// 読み込む小さなファイルに分けた（起動の時はログインの状態を確かめるだけなので、Firestore の大きな部品を読み込まない）。
// 端末の中の控えは持たない memoryLocalCache（端末の中のデータは Dexie が持つ）。
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore'
import { emulatorHost, firebase } from './firebase'

let instance: Firestore | null = null

export function firestore(): Firestore {
  if (instance) return instance
  const fs = initializeFirestore(firebase().app, { localCache: memoryLocalCache() })
  if (emulatorHost) connectFirestoreEmulator(fs, emulatorHost, 8080)
  instance = fs
  return fs
}
