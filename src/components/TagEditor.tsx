import { X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

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
  const datalistId = `tag-suggestions-${useId().replaceAll(':', '')}`
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const suggestions = useMemo(
    () => availableTags.filter((tag) => !tags.includes(tag)).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [availableTags, tags],
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
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={tags.length === 0 ? '输入或选择标签' : '添加更多标签…'}
          maxLength={80}
          list={datalistId}
        />
        <datalist id={datalistId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
        <button type="submit" className="secondary-button tiny-button" disabled={saving || !value.trim() || tags.includes(value.trim())}>
          {saving ? '保存中…' : '添加'}
        </button>
      </form>
    </div>
  )
}
