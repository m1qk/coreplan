import { useApp } from '../app-context'
import { KIND_LABEL, timingText } from '../lib/exporters'
import { fmtClock, fmtClockShort, fmtDuration, fmtMinSec } from '../lib/time'

/**
 * The studio rundown. Hidden on screen, it is the only thing printed.
 * Black on white with a thin type rule so it works on any printer, and the
 * type is spelled out in words so a black-and-white printout loses nothing.
 */
export function PrintSheet() {
  const { show, timeline, validation: v } = useApp()
  const s = show.settings
  const rule = '1px solid #000'
  const th = { textAlign: 'left' as const, padding: '4px 6px', borderBottom: '2px solid #000', fontSize: '10pt' }
  const td = { padding: '5px 6px', borderBottom: '1px solid #bbb', fontSize: '10.5pt', verticalAlign: 'top' as const }
  const fill: Record<string, string> = { required: '#d8362b', personal: '#1f5fd6', mic: '#6a7078', station: '#14804a' }

  return (
    <div className="print-only" data-testid="print-sheet" style={{ fontFamily: 'Helvetica, Arial, sans-serif', color: '#000', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '3px solid #000', paddingBottom: 6, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: '20pt', fontWeight: 800, lineHeight: 1.1 }}>{s.showName.trim() || 'Untitled show'}</div>
          <div style={{ fontSize: '11pt', marginTop: 2 }}>
            {s.djName.trim() ? `DJ ${s.djName.trim()} · ` : ''}
            {s.date} · {fmtClockShort(timeline.startSec)} to {fmtClockShort(timeline.startSec + timeline.showDurationSec)}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '10pt' }}>
          <div style={{ fontWeight: 800, fontSize: '12pt' }}>90.3 The Core · WVPH</div>
          <div>
            Planned {fmtMinSec(timeline.totalSec)} of {fmtMinSec(timeline.showDurationSec)}
          </div>
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '10%' }}>Start</th>
            <th style={{ ...th, width: '10%' }}>End</th>
            <th style={{ ...th, width: '13%' }}>Type</th>
            <th style={th}>Title / artist / album</th>
            <th style={{ ...th, width: '8%' }}>Length</th>
            <th style={{ ...th, width: '13%' }}>Due</th>
            <th style={{ ...th, width: '6%' }}>Done</th>
          </tr>
        </thead>
        <tbody>
          {timeline.entries.map((e) => (
            <tr key={e.item.id} style={{ breakInside: 'avoid' }}>
              <td style={{ ...td, fontFamily: 'Courier New, monospace', fontWeight: 700, borderLeft: `8px solid ${fill[e.item.kind]}` }}>{fmtClock(e.start)}</td>
              <td style={{ ...td, fontFamily: 'Courier New, monospace' }}>{fmtClock(e.end)}</td>
              <td style={{ ...td, fontWeight: 700 }}>{KIND_LABEL[e.item.kind]}</td>
              <td style={td}>
                <div style={{ fontWeight: 700 }}>{e.item.title}</div>
                {(e.item.artist || e.item.album) && (
                  <div style={{ fontSize: '9.5pt' }}>
                    {e.item.artist}
                    {e.item.album ? ` · ${e.item.album}` : ''}
                  </div>
                )}
              </td>
              <td style={{ ...td, fontFamily: 'Courier New, monospace' }}>{fmtDuration(e.durationSec)}</td>
              <td style={{ ...td, fontSize: '9.5pt' }}>
                {e.target ? (
                  <>
                    {fmtClock(e.target.targetSec)}
                    <br />
                    <span style={{ fontWeight: e.severity === 'ok' ? 400 : 700 }}>
                      {timingText(e)}
                      {e.severity && e.severity !== 'ok' ? ' !' : ''}
                    </span>
                  </>
                ) : (
                  ''
                )}
              </td>
              <td style={td}>
                <span style={{ display: 'inline-block', width: 14, height: 14, border: rule }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12, fontSize: '10pt', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <span>
          <b>{v.requiredCount}</b> of {v.requiredNeeded} required songs
        </span>
        <span>
          <b>{v.micCount}</b> of {v.micNeeded} mic breaks
        </span>
        <span>
          Total <b>{fmtMinSec(timeline.totalSec)}</b> / {fmtMinSec(timeline.showDurationSec)}
        </span>
      </div>
      {v.issues.length > 0 && (
        <div style={{ marginTop: 8, fontSize: '9.5pt', border: rule, padding: 6 }}>
          <b>Still to check</b>
          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
            {v.issues.map((i) => (
              <li key={i.id}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
