export function createAllScrapeFields(preview: StarMediaScrapePreview, draft: Required<StarMediaScrapeFields>): StarMediaScrapeFields {
  const fields: StarMediaScrapeFields = {}
  if (preview.coverUrl && draft.cover) fields.cover = true
  for (const field of ['affiliation', 'originalTitle', 'studio', 'firstAiredAt', 'note'] as const) {
    if (draft[field].trim()) fields[field] = draft[field]
  }
  return fields
}
