// 祝日名（docs/SPEC.md の 7.2・4.7）。マンスリー（L・M）のマスの右上、ウィークリー・デイリーの日付の見出しに出す
// （S のマンスリーとイヤーは日付の色だけなので、出す・出さないは画面が決める）。ui 10px・400・行の高さ 1.2・--sun・1行。
// 名前は画面に出す形（「休日」→「国民の休日」、「… 振替休日」→「振替休日」。src/domain/holidays.ts）。祝日でない日は何も出さない
import { holidayName } from '../../../../domain/holidays'
import { cls } from './itemLook'
import './parts.css'

export interface HolidayNameProps {
  /** その日（'YYYY-MM-DD'） */
  date: string
  className?: string
}

export function HolidayName({ date, className }: HolidayNameProps) {
  const name = holidayName(date)
  if (!name) return null
  return (
    <span className={cls('cp-holiday', className)} title={name}>
      {name}
    </span>
  )
}
