// Firebase の Web アプリの設定値（公開してよい識別子。データはアクセスルールで本人だけに限る。docs/SPEC.md の 2.6）。
//
// DS の Firebase のプロジェクト diary-studio-35f4e（NS とは別。2026-11-10 に作者が作った）の、Firebase のコンソールの
// 「プロジェクトの設定 → マイアプリ → SDK の設定と構成」の値（docs/DEPLOY.md の 1 の 7）。変える時は .firebaserc のプロジェクトもそろえる
export const firebaseConfig = {
  apiKey: 'AIzaSyBjjPMhltGYCBezf8Ggos176Du0I_43wns',
  authDomain: 'diary-studio-35f4e.firebaseapp.com',
  projectId: 'diary-studio-35f4e',
  storageBucket: 'diary-studio-35f4e.firebasestorage.app',
  messagingSenderId: '232964262076',
  appId: '1:232964262076:web:487c11c47d97fa623468b9',
}

/** 設定値がまだ仮の値のまま（docs/DEPLOY.md の手順で差し替える前） */
export const firebaseConfigIsPlaceholder = firebaseConfig.apiKey.startsWith('REPLACE_')

/** 開発・テスト用の Firebase エミュレーターのプロジェクト名（docs/SPEC.md の 2.6） */
export const EMULATOR_PROJECT_ID = 'demo-diary-studio'
