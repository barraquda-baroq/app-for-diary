// iPhone の端からのフリックの間に見える絵（docs/SPEC.md の 3.1）のための、画面の側の物。アプリの履歴（src/history/appHistory.ts の
// handlers。src/App.tsx が置く）と、小さな画面を開く所（src/features/calendar/common/sheets.ts）が使う。
// WebKit は、端からのフリックの間、行き先の履歴の絵を出す。絵は、その履歴を最後に離れた時（pushState・go・身振りの始まり）に、その時に
// 描かれていた画面を写した物（描く前の DOM ではなく、描き終えた画面）。なのでアプリが自分で履歴を動かす前に、画面をカレンダーだけに
// して描かせる。WebKit は、着いた後も、画面が描き直されて、ページの描く物の数が行き先の絵の半分を超えるなどするまで身振りの絵を外さない
// （長くて3秒）ので、モードを回した直後に、見えない描く物を足せるようにする
import { launchActive } from '../launch/launchHook'
import { currentPopSource } from '../ui/device'
import { calendarUncovered } from './appHistory'

/** カレンダーの上に出ている物（これがあると、絵を写さない）: 小さな画面・確かめ・メニュー・一覧・すばやく足すの入力欄・掴んだカード・めくる動き */
const OVER_CALENDAR = [
  '.modal-backdrop',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '.cp-quick',
  '[data-dnd-dragging]',
  '[data-dnd-dropping]',
  '.cal-turn',
].join(',')

/** 閉じる前に隠した小さな画面の印（src/styles.css で隠す） */
export const LEAVING_ATTR = 'data-ds-leaving'

/** 見えない描く物を入れる箱の id（src/styles.css の #ds-ballast） */
export const BALLAST_ID = 'ds-ballast'

/** カレンダーの上の物（すばやく足すの入力欄）が消えてから、まだ描かれていないとみなす長さ */
const GONE_RECENT_MS = 150

/** カレンダーの上の物が最後に消えた時刻 */
let goneAt = -Infinity

/**
 * カレンダーの上の物（すばやく足すの入力欄）が消えた（DOM から外れた。QuickAdd が知らせる）。外を押した時は、押した物（予定のカード）の
 * click より先に閉じて外れるので、開く時に DOM を見ても分からない。描かれるまでは、その物の写った画面が残っている。アプリの履歴には、
 * 消えた画面が描かれた後に、土台の前後の絵を写し直すかを確かめさせる（Esc・キーボードの完了で閉じた時は、押し終わりが無いので）
 */
export function overCalendarGone(): void {
  goneAt = performance.now()
  calendarUncovered(GONE_RECENT_MS)
}

/**
 * 画面がカレンダーだけか（ページが見えていて、起動アニメーションも上に出ている物も無く、上の物が消えてから描かれるまでの間でもない）
 */
export function screenIsClean(): boolean {
  if (document.visibilityState !== 'visible' || launchActive()) return false
  if (performance.now() - goneAt < GONE_RECENT_MS) return false
  return document.querySelector(OVER_CALENDAR) === null
}

/** 小さな画面と確かめを隠す（閉じる前。描く物も外す: display: none）。返す関数で、残っている物を出し直す */
export function hideSheets(): () => void {
  const hidden = [...document.querySelectorAll<HTMLElement>('.modal-backdrop')]
  for (const el of hidden) el.setAttribute(LEAVING_ATTR, '')
  return () => {
    for (const el of hidden) el.removeAttribute(LEAVING_ATTR)
  }
}

/**
 * ページの描く物の数の見積もり: 要素と、字のある文字の数（WebKit の描く物の数に近い。CSS で消した物・前後の飾り・字の中の分かれは
 * 数えない。どのモードでも同じ割合でずれるので、比べるのには使える）。見えない描く物は数えない
 */
export function renderWeight(): number {
  const body = document.body
  if (!body) return 0
  let count = body.getElementsByTagName('*').length
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) if (walker.currentNode.nodeValue?.trim()) count++
  const ballast = document.getElementById(BALLAST_ID)
  if (ballast) count -= ballast.childElementCount + 1
  return count
}

/** 見えない描く物を count 個にする（0 で外す。どれも大きさの無い箱の中で、見えず・押せず・読み上げない） */
export function setBallast(count: number): void {
  document.getElementById(BALLAST_ID)?.remove()
  if (count <= 0) return
  const box = document.createElement('div')
  box.id = BALLAST_ID
  box.setAttribute('aria-hidden', 'true')
  const items = document.createDocumentFragment()
  for (let i = 0; i < count; i++) items.appendChild(document.createElement('div'))
  box.appendChild(items)
  document.body.appendChild(box)
}

/** 画面を替えてから描かれたとみなすまでの、描く時の後の待ち（src/history/appHistory.ts の PAINT_MS と同じ） */
const PAINT_WAIT_MS = 50

/**
 * 小さな画面を開く（履歴に積む）前に: iPhone で、カレンダーの上に物が出ている・消えたばかりの時（すばやく足すの入力欄を開いたまま予定を
 * 押したなど）は、それが消えた画面が描かれてから開く（積む時にカレンダーの履歴の絵を写すので、入力欄を絵に残さない。閉じる物は押した
 * 時に閉じている）。ほかの時・ほかの端末は、すぐ開く
 */
export function whenScreenClean(open: () => void): void {
  if (currentPopSource() !== 'edge-flick' || screenIsClean()) {
    open()
    return
  }
  let done = false
  const run = () => {
    if (done) return
    done = true
    open()
  }
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(run, PAINT_WAIT_MS)))
  // 描かない時（見えていない）も開く
  setTimeout(run, 1000)
}
