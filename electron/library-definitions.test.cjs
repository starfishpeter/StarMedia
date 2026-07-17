const test = require('node:test')
const assert = require('node:assert/strict')
const {
  defaultLibraryFolderNames,
  isArchiveLibrary,
  isKnownLibrary,
  isPosterLibrary,
  isVideoLibrary,
  libraryIds,
} = require('./library-definitions.cjs')

test('library definitions partition every configured library', () => {
  assert.deepEqual(libraryIds, ['erAnime', 'anime', 'creator', 'books', 'comics', 'general'])
  assert.deepEqual(Object.keys(defaultLibraryFolderNames), libraryIds)

  for (const libraryId of libraryIds) {
    assert.equal(isKnownLibrary(libraryId), true)
    assert.notEqual(isArchiveLibrary(libraryId), isVideoLibrary(libraryId))
  }
})

test('library definitions reject unknown libraries', () => {
  assert.equal(isKnownLibrary('unknown'), false)
  assert.equal(isArchiveLibrary('unknown'), false)
  assert.equal(isVideoLibrary('unknown'), false)
  assert.equal(isPosterLibrary('unknown'), false)
  assert.equal(isPosterLibrary('erAnime'), true)
  assert.equal(isPosterLibrary('anime'), true)
  assert.equal(isPosterLibrary('general'), false)
})
