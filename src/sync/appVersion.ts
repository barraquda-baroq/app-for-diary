// アプリの版（package.json の version の x.y。src/sync/appVersion.test.ts で揃っていることを確かめる）。NS の src/sync/appVersion.ts から。
// 画面（ログインの画面の左下・設定）からも読むので、Firebase を読み込まない小さなファイルに分けている（appModel.ts は Firestore を使う）。

/** 記録に添えるアプリの版（古い版のアプリの画面で「どの版に更新すればよいか」を出すため） */
export const APP_VERSION = '0.1'

/**
 * このアプリが書くデータの形の版（今は 1）。表や項目の意味を変えたら上げる（src/sync/appModel.ts の DATA_MODEL。同期を受け持つタブの
 * 受け渡しで、Firebase を読み込まずに比べられるようにここに置く）
 */
export const DATA_MODEL = 1
