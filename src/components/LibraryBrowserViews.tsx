import { ArrowUpDown, Check, LibraryBig, Search, SlidersHorizontal } from 'lucide-react'
import { Fragment, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { type LibraryDefinition, type MediaItem } from '../data'
import {
  compareMediaEpisodes,
  compareMediaItems,
  getMediaAffiliation,
  isArchiveLibrary,
  type SortDirection,
  type SortMode,
} from '../domain/media'
import { DropdownSelect } from './DropdownSelect'
import { MediaWall } from './MediaWall'

type ViewMode = 'large' | 'list'

type BrowserOption = string | { value: string; label: string }

function BrowserControlSelect({
  icon,
  label,
  value,
  onChange,
  options,
  includeAll = true,
}: {
  icon: ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  options: BrowserOption[]
  includeAll?: boolean
}) {
  return (
    <DropdownSelect
      className="toolbar-select"
      prefix={
        <>
          <span className="toolbar-select-icon">{icon}</span>
          <span className="toolbar-select-label">{label}</span>
        </>
      }
      value={value}
      onChange={onChange}
      options={[
        ...(includeAll ? [{ value: 'all', label: '全部' }] : []),
        ...options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option)),
      ]}
    />
  )
}

export function LibraryBrowser({
  activeLibrary,
  queryActive,
  visibleItems,
  isAffiliationLibrary,
  isShelfLibrary,
  selectedAffiliation,
  selectedShelf,
  selectedIds,
  viewMode,
  primaryFilter,
  tagFilter,
  sortMode,
  sortDirection,
  primaryOptions,
  tagOptions,
  sortOptions,
  onBrowseStateChange,
  onReset,
  onClearSelection,
  onOpenAffiliation,
  onOpenShelf,
  onOpenItem,
  onToggleSelection,
  onOpenBatchMenu,
  onOpenBatchMenuForItems,
  onSelectMany,
  affiliationOverview,
  shelfOverview,
}: {
  activeLibrary: LibraryDefinition | null
  queryActive: boolean
  visibleItems: MediaItem[]
  isAffiliationLibrary: boolean
  isShelfLibrary: boolean
  selectedAffiliation: string | null
  selectedShelf: string | null
  selectedIds: string[]
  viewMode: ViewMode
  primaryFilter: string
  tagFilter: string
  sortMode: SortMode
  sortDirection: SortDirection
  primaryOptions: string[]
  tagOptions: string[]
  sortOptions: Array<{ value: SortMode; label: string }>
  onBrowseStateChange: (changes: { primaryFilter?: string; tagFilter?: string; sortMode?: SortMode; sortDirection?: SortDirection }) => void
  onReset: () => void
  onClearSelection: () => void
  onOpenAffiliation: (affiliation: string) => void
  onOpenShelf: (shelf: string) => void
  onOpenItem: (item: MediaItem) => void
  onToggleSelection: (item: MediaItem) => void
  onOpenBatchMenu: (item: MediaItem, event: React.MouseEvent<HTMLElement>) => void
  onOpenBatchMenuForItems: (items: MediaItem[], event: React.MouseEvent<HTMLElement>) => void
  onSelectMany: (items: MediaItem[]) => void
  affiliationOverview: ReactNode
  shelfOverview: ReactNode
}) {
  const showingContainer = Boolean(selectedAffiliation || selectedShelf)
  const sortDirectionOptions: BrowserOption[] =
    sortMode === 'title'
      ? [
          { value: 'ascending', label: 'A → Z' },
          { value: 'descending', label: 'Z → A' },
        ]
      : [
          { value: 'ascending', label: '旧 → 新' },
          { value: 'descending', label: '新 → 旧' },
        ]

  return (
    <section
      className="library-page"
      style={{ position: 'relative', zIndex: 1 }}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement
        if (
          !target.closest('.media-selection-surface') &&
          !target.closest(
            '[data-media-id], [data-group-key], button, input, select, textarea, a, [role="menu"], .dropdown-menu, .media-batch-menu',
          )
        )
          onClearSelection()
      }}
    >
      {!showingContainer && (
        <div className="control-bar">
          <div className="control-bar-group">
            <BrowserControlSelect
              icon={<SlidersHorizontal size={15} />}
              label={activeLibrary?.primaryLabel ?? '分类'}
              value={primaryFilter}
              onChange={(value) => onBrowseStateChange({ primaryFilter: value })}
              options={primaryOptions}
            />
            <BrowserControlSelect
              icon={<Check size={15} />}
              label="标签"
              value={tagFilter}
              onChange={(value) => onBrowseStateChange({ tagFilter: value })}
              options={tagOptions}
            />
          </div>
          <div className="control-bar-divider" />
          <div className="control-bar-group">
            <BrowserControlSelect
              icon={<ArrowUpDown size={15} />}
              label="排序"
              value={sortMode}
              onChange={(value) => onBrowseStateChange({ sortMode: value as SortMode })}
              includeAll={false}
              options={sortOptions}
            />
            <BrowserControlSelect
              icon={<ArrowUpDown size={15} />}
              label="方向"
              value={sortDirection}
              onChange={(value) => onBrowseStateChange({ sortDirection: value as SortDirection })}
              includeAll={false}
              options={sortDirectionOptions}
            />
          </div>
          <div className="toolbar-spacer" />
          <div className={`result-total library-item-count ${selectedIds.length > 0 ? 'has-selection' : ''}`}>
            <LibraryBig size={17} /> {selectedIds.length > 0 ? `已选 ${selectedIds.length} 项` : `${visibleItems.length} 项`}
          </div>
        </div>
      )}

      {visibleItems.length === 0 ? (
        <BrowserEmptyState onReset={onReset} />
      ) : isAffiliationLibrary && !queryActive && !selectedAffiliation ? (
        <AffiliationWall
          items={visibleItems}
          sortMode={sortMode}
          sortDirection={sortDirection}
          onOpen={onOpenAffiliation}
          selectedIds={selectedIds}
          onOpenBatchMenu={onOpenBatchMenuForItems}
          onSelectMany={onSelectMany}
        />
      ) : isAffiliationLibrary && !queryActive && selectedAffiliation ? (
        affiliationOverview
      ) : isShelfLibrary && !queryActive && !selectedShelf ? (
        <ArchiveLibraryView
          items={visibleItems}
          viewMode={viewMode}
          sortMode={sortMode}
          sortDirection={sortDirection}
          onOpenShelf={onOpenShelf}
          onOpenItem={onOpenItem}
          selectedIds={selectedIds}
          onToggleSelection={onToggleSelection}
          onOpenBatchMenu={onOpenBatchMenu}
          onOpenBatchMenuForItems={onOpenBatchMenuForItems}
          onSelectMany={onSelectMany}
        />
      ) : isShelfLibrary && !queryActive && selectedShelf ? (
        shelfOverview
      ) : (
        <MediaWall
          key={activeLibrary?.id ?? 'search'}
          items={visibleItems}
          viewMode={viewMode}
          deferRendering={Boolean(activeLibrary && isArchiveLibrary(activeLibrary.id))}
          onOpen={onOpenItem}
          selectedIds={selectedIds}
          onToggleSelection={onToggleSelection}
          onOpenBatchMenu={onOpenBatchMenu}
          onSelectMany={onSelectMany}
        />
      )}
    </section>
  )
}

function BrowserEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="empty-state">
      <Search size={30} />
      <h2>没有找到匹配的媒体</h2>
      <p>可以调整搜索范围、分类或标签筛选。</p>
      <button className="secondary-button" onClick={onReset}>
        清除筛选
      </button>
    </div>
  )
}

function isSelectionControl(target: HTMLElement) {
  if (target.closest('input, select, textarea, a, [role="menu"], .dropdown-menu, .media-batch-menu')) return true
  if (target.closest('[data-media-id], [data-group-key]')) return false
  const button = target.closest('button')
  return Boolean(button)
}

export function AffiliationWall({
  items,
  sortMode,
  sortDirection,
  onOpen,
  selectedIds = [],
  onOpenBatchMenu,
  onSelectMany,
}: {
  items: MediaItem[]
  sortMode: SortMode
  sortDirection: SortDirection
  onOpen: (affiliation: string) => void
  selectedIds?: string[]
  onOpenBatchMenu?: (items: MediaItem[], event: React.MouseEvent<HTMLElement>) => void
  onSelectMany?: (items: MediaItem[]) => void
}) {
  const groups = new Map<string, MediaItem[]>()
  for (const item of items) {
    const affiliation = getMediaAffiliation(item)
    const group = groups.get(affiliation) ?? []
    group.push(item)
    groups.set(affiliation, group)
  }
  const selectedIdSet = new Set(selectedIds)
  const entries = [...groups.entries()]
    .map(
      ([name, groupItems]) =>
        [
          name,
          groupItems,
          groupItems.reduce((best, item) => (compareMediaItems(item, best, sortMode, sortDirection) < 0 ? item : best)),
        ] as const,
    )
    .sort(([leftName, , left], [rightName, , right]) => {
      return compareMediaItems(left, right, sortMode, sortDirection) || leftName.localeCompare(rightName, 'zh-CN')
    })
  const usesPosterCards = entries[0]?.[1][0]?.library === 'erAnime' || entries[0]?.[1][0]?.library === 'anime'
  return (
    <GroupSelectionSurface
      className={`affiliation-wall ${usesPosterCards ? 'poster-affiliation-wall' : 'landscape-affiliation-wall'}`}
      groups={entries.map(([key, groupItems]) => ({ key, items: groupItems }))}
      selectedIds={selectedIds}
      onSelectMany={onSelectMany}
    >
      {(group, { selectRange }) => {
        const affiliation = group.key
        const episodes = group.items
        const coverItem = [...episodes].sort(compareMediaEpisodes)[0]
        const isCreator = coverItem.library === 'creator'
        return (
          <button
            data-group-key={affiliation}
            className={`affiliation-card ${episodes.every((item) => selectedIdSet.has(item.id)) ? 'selected' : ''}`}
            key={affiliation}
            onClick={(event) => {
              if (event.shiftKey) {
                event.preventDefault()
                selectRange()
                return
              }
              onOpen(affiliation)
            }}
            onContextMenu={(event) => onOpenBatchMenu?.(episodes, event)}
          >
            <div
              className={`cover-art affiliation-cover ${coverItem.library === 'erAnime' || coverItem.library === 'anime' ? 'poster-cover' : ''} ${isCreator ? 'creator-cover-placeholder' : ''}`}
              style={isCreator ? undefined : ({ background: coverItem.cover } as CSSProperties)}
            >
              {isCreator ? <span className="creator-cover-label">创作者</span> : <span className="cover-grain" />}
            </div>
            <span className="affiliation-card-info">
              <strong>{affiliation}</strong>
              <small>{episodes.length} 个选集</small>
            </span>
          </button>
        )
      }}
    </GroupSelectionSurface>
  )
}

