import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { MediaItem } from '../data'

export function BookReader({
  item,
  sessionId,
  pages,
  status,
  errorMessage,
  defaultMode,
  onClose,
}: {
  item: MediaItem
  sessionId: string
  pages: StarMediaBookPage[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  errorMessage: string
  defaultMode: StarMediaReadingMode
  onClose: () => void
}) {
  const [mode, setMode] = useState<StarMediaReadingMode>(defaultMode)
  const [zoom, setZoom] = useState(1)
  const [pageIndex, setPageIndex] = useState(0)
  const [pageViewport, setPageViewport] = useState({ width: 0, height: 0 })
  const [pageImageSize, setPageImageSize] = useState<{ width: number; height: number } | null>(null)
  const [scrollImageSizes, setScrollImageSizes] = useState<Record<number, { width: number; height: number }>>({})
  const [prefetchedPageUrls, setPrefetchedPageUrls] = useState<Record<number, string>>({})
  const [scrollPrefetchCursor, setScrollPrefetchCursor] = useState(0)
  const contentRef = useRef<HTMLElement | null>(null)
  const prefetchRequestedRef = useRef(new Set<string>())

  useEffect(() => {
    setMode(defaultMode)
    setPageIndex(0)
    setZoom(1)
    setPageImageSize(null)
    setScrollImageSizes({})
    setScrollPrefetchCursor(0)
  }, [defaultMode, item.id])

  useEffect(() => {
    prefetchRequestedRef.current.clear()
    setPrefetchedPageUrls({})
    setScrollImageSizes({})
    setScrollPrefetchCursor(0)
  }, [sessionId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key.toLocaleLowerCase() === 'r') setZoom(1)
      if (mode !== 'page') return
      if (event.key === 'ArrowLeft') setPageIndex((current) => Math.max(0, current - 1))
      if (event.key === 'ArrowRight') setPageIndex((current) => Math.min(Math.max(0, pages.length - 1), current + 1))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode, onClose, pages.length])

  useEffect(() => {
    if (!sessionId || pages.length === 0 || !window.starMedia?.getBookPage) return
    const anchor = mode === 'page' ? pageIndex : scrollPrefetchCursor
    const start = Math.max(0, mode === 'page' ? anchor - 2 : anchor)
    const end = Math.min(pages.length - 1, start + (mode === 'page' ? 11 : 15))
    const queue = Array.from({ length: end - start + 1 }, (_, offset) => start + offset).filter((index) => {
      const key = `${sessionId}:${index}`
      if (prefetchRequestedRef.current.has(key)) return false
      prefetchRequestedRef.current.add(key)
      return true
    })
    if (queue.length === 0) return

    let cancelled = false
    async function warmImage(url: string) {
      await new Promise<void>((resolve) => {
        const image = new Image()
        const finish = () => resolve()
        image.decoding = 'async'
        image.onload = finish
        image.onerror = finish
        image.src = url
        if (image.complete) finish()
      })
    }
    async function worker() {
      while (!cancelled && queue.length > 0) {
        const index = queue.shift()
        if (index === undefined) return
        try {
          const source = pages[index]
          const result = source.url ? { url: source.url } : await window.starMedia!.getBookPage!(sessionId, index)
          if (!result.url) continue
          await warmImage(result.url)
          if (!cancelled)
            setPrefetchedPageUrls((current) => (current[index] === result.url ? current : { ...current, [index]: result.url! }))
        } catch {
          // The visible page retains its own retry state when prefetching fails.
        }
      }
    }
    void Promise.all([worker(), worker()])
    return () => {
      cancelled = true
    }
  }, [mode, pageIndex, pages, scrollPrefetchCursor, sessionId])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const updateViewport = () => setPageViewport({ width: content.clientWidth, height: content.clientHeight })
    updateViewport()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport)
    observer?.observe(content)
    window.addEventListener('resize', updateViewport)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateViewport)
    }
  }, [mode, sessionId])

  useEffect(() => setPageImageSize(null), [pageIndex, sessionId])

  function adjustZoom(delta: number) {
    setZoom((current) => Math.max(0.5, Math.min(3, Math.round((current + delta) * 100) / 100)))
  }

  function changeMode(nextMode: StarMediaReadingMode) {
    setMode(nextMode)
    setZoom(1)
    if (nextMode === 'page') setPageIndex((current) => Math.min(current, Math.max(0, pages.length - 1)))
  }

  useEffect(() => {
    const content = contentRef.current
    if (!content) return undefined
    const handleNativeWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      adjustZoom(event.deltaY < 0 ? 0.02 : -0.02)
    }
    content.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => content.removeEventListener('wheel', handleNativeWheel)
  }, [])

  const currentPage = pages[pageIndex]
  const pageDisplayStyle = useMemo<CSSProperties | undefined>(() => {
    if (!pageImageSize || pageViewport.width <= 0 || pageViewport.height <= 0) return undefined
    const fitScale = Math.min(pageViewport.width / pageImageSize.width, pageViewport.height / pageImageSize.height)
    if (!Number.isFinite(fitScale) || fitScale <= 0) return undefined
    return {
      width: `${Math.max(1, Math.round(pageImageSize.width * fitScale * zoom))}px`,
      height: `${Math.max(1, Math.round(pageImageSize.height * fitScale * zoom))}px`,
      maxWidth: 'none',
      maxHeight: 'none',
    }
  }, [pageImageSize, pageViewport.height, pageViewport.width, zoom])

  function scrollPageDisplayStyle(index: number): CSSProperties {
    const size = scrollImageSizes[index]
    if (!size || pageViewport.width <= 0 || pageViewport.height <= 0) {
      return {
        width: `${Math.max(1, pageViewport.width)}px`,
        height: `${Math.max(1, pageViewport.height)}px`,
        maxWidth: '100%',
        maxHeight: 'none',
      }
    }
    const fitScale = Math.min(pageViewport.width / size.width, pageViewport.height / size.height)
    return {
      width: `${Math.max(1, Math.round(size.width * fitScale * zoom))}px`,
      height: `${Math.max(1, Math.round(size.height * fitScale * zoom))}px`,
      maxWidth: 'none',
      maxHeight: 'none',
    }
  }

  function resolvePage(page: StarMediaBookPage, index: number) {
    const prefetchedUrl = prefetchedPageUrls[index]
    return prefetchedUrl ? { ...page, url: prefetchedUrl } : page
  }

  return (
    <div className="reader-overlay">
      <header className="reader-topbar">
        <div>
          <strong>{item.title}</strong>
        </div>
        <div className="reader-actions">
          <button className={mode === 'scroll' ? 'reader-mode-button active' : 'reader-mode-button'} onClick={() => changeMode('scroll')}>
            滚动
          </button>
          <button className={mode === 'page' ? 'reader-mode-button active' : 'reader-mode-button'} onClick={() => changeMode('page')}>
            单页
          </button>
          <button className="reader-mode-button" onClick={() => adjustZoom(-0.05)} aria-label="缩小">
            −
          </button>
          <span className="reader-zoom">{Math.round(zoom * 100)}%</span>
          <button className="reader-mode-button" onClick={() => adjustZoom(0.05)} aria-label="放大">
            +
          </button>
          <button className="reader-mode-button reader-reset-button" onClick={() => setZoom(1)} aria-label="重置缩放">
            重置
          </button>
          {status === 'ready' && pages.length > 0 && (
            <span className="reader-progress">{mode === 'page' ? `${pageIndex + 1} / ${pages.length}` : `${pages.length} 页`}</span>
          )}
          <button className="secondary-button" onClick={onClose}>
            返回
          </button>
        </div>
      </header>
      <main ref={contentRef} className={`reader-content reader-${mode}`}>
        {status === 'loading' && <div className="reader-state">正在打开压缩包…</div>}
        {status === 'error' && <div className="reader-state">打开失败：{errorMessage || '无法读取压缩包'}</div>}
        {status === 'ready' && pages.length === 0 && <div className="reader-state">没有找到图片页</div>}
        {status === 'ready' &&
          mode === 'scroll' &&
          pages.map((page, index) => (
            <ReaderPageImage
              key={`${sessionId}:${index}`}
              sessionId={sessionId}
              page={resolvePage(page, index)}
              index={index}
              style={scrollPageDisplayStyle(index)}
              onNearViewport={(nearIndex) => setScrollPrefetchCursor((current) => Math.max(current, nearIndex))}
              onImageLoad={(size) =>
                setScrollImageSizes((current) =>
                  current[index]?.width === size.width && current[index]?.height === size.height ? current : { ...current, [index]: size },
                )
              }
            />
          ))}
        {status === 'ready' && mode === 'page' && currentPage && (
          <div className={`reader-single-page ${zoom > 1 ? 'zoomed' : ''}`}>
            <button
              className="reader-page-nav previous"
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
              disabled={pageIndex === 0}
              aria-label="上一页"
            />
            <ReaderPageImage
              key={`${sessionId}:${pageIndex}`}
              sessionId={sessionId}
              page={resolvePage(currentPage, pageIndex)}
              index={pageIndex}
              eager
              style={pageDisplayStyle}
              onImageLoad={setPageImageSize}
            />
            <button
              className="reader-page-nav next"
              onClick={() => setPageIndex((current) => Math.min(pages.length - 1, current + 1))}
              disabled={pageIndex >= pages.length - 1}
              aria-label="下一页"
            />
          </div>
        )}
      </main>
    </div>
  )
}

