// 小さなインライン SVG の線のアイコン集（外部依存なし。docs/SPEC.md の 4.10）。NS の src/ui/icons.tsx から、
// NS 専用の物（本・本棚・資料の本・比較・アイデアの電球・戦略の的・カメラ）を削り、DS の物（下の「DS で足したアイコン」）を足した。
// どれも 24 四方・線の太さ 1.8・端が丸い・文字と同じ色（currentColor）。大きさは CSS の .icon（18px）で決める
import type { ReactNode, SVGProps } from 'react'

/**
 * title を渡すと読み上げる絵（role="img"）になり、渡さなければ飾り（aria-hidden）になる。
 * small は 14px より小さく出す時（ロック・区分のかばん／家の 12px など）: 12px にして線を 2.4 にする（12px で線が 1.2px になり、
 * 等倍の画面でにじまない）
 */
export type IconProps = SVGProps<SVGSVGElement> & { title?: string; small?: boolean }

/** 線の太さ（ふつう） */
export const ICON_STROKE = 1.8
/** 線の太さ（14px より小さく出す時） */
export const ICON_STROKE_SMALL = 2.4

function Svg({ title, small, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={small ? 'icon icon-sm' : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={small ? ICON_STROKE_SMALL : ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)
export const UpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 15 6-6 6 6" />
  </Svg>
)
export const DownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
)
export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 6-6 6 6 6" />
  </Svg>
)
export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Svg>
)
/** 元に戻す（ゴミ箱から戻す） */
export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
)
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
  </Svg>
)
export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </Svg>
)
export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12 5 5 9-10" />
  </Svg>
)
export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)
export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </Svg>
)
export const DocIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
)
export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 4 2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.3 7 19l1.2-5.6L4 9.6 9.6 9z" />
  </Svg>
)
export const NoteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h14v11l-5 5H5z" />
    <path d="M14 20v-5h5" />
  </Svg>
)
/** 荷札（ラベル） */
export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1.4 1.4 0 0 1 0 2l-7.1 7.1a1.4 1.4 0 0 1-2 0z" />
    <circle cx="8.3" cy="8.3" r="1.4" />
  </Svg>
)

/** 虫めがね（探す） */
export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
)

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
)
export const SortIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3" />
  </Svg>
)
export const MoveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
)
export const ListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
)
export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
)
export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />
  </Svg>
)
export const MoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </Svg>
)
export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
)

// ---------- DS で足したアイコン（docs/SPEC.md の 4.10） ----------

/** 日付を選ぶ: 角丸の四角に上の2本の留め具と横線1本 */
export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M8 3v4M16 3v4M3.5 10h17" />
  </Svg>
)

/** ロック: 角丸の四角の上に半円の掛け金 */
export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
)

/** ［MIM］: 丸と軸と2つの歯 */
export const KeyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.5" cy="12" r="4" />
    <path d="M11.5 12h9M16.5 12v3M20 12v2.5" />
  </Svg>
)

/** QR を出す: 3つの角の四角と小さな四角 */
export const QrIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <rect x="15" y="15" width="4" height="4" rx="0.5" />
  </Svg>
)

/** 伏せる欄を見せる: 目の形 */
export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
)

/** 伏せる: 斜線付きの目 */
export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
    <path d="m4 4 16 16" />
  </Svg>
)

/** 仕事: 取っ手の付いた角丸の四角（かばん） */
export const BagIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="7.5" width="17" height="12.5" rx="2" />
    <path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2" />
  </Svg>
)

/** プライベート: 屋根と四角（家） */
export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M6 9.5V20h12V9.5" />
  </Svg>
)

/** 区分のアイコン（仕事＝かばん、プライベート＝家）。ディープダークでは区分をこれと位置だけで見分ける（docs/SPEC.md の 4.2） */
export const KindIcon = ({ kind, ...p }: IconProps & { kind: 'work' | 'private' }) =>
  kind === 'work' ? <BagIcon {...p} /> : <HomeIcon {...p} />

/** Routine List: 2本の矢印の輪 */
export const RepeatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m17 3 3 3-3 3" />
    <path d="M4 11.5V10a4 4 0 0 1 4-4h12" />
    <path d="m7 21-3-3 3-3" />
    <path d="M20 12.5V14a4 4 0 0 1-4 4H4" />
  </Svg>
)