export function ArchiveLibraryView({
  items,
  viewMode,
  sortMode,
  sortDirection,
  onOpenShelf,
  onOpenItem,
  selectedIds,
  onToggleSelection,
  onOpenBatchMenu,
  onOpenBatchMenuForItems,
  onSelectMany,
}: {
  items: MediaItem[]
  viewMode: ViewMode
  sortMode: SortMode
  sortDirection: SortDirection
  onOpenShelf: (shelf: string) => void
  onOpenItem: (item: MediaItem) => void
  selectedIds: string[]
  onToggleSelection: (item: MediaItem) => void
  onOpenBatchMenu: (item: MediaItem, event: React.MouseEvent<HTMLElement>) => void
  onOpenBatchMenuForItems: (items: MediaItem[], event: React.MouseEvent<HTMLElement>) => void
  onSelectMany: (items: MediaItem[]) => void
}) {
  const shelvedItems = items.filter((item) => Boolean(item.shelf?.trim()))
  const looseItems = items.filter((item) => !item.shelf?.trim())
  return (
    <div className="archive-library-view">
      {shelvedItems.length > 0 && (
        <BookshelfWall
          items={shelvedItems}
          sortMode={sortMode}
          sortDirection={sortDirection}
          onOpen={onOpenShelf}
          selectedIds={selectedIds}
          onSelectMany={onSelectMany}
          onOpenBatchMenu={onOpenBatchMenuForItems}
        />
      )}
      {looseItems.length > 0 && (
        <MediaWall
          key={`${looseItems[0]?.library ?? 'archive'}:loose`}
          items={looseItems}
          viewMode={viewMode}
          deferRendering
          onOpen={onOpenItem}
          selectedIds={selectedIds}
          onToggleSelection={onToggleSelection}
          onOpenBatchMenu={onOpenBatchMenu}
          onSelectMany={onSelectMany}
        />
      )}
    </div>
  )
}

