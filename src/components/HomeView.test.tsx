import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MediaItem } from '../data'
import { HomeView } from './HomeView'

function makeItems(library: 'anime' | 'books', count: number): MediaItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${library}:${index}`,
    library,
    title: `${library} ${index}`,
    grouping: 'Series',
    affiliation: library === 'anime' ? `Series ${index}` : undefined,
    tags: [],
    addedAt: '2026-01-01',
    duration: library === 'books' ? '36 页' : '24:00',
    kind: library === 'books' ? 'book' : 'video',
    cover: '',
    note: '',
  }))
}

describe('HomeView', () => {
  it('shows only populated libraries and limits each random shelf to eight cards', () => {
    const markup = renderToStaticMarkup(
      <HomeView
        items={[...makeItems('anime', 12), ...makeItems('books', 3)]}
        onNavigate={() => {}}
        onOpen={() => {}}
        onOpenCollection={() => {}}
      />,
    )

    expect(markup).toContain('id="home-library-anime"')
    expect(markup).toContain('id="home-library-books"')
    expect(markup).not.toContain('id="home-library-erAnime"')
    expect(markup).not.toContain('id="home-library-comics"')
    expect(markup.match(/data-group-key="Series /g)).toHaveLength(8)
    expect(markup).not.toContain('data-media-id="anime:')
    expect(markup.match(/data-media-id="books:/g)).toHaveLength(3)
    expect(markup.match(/换一批/g)).toHaveLength(1)
    expect(markup).not.toContain('<h1>随便看看</h1>')
  })

  it('renders a single empty state when every library is empty', () => {
    const markup = renderToStaticMarkup(<HomeView items={[]} onNavigate={() => {}} onOpen={() => {}} onOpenCollection={() => {}} />)

    expect(markup).toContain('还没有可以展示的资源')
    expect(markup).not.toContain('home-library-section')
  })
})
