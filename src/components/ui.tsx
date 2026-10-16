import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { generatedCover } from '../lib/artwork'
import { fmtDuration, parseDuration } from '../lib/time'
import type { ItemKind } from '../lib/types'
import { KIND_LABEL, KIND_TAG } from '../lib/exporters'

// ---------------------------------------------------------------- icons

type IconName = 'plus' | 'x' | 'up' | 'down' | 'edit' | 'trash' | 'grip' | 'search' | 'mic' | 'radio' | 'check' | 'alert' | 'import' | 'download' | 'print' | 'clock' | 'folder' | 'save' | 'spark' | 'minus' | 'link'

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  edit: <path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" />,
  trash: <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" />,
  grip: (
    <>
      <circle cx="9" cy="6" r="1.3" fill="currentColor" />
      <circle cx="15" cy="6" r="1.3" fill="currentColor" />
      <circle cx="9" cy="12" r="1.3" fill="currentColor" />
      <circle cx="15" cy="12" r="1.3" fill="currentColor" />
      <circle cx="9" cy="18" r="1.3" fill="currentColor" />
      <circle cx="15" cy="18" r="1.3" fill="currentColor" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l5 5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </>
  ),
  radio: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17.2v.1" />,
  import: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  print: <path d="M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  folder: <path d="M3 7h6l2 2h10v10H3z" />,
  save: <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />,
  spark: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />,
}

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  )
}

export function KindIcon({ kind, className = 'h-5 w-5' }: { kind: ItemKind; className?: string }) {
  return <Icon name={kind === 'mic' ? 'mic' : kind === 'station' ? 'radio' : 'spark'} className={className} />
}

// ---------------------------------------------------------------- bits

export function KindChip({ kind }: { kind: ItemKind }) {
  return (
    <span className={`chip kind-${kind}`} title={KIND_LABEL[kind]}>
      {KIND_TAG[kind]}
    </span>
  )
}

export function Cover({ src, title, artist, className = 'h-12 w-12' }: { src?: string; title: string; artist: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const url = !src || failed ? generatedCover(title, artist) : src
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} shrink-0 rounded-[3px] border border-ink bg-paper-2 object-cover`}
    />
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; title?: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A trash button that asks once ("Sure?") before it acts. */
export function ConfirmButton({ onConfirm, label, className = 'btn btn-icon', children }: { onConfirm: () => void; label: string; className?: string; children?: ReactNode }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(t)
  }, [armed])
  return (
    <button
      type="button"
      className={`${className} ${armed ? '![--b:var(--color-pink)]' : ''}`}
      aria-label={armed ? `Confirm: ${label}` : label}
      title={armed ? 'Click again to confirm' : label}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? <span className="px-1 text-xs font-bold">Sure?</span> : (children ?? <Icon name="trash" className="h-5 w-5" />)}
    </button>
  )
}

/** Type "3:45", "225" or "3m45s". Enter or leaving the box saves, Esc cancels. */
export function DurationInput({ value, onCommit, label, className = '', allowEmpty = false }: { value: number | null; onCommit: (sec: number | null) => void; label: string; className?: string; allowEmpty?: boolean }) {
  const shown = value ? fmtDuration(value) : ''
  const [draft, setDraft] = useState(shown)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setDraft(shown)
    setBad(false)
  }, [shown])
  const commit = () => {
    const t = draft.trim()
    if (t === shown) return setBad(false)
    if (t === '') {
      if (allowEmpty) onCommit(null)
      else setDraft(shown)
      return
    }
    const sec = parseDuration(t)
    if (sec === null || sec <= 0 || sec > 6 * 3600) {
      setBad(true)
      return
    }
    setBad(false)
    onCommit(sec)
  }
  return (
    <input
      className={`field mono !min-h-[40px] !w-[5.4rem] !px-2 !py-1 text-center !text-[0.95rem] ${value ? '' : '!bg-mustard/60'} ${bad ? '!border-pink !bg-pink/30' : ''} ${className}`}
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? 'Use minutes and seconds, like 3:45' : 'Length (m:ss)'}
      inputMode="text"
      autoComplete="off"
      placeholder="m:ss"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        setBad(false)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setDraft(shown)
          setBad(false)
        }
      }}
    />
  )
}

/** -15s / +15s steppers for mic breaks and station elements. */
export function DurationStepper({ value, onChange, label, step = 15, min = 5 }: { value: number | null; onChange: (sec: number) => void; label: string; step?: number; min?: number }) {
  const v = value ?? 0
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="btn btn-icon btn-sm" aria-label={`Shorten ${label} by ${step} seconds`} onClick={() => onChange(Math.max(min, v - step))} disabled={v <= min}>
        <Icon name="minus" className="h-4 w-4" />
      </button>
      <DurationInput value={value} onCommit={(s) => s && onChange(s)} label={`${label} length`} />
      <button type="button" className="btn btn-icon btn-sm" aria-label={`Lengthen ${label} by ${step} seconds`} onClick={() => onChange(v + step)}>
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </span>
  )
}

// ---------------------------------------------------------------- modal

export function Modal({ title, onClose, children, size = 'md' }: { title: string; onClose: () => void; children: ReactNode; size?: 'md' | 'lg'; tape?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const root = ref.current!
    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null)
    root.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (f.length === 0) return e.preventDefault()
        const a = document.activeElement
        if (e.shiftKey && (a === f[0] || a === root)) {
          e.preventDefault()
          f[f.length - 1].focus()
        } else if (!e.shiftKey && a === f[f.length - 1]) {
          e.preventDefault()
          f[0].focus()
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`panel modal ${size === 'lg' ? '!max-w-[56rem]' : ''}`}>
        <div className="titlebar sticky top-0 z-10 !mx-0 !mb-0">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-icon btn-close" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="!mx-0 p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- popover menu

export function Menu({ label, icon, children, className = '', hideLabelOnPhone = false }: { label: string; icon?: IconName; children: (close: () => void) => ReactNode; className?: string; hideLabelOnPhone?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" className="btn btn-primary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon && <Icon name={icon} className="h-5 w-5" />}
        <span className={hideLabelOnPhone ? 'max-sm:sr-only' : ''}>{label}</span>
      </button>
      {open && (
        <div role="menu" className="paper absolute right-0 z-40 mt-2 w-64 max-w-[85vw] p-2 pop-in" style={{ boxShadow: 'var(--bevel-out), 3px 5px 12px rgba(10,40,90,.4)' }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, hint }: { icon?: IconName; children: ReactNode; onClick: () => void; hint?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex min-h-[44px] w-full items-center gap-3 px-3 py-2 text-left text-[0.92rem] font-bold hover:bg-[#1f63c8] hover:text-white focus-visible:bg-[#1f63c8] focus-visible:text-white">
      {icon && <Icon name={icon} className="h-5 w-5 shrink-0" />}
      <span>
        {children}
        {hint && <span className="block text-xs font-normal opacity-80">{hint}</span>}
      </span>
    </button>
  )
}