function ReaderPageImage({
  sessionId,
  page,
  index,
  eager = false,
  style,
  onNearViewport,
  onImageLoad,
}: {
  sessionId: string
  page: StarMediaBookPage
  index: number
  eager?: boolean
  style?: CSSProperties
  onNearViewport?: (index: number) => void
  onImageLoad?: (size: { width: number; height: number }) => void
}) {
  const placeholderRef = useRef<HTMLButtonElement | null>(null)
  const [url, setUrl] = useState(page.url ?? '')
  const [failed, setFailed] = useState(false)
  const [reloadAttempt, setReloadAttempt] = useState(0)
  const reportNearViewport = useEffectEvent(() => onNearViewport?.(index))

  useEffect(() => {
    let cancelled = false
    let observer: IntersectionObserver | null = null

    async function loadPage() {
      if (!window.starMedia?.getBookPage || !sessionId) return
      try {
        const result = await window.starMedia.getBookPage(sessionId, index, reloadAttempt > 0 ? { force: true } : undefined)
        if (!cancelled) setUrl(result.url ?? '')
      } catch (error) {
        console.error(error)
        if (!cancelled) setFailed(true)
      }
    }

    if (page.url && reloadAttempt === 0) {
      setUrl(page.url)
      return () => {
        cancelled = true
      }
    }
    if (eager || typeof IntersectionObserver === 'undefined') {
      void loadPage()
      return () => {
        cancelled = true
      }
    }

    const target = placeholderRef.current
    if (!target)
      return () => {
        cancelled = true
      }
    const scrollRoot = target.closest<HTMLElement>('.reader-content.reader-scroll')
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer?.disconnect()
        observer = null
        reportNearViewport()
        void loadPage()
      },
      { root: scrollRoot, rootMargin: '10000px 0px' },
    )
    observer.observe(target)
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [eager, index, page.url, reloadAttempt, sessionId])

  if (url)
    return (
      <img
        src={url}
        alt={page.name}
        loading="eager"
        decoding="async"
        style={style}
        onLoad={(event) => onImageLoad?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onError={() => {
          setUrl('')
          if (reloadAttempt === 0) setReloadAttempt(1)
          else setFailed(true)
        }}
      />
    )
  return (
    <button
      ref={placeholderRef}
      type="button"
      className={`reader-page-placeholder ${failed ? 'failed' : ''}`}
      style={style}
      onClick={() => {
        if (!failed) return
        setFailed(false)
        setReloadAttempt((current) => current + 1)
      }}
    >
      {failed ? `第 ${index + 1} 页加载失败，点击重试` : `正在加载第 ${index + 1} 页…`}
    </button>
  )
}
