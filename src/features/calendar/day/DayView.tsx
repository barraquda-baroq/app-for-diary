// デイリー（docs/SPEC.md の 11.。1日の予定を、時刻の無い物のリストと、時刻のある物のタイムスケジュールに分けて見る）。
// いちばん上に日の見出し（40px）、その下に
// - L・M（幅の区分で決める。領域の幅では決めない）: 左に時間指定なしのリスト、右にタイムスケジュールを 4:6（間 16px）。左のリストは
//   上下に半分ずつ、上＝仕事・下＝プライベートの区切りで、それぞれの中だけでスクロールする。タイムスケジュールもその中だけで（11.1）
// - S: 上に時間指定なしのリスト（仕事 → プライベートの順に積む。高さは中身に合わせ、合わせて日の見出しより下の高さの 45% まで。
//   超えたらその中でスクロール）、下にタイムスケジュール（残りの高さ。その中でスクロール）（11.1・AMB-ITEMS-20）
// 見た目は dayModel.ts の buildDay で決め、ここでは描くだけ。動き:
// - 予定・行を押すと詳細（12.3）、●・点線の丸を押すと完了（［元に戻す］付きのお知らせ。12.5）。どちらも部品の中
// - 「＋ 予定を足す」の行 → その日・その区分のすばやく足す（12.1。開いているのは1つだけ。見ている日が替わったら閉じる）
// - タイムスケジュールの空いた所 → 登録の画面（この日・押した所を 30分単位に切り捨てた時刻〜60分後・仕事。ITEMS-149）
// - 「+n」の札 → 隠れた予定の一覧（Timeline の中）
// - マンスリー（L・M）の数字から来た時は、押した側の区切りとタイムスケジュールのその区分の予定を目立たせる（各部品の useFlashTarget。
//   S のマンスリーからは目立たせない。D32）
// - S・M の指で左右になぞると前後の日へ（画面の枠 common/CalendarView の useSwipe）
// - 出している間は、予定を変える操作を元に戻す・やり直すの並びに積む（useUndoScope。操作をした所は日と見ている日。7.13・■28）
import { useCallback, useMemo, useState } from 'react'
import { tapToTimes } from '../../../domain/dayLayout'
import type { ItemKind } from '../../../domain/types'
import { cls, useCalendarData } from '../common/parts'
import { useItemSheets } from '../common/sheets'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'
import { useUndoScope } from '../common/useUndoScope'
import { DayHead } from './DayHead'
import { buildDay } from './dayModel'
import { Timeline } from './Timeline'
import { UntimedArea } from './UntimedArea'
import './day.css'

export function DayView({ viewed, today, width }: ViewProps) {
  const { list, off } = useCalendarData()
  const vm = useMemo(() => buildDay(viewed, list, off, today, width), [viewed, list, off, today, width])
  const { openRegister } = useItemSheets()
  useUndoScope('day', viewed)
  // すばやく足すを開いている日と区分（見ている日が替わったら閉じる。前の日へ戻っても開き直さない）
  const [adding, setAdding] = useState<{ date: string; kind: ItemKind } | null>(null)
  if (adding && adding.date !== viewed) setAdding(null)
  const addingKind = adding?.date === viewed ? adding.kind : null
  const onAdd = useCallback((kind: ItemKind) => setAdding({ date: viewed, kind }), [viewed])
  const onCloseAdd = useCallback(() => setAdding(null), [])
  const onSlot = useCallback(
    (minute: number) => openRegister({ start: viewed, ...tapToTimes(minute), kind: 'work' }),
    [openRegister, viewed],
  )
  const stacked = width === 'S'
  return (
    <div className={cls('dy', stacked && 'is-stacked')} data-width={width} data-testid={testIds.view('day')}>
      <DayHead date={vm.head.date} dotted={vm.head.dotted} today={today} off={vm.head.off} />
      <div className="dy-main">
        <div className="dy-list">
          {vm.sections.map((s) => (
            <UntimedArea
              key={s.kind}
              date={viewed}
              section={s}
              adding={addingKind === s.kind}
              onAdd={onAdd}
              onCloseAdd={onCloseAdd}
            />
          ))}
        </div>
        <Timeline date={viewed} today={today} timeline={vm.timeline} onSlot={onSlot} />
      </div>
    </div>
  )
}
