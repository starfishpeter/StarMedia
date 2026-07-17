import { AlertTriangle, Database, FolderInput, FolderOpen, Search, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { libraries, libraryById, type LibraryId } from '../data'
import { isArchiveLibrary } from '../domain/media'

export type ImportStatus = 'idle' | 'scanning' | 'ready' | 'error'
export type ImportOperation = 'idle' | 'importing'
export type ImportTarget = LibraryId | 'auto'
export type ImportProgress = { stage?: 'importing' | 'thumbnails' | 'saving'; current: number; total: number; fileName?: string }
type ImportPlanChanges = Partial<Pick<StarMediaImportPlanItem, 'library' | 'affiliation' | 'shelf' | 'episode' | 'replacementItemId'>>

function isSelectionControl(target: HTMLElement) {
  return Boolean(target.closest('input, select, textarea, button, a, [role="menu"], .dropdown-menu, .media-batch-menu'))
}

export function ImportView({
  sourcePaths,
  targetLibrary,
  onTargetLibraryChange,
  plan,
  status,
  error,
  apiAvailable,
  onSourcePathsChange,
  onPickSource,
  onGeneratePlan,
  onScanManagedLibraries,
  onImportRecords,
  importOperation,
  importProgress,
  onPlanItemChange,
  onPlanItemsChange,
}: {
  sourcePaths: string[]
  targetLibrary: ImportTarget
  onTargetLibraryChange: (value: ImportTarget) => void
  plan: StarMediaImportPlan | null
  status: ImportStatus
  error: string | null
  apiAvailable: boolean
  onSourcePathsChange: (value: string[]) => void
  onPickSource: () => void
  onGeneratePlan: () => void
  onScanManagedLibraries: () => void
  onImportRecords: () => void
  importOperation: ImportOperation
  importProgress: ImportProgress | null
  onPlanItemChange: (itemId: string, changes: ImportPlanChanges) => void
  onPlanItemsChange: (itemIds: string[], changes: ImportPlanChanges) => void
}) {
  const [dragActive, setDragActive] = useState(false)
  const canGeneratePlan = apiAvailable && sourcePaths.length > 0 && status !== 'scanning'

  function pathsFromFiles(files: FileList) {
    return Array.from(files)
      .map((file) => window.starMedia?.getPathForFile?.(file) ?? '')
      .filter(Boolean)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    const paths = pathsFromFiles(event.dataTransfer.files)
    if (paths.length > 0) onSourcePathsChange(paths)
  }

  if (plan && importOperation === 'importing') {
    return (
      <section className="utility-page import-page import-progress-page">
        <ImportProgressView progress={importProgress} />
      </section>
    )
  }

  if (plan) {
    return (
      <section className="utility-page import-page import-plan-page">
        <ImportPlanPreview
          plan={plan}
          onReset={() => onSourcePathsChange([])}
          onImportRecords={onImportRecords}
          importOperation={importOperation}
          onItemChange={onPlanItemChange}
          onItemsChange={onPlanItemsChange}
        />
      </section>
    )
  }

  return (
    <section className="utility-page import-page">
      <article className="settings-card import-uploader-card">
        <div className="import-form">
          <div className="collection-import-options">
            <label>
              目标媒体库
              <select value={targetLibrary} onChange={(event) => onTargetLibraryChange(event.target.value as ImportTarget)}>
                <option value="auto">自动识别</option>
                {libraries.map((library) => (
                  <option key={library.id} value={library.id}>
                    {library.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            className={`upload-dropzone ${dragActive ? 'drag-active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
          >
            <UploadCloud size={42} />
            <strong>拖动文件或文件夹到这里</strong>
            <div className="upload-actions">
              <button className="primary-button" onClick={onPickSource} disabled={!apiAvailable}>
                <FolderOpen size={16} />
                上传文件/文件夹
              </button>
              <button className="secondary-button" onClick={onScanManagedLibraries} disabled={!apiAvailable || status === 'scanning'}>
                <Search size={16} />
                扫描媒体库目录
              </button>
            </div>
          </div>
          {sourcePaths.length > 0 && (
            <div className="source-list" aria-label="已选择来源">
              <strong>已选择 {sourcePaths.length} 个来源</strong>
              {sourcePaths.slice(0, 5).map((source) => (
                <span key={source} title={source}>
                  {source}
                </span>
              ))}
              {sourcePaths.length > 5 && <em>还有 {sourcePaths.length - 5} 个来源</em>}
            </div>
          )}
          <button className="primary-button import-plan-button" onClick={onGeneratePlan} disabled={!canGeneratePlan}>
            <Search size={17} />
            {status === 'scanning' ? '正在扫描来源…' : '生成导入计划'}
          </button>
          {error && (
            <div className="inline-error">
              <AlertTriangle size={15} />
              {error}
            </div>
          )}
        </div>
      </article>
    </section>
  )
}

function ImportProgressView({ progress }: { progress: ImportProgress | null }) {
  const total = Math.max(1, progress?.total ?? 1)
  const current = Math.min(total, Math.max(0, progress?.current ?? 0))
  const percent = Math.round((current / total) * 100)
  const stage = progress?.stage ?? 'importing'
  const title = stage === 'thumbnails' ? '正在生成缩略图' : stage === 'saving' ? '正在保存媒体库' : '正在导入资源'
  const copy =
    stage === 'thumbnails'
      ? '正在为新导入的资源生成缩略图。'
      : stage === 'saving'
        ? '正在写入媒体库记录，即将完成。'
        : '正在移动文件并写入媒体库。'
  const count = stage === 'saving' ? '完成导入，正在收尾' : `${current} / ${total}`
  return (
    <article className="settings-card import-progress-card">
      <div className="card-title">
        <FolderInput size={18} />
        <div>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
      </div>
      <div className="import-progress-track">
        <i style={{ width: `${percent}%` }} />
      </div>
      <strong>{count}</strong>
    </article>
  )
}

function ImportPlanPreview({
  plan,
  onReset,
  onImportRecords,
  importOperation,
  onItemChange,
  onItemsChange,
}: {
  plan: StarMediaImportPlan
  onReset: () => void
  onImportRecords: () => void
  importOperation: ImportOperation
  onItemChange: (itemId: string, changes: ImportPlanChanges) => void
  onItemsChange: (itemIds: string[], changes: ImportPlanChanges) => void
}) {
  const pageSize = 100
  const [page, setPage] = useState(0)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [batchLibrary, setBatchLibrary] = useState<LibraryId | ''>('')
  const planTableRef = useRef<HTMLDivElement | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const planDragStateRef = useRef<{ x: number; y: number; pointerId: number; active: boolean; selectedIds: Set<string> } | null>(null)
  const suppressPlanClickRef = useRef(false)
  const pageCount = Math.max(1, Math.ceil(plan.items.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const previewItems = plan.items.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const isMixedPlan = plan.targetLibrary === 'auto'
  const isVideoPlan = plan.targetLibrary === 'auto' ? false : !isArchiveLibrary(plan.targetLibrary)
  const canExecute = plan.items.some((item) => item.status === 'ready' && Boolean(item.targetPath))
  const selectedItemIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds])
  const selectedItems = plan.items.filter((item) => selectedItemIdSet.has(item.id) && item.status === 'ready')
  const selectedArchiveKind = selectedItems.length > 0 ? isArchiveLibrary(selectedItems[0].library) : null
  const canBatchChangeLibrary =
    isMixedPlan && selectedArchiveKind !== null && selectedItems.every((item) => isArchiveLibrary(item.library) === selectedArchiveKind)
  const batchLibraries = useMemo(
    () => (canBatchChangeLibrary ? libraries.filter((library) => isArchiveLibrary(library.id) === selectedArchiveKind) : []),
    [canBatchChangeLibrary, selectedArchiveKind],
  )
  const selectablePlanItems = plan.items.filter((item) => item.status === 'ready')
  const allPlanItemsSelected = selectablePlanItems.length > 0 && selectablePlanItems.every((item) => selectedItemIdSet.has(item.id))

  useEffect(() => {
    setPage(0)
    setSelectedItemIds([])
    setSelectionAnchorId(null)
    setBatchLibrary('')
  }, [plan.planId])

  useEffect(() => {
    if (batchLibraries.length === 0) {
      if (batchLibrary) setBatchLibrary('')
      return
    }
    if (!batchLibraries.some((library) => library.id === batchLibrary)) setBatchLibrary(batchLibraries[0].id)
  }, [batchLibraries, batchLibrary])

  function toggleItemSelection(itemId: string, useRange = false) {
    if (useRange && selectionAnchorId) {
      const start = selectablePlanItems.findIndex((item) => item.id === selectionAnchorId)
      const end = selectablePlanItems.findIndex((item) => item.id === itemId)
      if (start >= 0 && end >= 0) {
        const range = selectablePlanItems.slice(Math.min(start, end), Math.max(start, end) + 1).map((item) => item.id)
        setSelectedItemIds((ids) => [...new Set([...ids, ...range])])
        return
      }
    }
    setSelectedItemIds((ids) => (ids.includes(itemId) ? ids.filter((id) => id !== itemId) : [...ids, itemId]))
    setSelectionAnchorId(itemId)
  }

  function togglePreviewSelection() {
    const planIds = new Set(selectablePlanItems.map((item) => item.id))
    setSelectedItemIds((ids) => (allPlanItemsSelected ? ids.filter((id) => !planIds.has(id)) : [...new Set([...ids, ...planIds])]))
  }

  function updatePlanDragSelection(clientX: number, clientY: number, event?: React.PointerEvent<HTMLDivElement>) {
    const root = planTableRef.current
    const state = planDragStateRef.current
    if (!root || !state) return
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
    for (const row of root.querySelectorAll<HTMLElement>('[data-plan-id]')) {
      const rect = row.getBoundingClientRect()
      const id = row.dataset.planId
      if (id && rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) ids.add(id)
    }
    const next = [...ids]
    setSelectedItemIds((current) => (current.length === next.length && current.every((id, index) => id === next[index]) ? current : next))
  }

  function startPlanDragSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      importOperation !== 'idle' ||
      selectablePlanItems.length === 0 ||
      isSelectionControl(event.target as HTMLElement)
    )
      return
    planDragStateRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
      active: false,
      selectedIds: new Set(event.shiftKey ? selectedItemIds : []),
    }
  }

  function finishPlanDragSelection(event: React.PointerEvent<HTMLDivElement>) {
    const state = planDragStateRef.current
    if (!state) return
    if (state.active) {
      suppressPlanClickRef.current = true
      window.setTimeout(() => {
        suppressPlanClickRef.current = false
      }, 0)
    }
    planDragStateRef.current = null
    setSelectionBox(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function applyBatchLibrary() {
    if (!batchLibrary || selectedItems.length === 0 || !canBatchChangeLibrary) return
    onItemsChange(
      selectedItems.map((item) => item.id),
      { library: batchLibrary },
    )
  }

  async function openTargetPath(item: StarMediaImportPlanItem) {
    if (!item.targetPath || !window.starMedia?.openPath) return
    try {
      await window.starMedia.openPath(item.targetPath)
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <article className="settings-card import-plan-card">
      <div className="plan-card-header">
        <div className="card-title">
          <Database size={18} />
          <div>
            <h2>导入计划预览</h2>
            <p>确认后按预览目标移动文件，并写入本地索引。</p>
          </div>
        </div>
        <div className="plan-card-actions">
          <button className="secondary-button" onClick={onReset} disabled={importOperation !== 'idle'}>
            重新选择
          </button>
          {canExecute && (
            <button className="primary-button" onClick={onImportRecords} disabled={importOperation !== 'idle'}>
              <FolderInput size={17} />
              {importOperation === 'importing' ? '正在导入…' : '确认导入'}
            </button>
          )}
        </div>
      </div>
      <div className="plan-summary-grid">
        <PlanMetric label="扫描文件" value={plan.totalFiles} />
        <PlanMetric label="可导入" value={plan.acceptedCount} tone="ready" />
        <PlanMetric label="需配置" value={plan.blockedCount} tone="blocked" />
        <PlanMetric label="不支持" value={plan.unsupportedCount} tone="unsupported" />
      </div>
      {selectedItems.length > 0 && (
        <div className="plan-bulk-actions">
          <strong>已选择 {selectedItems.length} 项</strong>
          {canBatchChangeLibrary ? (
            <>
              <select
                value={batchLibrary}
                onChange={(event) => setBatchLibrary(event.target.value as LibraryId)}
                disabled={importOperation !== 'idle'}
              >
                {batchLibraries.map((library) => (
                  <option key={library.id} value={library.id}>
                    {library.label}
                  </option>
                ))}
              </select>
              <button
                className="secondary-button small-button"
                onClick={applyBatchLibrary}
                disabled={importOperation !== 'idle' || !batchLibrary}
              >
                批量修改媒体库
              </button>
            </>
          ) : (
            <span>请只选择同一媒体类型的可导入文件。</span>
          )}
          <button className="text-button" onClick={() => setSelectedItemIds([])} disabled={importOperation !== 'idle'}>
            取消选择
          </button>
        </div>
      )}
      {plan.truncated && (
        <div className="inline-warning">
          <AlertTriangle size={15} />
          {buildPlanWarning(plan)}
        </div>
      )}
      {plan.errors.length > 0 && (
        <div className="inline-warning">
          <AlertTriangle size={15} />
          扫描中有 {plan.errors.length} 个目录或文件无法读取，未中断整体计划。
        </div>
      )}
      <div
        ref={planTableRef}
        className={`plan-table media-selection-surface ${isVideoPlan ? 'is-video-plan' : ''} ${isMixedPlan ? 'is-mixed-plan' : ''}`}
        role="table"
        aria-label="导入计划预览"
        onPointerDown={startPlanDragSelection}
        onPointerMove={(event) => updatePlanDragSelection(event.clientX, event.clientY, event)}
        onPointerUp={(event) => {
          updatePlanDragSelection(event.clientX, event.clientY, event)
          finishPlanDragSelection(event)
        }}
        onPointerCancel={finishPlanDragSelection}
        onLostPointerCapture={finishPlanDragSelection}
        onClickCapture={(event) => {
          if (suppressPlanClickRef.current) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <div className="plan-table-row plan-table-head" role="row">
          <span>
            <input
              className="plan-row-check"
              type="checkbox"
              aria-label="选择当前计划所有可导入文件"
              checked={allPlanItemsSelected}
              onChange={togglePreviewSelection}
              disabled={selectablePlanItems.length === 0 || importOperation !== 'idle'}
            />
          </span>
          <span>状态</span>
          <span>来源文件</span>
          {isMixedPlan && <span>媒体库</span>}
          {(isVideoPlan || isMixedPlan) && <span>选集</span>}
          <span>大小</span>
          <span>目标</span>
        </div>
        {previewItems.map((item) => {
          const itemIsVideo = !isArchiveLibrary(item.library)
          const compatibleLibraries = libraries.filter((library) => isArchiveLibrary(library.id) === !itemIsVideo)
          return (
            <div
              data-plan-id={item.id}
              className={`plan-table-row ${selectedItemIdSet.has(item.id) ? 'selected' : ''}`}
              role="row"
              key={item.id}
              onClick={(event) => {
                if (item.status !== 'ready' || importOperation !== 'idle' || (event.target as HTMLElement).closest('input, select, button'))
                  return
                toggleItemSelection(item.id, event.shiftKey)
              }}
            >
              <span>
                <input
                  className="plan-row-check"
                  type="checkbox"
                  aria-label={`选择 ${item.relativePath}`}
                  checked={selectedItemIdSet.has(item.id)}
                  onChange={(event) => toggleItemSelection(item.id, (event.nativeEvent as MouseEvent).shiftKey)}
                  disabled={item.status !== 'ready' || importOperation !== 'idle'}
                />
              </span>
              <span>
                <ImportStatusBadge status={item.status} />
              </span>
              <span title={item.sourcePath}>
                {item.relativePath}
                {item.sidecars?.length ? ` + ${item.sidecars.length} 个关联文件` : ''}
              </span>
              {isMixedPlan && (
                <span>
                  {item.status === 'ready' ? (
                    <select
                      className="plan-category-select"
                      value={item.library}
                      onChange={(event) => onItemChange(item.id, { library: event.target.value as LibraryId })}
                      disabled={importOperation !== 'idle'}
                    >
                      {compatibleLibraries.map((library) => (
                        <option key={library.id} value={library.id}>
                          {library.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    libraryById[item.library].label
                  )}
                </span>
              )}
              {(isVideoPlan || isMixedPlan) && (
                <span>
                  {itemIsVideo ? (
                    item.status === 'ready' ? (
                      <input
                        className="plan-text-input"
                        value={item.episode ?? ''}
                        onChange={(event) => onItemChange(item.id, { episode: event.target.value })}
                        disabled={importOperation !== 'idle'}
                      />
                    ) : (
                      item.episode || '-'
                    )
                  ) : (
                    '-'
                  )}
                </span>
              )}
              <span>{formatBytes(item.size)}</span>
              <span>
                {item.targetPath ? (
                  <button className="plan-target-button" title={item.targetPath} onClick={() => void openTargetPath(item)}>
                    <FolderOpen size={15} />
                    打开
                  </button>
                ) : (
                  item.reason || '-'
                )}
              </span>
            </div>
          )
        })}
        {selectionBox && <span className="media-selection-box" style={selectionBox} />}
      </div>
      {pageCount > 1 && (
        <div className="plan-pagination">
          <button
            className="secondary-button small-button"
            onClick={() => setPage((value) => Math.max(0, value - 1))}
            disabled={safePage === 0}
          >
            上一页
          </button>
          <span>
            第 {safePage + 1} / {pageCount} 页 · 共 {plan.items.length} 项
          </span>
          <button
            className="secondary-button small-button"
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
            disabled={safePage >= pageCount - 1}
          >
            下一页
          </button>
        </div>
      )}
    </article>
  )
}

function PlanMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'ready' | 'blocked' | 'unsupported'
}) {
  return (
    <div className={`plan-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function buildPlanWarning(plan: StarMediaImportPlan) {
  const parts = []
  if (plan.candidateItemsTruncated) parts.push(`可导入/需配置候选只显示前 ${plan.maxImportPlanItems} 项`)
  if (plan.totalFiles > plan.maxImportScanFiles) parts.push(`扫描在 ${plan.maxImportScanFiles} 个文件后停止`)
  return parts.length > 0 ? parts.join('；') : '计划结果已截断。'
}

function ImportStatusBadge({ status }: { status: StarMediaImportPlanItem['status'] }) {
  const label = status === 'ready' ? '可导入' : status === 'blocked' ? '需配置' : '不支持'
  return <em className={`plan-status ${status}`}>{label}</em>
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`
}