export function BookshelfWall({
  items,
  sortMode,
  sortDirection,
  onOpen,
  selectedIds,
  onSelectMany,
  onOpenBatchMenu,
}: {
  items: MediaItem[]
  sortMode: SortMode
  sortDirection: SortDirection
  onOpen: (shelf: string) => void
  selectedIds: string[]
  onSelectMany: (items: MediaItem[]) => void
  onOpenBatchMenu: (items: MediaItem[], event: React.MouseEvent<HTMLElement>) => void
}) {
  const shelves = [
    ...items
      .reduce((result, item) => {
        const name = item.shelf?.trim() || ''
        const grouped = result.get(name) ?? []
        grouped.push(item)
        result.set(name, grouped)
        return result
      }, new Map<string, MediaItem[]>())
      .entries(),
  ]
    .map(
      ([name, groupItems]) =>
        [
          name,
          groupItems,
          groupItems.reduce((best, item) => (compareMediaItems(item, best, sortMode, sortDirection) < 0 ? item : best)),
        ] as const,
    )
    .sort(([leftName, , left], [rightName, , right]) => {
      return compareMediaItems(left, right, sortMode, sortDirection) || leftName.localeCompare(rightName, 'zh-CN')
    })
  const selectedIdSet = new Set(selectedIds)

  return (
    <GroupSelectionSurface
      className="bookshelf-wall"
      groups={shelves.map(([key, groupItems]) => ({ key, items: groupItems }))}
      selectedIds={selectedIds}
      onSelectMany={onSelectMany}
    >
      {(group, { selectRange }) => {
        const shelf = group.key
        const books = group.items
        return (
          <button
            data-group-key={shelf}
            className={`bookshelf-card ${books.every((book) => selectedIdSet.has(book.id)) ? 'selected' : ''}`}
            key={shelf}
            onClick={(event) => {
              if (event.shiftKey) {
                event.preventDefault()
                selectRange()
                return
              }
              onOpen(shelf)
            }}
            onContextMenu={(event) => onOpenBatchMenu(books, event)}
          >
            <div className="bookshelf-covers">
              {books.slice(0, 4).map((book) => (
                <span key={book.id} style={{ background: book.cover } as CSSProperties} />
              ))}
            </div>
            <strong>{shelf}</strong>
            <small>{books.length} 本</small>
          </button>
        )
      }}
    </GroupSelectionSurface>
  )
}

export function GroupSelectionSurface({
  className,
  groups,
  selectedIds,
  onSelectMany,
  children,
}: {
  className: string
  groups: Array<{ key: string; items: MediaItem[] }>
  selectedIds: string[]
  onSelectMany?: (items: MediaItem[]) => void
  children: (group: { key: string; items: MediaItem[] }, controls: { selectRange: () => void }) => React.ReactNode
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const dragStateRef = useRef<{ x: number; y: number; pointerId: number; active: boolean; selectedIds: Set<string> } | null>(null)
  const suppressClickRef = useRef(false)
  const selectionAnchorRef = useRef<string | null>(null)
  const groupByKey = useMemo(() => new Map(groups.map((group) => [group.key, group])), [groups])

  function selectRange(target: { key: string; items: MediaItem[] }) {
    if (!onSelectMany) return
    const anchorIndex = groups.findIndex((group) => group.key === selectionAnchorRef.current)
    const targetIndex = groups.findIndex((group) => group.key === target.key)
    if (anchorIndex < 0) selectionAnchorRef.current = target.key
    const range =
      anchorIndex >= 0 && targetIndex >= 0
        ? groups.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
        : [target]
    const selected = new Set(selectedIds)
    range.flatMap((group) => group.items).forEach((item) => selected.add(item.id))
    onSelectMany(groups.flatMap((group) => group.items).filter((item) => selected.has(item.id)))
  }

  function updateSelection(clientX: number, clientY: number, event?: React.PointerEvent<HTMLDivElement>) {
    const root = rootRef.current
    const state = dragStateRef.current
    if (!root || !onSelectMany) return
    if (!state) return
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
    for (const card of root.querySelectorAll<HTMLElement>('[data-group-key]')) {
      const rect = card.getBoundingClientRect()
      const group = card.dataset.groupKey ? groupByKey.get(card.dataset.groupKey) : undefined
      if (group && rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top)
        group.items.forEach((item) => ids.add(item.id))
    }
    onSelectMany(groups.flatMap((group) => group.items.filter((item) => ids.has(item.id))))
  }

  function startSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (!onSelectMany || event.button !== 0 || isSelectionControl(event.target as HTMLElement)) return
    const state = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      selectedIds: new Set(event.shiftKey ? selectedIds : []),
    }
    dragStateRef.current = { ...state, active: false }
  }

  function finishSelection(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current
    if (!state) return
    if (state?.active) {
      suppressClickRef.current = true
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 120)
    }
    dragStateRef.current = null
    setSelectionBox(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={rootRef}
      className={`${className} media-selection-surface`}
      onPointerDown={startSelection}
      onPointerDownCapture={(event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>('[data-group-key]')?.dataset.groupKey
        if (key && !event.shiftKey) selectionAnchorRef.current = key
      }}
      onPointerMove={(event) => updateSelection(event.clientX, event.clientY, event)}
      onPointerUp={(event) => {
        updateSelection(event.clientX, event.clientY, event)
        finishSelection(event)
      }}
      onPointerCancel={finishSelection}
      onLostPointerCapture={finishSelection}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        const target = event.target as HTMLElement
        if (!target.closest('[data-group-key], button, input, select, textarea, a, [role="menu"]')) onSelectMany?.([])
      }}
    >
      {groups.map((group) => (
        <Fragment key={group.key}>{children(group, { selectRange: () => selectRange(group) })}</Fragment>
      ))}
      {selectionBox && <span className="media-selection-box" style={selectionBox} />}
    </div>
  )
}