/** Favorite List: ハート */
export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20 4.9 12.9a4.3 4.3 0 0 1 7.1-5.6 4.3 4.3 0 0 1 7.1 5.6z" />
  </Svg>
)

/** Task View: 3本の横線と左にチェック */
export const ListCheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 6h9M11 12h9M11 18h9" />
    <path d="m3.5 12 2.5 2.5L10 9.5" />
  </Svg>
)

/** 時刻: 丸と2本の針 */
export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)

/** 並べ替えのつまみ: 縦2列×3つの点 */
export const GripIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1.2" fill="currentColor" />
    <circle cx="15" cy="6" r="1.2" fill="currentColor" />
    <circle cx="9" cy="12" r="1.2" fill="currentColor" />
    <circle cx="15" cy="12" r="1.2" fill="currentColor" />
    <circle cx="9" cy="18" r="1.2" fill="currentColor" />
    <circle cx="15" cy="18" r="1.2" fill="currentColor" />
  </Svg>
)

/** MIM の印刷: 印刷機 */
export const PrintIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 9V4h10v5" />
    <path d="M7 17H5.5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H17" />
    <rect x="7" y="14" width="10" height="6" rx="1" />
  </Svg>
)

const CLOUD = 'M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18z'

/** 同期の表示: 雲 */
export const CloudIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d={CLOUD} />
  </Svg>
)

/** 同期の表示（オフライン・止まっている時）: 斜線付きの雲 */
export const CloudOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d={CLOUD} />
    <path d="m4 4 16 16" />
  </Svg>
)

/**
 * Claude からの提案の印（カード・行・詳細の提案の欄。docs/SPEC.md の 4.10・7.7・12.3）: 角の丸い吹き出しの中に点3つ。
 * 段階2で形とテストだけを足し、使うのは提案の画面を作る段階5（確かめ A20）
 */
export const ProposalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 4h11A3.5 3.5 0 0 1 21 7.5v6a3.5 3.5 0 0 1-3.5 3.5H12l-4.5 3.5V17h-1A3.5 3.5 0 0 1 3 13.5v-6A3.5 3.5 0 0 1 6.5 4z" />
    <circle cx="8" cy="10.5" r="1.1" fill="currentColor" />
    <circle cx="12" cy="10.5" r="1.1" fill="currentColor" />
    <circle cx="16" cy="10.5" r="1.1" fill="currentColor" />
  </Svg>
)

/** 点線の丸の、点と点の間（線の長さ 2.6px・すき間 2.6px。docs/SPEC.md の 4.11） */
const DOT_DASH = 2.6

/**
 * 点線の丸のチェック（docs/SPEC.md の 4.4・4.11）。見える丸は直径 18px（ウィークリーのカード・タイムスケジュールの予定は 16px）、
 * 線は 1.5px の点線、色は文字の色（.dot-check の --text-faint）。done は済み・完了: 丸を塗り、中に✓（色は .dot-check-mark の --surface）。
 * 乗せると実線にするのは CSS（.dot-check:hover）。押せる所・読み上げの名前は、包むボタン（.dot-check）に付ける
 */
export function DotCheckIcon({ done = false, size = 18, ...rest }: SVGProps<SVGSVGElement> & { done?: boolean; size?: 16 | 18 }) {
  const c = size / 2
  const r = (size - 1.5) / 2
  // 丸の周りに点がちょうど並ぶよう、線とすき間の長さを 2.6px 前後にそろえる（継ぎ目で点がつながらないように）
  const around = 2 * Math.PI * r
  const dash = Number((around / (2 * Math.max(1, Math.round(around / (2 * DOT_DASH))))).toFixed(3))
  const s = size / 18
  const n = (v: number) => Number((v * s).toFixed(2))
  return (
    <svg
      className="dot-check-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
      data-done={done ? 'true' : undefined}
      {...rest}
    >
      <circle
        className="dot-check-ring"
        cx={c}
        cy={c}
        r={r}
        fill={done ? 'currentColor' : 'none'}
        strokeDasharray={done ? undefined : `${dash} ${dash}`}
      />
      {done ? (
        <path
          className="dot-check-mark"
          d={`M${n(5.4)} ${n(9.3)}l${n(2.5)} ${n(2.5)} ${n(4.7)}-${n(5)}`}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  )
}
