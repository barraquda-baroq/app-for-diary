// デイリーの日の見出し（docs/SPEC.md の 11.1・7.1〜7.4・D21・D40）。高さ 40px の1行に、曜日の丸いラベル（今日は今日の印）＋
// 等幅の「2026.11.10」（日曜・祝日は --sun、土曜は --sat）＋祝日名（見出しの行の中。「休日」→「国民の休日」など）＋休みなら「休」。
// 休みの日は、この行だけを --off-fill にする（左の区切りの地とタイムスケジュールの縞は変えない。D40）。ここでは休みを付け外しできない
// （休みはウィークリーのチェックで付けるので、元に戻す・やり直すで休みを当てた時は、デイリーで押してもウィークリーへ戻って、その日の
// 見出しを目立たせる。7.13・■28。この行にも同じ目立たせる印を付けているのは、操作をした所を覚えていない操作のためで、ふつうは出ない）
import { jaDateLabel } from '../../../domain/dates'
import { cls, DayPill, dayTone, flashKey, HolidayName, OffMark, useFlashTarget } from '../common/parts'
import { testIds } from '../common/testIds'
import './day.css'

export interface DayHeadProps {
  date: string
  /** 「2026.11.10」 */
  dotted: string
  today: string
  off: boolean
}

export function DayHead({ date, dotted, today, off }: DayHeadProps) {
  const tone = dayTone(date)
  const flashRef = useFlashTarget<HTMLDivElement>(flashKey.dayHead(date))
  return (
    <div
      ref={flashRef}
      className={cls('dy-head', off && 'cp-offday')}
      data-off={off ? 'true' : undefined}
      data-testid={testIds.dayHead}
    >
      <DayPill date={date} today={today} off={off} />
      <span className={cls('mono', 'dy-date', tone && `cp-${tone}`)}>
        <span aria-hidden="true">{dotted}</span>
        <span className="visually-hidden">{jaDateLabel(date)}</span>
      </span>
      <HolidayName date={date} className="dy-holiday" />
      {off ? <OffMark /> : null}
    </div>
  )
}
