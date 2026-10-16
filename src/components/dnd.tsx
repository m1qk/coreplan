import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useState, type ReactNode } from 'react'
import { useApp } from '../app-context'
import { Cover, KindChip } from './ui'
import { fmtDuration } from '../lib/time'
import type { ItemKind } from '../lib/types'

export const RUNDOWN_END = 'rundown-end'
export const LIB_PREFIX = 'lib:'

/**
 * One drag context for the whole planner so songs can be dragged from the
 * crate into the show, and rows can be reordered, with the same sensors.
 * Mouse: press and move 6px. Touch: press and hold briefly (so scrolling still
 * works). Keyboard: focus a row's grip, press Space, use arrows, Space to drop.
 */
export function PlannerDnd({ children }: { children: ReactNode }) {
  const { state, show, timeline, dispatch, toast } = useApp()
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onStart = (e: DragStartEvent) => setActiveId(String(e.active.id))
  const onEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const aid = String(active.id)
    const oid = String(over.id)
    if (aid.startsWith(LIB_PREFIX)) {
      const trackId = aid.slice(LIB_PREFIX.length)
      if (show.items.some((i) => i.trackId === trackId)) return toast('That song is already in this show.', 'info')
      if (oid === RUNDOWN_END) return dispatch({ type: 'item/addTrack', trackId })
      const idx = timeline.entries.findIndex((en) => en.item.id === oid)
      dispatch({ type: 'item/addTrack', trackId, atMergedIndex: idx >= 0 ? idx : undefined })
    } else if (aid !== oid && oid !== RUNDOWN_END) {
      dispatch({ type: 'item/reorder', activeId: aid, overId: oid })
    } else if (aid !== oid && oid === RUNDOWN_END) {
      const last = timeline.entries[timeline.entries.length - 1]
      if (last && last.item.id !== aid) dispatch({ type: 'item/reorder', activeId: aid, overId: last.item.id })
    }
  }

  let overlay: ReactNode = null
  if (activeId?.startsWith(LIB_PREFIX)) {
    const t = state.library.find((x) => x.id === activeId.slice(LIB_PREFIX.length))
    if (t) overlay = <DragCard title={t.title} sub={t.artist} kind={t.role} artwork={t.artwork} dur={t.durationSec} />
  } else if (activeId) {
    const en = timeline.entries.find((x) => x.item.id === activeId)
    if (en) overlay = <DragCard title={en.item.title} sub={en.item.artist} kind={en.item.kind} artwork={en.item.artwork} dur={en.durationSec} />
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActiveId(null)} accessibility={{ screenReaderInstructions: { draggable: 'To pick up a row, press space. Use the arrow keys to move it. Press space again to drop it, or escape to cancel.' } }}>
      {children}
      <DragOverlay dropAnimation={{ duration: 180 }}>{overlay}</DragOverlay>
    </DndContext>
  )
}

function DragCard({ title, sub, kind, artwork, dur }: { title: string; sub: string; kind: ItemKind; artwork?: string; dur: number | null }) {
  return (
    <div className={`kind-${kind} flex w-72 max-w-[80vw] items-center gap-3 rounded-[3px] border border-ink bg-paper p-2 shadow-[4px_6px_14px_rgba(10,40,90,.4)]`} style={{ transform: 'rotate(-2.5deg)' }}>
      <Cover src={artwork} title={title} artist={sub} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{title}</div>
        <div className="truncate text-sm text-[#3c3c3c]">{sub}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <KindChip kind={kind} />
        <span className="mono text-xs">{fmtDuration(dur)}</span>
      </div>
    </div>
  )
}
