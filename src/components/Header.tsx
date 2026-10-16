import { useRef } from 'react'
import { useApp } from '../app-context'
import { Orb } from './Art'
import { Icon, Menu, MenuItem } from './ui'
import { downloadText } from '../lib/download'
import { rundownCsv, rundownFileName, fileSafeName } from '../lib/exporters'
import { csvTemplate, libraryToCsv } from '../lib/csv'
import { buildShowFile } from '../lib/storage'

export function Header() {
  const { show, state, setDialog, saveStatus } = useApp()
  const name = show.settings.showName.trim() || 'Untitled show'
  return (
    <header className="relative z-20 px-3 pb-2 pt-3 min-[1100px]:px-5">
      <div className="flex items-center gap-2 sm:gap-3">
        <Orb className="bob h-[2.6rem] w-[2.6rem] shrink-0 drop-shadow-[0_2px_3px_rgba(0,30,80,.4)] sm:h-14 sm:w-14" />
        <div className="min-w-0">
          <h1 className="whitespace-nowrap text-[clamp(1.1rem,5.2vw,1.5rem)] font-bold italic leading-none tracking-tight text-[#0a2a6a] [text-shadow:0_1px_0_#fff,0_0_8px_rgba(255,255,255,.9)] sm:text-[2rem]">
            90.3 The Core
          </h1>
          <p className="mt-0.5 hidden text-sm font-bold text-[#1d4f8f] [text-shadow:0_1px_0_#fff] sm:block">Show Planner for DJs</p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn max-w-[16rem] max-sm:!px-0 max-sm:!min-w-[44px]" onClick={() => setDialog({ type: 'shows' })} aria-label={`Current show: ${name}. Open my shows`}>
            <Icon name="folder" className="h-5 w-5 shrink-0" />
            <span className="hidden truncate sm:inline">{name}</span>
            {state.shows.length > 1 && <span className="sticker !px-1.5 !py-0" style={{ ['--s' as string]: 'var(--color-pink)' }}>{state.shows.length}</span>}
          </button>
          <SaveBadge status={saveStatus} />
          <ExportMenu />
        </div>
      </div>
    </header>
  )
}

function SaveBadge({ status }: { status: ReturnType<typeof useApp>['saveStatus'] }) {
  const err = status.kind === 'error'
  return (
    <div
      role="status"
      aria-live="polite"
      title={err ? status.message : status.kind === 'saved' ? 'All changes are saved on this device' : 'Saving...'}
      className={`hidden items-center gap-1.5 rounded-[2px] border border-[#404040] px-3 py-1 text-sm font-bold shadow-[inset_1px_1px_0_#808080,inset_-1px_-1px_0_#fff] sm:flex ${err ? 'bg-pink text-ink' : 'bg-white/80 text-ink'}`}
    >
      <Icon name={err ? 'alert' : 'check'} className="h-4 w-4" />
      {err ? 'Not saved' : status.kind === 'saving' ? 'Saving...' : 'Saved'}
    </div>
  )
}

export function ExportMenu() {
  const { show, state, timeline, importShowFile, toast, saveStatus } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const label = (ext: string) => rundownFileName(show, ext)

  return (
    <>
      <Menu label="Save" icon="save" hideLabelOnPhone>
        {(close) => (
          <>
            {saveStatus.kind === 'error' && <p className="mb-1 rounded-[3px] bg-pink/40 p-2 text-sm font-bold">{saveStatus.message}</p>}
            <MenuItem
              icon="print"
              hint="Opens the print window. Choose “Save as PDF” as the printer."
              onClick={() => {
                close()
                window.setTimeout(() => window.print(), 50)
              }}
            >
              Print or save PDF
            </MenuItem>
            <MenuItem
              icon="download"
              hint="Open in Excel or Google Sheets"
              onClick={() => {
                downloadText(label('csv'), rundownCsv(show, timeline), 'text/csv')
                toast('Rundown saved as a CSV file.')
                close()
              }}
            >
              Rundown as CSV
            </MenuItem>
            <MenuItem
              icon="save"
              hint="Re-open it later or move it to another computer"
              onClick={() => {
                downloadText(`${fileSafeName(show.settings.showName || 'show')}-${show.settings.date}.core-show.json`, JSON.stringify(buildShowFile([show], state.library), null, 2), 'application/json')
                toast('Show file saved.')
                close()
              }}
            >
              Show file (.json)
            </MenuItem>
            <MenuItem
              icon="folder"
              onClick={() => {
                fileRef.current?.click()
                close()
              }}
            >
              Open a show file
            </MenuItem>
            <hr className="my-1 border-t border-[#808080]" />
            <MenuItem
              icon="download"
              hint="Every imported song, as CSV"
              onClick={() => {
                downloadText('my-crate.csv', libraryToCsv(state.library), 'text/csv')
                close()
              }}
            >
              Song crate as CSV
            </MenuItem>
            <MenuItem
              icon="download"
              hint="A sample to fill in and import"
              onClick={() => {
                downloadText('core-songs-template.csv', csvTemplate(), 'text/csv')
                close()
              }}
            >
              Blank song template
            </MenuItem>
          </>
        )}
      </Menu>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="Open a show file"
        tabIndex={-1}
        data-testid="show-file-input"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) await importShowFile(f)
        }}
      />
    </>
  )
}
