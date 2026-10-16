import { useId } from 'react'

/**
 * Small glossy "Aero" illustrations. Every one is a plain SVG built from a
 * sphere or disc with a highlight, so they stay simple and match the windows.
 */

type P = { className?: string }

function Gloss({ id, from, to }: { id: string; from: string; to: string }) {
  return (
    <>
      <radialGradient id={`${id}-b`} cx="38%" cy="30%" r="75%">
        <stop offset="0" stopColor={from} />
        <stop offset="1" stopColor={to} />
      </radialGradient>
      <linearGradient id={`${id}-h`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".95" />
        <stop offset="1" stopColor="#fff" stopOpacity=".05" />
      </linearGradient>
    </>
  )
}

/** Header logo: a blue glass orb with a radio signal. */
export function Orb({ className = '' }: P) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <Gloss id={id} from="#9fe0ff" to="#0b4fb3" />
      </defs>
      <circle cx="32" cy="33" r="28" fill="#0a2a6a" opacity=".25" />
      <circle cx="32" cy="31" r="28" fill={`url(#${id}-b)`} stroke="#07387f" strokeWidth="2" />
      <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round">
        <path d="M20 31a12 12 0 0 1 24 0" opacity=".9" />
        <path d="M13 31a19 19 0 0 1 38 0" opacity=".55" />
      </g>
      <circle cx="32" cy="38" r="5" fill="#fff" />
      <ellipse cx="32" cy="15" rx="19" ry="10" fill={`url(#${id}-h)`} />
    </svg>
  )
}

/** Empty crate: a shiny CD. */
export function CdDisc({ className = '' }: P) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-d`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4fbff" />
          <stop offset=".3" stopColor="#b9e2f7" />
          <stop offset=".55" stopColor="#e9f7e0" />
          <stop offset=".8" stopColor="#a7d7f2" />
          <stop offset="1" stopColor="#eaf6ff" />
        </linearGradient>
      </defs>
      <ellipse cx="60" cy="108" rx="38" ry="6" fill="#0a2a6a" opacity=".18" />
      <circle cx="60" cy="58" r="50" fill={`url(#${id}-d)`} stroke="#5b7f99" strokeWidth="2" />
      <circle cx="60" cy="58" r="40" fill="none" stroke="#fff" strokeWidth="1.5" opacity=".7" />
      <circle cx="60" cy="58" r="16" fill="#d9ecf8" stroke="#5b7f99" strokeWidth="2" />
      <circle cx="60" cy="58" r="6" fill="#8fd0f2" stroke="#5b7f99" strokeWidth="1.5" />
      <path d="M22 40a42 42 0 0 1 40-26" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".85" />
    </svg>
  )
}

/** Empty show: a green glass orb holding a microphone. */
export function MicOrb({ className = '' }: P) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <defs>
        <Gloss id={id} from="#c9f6a2" to="#2c8f12" />
      </defs>
      <ellipse cx="60" cy="110" rx="36" ry="6" fill="#0a2a6a" opacity=".18" />
      <circle cx="60" cy="56" r="50" fill={`url(#${id}-b)`} stroke="#1f6a10" strokeWidth="2" />
      <rect x="48" y="26" width="24" height="42" rx="12" fill="#fff" stroke="#1f6a10" strokeWidth="2" />
      <path d="M40 54a20 20 0 0 0 40 0M60 74v14M48 88h24" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <path d="M40 54a20 20 0 0 0 40 0" fill="none" stroke="#1f6a10" strokeWidth="1.5" opacity=".5" />
      <ellipse cx="60" cy="24" rx="34" ry="16" fill={`url(#${id}-h)`} />
    </svg>
  )
}

/** All clear: a green orb with a check mark. */
export function CheckOrb({ className = '' }: P) {
  const id = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <Gloss id={id} from="#c9f6a2" to="#2c8f12" />
      </defs>
      <circle cx="32" cy="33" r="28" fill="#0a2a6a" opacity=".2" />
      <circle cx="32" cy="31" r="28" fill={`url(#${id}-b)`} stroke="#1f6a10" strokeWidth="2" />
      <path d="M19 32l9 9 17-19" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <ellipse cx="32" cy="15" rx="19" ry="10" fill={`url(#${id}-h)`} />
    </svg>
  )
}

/** Soft bubbles floating over the sky. Decorative only. */
export function Bubbles() {
  const bubbles = [
    { x: '6%', y: '18%', s: 96 },
    { x: '90%', y: '30%', s: 140 },
    { x: '78%', y: '72%', s: 70 },
    { x: '14%', y: '80%', s: 120 },
    { x: '52%', y: '8%', s: 54 },
    { x: '35%', y: '92%', s: 64 },
  ]
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            left: b.x,
            top: b.y,
            width: b.s,
            height: b.s,
            background: 'radial-gradient(circle at 32% 26%, rgb(255 255 255 / .9) 0 10%, rgb(255 255 255 / .25) 28%, rgb(180 230 255 / .12) 62%, rgb(255 255 255 / .5) 100%)',
            boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / .7), 0 4px 14px rgb(30 100 170 / .15)',
          }}
        />
      ))}
    </div>
  )
}
