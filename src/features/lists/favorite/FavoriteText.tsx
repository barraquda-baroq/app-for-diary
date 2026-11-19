// Favorite List の行の中身の字（docs/SPEC.md の 15.2）: 14px。改行で分けた行が2行以上なら1行目を少し太く（600。折り返しでなく改行で
// 数える）。中の URL（http・https だけ。詳細のメモと同じ item/itemForm.ts の memoParts）は押せるリンク（新しいタブ・
// rel="noopener noreferrer"。アプリの中の行き先には使わない）。長い物は3行まで見せ（折り返した行も数える）、超えた時だけ「続き」を
// 出して、押すと全部見せる（その行を出している間。読み込み直すとまた3行）。全部見せている間は同じボタンが「畳む」になり、押すと3行に
// 戻して「続き」に戻る（ボタンは置き換えないので、フォーカスもそのまま）。畳んだ時に「続き」が見える所の上に隠れれば（長い物を下まで
// 読み進めてから畳んだ時）、隠れた分だけすぐ送る（keepMoreInView。見えていれば送らない）。
// 字を押すと（リンクを除く）その場で直し始める（onEdit。押した出来事の中で呼ぶ。iPhone でもキーボードが出る）。リンクの無い物は字の
// 全体がボタン（キーボードでも直せる）、リンクのある物はリンクを中に持つのでボタンにせず、リンクの外を押すと直す（キーボードでは
// 行の「…」の［詳しく］のパネルで直す）。data-testid は list-favorite-title-{id}（字）・favorite-more-{id}（「続き」「畳む」）
import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { FavoriteRowView } from '../../../domain/favoriteList'
import { memoParts, type MemoPart } from '../../item/itemForm'
import { listTestIds } from '../common/testIds'

/** 字とリンクを並べる */
function renderParts(parts: MemoPart[]): ReactNode[] {
  return parts.map((p, i) =>
    'url' in p ? (
      <a key={i} className="fv-link" href={p.url} target="_blank" rel="noopener noreferrer">
        {p.url}
      </a>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  )
}

/** 縦にスクロールできる overflow */
const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/**
 * 畳んだ後、「続き」が見える所の上の端より上に隠れていれば、なめらかにせずすぐ、隠れた分だけ（いちばん小さく）送って、「続き」の上の
 * 端を見える所の上の端にそろえる。見えている時は動かさない（ページを跳ばさない）。送るのは「続き」を入れたいちばん近いスクロールする所
 * （L は右の列 .top-side）で、無ければページ（S・M）。見える所の上の端は、その箱の中の上の端（ページは画面の上の端）から「続き」の
 * scroll-margin-top だけ下（S・M は上に固定したヘッダーと切り替えの列の下。favorite.css）
 */
function keepMoreInView(el: HTMLElement): void {
  let box: HTMLElement | null = null
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (SCROLLS.has(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) {
      box = p
      break
    }
  }
  const margin = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0
  const lo = (box ? box.getBoundingClientRect().top + box.clientTop : 0) + margin
  // 隠れた高さ（ブラウザはスクロールの位置を整数の px にそろえることがあるので、切り上げて送る）
  const hidden = Math.ceil(lo - el.getBoundingClientRect().top)
  if (hidden <= 0) return
  if (box) box.scrollTo({ top: box.scrollTop - hidden, behavior: 'auto' })
  else window.scrollTo({ top: window.scrollY - hidden, behavior: 'auto' })
}

export interface FavoriteTextProps {
  row: FavoriteRowView
  /** その場で直し始める */
  onEdit: () => void
}

export function FavoriteText({ row, onEdit }: FavoriteTextProps) {
  const [expanded, setExpanded] = useState(false)
  /** 3行を超えている（「続き」を出す） */
  const [over, setOver] = useState(false)
  const text = useRef<HTMLSpanElement | null>(null)
  const more = useRef<HTMLButtonElement | null>(null)
  /** 「畳む」を押した（畳んだ後の描画で「続き」を見える所に残す） */
  const folding = useRef(false)
  const first = memoParts(row.firstLine)
  const rest = row.multiLine ? memoParts(row.rest) : []
  const hasLinks = [...first, ...rest].some((p) => 'url' in p)

  // 3行を超えているかを測る（字が替わった時と、幅が替わって折り返しが替わった時）
  useLayoutEffect(() => {
    const el = text.current
    if (!el || expanded) return
    const measure = () => setOver(el.scrollHeight > el.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(measure)
    o.observe(el)
    return () => o.disconnect()
  }, [row.firstLine, row.rest, expanded])

  // 「畳む」で3行に戻した描画で、「続き」が見える所の上に隠れていれば戻す（描く前に。ページが跳んで見えないように）
  useLayoutEffect(() => {
    if (expanded || !folding.current) return
    folding.current = false
    if (more.current) keepMoreInView(more.current)
  }, [expanded])

  const body = (
    <span ref={text} className={`fv-text${expanded ? '' : ' is-clamped'}`}>
      <span className={row.multiLine ? 'fv-first' : undefined}>{renderParts(first)}</span>
      {row.multiLine ? (
        <>
          {'\n'}
          {renderParts(rest)}
        </>
      ) : null}
    </span>
  )
  const onClick = (e: MouseEvent) => {
    // リンクを押した時は、そのリンクを開くだけ（直さない）
    if ((e.target as Element).closest('a')) return
    onEdit()
  }
  const testId = listTestIds.rowTitle('favorite', row.id)
  return (
    <div className="fv-body">
      {hasLinks ? (
        <div className="fv-text-box" onClick={onClick} data-testid={testId}>
          {body}
        </div>
      ) : (
        <button type="button" className="fv-text-box" onClick={onClick} data-testid={testId}>
          {body}
        </button>
      )}
      {over ? (
        <button
          ref={more}
          type="button"
          className="fv-more"
          aria-expanded={expanded}
          onClick={() => {
            folding.current = expanded
            setExpanded(!expanded)
          }}
          data-testid={listTestIds.favoriteMore(row.id)}
        >
          {expanded ? '畳む' : '続き'}
        </button>
      ) : null}
    </div>
  )
}
