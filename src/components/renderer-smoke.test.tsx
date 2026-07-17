import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BookReader } from './BookReader'
import { ContainerOverview } from './ContainerOverview'
import { DetailPanel } from './DetailPanel'
import { ImportView } from './ImportView'
import { LibraryBrowser } from './LibraryBrowserViews'
import { MediaBatchMenu } from './MediaBatchMenu'
import { MediaWall } from './MediaWall'
import { TagEditor } from './TagEditor'
import { VideoPlayer } from './VideoPlayer'
import { libraries, libraryById, type MediaItem } from '../data'

const video: MediaItem = {
  id: 'video:1',
  library: 'anime',
  title: 'Episode 1',
  grouping: 'Series',
  affiliation: 'Series',
  episode: 'Episode 1',
  tags: ['动作'],
  addedAt: '2026-01-01',
  duration: '24:00',
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
  grouping: '',
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
          primaryFilter="all"
          tagFilter="all"
          sortMode="title"
          sortDirection="ascending"
          primaryOptions={[]}
          tagOptions={[]}
          sortOptions={[{ value: 'title', label: '标题' }]}
          onBrowseStateChange={noOp}
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
        />
        <DetailPanel
          item={video}
          availableTags={['动作']}
          classifications={[]}
          availableCreators={[]}
          onUpdateTags={noOp}
          onUpdateBookMetadata={async () => {}}
          onUpdateVideoEpisode={async () => video}
          onUpdateVideoReleaseDate={async () => video}
          onClose={noOp}
          onRead={noOp}
          onPlayVideo={noOp}
          onOpenExternal={noOp}
        />
        <MediaBatchMenu position={{ x: 0, y: 0 }} items={[book]} onApplyShelf={noOp} onTransfer={noOp} onTrash={noOp} onClose={noOp} />
        <BookReader
          item={book}
          sessionId="session"
          pages={[{ name: 'page-1', url: 'file:///page-1.jpg' }]}
          status="ready"
          errorMessage=""
          onClose={noOp}
        />
        <VideoPlayer
          item={video}
          sourceUrl="file:///episode.mp4"
          mimeType="video/mp4"
          subtitles={[
            { url: 'file:///zh.vtt', label: '中文' },
            { url: 'file:///en.vtt', label: 'English' },
          ]}
          status="ready"
          errorMessage=""
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
    expect(markup).toContain('1 / 1')
    expect(markup).toContain('移入回收站')
    expect(markup).toContain('字幕：关闭')
    expect(markup).toContain('English')
    expect(markup).toContain('铺满屏幕')
    expect(markup).toContain('原始尺寸')
  })

  it('keeps media library navigation in the configured order', () => {
    expect(libraries.map((library) => library.id)).toEqual(['erAnime', 'anime', 'creator', 'general', 'books', 'comics'])
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

  it('keeps large tag catalogs inside a compact picker instead of rendering one button per tag', () => {
    const availableTags = Array.from({ length: 120 }, (_, index) => `标签 ${index + 1}`)
    const markup = renderToStaticMarkup(
      <TagEditor tags={['已选择']} availableTags={availableTags} onChange={noOp} onAddTag={async () => {}} />,
    )

    expect(markup.match(/class="tag-editor-chip"/g)).toHaveLength(1)
    expect(markup.match(/<option/g)).toHaveLength(120)
    expect(markup).toContain('添加更多标签')
  })
})
