// デイリー（docs/SPEC.md の 11.。1日の予定を、時刻の無い物のリストと、時刻のある物のタイムスケジュールに分けて見る）。
// いちばん上に日の見出し（40px）、その下に
// - L・M（幅の区分で決める。領域の幅では決めない）: 左に時間指定なしのリスト、右にタイムスケジュールを 4:6（間 16px）。左のリストは
//   上下に半分ずつ、上＝仕事・下＝プライベートの区切りで、それぞれの中だけでスクロールする。タイムスケジュールもその中だけで（11.1）
// - S: 上に時間指定なしのリスト（仕事 → プライベートの順に積む。高さは中身に合わせ、合わせて日の見出しより下の高さの 45% まで。
//   超えたらその中でスクロール）、下にタイムスケジュール（残りの高さ。その中でスクロール）（11.1・AMB-ITEMS-20）
// 見た目は dayModel.ts の buildDay で決め、ここでは描くだけ。予定を押すと詳細（12.3）。
// 段階2の後半（WP8B）でつなぐ所: 「＋ 予定を足す」→ すばやく足す（UntimedArea の onAdd）、空いた所 → 登録の画面（Timeline の onSlot）、
// 「+n」→ 隠れた予定の一覧（onMore）、マンスリーの数字から来た時に区切りと予定を目立たせる（useFlashTarget）、S・M のスワイプ
// （画面の枠 common/useSwipe がもう受けている）
import { useMemo } from 'react'
import { cls, useCalendarData } from '../common/parts'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'
import { DayHead } from './DayHead'
import { buildDay } from './dayModel'
import { Timeline } from './Timeline'
import { UntimedArea } from './UntimedArea'
import './day.css'

export function DayView({ viewed, today, width }: ViewProps) {
  const { list, off } = useCalendarData()
  const vm = useMemo(() => buildDay(viewed, list, off, today, width), [viewed, list, off, today, width])
  const stacked = width === 'S'
  return (
    <div className={cls('dy', stacked && 'is-stacked')} data-width={width} data-testid={testIds.view('day')}>
      <DayHead date={vm.head.date} dotted={vm.head.dotted} today={today} off={vm.head.off} />
      <div className="dy-main">
        <div className="dy-list">
          {vm.sections.map((s) => (
            <UntimedArea key={s.kind} date={viewed} section={s} />
          ))}
        </div>
        <Timeline date={viewed} today={today} timeline={vm.timeline} />
      </div>
    </div>
  )
}
