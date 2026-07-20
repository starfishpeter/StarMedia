import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BookReader } from './BookReader'
import { ContainerOverview } from './ContainerOverview'
import { DetailPanel } from './DetailPanel'
import { ImportView } from './ImportView'
import { AffiliationWall, LibraryBrowser } from './LibraryBrowserViews'
import { MediaBatchMenu } from './MediaBatchMenu'
import { MediaWall } from './MediaWall'
import { TagEditor } from './TagEditor'
import { VideoPlayer } from './VideoPlayer'
import { libraries, libraryById, type MediaItem } from '../data'

const video: MediaItem = {
  id: 'video:1',
  library: 'anime',
  title: 'Episode 1',
  affiliation: 'Series',
  episode: 'Episode 1',
  tags: ['动作'],
  addedAt: '2026-01-01',
  duration: '24:00',
  durationSeconds: 1440,
  kind: 'video',
  cover: '',
  note: 'Video note',
  sourcePath: 'C:\\Media\\Series\\episode.mp4',
  sidecars: [],
}

const book: MediaItem = {
  ...video,
  id: 'book:1',
  library: 'books',
  title: 'Book 1',
  shelf: 'Shelf',
  kind: 'book',
  duration: '32 页',
  sourcePath: 'C:\\Media\\Shelf\\book.zip',
}

const noOp = () => {}

