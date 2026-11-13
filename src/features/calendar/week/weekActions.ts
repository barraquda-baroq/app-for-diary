// ウィークリーの中の操作（docs/SPEC.md の 10.2・10.4・7.4・7.12・12.1）を、画面の部品へ渡す形。WeekView が useWeekActions で
// 1つだけ作って渡す。予定を押すと詳細（12.3）は、カード・始点のカード・受けた表示・●・＞が useItemSheets().openDetail を自分で
// 呼ぶので、ここには無い。完了の丸（お知らせと［元に戻す］）も共通の部品（DoneToggle）が自分でする。
// - 日付の見出し（丸いラベル＋「11/8」）→ その日のデイリーへ（積む。見ている日はその日。7.12・CALENDAR-192）
// - 休みのチェック → その日の休みを付ける・外す（offDays の off を切り替えるだけ。記録は消さない。6.5・7.4・D33）。元に戻す・やり直すの
//   並びに積む（お知らせは出さない。7.13）
// - 「＋」の行 → その日・その段のすばやく足す（12.1）。その「＋」の行が、その場で1行の入力欄に替わる（D44）。開くのはいつも1か所
//   だけで、ほかの「＋」を押すとそちらへ移る（前の入力欄は外を押したので、字があれば足して閉じる）。週を移ると閉じる
import { useCallback, useMemo, useState } from 'react'
import { undoText } from '../../../domain/itemText'
import type { ItemKind } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData } from '../../../store/appStore'
import { attempt } from '../../../store/uiStore'
import { recordStep } from '../../../store/undoStore'
import { useCalendarNav } from '../common/useCalendarRoute'

/** 開いているすばやく足す（その日・その段） */
export interface QuickTarget {
  date: string
  kind: ItemKind
}

export interface WeekActions {
  /** 日付の見出し（曜日の丸いラベル＋「11/8」）を押した: その日のデイリーへ（7.12） */
  openDay: (date: string) => void
  /** 休みのチェックを押した: その日の休みを付ける・外す（off は押した後の値。7.4） */
  setOff: (date: string, off: boolean) => void
  /** 「＋」の行を押した: その日・その段のすばやく足すを開く（12.1） */
  quickAdd: (date: string, kind: ItemKind) => void
  /** 開いているすばやく足す（無ければ null） */
  quick: QuickTarget | null
  /** すばやく足すを閉じた（Esc・Tab は書きかけを控えたまま。外を押した・キーボードを閉じた時は、字があれば足してから。12.1） */
  closeQuick: () => void
}

/** その「＋」の行の所にすばやく足すが開いているか */
export const isQuickOpen = (quick: QuickTarget | null, date: string, kind: ItemKind): boolean =>
  quick !== null && quick.date === date && quick.kind === kind

/** ウィークリーの中の操作（sunday は見ている週の日曜。週が替わると開いているすばやく足すを閉じる） */
export function useWeekActions(sunday: string): WeekActions {
  const nav = useCalendarNav()
  const [open, setOpen] = useState<(QuickTarget & { sunday: string }) | null>(null)
  // 週を移ったら閉じる（戻ってきた時に開き直さない）
  if (open && open.sunday !== sunday) setOpen(null)
  const quick = open && open.sunday === sunday ? open : null

  const quickAdd = useCallback((date: string, kind: ItemKind) => setOpen({ date, kind, sunday }), [sunday])
  const closeQuick = useCallback(() => setOpen(null), [])
  return useMemo(
    () => ({
      openDay: (date) => nav.openDay(date),
      setOff: (date, off) => {
        const before = Boolean(getData().offDays[date]?.off)
        if (attempt(() => (actions.setOffDay(date, off), true))) {
          recordStep(undoText.off(date, off), [
            { table: 'offDays', id: date, before, after: Boolean(getData().offDays[date]?.off) },
          ])
        }
      },
      quickAdd,
      quick,
      closeQuick,
    }),
    [nav, quickAdd, quick, closeQuick],
  )
}
