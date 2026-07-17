import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { libraries, type LibraryId, type MediaItem } from '../data'
import { isArchiveLibrary } from '../domain/media'

export function MediaBatchMenu({
  position,
  items,
  onApplyShelf,
  onTransfer,
  onTrash,
  onClose,
}: {
  position: { x: number; y: number }
  items: MediaItem[]
  onApplyShelf: (shelf: string) => void
  onTransfer: (targetLibrary: LibraryId) => void
  onTrash: () => void
  onClose: () => void
}) {
  const [shelf, setShelf] = useState('')
  const canManageShelf = items.length > 0 && items.every((item) => item.kind === 'book')
  const canTransfer = items.length > 0 && items.every((item) => item.kind === items[0].kind)
  const targetLibraries = useMemo(
    () =>
      canTransfer
        ? libraries.filter(
            (library) => isArchiveLibrary(library.id) === canManageShelf && !items.some((item) => item.library === library.id),
          )
        : [],
    [canManageShelf, canTransfer, items],
  )
  const [targetLibrary, setTargetLibrary] = useState<LibraryId | ''>(targetLibraries[0]?.id ?? '')

  useEffect(() => {
    if (!targetLibraries.some((library) => library.id === targetLibrary)) setTargetLibrary(targetLibraries[0]?.id ?? '')
  }, [targetLibraries, targetLibrary])

  function submitShelf(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = shelf.trim()
    if (value) onApplyShelf(value)
  }

  return (
    <div
      className="media-batch-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <strong>已选择 {items.length} 项</strong>
      {targetLibraries.length > 0 && (
        <>
          <label>
            目标媒体库
            <select value={targetLibrary} onChange={(event) => setTargetLibrary(event.target.value as LibraryId)}>
              {targetLibraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!targetLibrary}
            onClick={() => {
              if (targetLibrary) onTransfer(targetLibrary)
            }}
          >
            转移到媒体库
          </button>
        </>
      )}
      {canManageShelf && (
        <form className="media-batch-shelf-form" onSubmit={submitShelf}>
          <label>
            书架名称
            <input value={shelf} onChange={(event) => setShelf(event.target.value)} placeholder="输入新书架或已有书架" autoFocus />
          </label>
          <button type="submit" className="secondary-button" disabled={!shelf.trim()}>
            加入书架
          </button>
          <button type="button" className="secondary-button" onClick={() => onApplyShelf('')}>
            从书架移除
          </button>
        </form>
      )}
      {targetLibraries.length === 0 && !canManageShelf && (
        <span className="media-batch-menu-hint">请只选择同类型，且不在同一目标媒体库中的资源。</span>
      )}
      {items.length > 0 && (
        <button type="button" className="danger-button media-trash-button" onClick={onTrash}>
          <Trash2 size={15} />
          移入回收站
        </button>
      )}
      <button type="button" className="text-button" onClick={onClose}>
        取消
      </button>
    </div>
  )
}
