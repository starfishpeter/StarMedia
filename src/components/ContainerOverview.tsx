import { ChevronLeft, UploadCloud } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type PointerEvent } from 'react'
import type { MediaItem } from '../data'
import { compareMediaEpisodes, getEpisodeCover, getMediaEpisode } from '../domain/media'
import { MediaWall } from './MediaWall'
import { TagEditor } from './TagEditor'

export type ContainerMetadata = { name: string; originalTitle: string; studio: string; firstAiredAt: string }
type ScrapeDraftValues = Required<StarMediaScrapeFields>
type ScrapeWritableField = Exclude<keyof ScrapeDraftValues, 'releaseDate'>
type EpisodeSortMode = 'episode' | 'title-asc' | 'title-desc'

const emptyScrapeDraftValues: ScrapeDraftValues = {
  cover: false,
  affiliation: '',
  originalTitle: '',
  studio: '',
  firstAiredAt: '',
  releaseDate: '',
  note: '',
}

export function ContainerOverview({
  kind,
  name,
  items,
  availableTags,
  onContainerImport,
  importing = false,
  onBack,
  onOpen,
  onSaveNote,
  onSaveMetadata,
  onSaveTags,
  onAddTag,
  onSearchBangumi,
  onPreviewBangumi,
  onApplyBangumi,
  onSearchHanime,
  onPreviewHanime,
  onApplyHanime,
  selectedIds = [],
  onToggleSelection,
  onOpenBatchMenu,
  onSelectMany,
}: {
  kind: 'affiliation' | 'shelf'
  name: string
  items: MediaItem[]
  availableTags: string[]
  onContainerImport?: () => void
  importing?: boolean
  onBack: () => void
  onOpen: (item: MediaItem) => void
  onSaveNote: (item: MediaItem, note: string) => void
  onSaveMetadata?: (item: MediaItem, metadata: ContainerMetadata) => Promise<MediaItem | undefined>
  onSaveTags: (item: MediaItem, tags: string[]) => void
  onAddTag?: (item: MediaItem, tag: string) => Promise<void>
  onSearchBangumi?: (query: string) => Promise<StarMediaBangumiSubject[]>
  onPreviewBangumi?: (subjectId: number) => Promise<StarMediaScrapePreview>
  onApplyBangumi?: (item: MediaItem, subjectId: number, fields: StarMediaScrapeFields) => Promise<StarMediaBangumiSubject | undefined>
  onSearchHanime?: (query: string, source: 'freeanimehentai' | 'hanime1') => Promise<StarMediaHanimeSubject[]>
  onPreviewHanime?: (subjectId: number, source: 'freeanimehentai' | 'hanime1') => Promise<StarMediaScrapePreview>
  onApplyHanime?: (
    item: MediaItem,
    subjectId: number,
    source: 'freeanimehentai' | 'hanime1',
    fields: StarMediaScrapeFields,
  ) => Promise<StarMediaHanimeSubject | undefined>
  selectedIds?: string[]
  onToggleSelection?: (item: MediaItem) => void
  onOpenBatchMenu?: (item: MediaItem, event: MouseEvent<HTMLElement>) => void
  onSelectMany?: (items: MediaItem[]) => void
}) {
  const [episodeSort, setEpisodeSort] = useState<EpisodeSortMode>('episode')
  const representative = items[0]
  const orderedItems = [...items].sort(
    kind === 'affiliation'
      ? episodeSort === 'episode'
        ? compareMediaEpisodes
        : (left, right) => {
            const result = getMediaEpisode(left).localeCompare(getMediaEpisode(right), 'zh-CN', { numeric: true })
            return episodeSort === 'title-asc' ? result : -result
          }
      : (left, right) => left.title.localeCompare(right.title, 'zh-CN', { numeric: true }),
  )
  const [draftNote, setDraftNote] = useState(representative?.note ?? '')
  const [draftMetadata, setDraftMetadata] = useState<ContainerMetadata>({
    name,
    originalTitle: representative?.originalTitle ?? '',
    studio: representative?.studio ?? '',
    firstAiredAt: representative?.firstAiredAt ?? '',
  })
  const [scraperSource, setScraperSource] = useState<'bangumi' | 'freeanimehentai' | 'hanime1'>('bangumi')
  const [scraperQuery, setScraperQuery] = useState(representative?.originalTitle?.trim() || name)
  const [bangumiId, setBangumiId] = useState(
    representative?.bangumiId ?? (representative?.scraperSource === 'Bangumi' ? (representative.scraperId ?? '') : ''),
  )
  const [freeAnimeHentaiId, setFreeAnimeHentaiId] = useState(
    representative?.freeAnimeHentaiId ?? (representative?.scraperSource === 'FreeAnimeHentai' ? (representative.scraperId ?? '') : ''),
  )
  const [hanime1Id, setHanime1Id] = useState(
    representative?.hanime1Id ?? (representative?.scraperSource === 'Hanime1' ? (representative.scraperId ?? '') : ''),
  )
  const [bangumiSubjects, setBangumiSubjects] = useState<StarMediaBangumiSubject[]>([])
  const [hanimeSubjects, setHanimeSubjects] = useState<StarMediaHanimeSubject[]>([])
  const [scrapePreview, setScrapePreview] = useState<StarMediaScrapePreview | null>(null)
  const [scrapeDraft, setScrapeDraft] = useState<ScrapeDraftValues>(emptyScrapeDraftValues)
  const [scraperStatus, setScraperStatus] = useState<'idle' | 'searching' | 'applying'>('idle')
  const [applyingField, setApplyingField] = useState<ScrapeWritableField | null>(null)
  const [lastAppliedField, setLastAppliedField] = useState<ScrapeWritableField | null>(null)
  const [scraperOpen, setScraperOpen] = useState(false)
  const [scraperError, setScraperError] = useState('')
  const [scraperSuccess, setScraperSuccess] = useState('')
  const [editingNote, setEditingNote] = useState(false)
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [metadataSaving, setMetadataSaving] = useState(false)
  const [metadataError, setMetadataError] = useState('')

  useEffect(() => setDraftNote(representative?.note ?? ''), [name, representative?.id, representative?.note])
  useEffect(
    () =>
      setDraftMetadata({
        name,
        originalTitle: representative?.originalTitle ?? '',
        studio: representative?.studio ?? '',
        firstAiredAt: representative?.firstAiredAt ?? '',
      }),
    [name, representative?.id, representative?.originalTitle, representative?.studio, representative?.firstAiredAt],
  )
  const resetContainerState = useEffectEvent(() => {
    setScraperQuery(representative?.originalTitle?.trim() || name)
    setBangumiId(representative?.bangumiId ?? (representative?.scraperSource === 'Bangumi' ? (representative.scraperId ?? '') : ''))
    setFreeAnimeHentaiId(
      representative?.freeAnimeHentaiId ?? (representative?.scraperSource === 'FreeAnimeHentai' ? (representative.scraperId ?? '') : ''),
    )
    setHanime1Id(representative?.hanime1Id ?? (representative?.scraperSource === 'Hanime1' ? (representative.scraperId ?? '') : ''))
    setBangumiSubjects([])
    setHanimeSubjects([])
    setScrapePreview(null)
    setScrapeDraft(emptyScrapeDraftValues)
    setScraperSource(
      representative?.scraperSource === 'FreeAnimeHentai'
        ? 'freeanimehentai'
        : representative?.scraperSource === 'Hanime1'
          ? 'hanime1'
          : 'bangumi',
    )
    setScraperStatus('idle')
    setApplyingField(null)
    setLastAppliedField(null)
    setScraperError('')
    setScraperSuccess('')
    setScraperOpen(false)
    setEditingNote(false)
    setEditingMetadata(false)
    setMetadataError('')
  })
  useEffect(() => resetContainerState(), [representative?.id])
  if (!representative) return null

  const label = kind === 'affiliation' ? '合集' : '书架'
  const entryLabel = kind === 'affiliation' ? '选集' : '本'
  const usesPosterCover = kind === 'affiliation' && (representative.library === 'erAnime' || representative.library === 'anime')
  const isCreatorContainer = kind === 'affiliation' && representative.library === 'creator'
  const canEditMetadata = Boolean(onSaveMetadata)
  const canUseHanime = kind === 'affiliation' && representative.library === 'erAnime' && Boolean(onSearchHanime && onApplyHanime)

  async function searchSelectedSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!scraperQuery.trim()) return
    setScraperStatus('searching')
    setScraperError('')
    setScraperSuccess('')
    try {
      if (scraperSource === 'bangumi' && onSearchBangumi) {
        setBangumiSubjects(await onSearchBangumi(scraperQuery.trim()))
        setHanimeSubjects([])
      } else if (scraperSource !== 'bangumi' && onSearchHanime) {
        setHanimeSubjects(await onSearchHanime(scraperQuery.trim(), scraperSource))
        setBangumiSubjects([])
      }
    } catch (error) {
      setBangumiSubjects([])
      setHanimeSubjects([])
      setScraperError(
        error instanceof Error
          ? error.message
          : `${scraperSource === 'bangumi' ? 'Bangumi' : scraperSource === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'} 搜索失败。`,
      )
    } finally {
      setScraperStatus('idle')
    }
  }

  async function prepareScrapePreview(source: 'bangumi' | 'freeanimehentai' | 'hanime1', subjectId: number) {
    const previewLoader =
      source === 'bangumi'
        ? onPreviewBangumi && (() => onPreviewBangumi(subjectId))
        : onPreviewHanime && (() => onPreviewHanime(subjectId, source))
    if (!previewLoader) return
    setScraperStatus('searching')
    setScraperError('')
    setScraperSuccess('')
    try {
      const preview = await previewLoader()
      setScrapePreview(preview)
      setScrapeDraft({
        cover: Boolean(preview.coverUrl),
        affiliation: preview.chineseTitle,
        originalTitle: preview.title,
        studio: preview.studio,
        firstAiredAt: preview.firstAiredAt || preview.releaseDate,
        releaseDate: '',
        note: preview.note,
      })
      setLastAppliedField(null)
    } catch (error) {
      setScrapePreview(null)
      setScraperError(error instanceof Error ? error.message : '读取刮削资料失败。')
    } finally {
      setScraperStatus('idle')
    }
  }

  async function applyScrapeField(field: ScrapeWritableField) {
    if (!scrapePreview) return
    const fields: StarMediaScrapeFields = field === 'cover' ? { cover: true } : { [field]: scrapeDraft[field] }
    setScraperStatus('applying')
    setApplyingField(field)
    setScraperError('')
    setScraperSuccess('')
    try {
      if (scrapePreview.source === 'bangumi' && onApplyBangumi) {
        await onApplyBangumi(representative, scrapePreview.subjectId, fields)
        setBangumiId(String(scrapePreview.subjectId))
      } else if (scrapePreview.source !== 'bangumi' && onApplyHanime) {
        await onApplyHanime(representative, scrapePreview.subjectId, scrapePreview.source, fields)
        if (scrapePreview.source === 'hanime1') setHanime1Id(String(scrapePreview.subjectId))
        else setFreeAnimeHentaiId(String(scrapePreview.subjectId))
      }
      if (scrapePreview.title) setScraperQuery(scrapePreview.title)
      setLastAppliedField(field)
      const labels: Record<ScrapeWritableField, string> = {
        cover: '封面',
        affiliation: '合集中文名',
        originalTitle: '原名',
        studio: '制作公司',
        firstAiredAt: '第一话首播日期',
        note: '简介',
      }
      setScraperSuccess(`${labels[field]}已写入。`)
    } catch (error) {
      setScraperError(error instanceof Error ? error.message : '刮削资料更新失败。')
    } finally {
      setScraperStatus('idle')
      setApplyingField(null)
    }
  }

  async function applyBangumiId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const subjectId = Number(bangumiId.trim())
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      setScraperError('请输入有效的 Bangumi ID。')
      return
    }
    await prepareScrapePreview('bangumi', subjectId)
  }

  async function applyHanimeId(event: FormEvent<HTMLFormElement>, source: 'freeanimehentai' | 'hanime1') {
    event.preventDefault()
    const value = source === 'hanime1' ? hanime1Id : freeAnimeHentaiId
    const subjectId = Number(value.trim())
    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      setScraperError(`请输入有效的 ${source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'} ID。`)
      return
    }
    await prepareScrapePreview(source, subjectId)
  }

  function closeScrapePreview() {
    setScrapePreview(null)
    setScrapeDraft(emptyScrapeDraftValues)
    setApplyingField(null)
    setLastAppliedField(null)
    setScraperSuccess('')
  }

  function selectScraperSource(source: 'bangumi' | 'freeanimehentai' | 'hanime1') {
    if (source === scraperSource) return
    setScraperSource(source)
    setBangumiSubjects([])
    setHanimeSubjects([])
    setScraperError('')
    closeScrapePreview()
  }

  async function saveMetadata() {
    if (!onSaveMetadata) return
    setMetadataSaving(true)
    setMetadataError('')
    try {
      await onSaveMetadata(representative, draftMetadata)
      setEditingMetadata(false)
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : '保存合集资料失败。')
    } finally {
      setMetadataSaving(false)
    }
  }

  return (
    <section className="container-overview">
      <div className="container-overview-heading">
        <button className="secondary-button small-button" onClick={onBack}>
          <ChevronLeft size={16} />
          返回{label}列表
        </button>
      </div>
      <article
        className={`collection-hero ${usesPosterCover ? 'poster-collection' : 'video-collection'} ${isCreatorContainer ? 'creator-collection' : ''}`}
      >
        {!isCreatorContainer && <div className="collection-backdrop" style={{ background: representative.cover } as CSSProperties} />}
        <div className="collection-hero-content">
          <div
            className={`collection-poster ${usesPosterCover ? 'poster-cover' : ''} ${isCreatorContainer ? 'creator-cover-placeholder' : ''}`}
            style={isCreatorContainer ? undefined : ({ background: representative.cover } as CSSProperties)}
          >
            {isCreatorContainer && <span className="creator-cover-label">创作者</span>}
          </div>
          <div className="collection-info">
            <h2>{name}</h2>
            {representative.originalTitle && <p className="collection-original-title">{representative.originalTitle}</p>}
            {(representative.firstAiredAt || representative.studio) && (
              <div className="collection-meta-chips">
                {representative.firstAiredAt && <span>{representative.firstAiredAt}</span>}
                {representative.studio && <span>{representative.studio}</span>}
              </div>
            )}
            <div className="collection-actions">
              {canEditMetadata && (
                <button className="secondary-button" onClick={() => setEditingMetadata((current) => !current)}>
                  {editingMetadata ? '收起资料' : kind === 'shelf' ? '编辑书架' : isCreatorContainer ? '编辑创作者' : '编辑资料'}
                </button>
              )}
              <button className="secondary-button" onClick={() => setEditingNote((current) => !current)}>
                {editingNote ? '收起简介' : '编辑简介'}
              </button>
              {usesPosterCover && onSearchBangumi && onPreviewBangumi && onApplyBangumi && (
                <button className="secondary-button" onClick={() => setScraperOpen((current) => !current)}>
                  {scraperOpen ? '收起刮削' : '网络刮削'}
                </button>
              )}
            </div>
            {editingMetadata && (
              <div className="collection-metadata-editor">
                {kind === 'shelf' ? (
                  <label>
                    <span>书架名称</span>
                    <input
                      value={draftMetadata.name}
                      onChange={(event) => setDraftMetadata((current) => ({ ...current, name: event.target.value }))}
                      maxLength={200}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      <span>{isCreatorContainer ? '创作者名' : '中文名（合集名）'}</span>
                      <input
                        value={draftMetadata.name}
                        onChange={(event) => setDraftMetadata((current) => ({ ...current, name: event.target.value }))}
                        maxLength={200}
                      />
                    </label>
                    {!isCreatorContainer && (
                      <>
                        <label>
                          <span>日语原名</span>
                          <input
                            value={draftMetadata.originalTitle}
                            onChange={(event) => setDraftMetadata((current) => ({ ...current, originalTitle: event.target.value }))}
                            maxLength={200}
                          />
                        </label>
                        <label>
                          <span>制作公司</span>
                          <input
                            value={draftMetadata.studio}
                            onChange={(event) => setDraftMetadata((current) => ({ ...current, studio: event.target.value }))}
                            maxLength={200}
                          />
                        </label>
                        <label>
                          <span>第一话首播日期</span>
                          <input
                            value={draftMetadata.firstAiredAt}
                            onChange={(event) => setDraftMetadata((current) => ({ ...current, firstAiredAt: event.target.value }))}
                            placeholder="YYYY-MM-DD"
                            maxLength={40}
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
                {metadataError && <p className="metadata-error">{metadataError}</p>}
                <div className="collection-editor-actions">
                  <button
                    className="primary-button small-button"
                    disabled={metadataSaving || !draftMetadata.name.trim()}
                    onClick={() => void saveMetadata()}
                  >
                    {metadataSaving ? '保存中…' : '保存资料'}
                  </button>
                  <button
                    className="secondary-button small-button"
                    disabled={metadataSaving}
                    onClick={() => {
                      setDraftMetadata({
                        name,
                        originalTitle: representative.originalTitle ?? '',
                        studio: representative.studio ?? '',
                        firstAiredAt: representative.firstAiredAt ?? '',
                      })
                      setMetadataError('')
                      setEditingMetadata(false)
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            {!editingNote && representative.note?.trim() && <p className="collection-note">{representative.note}</p>}
            {editingNote && (
              <div className="collection-note-editor">
                <textarea
                  value={draftNote}
                  onChange={(event) => setDraftNote(event.target.value)}
                  placeholder={`为这个${label}写一段介绍…`}
                  maxLength={1200}
                />
                <button
                  className="secondary-button small-button"
                  onClick={() => {
                    onSaveNote(representative, draftNote)
                    setEditingNote(false)
                  }}
                >
                  保存简介
                </button>
              </div>
            )}
            <TagEditor
              className="container-tag-editor"
              tags={representative.tags ?? []}
              availableTags={availableTags}
              onChange={(tags) => onSaveTags(representative, tags)}
              onAddTag={onAddTag ? (tag) => onAddTag(representative, tag) : undefined}
            />
          </div>
        </div>
      </article>
      {usesPosterCover && onSearchBangumi && onPreviewBangumi && onApplyBangumi && scraperOpen && (
        <section className="scraper-panel collection-scraper-panel">
          <div className="scraper-panel-heading">
            <strong>网络刮削</strong>
            <button className="secondary-button tiny-button" onClick={() => setScraperOpen(false)}>
              收起
            </button>
          </div>
          <div className="scraper-source-switcher" role="tablist" aria-label="刮削来源">
            <button
              className={scraperSource === 'bangumi' ? 'active' : ''}
              disabled={scraperStatus !== 'idle'}
              onClick={() => selectScraperSource('bangumi')}
            >
              Bangumi
            </button>
            {canUseHanime && (
              <>
                <button
                  className={scraperSource === 'freeanimehentai' ? 'active' : ''}
                  disabled={scraperStatus !== 'idle'}
                  onClick={() => selectScraperSource('freeanimehentai')}
                >
                  FreeAnimeHentai
                </button>
                <button
                  className={scraperSource === 'hanime1' ? 'active' : ''}
                  disabled={scraperStatus !== 'idle'}
                  onClick={() => selectScraperSource('hanime1')}
                >
                  Hanime1
                </button>
              </>
            )}
          </div>
          <form className="scraper-search-form" onSubmit={searchSelectedSource}>
            <input
              value={scraperQuery}
              onChange={(event) => setScraperQuery(event.target.value)}
              placeholder={
                scraperSource === 'bangumi'
                  ? '搜索日语原名'
                  : scraperSource === 'hanime1'
                    ? '搜索标题、ID 或 Hanime1 链接'
                    : '搜索 FreeAnimeHentai 标题'
              }
            />
            <button type="submit" className="primary-button small-button" disabled={scraperStatus !== 'idle' || !scraperQuery.trim()}>
              {scraperStatus === 'searching'
                ? '搜索中…'
                : `搜索 ${scraperSource === 'bangumi' ? 'Bangumi' : scraperSource === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'}`}
            </button>
          </form>
          {scraperSource === 'bangumi' && (
            <form className="scraper-id-form" onSubmit={applyBangumiId}>
              <input
                value={bangumiId}
                onChange={(event) => setBangumiId(event.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="输入 Bangumi ID 精确匹配"
              />
              <button type="submit" className="primary-button small-button" disabled={scraperStatus !== 'idle' || !bangumiId.trim()}>
                选择字段
              </button>
            </form>
          )}
          {scraperSource === 'freeanimehentai' && (
            <form className="scraper-id-form" onSubmit={(event) => void applyHanimeId(event, 'freeanimehentai')}>
              <input
                value={freeAnimeHentaiId}
                onChange={(event) => setFreeAnimeHentaiId(event.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="输入 FreeAnimeHentai ID"
              />
              <button
                type="submit"
                className="primary-button small-button"
                disabled={scraperStatus !== 'idle' || !freeAnimeHentaiId.trim()}
              >
                选择字段
              </button>
            </form>
          )}
          {scraperSource === 'hanime1' && (
            <form className="scraper-id-form" onSubmit={(event) => void applyHanimeId(event, 'hanime1')}>
              <input
                value={hanime1Id}
                onChange={(event) => setHanime1Id(event.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder="输入 Hanime1 ID 或使用上方链接搜索"
              />
              <button type="submit" className="primary-button small-button" disabled={scraperStatus !== 'idle' || !hanime1Id.trim()}>
                选择字段
              </button>
            </form>
          )}
          {scraperError && <p className="bangumi-error">{scraperError}</p>}
          {scraperSuccess && <p className="scraper-success">{scraperSuccess}</p>}
          {scrapePreview && (
            <section className="scrape-field-editor">
              <div className="scrape-field-editor-heading">
                <div>
                  <strong>逐项写入刮削值</strong>
                  <small>
                    来源：
                    {scrapePreview.source === 'bangumi' ? 'Bangumi' : scrapePreview.source === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'} ·
                    ID：{scrapePreview.subjectId}
                  </small>
                </div>
                <button className="secondary-button tiny-button" onClick={closeScrapePreview} disabled={scraperStatus !== 'idle'}>
                  取消
                </button>
              </div>
              <p className="scrape-field-hint">
                {scrapePreview.source === 'freeanimehentai'
                  ? '每个值可单独修改和写入；该来源没有提供的字段不会影响现有资料。'
                  : scrapePreview.source === 'hanime1'
                    ? 'Hanime1 标题含附加文案时，可先修改“原名”，再只写入这一项。'
                    : '每个按钮只写入旁边的一项，不会覆盖其他资料。'}
              </p>
              <div className="scrape-field-row scrape-cover-row">
                <span>来源封面</span>
                {scrapePreview.coverUrl && (
                  <span className="scrape-preview-cover" style={{ backgroundImage: `url("${scrapePreview.coverUrl}")` }} />
                )}
                <button
                  type="button"
                  className="primary-button tiny-button scrape-write-button"
                  onClick={() => void applyScrapeField('cover')}
                  disabled={scraperStatus !== 'idle' || !scrapePreview.coverUrl}
                >
                  {applyingField === 'cover' ? '写入中…' : lastAppliedField === 'cover' ? '已写入' : '写入封面'}
                </button>
              </div>
              <ScrapeValueRow
                label="合集中文名"
                value={scrapeDraft.affiliation}
                maxLength={200}
                applying={applyingField === 'affiliation'}
                applied={lastAppliedField === 'affiliation'}
                disabled={scraperStatus !== 'idle'}
                onChange={(value) => setScrapeDraft((current) => ({ ...current, affiliation: value }))}
                onApply={() => void applyScrapeField('affiliation')}
              />
              <ScrapeValueRow
                label="原名（用于视频目录）"
                value={scrapeDraft.originalTitle}
                maxLength={200}
                applying={applyingField === 'originalTitle'}
                applied={lastAppliedField === 'originalTitle'}
                disabled={scraperStatus !== 'idle'}
                onChange={(value) => setScrapeDraft((current) => ({ ...current, originalTitle: value }))}
                onApply={() => void applyScrapeField('originalTitle')}
              />
              <ScrapeValueRow
                label="制作公司"
                value={scrapeDraft.studio}
                maxLength={200}
                applying={applyingField === 'studio'}
                applied={lastAppliedField === 'studio'}
                disabled={scraperStatus !== 'idle'}
                onChange={(value) => setScrapeDraft((current) => ({ ...current, studio: value }))}
                onApply={() => void applyScrapeField('studio')}
              />
              <ScrapeValueRow
                label="第一话首播日期"
                value={scrapeDraft.firstAiredAt}
                maxLength={40}
                applying={applyingField === 'firstAiredAt'}
                applied={lastAppliedField === 'firstAiredAt'}
                disabled={scraperStatus !== 'idle'}
                onChange={(value) => setScrapeDraft((current) => ({ ...current, firstAiredAt: value }))}
                onApply={() => void applyScrapeField('firstAiredAt')}
              />
              <ScrapeValueRow
                label="简介"
                value={scrapeDraft.note}
                maxLength={1200}
                multiline
                applying={applyingField === 'note'}
                applied={lastAppliedField === 'note'}
                disabled={scraperStatus !== 'idle'}
                onChange={(value) => setScrapeDraft((current) => ({ ...current, note: value }))}
                onApply={() => void applyScrapeField('note')}
              />
            </section>
          )}
          {bangumiSubjects.length > 0 && (
            <div className="scraper-results">
              <div className="scraper-results-heading">来源：Bangumi · {bangumiSubjects.length} 个结果</div>
              {bangumiSubjects.map((subject) => (
                <div className="scraper-result-row" key={subject.id}>
                  <div
                    className="scraper-result-cover"
                    style={{ background: subject.image ? `url("${subject.image}") center / cover` : undefined }}
                  />
                  <div className="scraper-result-copy">
                    <strong>{subject.nameCn || subject.name}</strong>
                    {subject.nameCn && subject.name !== subject.nameCn && <small>{subject.name}</small>}
                    <small>
                      ID：{subject.id} · {subject.date || '日期未知'}
                    </small>
                  </div>
                  <div className="scraper-result-actions">
                    <button
                      className="primary-button tiny-button"
                      disabled={scraperStatus !== 'idle'}
                      onClick={() => void prepareScrapePreview('bangumi', subject.id)}
                    >
                      选择字段
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {hanimeSubjects.length > 0 && (
            <div className="scraper-results">
              <div className="scraper-results-heading">
                来源：{scraperSource === 'hanime1' ? 'Hanime1' : 'FreeAnimeHentai'} · {hanimeSubjects.length} 个结果
              </div>
              {hanimeSubjects.map((subject) => (
                <div className="scraper-result-row" key={`${subject.source}-${subject.id}`}>
                  <div
                    className="scraper-result-cover"
                    style={{ background: subject.image ? `url("${subject.image}") center / cover` : undefined }}
                  />
                  <div className="scraper-result-copy">
                    <strong>{subject.name}</strong>
                    <small>
                      ID：{subject.id} · {subject.date || '日期未知'}
                      {subject.brand ? ` · ${subject.brand}` : ''}
                    </small>
                    {subject.description && <small>{subject.description}</small>}
                  </div>
                  <div className="scraper-result-actions">
                    <button
                      className="primary-button tiny-button"
                      disabled={scraperStatus !== 'idle'}
                      onClick={() => void prepareScrapePreview(subject.source, subject.id)}
                    >
                      选择字段
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <section className="container-entry-section">
        <div className="container-entry-heading">
          <h3>{kind === 'affiliation' ? '选集' : '书目'}</h3>
          <div className="container-entry-controls">
            {onContainerImport && (
              <button className="secondary-button tiny-button" onClick={onContainerImport} disabled={importing}>
                <UploadCloud size={14} />
                {importing ? '正在导入…' : `导入${entryLabel}`}
              </button>
            )}
            {kind === 'affiliation' && (
              <label className="episode-sort-select">
                <span>排序</span>
                <select value={episodeSort} onChange={(event) => setEpisodeSort(event.target.value as EpisodeSortMode)}>
                  <option value="episode">集数排序</option>
                  <option value="title-asc">名称 A-Z</option>
                  <option value="title-desc">名称 Z-A</option>
                </select>
              </label>
            )}
          </div>
        </div>
        {kind === 'affiliation' ? (
          <EpisodeSelectionSurface
            items={orderedItems}
            selectedIds={selectedIds}
            onOpen={onOpen}
            onToggleSelection={onToggleSelection}
            onOpenBatchMenu={onOpenBatchMenu}
            onSelectMany={onSelectMany}
          />
        ) : (
          <MediaWall
            key={`${orderedItems[0]?.library ?? 'archive'}:${name}`}
            items={orderedItems}
            viewMode="large"
            deferRendering
            onOpen={onOpen}
            selectedIds={selectedIds}
            onToggleSelection={onToggleSelection}
            onOpenBatchMenu={onOpenBatchMenu}
            onSelectMany={onSelectMany}
          />
        )}
      </section>
    </section>
  )
}

function ScrapeValueRow({
  label,
  value,
  maxLength,
  multiline = false,
  applying,
  applied,
  disabled,
  onChange,
  onApply,
}: {
  label: string
  value: string
  maxLength: number
  multiline?: boolean
  applying: boolean
  applied: boolean
  disabled: boolean
  onChange: (value: string) => void
  onApply: () => void
}) {
  return (
    <div className={`scrape-field-row ${multiline ? 'scrape-note-row' : ''}`}>
      <span>{label}</span>
      <div className="scrape-value-actions">
        {multiline ? (
          <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} />
        ) : (
          <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} />
        )}
        <button type="button" className="secondary-button tiny-button scrape-write-button" onClick={onApply} disabled={disabled}>
          {applying ? '写入中…' : applied ? '已写入' : '写入此项'}
        </button>
      </div>
    </div>
  )
}

function EpisodeSelectionSurface({
  items,
  selectedIds,
  onOpen,
  onToggleSelection,
  onOpenBatchMenu,
  onSelectMany,
}: {
  items: MediaItem[]
  selectedIds: string[]
  onOpen: (item: MediaItem) => void
  onToggleSelection?: (item: MediaItem) => void
  onOpenBatchMenu?: (item: MediaItem, event: MouseEvent<HTMLElement>) => void
  onSelectMany?: (items: MediaItem[]) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const dragStateRef = useRef<{ x: number; y: number; pointerId: number; active: boolean; selectedIds: Set<string> } | null>(null)
  const suppressClickRef = useRef(false)
  const selectionAnchorRef = useRef<string | null>(null)

  function selectItem(item: MediaItem, useRange: boolean) {
    const anchorId = selectionAnchorRef.current
    if (useRange && anchorId && onSelectMany) {
      const start = items.findIndex((candidate) => candidate.id === anchorId)
      const end = items.findIndex((candidate) => candidate.id === item.id)
      if (start >= 0 && end >= 0) {
        const selected = new Set(selectedIds)
        items.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((candidate) => selected.add(candidate.id))
        onSelectMany(items.filter((candidate) => selected.has(candidate.id)))
        return
      }
    }
    onToggleSelection?.(item)
    selectionAnchorRef.current = item.id
  }

  function updateDragSelection(clientX: number, clientY: number, event?: PointerEvent<HTMLDivElement>) {
    const root = rootRef.current
    const state = dragStateRef.current
    if (!root || !state || !onSelectMany) return
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
    for (const item of items) {
      const card = root.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(item.id)}"]`)
      if (!card) continue
      const rect = card.getBoundingClientRect()
      if (rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top) ids.add(item.id)
    }
    onSelectMany(items.filter((item) => ids.has(item.id)))
  }

  function startDragSelection(event: PointerEvent<HTMLDivElement>) {
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

  function finishDragSelection(event: PointerEvent<HTMLDivElement>) {
    const state = dragStateRef.current
    if (!state) return
    if (state.active) {
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
      className="episode-grid media-selection-surface"
      onPointerDown={startDragSelection}
      onPointerDownCapture={(event) => {
        const itemId = (event.target as HTMLElement).closest<HTMLElement>('[data-media-id]')?.dataset.mediaId
        if (itemId && !event.shiftKey) selectionAnchorRef.current = itemId
      }}
      onPointerMove={(event) => updateDragSelection(event.clientX, event.clientY, event)}
      onPointerUp={(event) => {
        updateDragSelection(event.clientX, event.clientY, event)
        finishDragSelection(event)
      }}
      onPointerCancel={finishDragSelection}
      onLostPointerCapture={finishDragSelection}
      onClickCapture={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault()
          event.stopPropagation()
          return
        }
        const target = event.target as HTMLElement
        if (!target.closest('[data-media-id], button, input, select, textarea, a, [role="menu"]')) onSelectMany?.([])
      }}
    >
      {items.map((item) => (
        <div
          data-media-id={item.id}
          className={`episode-card ${selectedIds.includes(item.id) ? 'selected' : ''}`}
          key={item.id}
          onContextMenu={(event) => onOpenBatchMenu?.(item, event)}
        >
          <button
            type="button"
            className="episode-card-open"
            onClick={(event) => {
              if (event.shiftKey) {
                event.preventDefault()
                selectItem(item, true)
                return
              }
              onOpen(item)
            }}
          >
            <div className="episode-cover" style={{ background: getEpisodeCover(item) } as CSSProperties} />
            <strong>{getMediaEpisode(item)}</strong>
          </button>
        </div>
      ))}
      {selectionBox && <span className="media-selection-box" style={selectionBox} />}
    </div>
  )
}

function isSelectionControl(target: HTMLElement) {
  if (target.closest('input, select, textarea, a, [role="menu"], .dropdown-menu, .media-batch-menu')) return true
  if (target.closest('[data-media-id], [data-group-key]')) return false
  const button = target.closest('button')
  return Boolean(button)
}