describe('renderer component smoke coverage', () => {
  it('renders import, browser, container, detail, batch, reader, and player entry states', () => {
    const markup = renderToStaticMarkup(
      <>
        <ImportView
          sourcePaths={['C:\\Source']}
          targetLibrary="auto"
          onTargetLibraryChange={noOp}
          plan={null}
          status="idle"
          error={null}
          apiAvailable
          onSourcePathsChange={noOp}
          onPickSource={noOp}
          onGeneratePlan={noOp}
          onScanManagedLibraries={noOp}
          onImportRecords={noOp}
          importOperation="idle"
          importProgress={null}
          onPlanItemChange={noOp}
          onPlanItemsChange={noOp}
        />
        <LibraryBrowser
          activeLibrary={libraryById.anime}
          queryActive={false}
          visibleItems={[video]}
          isAffiliationLibrary
          isShelfLibrary={false}
          selectedAffiliation={null}
          selectedShelf={null}
          selectedIds={[]}
          viewMode="large"
          sortMode="title"
          sortDirection="ascending"
          sortOptions={[{ value: 'title', label: '标题' }]}
          onBrowseStateChange={noOp}
          showExternalSubtitleBadges={false}
          onShowExternalSubtitleBadgesChange={noOp}
          onReset={noOp}
          onClearSelection={noOp}
          onOpenAffiliation={noOp}
          onOpenShelf={noOp}
          onOpenItem={noOp}
          onToggleSelection={noOp}
          onOpenBatchMenu={noOp}
          onOpenBatchMenuForItems={noOp}
          onSelectMany={noOp}
          affiliationOverview={null}
          shelfOverview={null}
          libraryUsageBytes={1024}
        />
        <ContainerOverview
          kind="affiliation"
          name="Series"
          items={[video]}
          availableTags={['动作']}
          onBack={noOp}
          onOpen={noOp}
          onSaveNote={noOp}
          onSaveTags={noOp}
          onAssignBangumiEpisodes={async () => 0}
        />
        <DetailPanel
          item={video}
          availableTags={['动作']}
          onUpdateTags={noOp}
          onUpdateBookMetadata={async () => {}}
          onUpdateVideoEpisode={async () => video}
          onUpdateVideoReleaseDate={async () => video}
          onApplyBangumiEpisode={async () => video}
          onOpenExternalUrl={noOp}
          onClose={noOp}
          onRead={noOp}
          onPlayVideo={noOp}
          onOpenExternal={noOp}
        />
        <MediaBatchMenu
          position={{ x: 0, y: 0 }}
          items={[book]}
          onApplyShelf={noOp}
          onTransfer={noOp}
          onOpenInFileManager={noOp}
          onTrash={noOp}
          onClose={noOp}
        />
        <BookReader
          item={book}
          sessionId="session"
          pages={[{ name: 'page-1', url: 'file:///page-1.jpg' }]}
          status="ready"
          errorMessage=""
          defaultMode="page"
          onClose={noOp}
        />
        <VideoPlayer
          item={video}
          sourceUrl="file:///episode.mp4"
          mimeType="video/mp4"
          subtitles={[
            { format: 'vtt', url: 'file:///zh.vtt', label: '中文' },
            { format: 'vtt', url: 'file:///en.vtt', label: 'English' },
          ]}
          status="ready"
          errorMessage=""
          defaultFitMode="contain"
          onClose={noOp}
          onOpenExternal={async () => {}}
          onMetadata={noOp}
          onFeedback={noOp}
        />
      </>,
    )

    expect(markup).toContain('上传文件/文件夹')
    expect(markup).not.toContain('扫描会查找六个受管理媒体库')
    expect(markup).toContain('Series')
    expect(markup).toContain('collection-note clamped')
    expect(markup).toContain('1 / 1')
    expect(markup).toContain('移入回收站')
    expect(markup).toContain('在文件管理器中打开')
    expect(markup).toContain('字幕：关闭')
    expect(markup).toContain('English')
    expect(markup).toContain('格式')
    expect(markup).toContain('MP4')
    expect(markup).toContain('时长')
    expect(markup).toContain('24:00')
    expect(markup).toContain('适应窗口')
    expect(markup).toContain('影院模式')
    expect(markup).toContain('class="video-stage"')
    expect(markup).toContain('toolbar-switch')
    expect(markup).toContain('>关<')
    expect(markup).toContain('额外信息')
    expect(markup).toContain('Bangumi 单集')
  })

  it('offers transactional renaming only when a Bangumi episode title is available', () => {
    const markup = renderToStaticMarkup(
      <DetailPanel
        item={{ ...video, episode: '#01', episodeTitle: 'Bangumi 原标题', bangumiEpisodeSort: 1 }}
        availableTags={[]}
        onUpdateTags={noOp}
        onUpdateBookMetadata={async () => {}}
        onUpdateVideoEpisode={async () => video}
        onUpdateVideoReleaseDate={async () => video}
        onApplyBangumiEpisode={async () => video}
        onOpenExternalUrl={noOp}
        onClose={noOp}
        onRead={noOp}
        onPlayVideo={noOp}
        onOpenExternal={noOp}
      />,
    )

    expect(markup).toContain('使用 Bangumi 标题重命名')
    expect(markup).toContain('#01 Bangumi 原标题')
    expect(markup).not.toContain('不会改动文件名或合集简介')
  })

  it('omits an automatic episode prefix in a single-episode detail', () => {
    const markup = renderToStaticMarkup(
      <DetailPanel
        item={{ ...video, episode: '#01', episodeTitle: 'Bangumi 原标题', bangumiEpisodeSort: 1 }}
        includeEpisodePrefix={false}
        availableTags={[]}
        onUpdateTags={noOp}
        onUpdateBookMetadata={async () => {}}
        onUpdateVideoEpisode={async () => video}
        onUpdateVideoReleaseDate={async () => video}
        onApplyBangumiEpisode={async () => video}
        onOpenExternalUrl={noOp}
        onClose={noOp}
        onRead={noOp}
        onPlayVideo={noOp}
        onOpenExternal={noOp}
      />,
    )

    expect(markup).toContain('Bangumi 原标题')
    expect(markup).not.toContain('#01 Bangumi 原标题')
  })

  it('hides Bangumi renaming after the sanitized filename has been saved', () => {
    const markup = renderToStaticMarkup(
      <DetailPanel
        item={{ ...video, episode: '#04 Question？', episodeTitle: '#04 Question?', bangumiEpisodeSort: 4 }}
        availableTags={[]}
        onUpdateTags={noOp}
        onUpdateBookMetadata={async () => {}}
        onUpdateVideoEpisode={async () => video}
        onUpdateVideoReleaseDate={async () => video}
        onApplyBangumiEpisode={async () => video}
        onOpenExternalUrl={noOp}
        onClose={noOp}
        onRead={noOp}
        onPlayVideo={noOp}
        onOpenExternal={noOp}
      />,
    )

    expect(markup).not.toContain('使用 Bangumi 标题重命名')
  })

  it('keeps Bangumi numbering after the Bangumi title was used as the local filename', () => {
    const markup = renderToStaticMarkup(
      <DetailPanel
        item={{
          ...video,
          episode: '二つのキャンプ、二人の景色',
          episodeTitle: '二つのキャンプ、二人の景色',
          episodeTitleSource: 'bangumi',
          bangumiEpisodeSort: 5,
        }}
        availableTags={[]}
        onUpdateTags={noOp}
        onUpdateBookMetadata={async () => {}}
        onUpdateVideoEpisode={async () => video}
        onUpdateVideoReleaseDate={async () => video}
        onApplyBangumiEpisode={async () => video}
        onOpenExternalUrl={noOp}
        onClose={noOp}
        onRead={noOp}
        onPlayVideo={noOp}
        onOpenExternal={noOp}
      />,
    )

    expect(markup).toContain('#05 二つのキャンプ、二人の景色')
  })

  it('keeps media library navigation in the configured order', () => {
    expect(libraries.map((library) => library.id)).toEqual(['erAnime', 'anime', 'creator', 'general', 'books', 'comics'])
  })

  it('sorts affiliation cards by their displayed titles rather than episode titles', () => {
    const markup = renderToStaticMarkup(
      <AffiliationWall
        items={[
          { ...video, id: 'season-3', title: 'A later episode', affiliation: '摇曳露营 第三季' },
          { ...video, id: 'season-2', title: 'Z earlier episode', affiliation: '摇曳露营 第二季' },
        ]}
        sortMode="title"
        sortDirection="ascending"
        onOpen={noOp}
      />,
    )

    expect(markup.indexOf('data-group-key="摇曳露营 第二季"')).toBeLessThan(markup.indexOf('data-group-key="摇曳露营 第三季"'))
  })

  it('marks a collection with any supported external subtitle only when enabled', () => {
    const items = [
      {
        ...video,
        id: 'subtitled',
        sidecars: [{ fileName: 'Episode 1.ass', sourcePath: 'C:\\Media\\Series\\Episode 1.ass', extension: '.ass', size: 8 }],
      },
      { ...video, id: 'plain', title: 'Episode 2' },
    ]
    const enabled = renderToStaticMarkup(
      <AffiliationWall items={items} sortMode="title" sortDirection="ascending" showExternalSubtitleBadges onOpen={noOp} />,
    )
    const disabled = renderToStaticMarkup(<AffiliationWall items={items} sortMode="title" sortDirection="ascending" onOpen={noOp} />)

    expect(enabled).toContain('external-subtitle-badge')
    expect(enabled).toContain('外挂')
    expect(disabled).not.toContain('external-subtitle-badge')
  })

  it('shows embedded and external subtitle badges together only when extra information is enabled', () => {
    const items = [
      {
        ...video,
        id: 'subtitled',
        hasEmbeddedSubtitles: true,
        sidecars: [{ fileName: 'Episode 1.ass', sourcePath: 'C:\\Media\\Series\\Episode 1.ass', extension: '.ass', size: 8 }],
      },
    ]
    const enabled = renderToStaticMarkup(
      <AffiliationWall items={items} sortMode="title" sortDirection="ascending" showExternalSubtitleBadges onOpen={noOp} />,
    )
    const disabled = renderToStaticMarkup(<AffiliationWall items={items} sortMode="title" sortDirection="ascending" onOpen={noOp} />)

    expect(enabled).toContain('外挂字幕')
    expect(enabled).toContain('内嵌字幕')
    expect(enabled).toContain('subtitle-badges')
    expect(disabled).not.toContain('subtitle-badges')
  })

  it('places the embedded subtitle switch in the collection action row', () => {
    const markup = renderToStaticMarkup(
      <ContainerOverview
        kind="affiliation"
        name="Series"
        items={[video]}
        availableTags={[]}
        onBack={noOp}
        onOpen={noOp}
        onSaveNote={noOp}
        onSaveMetadata={async () => video}
        onSaveTags={noOp}
        onUpdateEmbeddedSubtitles={async () => video}
      />,
    )

    expect(markup).toContain('collection-action-toggle')
    expect(markup).toContain('内嵌字幕标记')
    expect(markup).not.toContain('collection-embedded-subtitle-toggle')
  })

  it('defaults collection entries to name ordering without an episode sort option', () => {
    const markup = renderToStaticMarkup(
      <ContainerOverview
        kind="affiliation"
        name="Series"
        items={[
          { ...video, id: 'four', episode: '#04 特典', bangumiEpisodeSort: 2 },
          { ...video, id: 'two', episode: '#02 正篇', bangumiEpisodeSort: 4 },
        ]}
        availableTags={[]}
        onBack={noOp}
        onOpen={noOp}
        onSaveNote={noOp}
        onSaveTags={noOp}
      />,
    )

    expect(markup).toContain('名称 A-Z')
    expect(markup).not.toContain('集数排序')
    expect(markup.indexOf('#02 正篇')).toBeLessThan(markup.indexOf('#04 特典'))
  })

  it('does not offer media-library transfer for a single video selection', () => {
    const markup = renderToStaticMarkup(
      <MediaBatchMenu
        position={{ x: 0, y: 0 }}
        items={[video]}
        onApplyShelf={noOp}
        onTransfer={noOp}
        onOpenInFileManager={noOp}
        onTrash={noOp}
        onClose={noOp}
      />,
    )

    expect(markup).toContain('在文件管理器中打开')
    expect(markup).not.toContain('转移到媒体库')
  })

  it('uses video metadata for creator and general videos without exposing collection tag controls', () => {
    const creatorVideo: MediaItem = {
      ...video,
      library: 'creator',
      affiliation: 'Creator',
      cover: 'url("file:///creator-thumb.jpg") center / cover',
    }
    const generalVideo: MediaItem = { ...video, library: 'general', affiliation: 'Program' }
    const creatorLibrary = renderToStaticMarkup(
      <LibraryBrowser
        activeLibrary={libraryById.creator}
        queryActive={false}
        visibleItems={[creatorVideo]}
        isAffiliationLibrary
        isShelfLibrary={false}
        selectedAffiliation={null}
        selectedShelf={null}
        selectedIds={[]}
        viewMode="large"
        sortMode="title"
        sortDirection="ascending"
        sortOptions={[{ value: 'title', label: '标题' }]}
        onBrowseStateChange={noOp}
        showExternalSubtitleBadges={false}
        onShowExternalSubtitleBadgesChange={noOp}
        onReset={noOp}
        onClearSelection={noOp}
        onOpenAffiliation={noOp}
        onOpenShelf={noOp}
        onOpenItem={noOp}
        onToggleSelection={noOp}
        onOpenBatchMenu={noOp}
        onOpenBatchMenuForItems={noOp}
        onSelectMany={noOp}
        affiliationOverview={null}
        shelfOverview={null}
        libraryUsageBytes={1024}
      />,
    )
    const creatorOverview = renderToStaticMarkup(
      <ContainerOverview
        kind="affiliation"
        name="Creator"
        items={[creatorVideo]}
        availableTags={['动作']}
        onBack={noOp}
        onOpen={noOp}
        onSaveNote={noOp}
        onSaveTags={noOp}
      />,
    )
    const generalDetail = renderToStaticMarkup(
      <DetailPanel
        item={generalVideo}
        availableTags={['动作']}
        onUpdateTags={noOp}
        onUpdateBookMetadata={async () => {}}
        onUpdateVideoEpisode={async () => generalVideo}
        onUpdateVideoReleaseDate={async () => generalVideo}
        onApplyBangumiEpisode={async () => generalVideo}
        onOpenExternalUrl={noOp}
        onClose={noOp}
        onRead={noOp}
        onPlayVideo={noOp}
        onOpenExternal={noOp}
      />,
    )

    expect(creatorLibrary).toContain('creator-thumb.jpg')
    expect(creatorLibrary).not.toContain('分类')
    expect(creatorLibrary).not.toContain('标签')
    expect(creatorOverview).not.toContain('container-tag-editor')
    expect(generalDetail).toContain('>标签<')
    expect(generalDetail).not.toContain('标签（作用于整个合集）')
  })

  it('caps the initial archive media wall DOM for large libraries', () => {
    const books = Array.from({ length: 209 }, (_, index) => ({
      ...book,
      id: `book:${index + 1}`,
      title: `Book ${index + 1}`,
    }))
    const markup = renderToStaticMarkup(
      <MediaWall items={books} viewMode="large" deferRendering onOpen={noOp} selectedIds={[]} onSelectMany={noOp} />,
    )

    expect(markup.match(/data-media-id=/g)).toHaveLength(48)
    expect(markup).not.toContain('content-visibility')
  })

  it('keeps large tag catalogs out of the initial markup until the user enters a query', () => {
    const availableTags = Array.from({ length: 120 }, (_, index) => `标签 ${index + 1}`)
    const markup = renderToStaticMarkup(
      <TagEditor tags={['已选择']} availableTags={availableTags} onChange={noOp} onAddTag={async () => {}} />,
    )

    expect(markup.match(/class="tag-editor-chip"/g)).toHaveLength(1)
    expect(markup).not.toContain('<option')
    expect(markup).not.toContain('tag-editor-suggestions')
    expect(markup).toContain('添加更多标签')
  })
})
