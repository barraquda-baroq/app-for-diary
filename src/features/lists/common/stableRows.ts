// リストの中身のフック（task/useTaskList・routine/useRoutineList・favorite/useFavoriteList）が、作り直した行・かたまり・中身を、前に
// 作った物と中身が同じなら前の物に置き換える道具（docs/SPEC.md の 2.9。カレンダーの useCalendarData と同じ考え。FRAME-284）。
// 行の部品は記録ごとの React.memo なので、行が前と同じ物なら描き直さない（ほかの記録を直した時・1分ごとの今の時刻・ほかの表が
// 替わった時）。記録が同じでも、済み・戻る日・今日の太字のように行に出す物が替われば新しい行にする。
// 比べ方: 各欄を === で比べ、配列は同じ長さで1つずつ ===、配列でない物（日付の列の字 TaskDateText など）は中の欄を === で比べる
// （1段だけ。記録そのもの（item・routine・favorite）は前と同じ物の時だけ同じ）

/** 覚える所（記録ごとの WeakMap か、種類ごとの Map） */
interface Cache<K, V> {
  get(key: K): V | undefined
  set(key: K, value: V): unknown
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** 配列でない物の中の欄が全部 === で同じ */
function sameFields(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
}

/** 1つの欄の値が同じ（=== か、配列は1つずつ ===、配列でない物は中の欄が ===） */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i])
  }
  return isObject(a) && isObject(b) && Object.getPrototypeOf(a) === Object.getPrototypeOf(b) && sameFields(a, b)
}

/** 行・かたまり・中身に出す物が同じ（欄の名前が同じで、どの欄も sameValue） */
export function sameView(a: object, b: object): boolean {
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x)
  if (keys.length !== Object.keys(y).length) return false
  // 記録そのもの（item・routine・favorite）は中を見ず、同じ物の時だけ同じ（直した記録は新しい物になる）
  return keys.every(
    (k) => Object.hasOwn(y, k) && (k === 'item' || k === 'routine' || k === 'favorite' ? x[k] === y[k] : sameValue(x[k], y[k])),
  )
}

/** key で前に覚えた物と next が同じなら前の物を、違えば next を覚えて返す */
export function keep<K, V extends object>(cache: Cache<K, V>, key: K, next: V): V {
  const prev = cache.get(key)
  if (prev !== undefined && sameView(prev, next)) return prev
  cache.set(key, next)
  return next
}
