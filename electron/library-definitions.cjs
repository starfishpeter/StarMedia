const libraryIds = Object.freeze(['erAnime', 'anime', 'creator', 'books', 'comics', 'general'])

const defaultLibraryFolderNames = Object.freeze({
  erAnime: '里番',
  anime: '番剧',
  creator: '原创',
  books: '本子',
  comics: '漫画',
  general: '综合',
})

const archiveLibraryIds = new Set(['books', 'comics'])
const videoLibraryIds = new Set(libraryIds.filter((id) => !archiveLibraryIds.has(id)))
const posterLibraryIds = new Set(['erAnime', 'anime'])

function isArchiveLibrary(libraryId) {
  return archiveLibraryIds.has(libraryId)
}

function isVideoLibrary(libraryId) {
  return videoLibraryIds.has(libraryId)
}

function isKnownLibrary(libraryId) {
  return isArchiveLibrary(libraryId) || isVideoLibrary(libraryId)
}

function isPosterLibrary(libraryId) {
  return posterLibraryIds.has(libraryId)
}

module.exports = {
  defaultLibraryFolderNames,
  isArchiveLibrary,
  isKnownLibrary,
  isPosterLibrary,
  isVideoLibrary,
  libraryIds,
}
