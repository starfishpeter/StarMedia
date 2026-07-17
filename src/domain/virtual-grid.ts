export interface VirtualGridInput {
  itemCount: number
  containerWidth: number
  viewportHeight: number
  scrollOffset: number
  compact: boolean
  overscanRows?: number
}

export interface VirtualGridRange {
  columns: number
  startIndex: number
  endIndex: number
  windowTop: number
  totalHeight: number
}

const columnGap = 20
const rowGap = 22
const coverRatio = 2.78 / 2
const cardInfoHeight = 43

export function calculateVirtualGrid({
  itemCount,
  containerWidth,
  viewportHeight,
  scrollOffset,
  compact,
  overscanRows = 3,
}: VirtualGridInput): VirtualGridRange {
  const safeCount = Math.max(0, Math.floor(itemCount))
  const safeWidth = Math.max(1, containerWidth)
  const minimumCardWidth = compact ? 148 : 188
  const columns = Math.max(1, Math.floor((safeWidth + columnGap) / (minimumCardWidth + columnGap)))
  const cardWidth = (safeWidth - columnGap * (columns - 1)) / columns
  const rowStride = cardWidth * coverRatio + cardInfoHeight + rowGap
  const totalRows = Math.ceil(safeCount / columns)
  const firstViewportRow = Math.min(Math.max(0, totalRows - 1), Math.max(0, Math.floor(Math.max(0, scrollOffset) / rowStride)))
  const lastViewportRow = Math.min(
    totalRows,
    Math.max(firstViewportRow + 1, Math.ceil(Math.max(0, scrollOffset + viewportHeight) / rowStride)),
  )
  const startRow = Math.max(0, firstViewportRow - Math.max(0, overscanRows))
  const endRow = Math.min(totalRows, lastViewportRow + Math.max(0, overscanRows))

  return {
    columns,
    startIndex: Math.min(safeCount, startRow * columns),
    endIndex: Math.min(safeCount, endRow * columns),
    windowTop: startRow * rowStride,
    totalHeight: Math.max(0, totalRows * rowStride - rowGap),
  }
}
