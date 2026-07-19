import { BookOpenText, ExternalLink, Play, Trash2, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { libraryById, type MediaItem } from '../data'
import { getEpisodeCover, getMediaAffiliation, getMediaEpisode, getMediaShelf } from '../domain/media'
import { TagEditor } from './TagEditor'

type VideoPlaybackAvailability = 'checking' | 'supported' | 'unsupported'

function getVideoFormat(item: MediaItem) {
  const extension = item.sourcePath?.match(/\.([^.\\/]+)$/)?.[1]
  return extension ? extension.toUpperCase() : '未设置'
}

export function DetailPanel({
  item,
  availableTags,
  onUpdateTags,
  onAddTag,
  onUpdateBookMetadata,
  onUpdateVideoEpisode,
  onUpdateVideoReleaseDate,
  onTrash,
  onReplaceVideo,
  onClose,
  onRead,
  onPlayVideo,
  onOpenExternal,
}: {
  item: MediaItem
  availableTags: string[]
  onUpdateTags: (item: MediaItem, tags: string[]) => void
  onAddTag?: (item: MediaItem, tag: string) => Promise<void>
  onUpdateBookMetadata: (item: MediaItem, metadata: { creator: string; releaseDate: string }) => Promise<void>
  onUpdateVideoEpisode: (item: MediaItem, episode: string) => Promise<MediaItem | undefined>
  onUpdateVideoReleaseDate: (item: MediaItem, releaseDate: string) => Promise<MediaItem | undefined>
  onTrash?: (item: MediaItem) => Promise<void>
  onReplaceVideo?: (item: MediaItem) => void
  onClose: () => void
  onRead: (item: MediaItem) => void
  onPlayVideo: (item: MediaItem) => void
  onOpenExternal: (item: MediaItem) => void
}) {
  const library = libraryById[item.library]
  const isBook = item.kind === 'book'
  const usesPerVideoMetadata = item.library === 'creator' || item.library === 'general'
  const itemEpisode = getMediaEpisode(item)
  const [videoPlaybackAvailability, setVideoPlaybackAvailability] = useState<VideoPlaybackAvailability>('checking')
  const [editing, setEditing] = useState(false)
  const [creator, setCreator] = useState(item.creator ?? '')
  const [releaseDate, setReleaseDate] = useState(item.releaseDate ?? '')
  const [episode, setEpisode] = useState(itemEpisode)
  const [editingEpisode, setEditingEpisode] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCreator(item.creator ?? '')
    setReleaseDate(item.releaseDate ?? '')
    setEpisode(itemEpisode)
    setEditingEpisode(false)
    setEditing(false)
  }, [item.id, item.creator, item.releaseDate, itemEpisode, item.title])

  useEffect(() => {
    if (isBook || !window.starMedia?.getVideoPlaybackSupport) {
      setVideoPlaybackAvailability('unsupported')
      return
    }

    setVideoPlaybackAvailability('checking')
    let active = true
    void window.starMedia
      .getVideoPlaybackSupport(item.id)
      .then((supported) => {
        if (active) setVideoPlaybackAvailability(supported ? 'supported' : 'unsupported')
      })
      .catch(() => {
        if (active) setVideoPlaybackAvailability('unsupported')
      })
    return () => {
      active = false
    }
  }, [isBook, item.id, item.sourcePath])

  async function saveBookMetadata() {
    setSaving(true)
    try {
      await onUpdateBookMetadata(item, { creator, releaseDate })
      setEditing(false)
    } catch {
      // The parent reports the failure and the editor remains open for retrying.
    } finally {
      setSaving(false)
    }
  }

  async function saveVideoDetails() {
    const nextEpisode = episode.trim()
    const nextReleaseDate = releaseDate.trim()
    if (!nextEpisode) return
    setSaving(true)
    try {
      let current = item
      if (nextEpisode !== getMediaEpisode(item)) current = (await onUpdateVideoEpisode(current, nextEpisode)) ?? current
      if (nextReleaseDate !== (item.releaseDate ?? '')) current = (await onUpdateVideoReleaseDate(current, nextReleaseDate)) ?? current
      setEpisode(getMediaEpisode(current))
      setReleaseDate(current.releaseDate ?? '')
      setEditingEpisode(false)
    } catch {
      // The parent reports the failure and the editor remains open for retrying.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="detail-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        data-video-playback={isBook ? undefined : videoPlaybackAvailability}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="close-detail" onClick={onClose} aria-label="关闭详情">
          <X size={19} />
        </button>
        <div className="detail-cover" style={{ background: getEpisodeCover(item) } as CSSProperties} />
        <div className="detail-body">
          <span className="detail-library" style={{ color: library.color }}>
            {library.label}
          </span>
          <h2>{isBook ? item.title : getMediaEpisode(item)}</h2>
          <p className="detail-note">{item.note}</p>
          <div className="detail-actions">
            {isBook && (
              <button className="primary-button" onClick={() => onRead(item)}>
                <BookOpenText size={17} />
                开始阅读
              </button>
            )}
            {!isBook && videoPlaybackAvailability === 'supported' && (
              <button className="primary-button" onClick={() => onPlayVideo(item)}>
                <Play size={17} fill="currentColor" />
                应用内播放
              </button>
            )}
            {!isBook && (
              <button className="secondary-button" onClick={() => onOpenExternal(item)}>
                <ExternalLink size={16} />
                外部播放
              </button>
            )}
            {isBook && (
              <button className="secondary-button" onClick={() => setEditing((current) => !current)}>
                {editing ? '收起资料' : '编辑资料'}
              </button>
            )}
            {!isBook && (
              <>
                <button className="secondary-button" onClick={() => setEditingEpisode((current) => !current)}>
                  {editingEpisode ? '收起选集资料' : '编辑选集'}
                </button>
                <button className="secondary-button" onClick={() => onReplaceVideo?.(item)}>
                  替换文件
                </button>
                <button className="danger-button small-button" onClick={() => void onTrash?.(item)}>
                  <Trash2 size={15} />
                  移入回收站
                </button>
              </>
            )}
          </div>
          {!isBook && editingEpisode && (
            <form
              className="detail-episode-editor"
              onSubmit={(event) => {
                event.preventDefault()
                void saveVideoDetails()
              }}
            >
              <label>
                <span>视频名称</span>
                <input value={episode} onChange={(event) => setEpisode(event.target.value)} maxLength={200} />
              </label>
              <label>
                <span>单集日期</span>
                <input
                  value={releaseDate}
                  onChange={(event) => setReleaseDate(event.target.value)}
                  placeholder="YYYY-MM-DD，可留空"
                  maxLength={40}
                />
              </label>
              <button
                className="secondary-button small-button"
                type="submit"
                disabled={
                  saving || !episode.trim() || (episode.trim() === getMediaEpisode(item) && releaseDate.trim() === (item.releaseDate ?? ''))
                }
              >
                {saving ? '保存中…' : '保存选集资料'}
              </button>
            </form>
          )}
          {isBook && editing && (
            <div className="detail-metadata-editor">
              <label>
                <span>创作者</span>
                <input value={creator} onChange={(event) => setCreator(event.target.value)} placeholder="可留空" />
              </label>
              <label>
                <span>发行日期</span>
                <input value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)} placeholder="YYYY-MM-DD，可留空" />
              </label>
              <button className="primary-button small-button" onClick={() => void saveBookMetadata()} disabled={saving}>
                {saving ? '保存中…' : '保存资料'}
              </button>
            </div>
          )}
          <dl className="detail-grid">
            {isBook ? (
              <>
                <div>
                  <dt>书架</dt>
                  <dd>{getMediaShelf(item)}</dd>
                </div>
                <div>
                  <dt>创作者</dt>
                  <dd>{item.creator || '未设置'}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>{item.library === 'creator' ? '创作者' : '合集'}</dt>
                  <dd>{getMediaAffiliation(item)}</dd>
                </div>
                <div>
                  <dt>选集</dt>
                  <dd>{getMediaEpisode(item)}</dd>
                </div>
              </>
            )}
            {isBook ? (
              <div>
                <dt>页数</dt>
                <dd>{item.duration}</dd>
              </div>
            ) : (
              <>
                <div>
                  <dt>格式</dt>
                  <dd>{getVideoFormat(item)}</dd>
                </div>
                <div>
                  <dt>时长</dt>
                  <dd>{item.durationSeconds ? item.duration : '未获取'}</dd>
                </div>
              </>
            )}
            <div>
              <dt>{isBook ? '发行日期' : '单集日期'}</dt>
              <dd>{isBook ? item.releaseDate || item.firstAiredAt || '未设置' : item.releaseDate || '未设置'}</dd>
            </div>
          </dl>
          {item.sidecars && item.sidecars.length > 0 && <p className="detail-sidecars">已关联 {item.sidecars.length} 个字幕文件</p>}
          <TagEditor
            className="detail-tags"
            label={usesPerVideoMetadata ? '标签' : `标签（作用于整个${isBook ? '书架' : '合集'}）`}
            tags={item.tags}
            availableTags={availableTags}
            onChange={(tags) => onUpdateTags(item, tags)}
            onAddTag={onAddTag ? (tag) => onAddTag(item, tag) : undefined}
          />
        </div>
      </aside>
    </div>
  )
}
