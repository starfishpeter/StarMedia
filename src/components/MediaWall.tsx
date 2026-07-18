import { MoreHorizontal } from 'lucide-react'
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { libraryById, type MediaItem } from '../data'
import { getEpisodeCover, getMediaAffiliation, getMediaEpisode, getMediaShelf } from '../domain/media'
import { calculateVirtualGrid, type VirtualGridRange } from '../domain/virtual-grid'

type ViewMode = 'large' | 'list'

function isSelectionControl(target: HTMLElement) {
  if (target.closest('input, select, textarea, a, [role="menu"], .dropdown-menu, .media-batch-menu')) return true
  if (target.closest('[data-media-id], [data-group-key]')) return false
  return Boolean(target.closest('button'))
}

export function MediaWall({
  items,
  viewMode,
  deferRendering = false,
  onOpen,
  selectedIds = [],
  onToggleSelection,
  onOpenBatchMenu,
  onSelectMany,
}: {
  items: MediaItem[]
  viewMode: ViewMode
  deferRendering?: boolean
  onOpen: (item: MediaItem) => void
  selectedIds?: string[]
  onToggleSelection?: (item: MediaItem) => void
  onOpenBatchMenu?: (item: MediaItem, event: React.MouseEvent<HTMLElement>) => void
  onSelectMany?: (items: MediaItem[]) => void
}) {
  const wallRef = useRef<HTMLDivElement | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const dragStateRef = useRef<{ x: number; y: number; pointerId: number; active: boolean; selectedIds: Set<string> } | null>(null)
  const suppressCardClickRef = useRef(false)
  const selectionAnchorRef = useRef<string | null>(null)
  const virtualFrameRef = useRef<number | null>(null)
  const [virtualRange, setVirtualRange] = useState<VirtualGridRange | null>(null)
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const shouldVirtualize = deferRendering && viewMode === 'large' && items.length > 60

  useLayoutEffect(() => {
    if (!shouldVirtualize) {
      setVirtualRange(null)
      return
    }
    const root = wallRef.current
    const scroller = root?.closest<HTMLElement>('.main-content')
    if (!root || !scroller) return
    const measuredRoot = root
    const scrollContainer = scroller

    function updateRange() {
      const rootBounds = measuredRoot.getBoundingClientRect()
      const scrollerBounds = scrollContainer.getBoundingClientRect()
      const next = calculateVirtualGrid({
        itemCount: items.length,
        containerWidth: measuredRoot.clientWidth,
        viewportHeight: scrollContainer.clientHeight,
        scrollOffset: scrollerBounds.top - rootBounds.top,
        compact: window.matchMedia('(max-width: 1080px)').matches,
        overscanRows: 4,
      })
      setVirtualRange((current) =>
        current &&
        current.columns === next.columns &&
        current.startIndex === next.startIndex &&
        current.endIndex === next.endIndex &&
        Math.abs(current.windowTop - next.windowTop) < 0.5 &&
        Math.abs(current.totalHeight - next.totalHeight) < 0.5
          ? current
          : next,
      )
    }

    function scheduleRangeUpdate() {
      if (virtualFrameRef.current !== null) return
      virtualFrameRef.current = window.requestAnimationFrame(() => {
        virtualFrameRef.current = null
        updateRange()
      })
    }

    updateRange()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleRangeUpdate)
    observer?.observe(measuredRoot)
    scrollContainer.addEventListener('scroll', scheduleRangeUpdate, { passive: true })
    window.addEventListener('resize', scheduleRangeUpdate)
    return () => {
      observer?.disconnect()
      scrollContainer.removeEventListener('scroll', scheduleRangeUpdate)
      window.removeEventListener('resize', scheduleRangeUpdate)
      if (virtualFrameRef.current !== null) window.cancelAnimationFrame(virtualFrameRef.current)
      virtualFrameRef.current = null
    }
  }, [items.length, shouldVirtualize])

  const cancelDragSelection = useEffectEvent(() => {
    const state = dragStateRef.current
    if (!state) return
    dragStateRef.current = null
    setSelectionBox(null)
    const root = wallRef.current
    if (root?.hasPointerCapture?.(state.pointerId)) root.releasePointerCapture(state.pointerId)
  })

  useEffect(() => {
    window.addEventListener('blur', cancelDragSelection)
    return () => {
      window.removeEventListener('blur', cancelDragSelection)
      cancelDragSelection()
    }
  }, [])

  function selectCard(item: MediaItem, useRange: boolean) {
    const anchorId = selectionAnchorRef.current
    if (useRange && anchorId && onSelectMany) {
      const start = items.findIndex((candidate) => candidate.id === anchorId)
      const end = items.findIndex((candidate) => candidate.id === item.id)
      if (start >= 0 && end >= 0) {
        const selected = new Set(selectedIdSet)
        items.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((candidate) => selected.add(candidate.id))
        onSelectMany(items.filter((candidate) => selected.has(candidate.id)))
        return
      }
    }
    onToggleSelection?.(item)
    selectionAnchorRef.current = item.id
  }

  function updateDragSelection(clientX: number, clientY: number, event?: React.PointerEvent<HTMLDivElement>) {
    const root = wallRef.current
    const state = dragStateRef.current
    if (!root || !onSelectMany || !state) return
    if (!state.active && Math.hypot(clientX - state.x, clientY - state.y) < 8) return
    state.active = true
    try {
      event?.currentTarget.setPointerCapture(state.pointerId)
    } catch {
      // Pointer capture may be unavailable if the pointer was released by the browser.
    }
    event?.preventDefault()
    window.getSelection()?.removeAllRanges()
    const bounds = root.getBoundingClientRect()
    const left = Math.min(state.x, clientX)
    const top = Math.min(state.y, clientY)
    const right = Math.max(state.x, clientX)
    const bottom = Math.max(state.y, clientY)
    setSelectionBox({ left: left - bounds.left, top: top - bounds.top, width: right - left, height: bottom - top })
    const ids = new Set(state.selectedIds)
    for (const card of root.querySelectorAll<HTMLElement>('[data-media-id]')) {
      const rect = card.getBoundingClientRect()
      const id = card.dataset.mediaId
      if (id && rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) ids.add(id)
    }
    onSelectMany(items.filter((item) => ids.has(item.id)))
  }

  function startDragSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (!onSelectMany || event.button !== 0 || isSelectionControl(event.target as HTMLElement)) return
    event.preventDefault()
    dragStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      active: false,
      selectedIds: new Set(event.shiftKey ? selectedIds : []),
    }
  }

  function finishDragSelection(event?: React.PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current
    if (!state) return
    if (state.active) {
      suppressCardClickRef.current = true
      window.setTimeout(() => {
        suppressCardClickRef.current = false
      }, 120)
    }
    dragStateRef.current = null
    setSelectionBox(null)
    const root = event?.currentTarget ?? wallRef.current
    if (root?.hasPointerCapture?.(state.pointerId)) root.releasePointerCapture(state.pointerId)
  }

  const commonProps = {
    ref: wallRef,
    onPointerDown: startDragSelection,
    onPointerDownCapture: (event: React.PointerEvent<HTMLDivElement>) => {
      const itemId = (event.target as HTMLElement).closest<HTMLElement>('[data-media-id]')?.dataset.mediaId
      if (itemId && !event.shiftKey) selectionAnchorRef.current = itemId
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => updateDragSelection(event.clientX, event.clientY, event),
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      updateDragSelection(event.clientX, event.clientY, event)
      finishDragSelection(event)
    },
    onPointerCancel: finishDragSelection,
    onLostPointerCapture: finishDragSelection,
    onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressCardClickRef.current) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (!(event.target as HTMLElement).closest('[data-media-id], button, input, select, textarea, a, [role="menu"]')) onSelectMany?.([])
    },
  }
  if (viewMode === 'list') {
    return (
      <div className="media-list media-selection-surface" {...commonProps}>
        {items.map((item) => (
          <MediaListItem
            key={item.id}
            item={item}
            onOpen={onOpen}
            selected={selectedIdSet.has(item.id)}
            onToggleSelection={selectCard}
            onOpenBatchMenu={onOpenBatchMenu}
          />
        ))}
        {selectionBox && <span className="media-selection-box" style={selectionBox} />}
      </div>
    )
  }
  if (shouldVirtualize) {
    const range = virtualRange ?? {
      columns: 1,
      startIndex: 0,
      endIndex: Math.min(items.length, 48),
      windowTop: 0,
      totalHeight: 0,
    }
    const ready = virtualRange !== null
    return (
      <div
        className={`virtual-media-wall media-selection-surface ${viewMode} ${ready ? 'ready' : ''}`}
        style={ready ? { height: `${range.totalHeight}px` } : undefined}
        {...commonProps}
      >
        <div
          className="media-wall virtual-media-window"
          style={
            ready
              ? {
                  top: `${range.windowTop}px`,
                  gridTemplateColumns: `repeat(${range.columns}, minmax(0, 1fr))`,
                }
              : undefined
          }
        >
          {items.slice(range.startIndex, range.endIndex).map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onOpen={onOpen}
              selected={selectedIdSet.has(item.id)}
              onToggleSelection={selectCard}
              onOpenBatchMenu={onOpenBatchMenu}
            />
          ))}
        </div>
        {selectionBox && <span className="media-selection-box" style={selectionBox} />}
      </div>
    )
  }
  return (
    <div className={`media-wall media-selection-surface ${viewMode}`} {...commonProps}>
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          onOpen={onOpen}
          selected={selectedIdSet.has(item.id)}
          onToggleSelection={selectCard}
          onOpenBatchMenu={onOpenBatchMenu}
        />
      ))}
      {selectionBox && <span className="media-selection-box" style={selectionBox} />}
    </div>
  )
}

