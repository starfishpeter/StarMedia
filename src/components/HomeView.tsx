import { ArrowRight, Shuffle } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { libraries, type LibraryId, type MediaItem } from '../data'
import { getHomeVideoCollections, pickRandomHomeItems, type HomeVideoCollection } from '../domain/home'
import { MediaCard } from './MediaWall'

const homeSessionSeed = String(Date.now())
const homeShelfLimit = 8
type HomeSection =
  | { library: (typeof libraries)[number]; total: number; kind: 'collections'; entries: HomeVideoCollection[] }
  | { library: (typeof libraries)[number]; total: number; kind: 'items'; entries: MediaItem[] }

export function HomeView({
  items,
  onNavigate,
  onOpen,
  onOpenCollection,
}: {
  items: MediaItem[]
  onNavigate: (id: LibraryId) => void
  onOpen: (item: MediaItem) => void
  onOpenCollection: (libraryId: LibraryId, name: string) => void
}) {
  const [refreshKeys, setRefreshKeys] = useState<Partial<Record<LibraryId, number>>>({})
  const sections = useMemo<HomeSection[]>(
    () =>
      libraries
        .map((library): HomeSection | null => {
          const libraryItems = items.filter((item) => item.library === library.id)
          if (libraryItems.length === 0) return null
          const refreshKey = refreshKeys[library.id] ?? 0
          const collections = getHomeVideoCollections(libraryItems)
          const seed = `${homeSessionSeed}:${library.id}:${refreshKey}`
          if (collections.length > 0)
            return {
              library,
              total: collections.length,
              kind: 'collections',
              entries: pickRandomHomeItems(collections, seed, homeShelfLimit),
            }
          return {
            library,
            total: libraryItems.length,
            kind: 'items',
            entries: pickRandomHomeItems(libraryItems, seed, homeShelfLimit),
          }
        })
        .filter((section): section is HomeSection => section !== null),
    [items, refreshKeys],
  )

  if (sections.length === 0) {
    return (
      <section className="home-page empty-home" aria-label="首页">
        <div className="home-empty-state">
          <Shuffle size={26} aria-hidden="true" />
          <h1>还没有可以展示的资源</h1>
          <p>导入媒体后，有内容的媒体库会自动出现在这里。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="home-page" aria-label="首页">
      {sections.map(({ library, total, kind, entries }) => {
        const Icon = library.icon
        return (
          <section key={library.id} className="home-library-section" aria-labelledby={`home-library-${library.id}`}>
            <div className="home-library-heading">
              <div className="home-library-title">
                <span className="home-library-icon" style={{ color: library.color, backgroundColor: `${library.color}18` }}>
                  <Icon size={19} aria-hidden="true" />
                </span>
                <div>
                  <h2 id={`home-library-${library.id}`}>{library.label}</h2>
                  <span>
                    随便看看 · 共 {total} {kind === 'collections' ? '个合集' : '项'}
                  </span>
                </div>
              </div>
              <div className="home-library-actions">
                {total > homeShelfLimit && (
                  <button
                    className="home-section-action"
                    onClick={() =>
                      setRefreshKeys((current) => ({
                        ...current,
                        [library.id]: (current[library.id] ?? 0) + 1,
                      }))
                    }
                  >
                    <Shuffle size={15} aria-hidden="true" />
                    换一批
                  </button>
                )}
                <button className="home-section-action" onClick={() => onNavigate(library.id)}>
                  查看全部
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="home-media-shelf">
              {kind === 'collections'
                ? entries.map((collection) => (
                    <HomeCollectionCard
                      key={collection.id}
                      collection={collection}
                      onOpen={() => onOpenCollection(library.id, collection.name)}
                    />
                  ))
                : entries.map((item) => <MediaCard key={item.id} item={item} onOpen={onOpen} />)}
            </div>
          </section>
        )
      })}
    </section>
  )
}

function HomeCollectionCard({ collection, onOpen }: { collection: HomeVideoCollection; onOpen: () => void }) {
  const { coverItem } = collection
  const usesPoster = coverItem.library === 'erAnime' || coverItem.library === 'anime'
  const isCreator = coverItem.library === 'creator'
  return (
    <button data-group-key={collection.name} className="affiliation-card" onClick={onOpen}>
      <div
        className={`cover-art affiliation-cover ${usesPoster ? 'poster-cover' : ''} ${isCreator ? 'creator-cover-placeholder' : ''}`}
        style={isCreator ? undefined : ({ background: coverItem.cover } as CSSProperties)}
      >
        {isCreator ? <span className="creator-cover-label">创作者</span> : <span className="cover-grain" />}
      </div>
      <span className="affiliation-card-info">
        <strong>{collection.name}</strong>
        <small>{collection.items.length} 个选集</small>
      </span>
    </button>
  )
}
