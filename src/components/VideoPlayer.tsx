import { ExternalLink, Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import type { MediaItem } from '../data'

export type VideoPlayerStatus = 'idle' | 'loading' | 'ready' | 'error'

export function VideoPlayer({
  item,
  sourceUrl,
  mimeType,
  subtitles,
  status,
  errorMessage,
  onClose,
  onOpenExternal,
  onMetadata,
  onFeedback,
}: {
  item: MediaItem
  sourceUrl: string
  mimeType: string
  subtitles: Array<{ url: string; label: string }>
  status: VideoPlayerStatus
  errorMessage: string
  onClose: () => void
  onOpenExternal: (item: MediaItem) => Promise<void>
  onMetadata: (item: MediaItem, durationSeconds: number, thumbnailDataUrl?: string) => void
  onFeedback: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const metadataSavedRef = useRef(false)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressActiveRef = useRef(false)
  const suppressVideoClickRef = useRef(false)
  const selectedRateRef = useRef(1)
  const [playbackError, setPlaybackError] = useState(false)
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain')
  const [playbackRate, setPlaybackRate] = useState(1)
  const [selectedSubtitle, setSelectedSubtitle] = useState('off')
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const controlsTimerRef = useRef<number | null>(null)
  const canSetFrameCover = item.kind === 'video'
  const resetPlayback = useEffectEvent(() => {
    metadataSavedRef.current = false
    setPlaybackError(false)
    setPlaybackRate(1)
    selectedRateRef.current = 1
    setSelectedSubtitle(subtitles[0]?.url ?? 'off')
    setIsPlaying(false)
    setDuration(0)
    setCurrentTime(0)
  })

  useEffect(() => {
    resetPlayback()
  }, [sourceUrl, item.id])

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
      if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current)
    },
    [],
  )

  function revealControls() {
    setShowControls(true)
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current)
    if (isPlaying) {
      controlsTimerRef.current = window.setTimeout(() => setShowControls(false), 1800)
    }
  }

  const hideControls = useCallback(() => {
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = null
    setShowControls(false)
  }, [])

  const seekFromKeyboard = useEffectEvent((seconds: number) => seekTo(seconds))

  useEffect(() => {
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current)
    if (!isPlaying) {
      setShowControls(true)
      return undefined
    }
    controlsTimerRef.current = window.setTimeout(() => setShowControls(false), 1800)
    return () => {
      if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current)
    }
  }, [isPlaying])

  useEffect(() => {
    window.addEventListener('blur', hideControls)
    document.documentElement.addEventListener('pointerleave', hideControls)
    return () => {
      window.removeEventListener('blur', hideControls)
      document.documentElement.removeEventListener('pointerleave', hideControls)
    }
  }, [hideControls])

  useEffect(() => {
    function handleSpacebar(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('button, input, select, textarea, [contenteditable="true"]')) return
      const video = videoRef.current
      if (!video || status !== 'ready') return
      if (event.code === 'Space') {
        if (event.repeat) return
        event.preventDefault()
        if (video.paused) void video.play().catch(() => {})
        else video.pause()
        return
      }
      if (event.code === 'ArrowLeft' || event.key === 'ArrowLeft' || event.key === 'Left') {
        event.preventDefault()
        seekFromKeyboard(video.currentTime - 5)
        return
      }
      if (event.code === 'ArrowRight' || event.key === 'ArrowRight' || event.key === 'Right') {
        event.preventDefault()
        seekFromKeyboard(video.currentTime + 5)
      }
    }
    window.addEventListener('keydown', handleSpacebar)
    return () => window.removeEventListener('keydown', handleSpacebar)
  }, [sourceUrl, status])

  function applyPlaybackRate(rate: number, remember = true) {
    setPlaybackRate(rate)
    if (remember) selectedRateRef.current = rate
    if (videoRef.current) videoRef.current.playbackRate = rate
  }

  function applySubtitleSelection(value: string) {
    setSelectedSubtitle(value)
  }

  function syncSubtitleTracks(value = selectedSubtitle) {
    const tracks = videoRef.current?.textTracks
    if (!tracks) return
    for (let index = 0; index < tracks.length; index += 1) tracks[index].mode = subtitles[index]?.url === value ? 'showing' : 'disabled'
  }

  const synchronizeSubtitleTracks = useEffectEvent((value: string) => syncSubtitleTracks(value))

  useEffect(() => {
    synchronizeSubtitleTracks(selectedSubtitle)
  }, [selectedSubtitle, subtitles])

  function togglePlayback() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => {})
    else video.pause()
  }

  function seekTo(seconds: number) {
    const video = videoRef.current
    if (!video || !Number.isFinite(seconds)) return
    video.currentTime = Math.max(0, Math.min(video.duration || duration, seconds))
    setCurrentTime(video.currentTime)
  }

  function changeVolume(nextVolume: number) {
    const normalized = Math.max(0, Math.min(1, nextVolume))
    const video = videoRef.current
    setVolume(normalized)
    setMuted(normalized === 0)
    if (!video) return
    video.volume = normalized
    video.muted = normalized === 0
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    const nextMuted = !video.muted
    video.muted = nextMuted
    setMuted(nextMuted)
  }

  function startLongPressSpeed(event: React.PointerEvent<HTMLVideoElement>) {
    if (event.button !== 0) return
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    longPressActiveRef.current = false
    longPressTimerRef.current = window.setTimeout(() => {
      longPressActiveRef.current = true
      suppressVideoClickRef.current = true
      applyPlaybackRate(2, false)
    }, 350)
  }

  function stopLongPressSpeed(event?: React.PointerEvent<HTMLVideoElement>) {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    if (longPressActiveRef.current) {
      longPressActiveRef.current = false
      applyPlaybackRate(selectedRateRef.current, false)
    }
    if (event?.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (suppressVideoClickRef.current)
      window.setTimeout(() => {
        suppressVideoClickRef.current = false
      }, 0)
  }

  function requestFullscreen() {
    void videoRef.current?.requestFullscreen?.()
  }

  function captureMetadata(saveThumbnail = false) {
    const video = videoRef.current
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      if (saveThumbnail) onFeedback('视频尚未就绪，无法生成封面。')
      return
    }
    if (!saveThumbnail && metadataSavedRef.current) return
    if (!saveThumbnail) metadataSavedRef.current = true
    let thumbnailDataUrl: string | undefined
    if (saveThumbnail) {
      try {
        const canvas = document.createElement('canvas')
        const ratio = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9
        canvas.width = 480
        canvas.height = Math.max(270, Math.round(canvas.width / ratio))
        const context = canvas.getContext('2d')
        context?.drawImage(video, 0, 0, canvas.width, canvas.height)
        thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.78)
      } catch {
        thumbnailDataUrl = undefined
      }
    }
    if (saveThumbnail && !thumbnailDataUrl) {
      onFeedback('无法从当前帧生成封面。')
      return
    }
    onMetadata(item, video.duration, thumbnailDataUrl)
  }

  function handleLoadedMetadata() {
    const video = videoRef.current
    if (!video) return
    setDuration(Number.isFinite(video.duration) ? video.duration : 0)
    video.volume = volume
    video.muted = muted
    applyPlaybackRate(playbackRate)
    window.requestAnimationFrame(() => syncSubtitleTracks(selectedSubtitle))
  }

  return (
    <div
      className={`video-overlay ${showControls ? '' : 'controls-hidden'}`}
      onPointerEnter={revealControls}
      onPointerLeave={hideControls}
      onPointerMove={revealControls}
    >
      <header className="video-topbar">
        <strong title={item.title}>{item.title}</strong>
        <div className="video-topbar-actions">
          <div className="video-fit-toggle" role="group" aria-label="画面适配方式">
            <button type="button" aria-pressed={fitMode === 'contain'} onClick={() => setFitMode('contain')}>
              原始比例
            </button>
            <button type="button" aria-pressed={fitMode === 'cover'} onClick={() => setFitMode('cover')}>
              铺满屏幕
            </button>
          </div>
          {canSetFrameCover && (
            <button className="video-text-button" onClick={() => captureMetadata(true)}>
              当前帧封面
            </button>
          )}
          <button className="video-icon-button" onClick={requestFullscreen} aria-label="全屏">
            <Maximize2 size={18} />
          </button>
          <button className="video-text-button" onClick={onClose}>
            返回
          </button>
        </div>
      </header>
      <main className="video-stage">
        {status === 'loading' && <div className="reader-state">正在打开视频…</div>}
        {status === 'error' && (
          <div className="reader-state">
            <span>{errorMessage || '视频文件不可用'}</span>
            <button className="primary-button small-button" onClick={() => void onOpenExternal(item)}>
              <ExternalLink size={16} />
              外部播放
            </button>
          </div>
        )}
        {status === 'ready' && sourceUrl && !playbackError && (
          <div className="video-frame">
            <div className="video-canvas">
              <video
                key={sourceUrl}
                ref={videoRef}
                className={`video-player ${fitMode === 'cover' ? 'fit-cover' : 'fit-contain'}`}
                autoPlay
                playsInline
                onClick={() => {
                  revealControls()
                  if (!suppressVideoClickRef.current) togglePlayback()
                }}
                onLoadedMetadata={handleLoadedMetadata}
                onLoadedData={() => {
                  captureMetadata(false)
                  syncSubtitleTracks(selectedSubtitle)
                }}
                onDurationChange={() => setDuration(Number.isFinite(videoRef.current?.duration) ? (videoRef.current?.duration ?? 0) : 0)}
                onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onVolumeChange={() => {
                  setVolume(videoRef.current?.volume ?? 1)
                  setMuted(videoRef.current?.muted ?? false)
                }}
                onError={() => setPlaybackError(true)}
                onPointerDown={startLongPressSpeed}
                onPointerUp={stopLongPressSpeed}
                onPointerCancel={stopLongPressSpeed}
              >
                <source src={sourceUrl} type={mimeType || undefined} />
                {subtitles.map((subtitle, index) => (
                  <track
                    key={subtitle.url}
                    kind="subtitles"
                    src={subtitle.url}
                    srcLang="zh"
                    label={subtitle.label}
                    default={index === 0}
                    onLoad={() => syncSubtitleTracks(selectedSubtitle)}
                    onError={() => onFeedback(`字幕「${subtitle.label}」加载失败。`)}
                  />
                ))}
              </video>
            </div>
          </div>
        )}
        {status === 'ready' && playbackError && (
          <div className="reader-state">
            <span>当前 Chromium 无法解码该视频的容器或音视频编码。</span>
            <button className="secondary-button small-button" onClick={() => void onOpenExternal(item)}>
              <ExternalLink size={16} />
              外部播放
            </button>
          </div>
        )}
      </main>
      <div className="video-controls" onPointerDown={(event) => event.stopPropagation()} onPointerMove={revealControls}>
        <button className="video-icon-button" onClick={togglePlayback} aria-label={isPlaying ? '暂停' : '播放'}>
          {isPlaying ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
        </button>
        <span className="video-time">
          {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
        </span>
        <input
          className="video-seek"
          type="range"
          min="0"
          max={Math.max(duration, 0)}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label="播放进度"
        />
        <button className="video-icon-button" onClick={toggleMute} aria-label={muted || volume === 0 ? '取消静音' : '静音'}>
          {muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
        </button>
        <input
          className="video-volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          onChange={(event) => changeVolume(Number(event.target.value))}
          aria-label="音量"
        />
        <label className="video-control">
          <span>倍速</span>
          <select value={playbackRate} onChange={(event) => applyPlaybackRate(Number(event.target.value))}>
            {[0.5, 1, 1.5, 2].map((rate) => (
              <option key={rate} value={rate}>
                {rate}×
              </option>
            ))}
          </select>
        </label>
        {subtitles.length > 0 && (
          <label className="video-control video-subtitle-control">
            <select aria-label="字幕" value={selectedSubtitle} onChange={(event) => applySubtitleSelection(event.target.value)}>
              <option value="off">字幕：关闭</option>
              {subtitles.map((subtitle) => (
                <option key={subtitle.url} value={subtitle.url}>
                  {subtitle.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  )
}

function formatPlaybackTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}