export function MediaCard({
  item,
  compact = false,
  onOpen,
  selected = false,
  onToggleSelection,
  onOpenBatchMenu,
}: {
  item: MediaItem
  compact?: boolean
  onOpen: (item: MediaItem) => void
  selected?: boolean
  onToggleSelection?: (item: MediaItem, useRange: boolean) => void
  onOpenBatchMenu?: (item: MediaItem, event: React.MouseEvent<HTMLElement>) => void
}) {
  return (
    <button
      data-media-id={item.id}
      className={`media-card ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`}
      onClick={(event) => {
        if (event.shiftKey) {
          event.preventDefault()
          onToggleSelection?.(item, true)
          return
        }
        onOpen(item)
      }}
      onContextMenu={(event) => onOpenBatchMenu?.(item, event)}
    >
      <div
        className={`cover-art ${item.kind === 'video' ? 'video-cover' : ''}`}
        style={{ background: getEpisodeCover(item) } as CSSProperties}
      >
        <span className="cover-grain" />
      </div>
      <span className="media-card-info">
        <strong>{item.title}</strong>
        <small>
          {item.kind === 'video'
            ? `${getMediaAffiliation(item)} · ${getMediaEpisode(item)}`
            : `${item.creator || getMediaShelf(item)} · ${item.duration}`}
        </small>
      </span>
    </button>
  )
}

