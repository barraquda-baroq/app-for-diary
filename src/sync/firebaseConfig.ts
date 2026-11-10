// Firebase の Web アプリの設定値（公開してよい識別子。データはアクセスルールで本人だけに限る。docs/SPEC.md の 2.6）。
//
// いまは仮の値（差し替え用）。DS の Firebase のプロジェクト（NS とは別に新しく作る。例 diary-studio-xxxx）を作者が作ったら、
// docs/DEPLOY.md の手順で、Firebase のコンソールの「プロジェクトの設定 → マイアプリ → SDK の設定と構成」の値に差し替える
// （あわせて .firebaserc のプロジェクトも変える）。仮の値のままでは、ログインの画面の［Google でログイン］は失敗する
export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
  authDomain: 'diary-studio-xxxx.firebaseapp.com',
  projectId: 'diary-studio-xxxx',
  storageBucket: 'diary-studio-xxxx.firebasestorage.app',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
}

/** 設定値がまだ仮の値のまま（docs/DEPLOY.md の手順で差し替える前） */
export const firebaseConfigIsPlaceholder = firebaseConfig.apiKey.startsWith('REPLACE_')

/** 開発・テスト用の Firebase エミュレーターのプロジェクト名（docs/SPEC.md の 2.6） */
export const EMULATOR_PROJECT_ID = 'demo-diary-studio'
