import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

export function TagEditor({
  tags,
  availableTags,
  label = '标签',
  className = '',
  onChange,
  onAddTag,
}: {
  tags: string[]
  availableTags: string[]
  label?: string
  className?: string
  onChange: (tags: string[]) => void
  onAddTag?: (tag: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const normalizedQuery = value.trim().toLocaleLowerCase()
  const suggestions = useMemo(
    () =>
      availableTags
        .filter((tag) => !tags.includes(tag) && normalizedQuery && tag.toLocaleLowerCase().includes(normalizedQuery))
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .slice(0, 8),
    [availableTags, normalizedQuery, tags],
  )

  async function addTag() {
    const tag = value.trim()
    if (!tag || tags.includes(tag)) {
      setValue('')
      return
    }
    setSaving(true)
    try {
      if (onAddTag) await onAddTag(tag)
      else onChange([...tags, tag])
      setValue('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`tag-editor ${className}`.trim()}>
      <span className="tag-editor-label">{label}</span>
      {tags.length > 0 && (
        <div className="tag-editor-chips">
          {tags.map((tag) => (
            <span className="tag-editor-chip" key={tag}>
              {tag}
              <button type="button" onClick={() => onChange(tags.filter((current) => current !== tag))} title={`删除标签「${tag}」`}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="tag-editor-add"
        onSubmit={(event) => {
          event.preventDefault()
          void addTag().catch(() => {})
        }}
      >
        <div className="tag-editor-input-wrap">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={tags.length === 0 ? '输入标签' : '添加更多标签…'}
            maxLength={80}
            aria-autocomplete="list"
            aria-expanded={focused && suggestions.length > 0}
          />
          {focused && suggestions.length > 0 && (
            <div className="tag-editor-suggestions" role="listbox" aria-label="标签建议">
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  role="option"
                  key={suggestion}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setValue(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="submit" className="secondary-button tiny-button" disabled={saving || !value.trim() || tags.includes(value.trim())}>
          {saving ? '保存中…' : '添加'}
        </button>
      </form>
    </div>
  )
}
