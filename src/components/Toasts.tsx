import { useApp } from '../app-context'
import { Icon } from './ui'

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-3 min-[1100px]:bottom-6" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          data-testid="toast"
          data-kind={t.kind}
          className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-[3px] border border-ink px-3 py-2 font-bold shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#808080] ${t.kind === 'error' ? 'bg-pink' : t.kind === 'info' ? 'bg-paper' : 'bg-mustard'}`}
          style={{ animation: 'slide-up 220ms cubic-bezier(0.2,0.9,0.3,1.1) both' }}
        >
          <Icon name={t.kind === 'error' ? 'alert' : 'check'} className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="flex-1">{t.text}</span>
          <button type="button" className="-m-1 rounded p-1 hover:bg-ink/10" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
