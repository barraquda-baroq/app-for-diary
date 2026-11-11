// データの形の版（users/{uid}/meta/app。docs/SPEC.md の 6.10・19.3）。新しい版のアプリが新しい形のデータを書いた後に、
// それを知らない古い版のアプリがクラウドへ書いて壊さないように、クラウドに「このデータを書いたアプリの形の版」を記録する。
// - この版（DATA_MODEL）より低い・記録が無い: この版に上げる（下げることはない。アクセスルールでも下げられない）
// - この版より高い: 受け取りは続け、送るのは止める（この端末の変更は送信待ちに残す）。画面で「要更新」と出す
// - 読めない・書けない（アクセスルールを公開する前など）: 止めずにそのまま同期する（記録が無いのと同じ扱い）。見張りが誤りで止まった時は
//   error を知らせ、エンジンが「確かめていない」扱いにして（送るトランザクションの中で読む）、少し後で見張り直す
// 持ち主ごとの文書にする（データ users/{uid}/records と一緒に）。NS の src/sync/appModel.ts をそのまま写した。
import { doc, onSnapshot, runTransaction, serverTimestamp, type Firestore, type Unsubscribe } from 'firebase/firestore'

/**
 * このアプリが書くデータの形の版（今は 1。値は src/sync/appVersion.ts）。表や項目の意味を変えたら上げる。段階6の Claude 用のコネクタも
 * 同じ値を持ち、違えば書き込まない（読むのは続ける。19.3）
 */
// 記録に添えるアプリの版（古い版のアプリの画面で「どの版に更新すればよいか」を出すため）
export { APP_VERSION, DATA_MODEL } from './appVersion'

export interface AppModel {
  model: number
  appVersion: string
}

export const appModelRef = (fs: Firestore, uid: string) => doc(fs, 'users', uid, 'meta', 'app')

/**
 * ok = 送ってよい、newer = 新しい版のアプリで書かれたデータがある（送らない）、
 * unknown = サーバーと確かめられなくなった（オフラインになった。つながってサーバーから届くまで送らない）、
 * error = 見張りが誤りで止まった（Firestore は誤りの後に見張りを閉じる。もう知らせは届かないので、確かめていない扱いにして
 * 見張り直す。src/sync/engine.ts）
 */
export type AppModelState = { state: 'ok' } | { state: 'unknown' } | { state: 'error' } | { state: 'newer'; cloud: AppModel }

/** 記録の内容（形の版が読めなければ null） */
export const asModel = (data: unknown): AppModel | null => {
  const d = data as { model?: unknown; appVersion?: unknown } | undefined
  if (!d || typeof d.model !== 'number' || !Number.isFinite(d.model)) return null
  return { model: d.model, appVersion: typeof d.appVersion === 'string' ? d.appVersion : '' }
}

/**
 * データの形の版を見張る。サーバーから届いた内容だけを見る（端末の中の控えは古いことがある）。
 * 記録が無い・低ければ、この版に上げる（トランザクションで読み直してから）。
 * 端末の中の控えからの通知（オフラインになった時に届く）は unknown として知らせる
 */
export function watchAppModel(fs: Firestore, uid: string, app: AppModel, onState: (s: AppModelState) => void): Unsubscribe {
  const ref = appModelRef(fs, uid)
  let raising = false
  const raise = async () => {
    if (raising) return
    raising = true
    try {
      await runTransaction(fs, async (tx) => {
        const snap = await tx.get(ref)
        const cur = snap.exists() ? asModel(snap.data()) : null
        if (cur && cur.model >= app.model) return
        tx.set(ref, { model: app.model, appVersion: app.appVersion, updatedAt: serverTimestamp() })
      })
    } catch (e) {
      console.warn('データの形の版を記録できませんでした', e)
    } finally {
      raising = false
    }
  }
  return onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.fromCache) {
        onState({ state: 'unknown' })
        return
      }
      const cur = snap.exists() ? asModel(snap.data()) : null
      if (cur && cur.model > app.model) {
        onState({ state: 'newer', cloud: cur })
        return
      }
      onState({ state: 'ok' })
      if (!cur || cur.model < app.model) void raise()
    },
    (err) => {
      // 「確かめた」とはしない（ok にすると、見張りが止まったまま、後で上がった版に気付かずに送り続ける）
      console.warn('データの形の版を読めませんでした', err)
      onState({ state: 'error' })
    },
  )
}
