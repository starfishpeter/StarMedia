import { describe, expect, it } from 'vitest'
import { calculateVirtualGrid } from './virtual-grid'

describe('calculateVirtualGrid', () => {
  it('keeps a large library to a small overscanned DOM window', () => {
    const top = calculateVirtualGrid({ itemCount: 209, containerWidth: 1600, viewportHeight: 900, scrollOffset: 0, compact: false })
    const middle = calculateVirtualGrid({ itemCount: 209, containerWidth: 1600, viewportHeight: 900, scrollOffset: 3000, compact: false })

    expect(top.columns).toBe(7)
    expect(top.startIndex).toBe(0)
    expect(top.endIndex).toBeLessThan(80)
    expect(middle.startIndex).toBeGreaterThan(0)
    expect(middle.endIndex - middle.startIndex).toBeLessThan(100)
    expect(middle.totalHeight).toBe(top.totalHeight)
  })

  it('covers every item near the bottom and adapts to compact cards', () => {
    const range = calculateVirtualGrid({
      itemCount: 209,
      containerWidth: 820,
      viewportHeight: 700,
      scrollOffset: 100000,
      compact: true,
    })

    expect(range.columns).toBe(5)
    expect(range.endIndex).toBe(209)
    expect(range.startIndex).toBeLessThan(range.endIndex)
  })
})