function MediaListItem({
  item,
  onOpen,
  selected = false,
  onToggleSelection,
  onOpenBatchMenu,
}: {
  item: MediaItem
  onOpen: (item: MediaItem) => void
  selected?: boolean
  onToggleSelection?: (item: MediaItem, useRange: boolean) => void
  onOpenBatchMenu?: (item: MediaItem, event: React.MouseEvent<HTMLElement>) => void
}) {
  const library = libraryById[item.library]
  return (
    <button
      data-media-id={item.id}
      className={`media-list-item ${selected ? 'selected' : ''}`}
      onClick={(event) => {
        if (event.shiftKey) {
          event.preventDefault()
          onToggleSelection?.(item, true)
          return
        }
        onOpen(item)
      }}
      onContextMenu={(event) => onOpenBatchMenu?.(item, event)}
    >
      <div className="list-cover" style={{ background: getEpisodeCover(item) } as CSSProperties} />
      <div className="list-main">
        <strong>{item.title}</strong>
        <small>
          {library.label} · {item.kind === 'video' ? getMediaAffiliation(item) : item.creator || getMediaShelf(item)}
        </small>
      </div>
      <span className="list-tag">{item.tags[0]}</span>
      <span className="list-meta">{item.kind === 'video' ? item.releaseDate || '-' : item.releaseDate || item.firstAiredAt || '-'}</span>
      <span className="list-meta">{item.duration}</span>
      <span className="list-progress">{item.kind === 'video' ? '视频' : '压缩包'}</span>
      <MoreHorizontal size={18} className="list-more" />
    </button>
  )
}
