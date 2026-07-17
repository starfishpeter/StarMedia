import {
  Database,
  FolderOpen,
  HardDrive,
  LibraryBig,
  PackageOpen,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { libraries, type LibraryId } from '../data'
import { DropdownSelect } from './DropdownSelect'

const configDateLabel = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
export type SettingsCapabilities = {
  chooseDirectory: boolean
  clearCaches: boolean
  clearEmptyMediaDirectories: boolean
  clearImportedRecords: boolean
  exportAppData: boolean
  importAppData: boolean
  installLocalUpdate: boolean
  regenerateThumbnails: boolean
  verifyBangumiToken: boolean
}

function formatConfigTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '尚未保存' : configDateLabel.format(date)
}

export function SettingsView({
  config,
  configMeta,
  capabilities,
  onChange,
  onPickMediaRoot,
  onPickLibraryRoot,
  onMediaRootChange,
  onClearImportedRecords,
  onClearEmptyMediaDirectories,
  onExportAppData,
  exportingAppData,
  onImportAppData,
  onInstallLocalUpdate,
  installingLocalUpdate,
  onRegenerateThumbnails,
  onClearCaches,
  onOpenBangumiTokenPage,
  onVerifyBangumiToken,
}: {
  config: StarMediaConfig
  configMeta: { dataRoot: string; configPath: string; backupDir: string; cacheDir: string }
  capabilities: SettingsCapabilities
  onChange: (config: StarMediaConfig) => void
  onPickMediaRoot: () => void
  onPickLibraryRoot: (id: LibraryId) => void
  onMediaRootChange: (mediaRoot: string) => void
  onClearImportedRecords: () => void
  onClearEmptyMediaDirectories: () => void
  onExportAppData: () => void
  exportingAppData: boolean
  onImportAppData: () => void
  onInstallLocalUpdate: () => void
  installingLocalUpdate: boolean
  onRegenerateThumbnails: () => void
  onClearCaches: () => void
  onOpenBangumiTokenPage: () => void
  onVerifyBangumiToken: () => Promise<{ valid: boolean; expiresAt: string | null; userName: string }>
}) {
  const [tab, setTab] = useState<'app' | 'paths' | 'scraping'>('app')
  const [tokenStatus, setTokenStatus] = useState('')
  const [verifyingToken, setVerifyingToken] = useState(false)

  function updateLibraryRoot(id: LibraryId, rootPath: string) {
    onChange({ ...config, libraries: { ...config.libraries, [id]: { ...config.libraries[id], rootPath } } })
  }

  function updateLibraryEnabled(id: LibraryId, enabled: boolean) {
    onChange({ ...config, libraries: { ...config.libraries, [id]: { ...config.libraries[id], enabled } } })
  }

  async function verifyToken() {
    setVerifyingToken(true)
    setTokenStatus('')
    try {
      const result = await onVerifyBangumiToken()
      const expiry = result.expiresAt ? `，有效期至 ${new Date(result.expiresAt).toLocaleString('zh-CN')}` : '，服务未提供可解析的有效期'
      setTokenStatus(`令牌有效${result.userName ? `：${result.userName}` : ''}${expiry}`)
    } catch (error) {
      setTokenStatus(error instanceof Error ? error.message : '令牌验证失败')
    } finally {
      setVerifyingToken(false)
    }
  }

  return (
    <section className="utility-page settings-page">
      <div className="settings-layout">
        <aside className="settings-side-nav" role="tablist" aria-label="应用设置">
          <button className={tab === 'app' ? 'active' : ''} onClick={() => setTab('app')}>
            <Settings size={16} />
            <span>应用配置</span>
          </button>
          <button className={tab === 'paths' ? 'active' : ''} onClick={() => setTab('paths')}>
            <HardDrive size={16} />
            <span>本地资源路径</span>
          </button>
          <button className={tab === 'scraping' ? 'active' : ''} onClick={() => setTab('scraping')}>
            <Search size={16} />
            <span>刮削配置</span>
          </button>
        </aside>
        <div className="settings-content">
          {tab === 'app' && (
            <article className="settings-card application-settings-card">
              <section className="application-settings-section">
                <div className="card-title">
                  <Settings size={18} />
                  <div>
                    <h2>应用皮肤</h2>
                  </div>
                </div>
                <div className="application-setting-control">
                  <DropdownSelect
                    value={config.theme}
                    onChange={(theme) => onChange({ ...config, theme: theme as StarMediaConfig['theme'] })}
                    options={[
                      { value: 'light', label: '日间模式' },
                      { value: 'dark', label: '深夜模式' },
                      { value: 'blue', label: '深海模式' },
                    ]}
                  />
                </div>
              </section>
              <section className="application-settings-section">
                <div className="card-title">
                  <X size={18} />
                  <div>
                    <h2>关闭行为</h2>
                  </div>
                </div>
                <div className="application-setting-control application-close-controls">
                  <label className="toggle-pill window-confirm-toggle">
                    <input
                      type="checkbox"
                      checked={config.confirmBeforeClose}
                      onChange={(event) => onChange({ ...config, confirmBeforeClose: event.target.checked })}
                    />
                    关闭前确认
                  </label>
                </div>
              </section>
              <section className="application-settings-section">
                <div className="card-title">
                  <Database size={18} />
                  <div>
                    <h2>应用数据</h2>
                  </div>
                </div>
                <div className="application-setting-control">
                  <dl className="config-meta compact-config-meta">
                    <div>
                      <dt>应用数据目录</dt>
                      <dd>{configMeta.dataRoot || '程序目录下的 StarMediaData'}</dd>
                    </div>
                    <div>
                      <dt>更新时间</dt>
                      <dd>{formatConfigTime(config.updatedAt)}</dd>
                    </div>
                  </dl>
                </div>
              </section>
              <section className="application-settings-section application-cache-section">
                <div className="card-title">
                  <HardDrive size={18} />
                  <div>
                    <h2>本地缓存</h2>
                    <p>阅读页与缩略图缓存。</p>
                  </div>
                </div>
                <div className="application-setting-control">
                  <label className="cache-limit-field">
                    <span>缓存上限</span>
                    <strong>{config.cacheLimitMb} MB</strong>
                    <input
                      type="range"
                      min="128"
                      max="8192"
                      step="128"
                      value={Math.min(config.cacheLimitMb, 8192)}
                      onChange={(event) => onChange({ ...config, cacheLimitMb: Number(event.target.value) || 128 })}
                    />
                    <small>
                      <i>128 MB</i>
                      <i>8192 MB</i>
                      <b>超过上限后自动清理较早缓存。</b>
                    </small>
                  </label>
                </div>
              </section>
              <section className="application-settings-section application-update-section">
                <div className="card-title">
                  <PackageOpen size={18} />
                  <div>
                    <h2>本地升级</h2>
                    <p>选择新版 StarMedia ZIP，保留应用数据并自动重启。</p>
                  </div>
                </div>
                <div className="application-setting-control local-update-control">
                  <button
                    className="primary-button"
                    onClick={onInstallLocalUpdate}
                    disabled={!capabilities.installLocalUpdate || installingLocalUpdate}
                  >
                    {installingLocalUpdate ? '正在校验升级包…' : '选择本地升级包'}
                  </button>
                  <small>只接受 StarMedia 官方绿色版 ZIP；升级过程中不会覆盖 StarMediaData。</small>
                </div>
              </section>
              <section className="application-settings-section application-data-actions">
                <div className="card-title">
                  <Database size={18} />
                  <div>
                    <h2>数据维护</h2>
                    <p>这些操作不会移动或删除应用外的实际媒体文件。</p>
                  </div>
                </div>
                <div className="application-setting-control">
                  <div className="data-management-actions">
                    <button className="primary-button" onClick={onExportAppData} disabled={!capabilities.exportAppData || exportingAppData}>
                      {exportingAppData ? '正在导出…' : '导出应用数据'}
                    </button>
                    <button className="secondary-button" onClick={onImportAppData} disabled={!capabilities.importAppData}>
                      导入应用数据
                    </button>
                    <button className="secondary-button" onClick={onRegenerateThumbnails} disabled={!capabilities.regenerateThumbnails}>
                      清理并重新生成缩略图
                    </button>
                    <button className="danger-button" onClick={onClearCaches} disabled={!capabilities.clearCaches}>
                      清空所有缓存
                    </button>
                    <button className="danger-button" onClick={onClearImportedRecords} disabled={!capabilities.clearImportedRecords}>
                      清空导入记录
                    </button>
                  </div>
                </div>
              </section>
            </article>
          )}

          {tab === 'paths' && (
            <>
              <article className="settings-card wide-card">
                <div className="card-title">
                  <HardDrive size={18} />
                  <div>
                    <h2>媒体数据总目录</h2>
                  </div>
                </div>
                <div className="path-row">
                  <input value={config.mediaRoot} onChange={(event) => onMediaRootChange(event.target.value)} placeholder="尚未设置" />
                  <button className="secondary-button" onClick={onPickMediaRoot} disabled={!capabilities.chooseDirectory}>
                    <FolderOpen size={16} />
                    选择
                  </button>
                </div>
                <div className="path-maintenance-row">
                  <button
                    className="secondary-button"
                    onClick={onClearEmptyMediaDirectories}
                    disabled={!capabilities.clearEmptyMediaDirectories || !config.mediaRoot.trim()}
                  >
                    清理其他空文件夹
                  </button>
                </div>
              </article>
              <article className="settings-card library-roots-card">
                <div className="card-title">
                  <LibraryBig size={18} />
                  <div>
                    <h2>媒体库路径</h2>
                  </div>
                </div>
                <div className="library-root-list">
                  {libraries.map((library) => {
                    const Icon = library.icon
                    const root = config.libraries[library.id]
                    return (
                      <div className="library-root-item" key={library.id}>
                        <span className="library-root-icon" style={{ color: library.color, backgroundColor: `${library.color}18` }}>
                          <Icon size={19} />
                        </span>
                        <div className="library-root-copy">
                          <strong>{library.label}</strong>
                        </div>
                        <input
                          value={root.rootPath}
                          onChange={(event) => updateLibraryRoot(library.id, event.target.value)}
                          placeholder="尚未设置"
                        />
                        <button
                          className="secondary-button small-button"
                          onClick={() => onPickLibraryRoot(library.id)}
                          disabled={!capabilities.chooseDirectory}
                        >
                          选择
                        </button>
                        <label className="toggle-pill">
                          <input
                            type="checkbox"
                            checked={root.enabled}
                            onChange={(event) => updateLibraryEnabled(library.id, event.target.checked)}
                          />
                          启用
                        </label>
                      </div>
                    )
                  })}
                </div>
              </article>
            </>
          )}

          {tab === 'scraping' && (
            <article className="settings-card scraping-card">
              <div className="card-title">
                <Search size={18} />
                <div>
                  <h2>Bangumi</h2>
                </div>
              </div>
              <label className="settings-field">
                <span>访问令牌（可留空）</span>
                <input
                  type="password"
                  value={config.scraping.bangumiToken}
                  onChange={(event) => onChange({ ...config, scraping: { ...config.scraping, bangumiToken: event.target.value } })}
                  placeholder="生成后粘贴到这里"
                />
              </label>
              <div className="bangumi-token-help">
                <button className="secondary-button" onClick={onOpenBangumiTokenPage} disabled={!capabilities.verifyBangumiToken}>
                  登录并生成令牌
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void verifyToken()}
                  disabled={!capabilities.verifyBangumiToken || verifyingToken || !config.scraping.bangumiToken.trim()}
                >
                  {verifyingToken ? '验证中…' : '验证令牌'}
                </button>
              </div>
              {tokenStatus && <p className="token-status">{tokenStatus}</p>}
            </article>
          )}
        </div>
      </div>
    </section>
  )
}

type ManagementTab = 'tags' | 'classifications' | 'libraries' | 'studios' | 'creators'

export function VocabularyView({ config, onChange }: { config: StarMediaConfig; onChange: (config: StarMediaConfig) => void }) {
  const [tab, setTab] = useState<ManagementTab>('tags')
  const tabs: Array<{ id: ManagementTab; label: string }> = [
    { id: 'tags', label: '标签管理' },
    { id: 'classifications', label: '分类管理' },
    { id: 'libraries', label: '媒体库管理' },
    { id: 'studios', label: '制作公司管理' },
    { id: 'creators', label: '创作者管理' },
  ]

  function updateCatalog(changes: Partial<StarMediaCatalog>) {
    onChange({ ...config, catalog: { ...config.catalog, ...changes } })
  }

  function deleteTag(tag: string) {
    updateCatalog({
      tags: config.catalog.tags.filter((value) => value !== tag),
      classifications: config.catalog.classifications.map((classification) => ({
        ...classification,
        tags: classification.tags.filter((value) => value !== tag),
      })),
    })
  }

  return (
    <section className="utility-page vocabulary-page">
      <div className="management-tabs" role="tablist" aria-label="分类标签管理">
        {tabs.map((entry) => (
          <button key={entry.id} className={tab === entry.id ? 'active' : ''} onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
      {tab === 'tags' && (
        <StringListManager
          title="标签管理"
          description=""
          items={config.catalog.tags}
          inputLabel="新增标签"
          onAdd={(value) => updateCatalog({ tags: [...config.catalog.tags, value] })}
          onRemove={deleteTag}
        />
      )}
      {tab === 'classifications' && (
        <ClassificationManager config={config} onChange={(classifications) => updateCatalog({ classifications })} />
      )}
      {tab === 'libraries' && (
        <LibraryClassificationManager config={config} onChange={(classifications) => updateCatalog({ classifications })} />
      )}
      {tab === 'studios' && (
        <StringListManager
          title="制作公司管理"
          description="用于番剧和里番的信息填写与输入提示。"
          items={config.catalog.studios}
          inputLabel="新增制作公司"
          onAdd={(value) => updateCatalog({ studios: [...config.catalog.studios, value] })}
          onRemove={(value) => updateCatalog({ studios: config.catalog.studios.filter((item) => item !== value) })}
        />
      )}
      {tab === 'creators' && (
        <StringListManager
          title="创作者管理"
          description="用于原创、本子和漫画的信息填写与输入提示。"
          items={config.catalog.creators}
          inputLabel="新增创作者"
          onAdd={(value) => updateCatalog({ creators: [...config.catalog.creators, value] })}
          onRemove={(value) => updateCatalog({ creators: config.catalog.creators.filter((item) => item !== value) })}
        />
      )}
    </section>
  )
}

function StringListManager({
  title,
  description,
  items,
  inputLabel,
  onAdd,
  onRemove,
}: {
  title: string
  description: string
  items: string[]
  inputLabel: string
  onAdd: (value: string) => void
  onRemove: (value: string) => void
}) {
  const [draft, setDraft] = useState('')

  function addItem() {
    const value = draft.trim()
    if (!value || items.includes(value)) return
    onAdd(value)
    setDraft('')
  }

  return (
    <article className="settings-card vocabulary-card">
      <div className="card-title">
        <SlidersHorizontal size={18} />
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      {items.length > 0 && (
        <div className="chip-list">
          {items.map((item) => (
            <span className="vocab-chip" key={item}>
              {item}
              <button onClick={() => onRemove(item)} aria-label={`删除 ${item}`}>
                <Trash2 size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="vocab-add-row">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addItem()
          }}
          placeholder={inputLabel}
        />
        <button className="secondary-button" onClick={addItem}>
          <Plus size={16} />
          新增
        </button>
      </div>
    </article>
  )
}

function ClassificationManager({
  config,
  onChange,
}: {
  config: StarMediaConfig
  onChange: (classifications: StarMediaClassification[]) => void
}) {
  const [name, setName] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  function createClassification() {
    const normalizedName = name.trim()
    if (!normalizedName || selectedTags.length === 0 || config.catalog.classifications.some((item) => item.name === normalizedName)) return
    onChange([
      ...config.catalog.classifications,
      {
        id: `classification-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: normalizedName,
        tags: selectedTags,
        libraryIds: [],
      },
    ])
    setName('')
    setSelectedTags([])
  }

  return (
    <article className="settings-card vocabulary-card">
      <div className="card-title">
        <SlidersHorizontal size={18} />
        <div>
          <h2>分类管理</h2>
          <p>分类由一个或多个标签组成；只有同时拥有全部标签的合集或书架才会归入该分类。</p>
        </div>
      </div>
      <div className="classification-create">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入分类名" />
        <div className="chip-list selectable-chips">
          {config.catalog.tags.length > 0 ? (
            config.catalog.tags.map((tag) => (
              <button
                key={tag}
                className={selectedTags.includes(tag) ? 'selected' : ''}
                onClick={() =>
                  setSelectedTags((current) => (current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]))
                }
              >
                {tag}
              </button>
            ))
          ) : (
            <span className="muted-copy">请先在标签管理中创建标签。</span>
          )}
        </div>
        <button className="secondary-button" onClick={createClassification} disabled={!name.trim() || selectedTags.length === 0}>
          <Plus size={16} />
          创建分类
        </button>
      </div>
      <div className="classification-list">
        {config.catalog.classifications.length === 0 && <p className="muted-copy">尚未创建分类。</p>}
        {config.catalog.classifications.map((classification) => (
          <div key={classification.id}>
            <strong>{classification.name}</strong>
            <span>{classification.tags.join(' + ') || '未设置标签'}</span>
            <button
              className="text-button"
              onClick={() => onChange(config.catalog.classifications.filter((item) => item.id !== classification.id))}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </article>
  )
}

function LibraryClassificationManager({
  config,
  onChange,
}: {
  config: StarMediaConfig
  onChange: (classifications: StarMediaClassification[]) => void
}) {
  function toggleAssignment(classificationId: string, libraryId: LibraryId) {
    onChange(
      config.catalog.classifications.map((classification) =>
        classification.id === classificationId
          ? {
              ...classification,
              libraryIds: classification.libraryIds.includes(libraryId)
                ? classification.libraryIds.filter((id) => id !== libraryId)
                : [...classification.libraryIds, libraryId],
            }
          : classification,
      ),
    )
  }

  return (
    <article className="settings-card vocabulary-card">
      <div className="card-title">
        <LibraryBig size={18} />
        <div>
          <h2>媒体库管理</h2>
          <p>将已有分类分配到媒体库后，才会在对应媒体库的筛选器中显示。</p>
        </div>
      </div>
      <div className="library-classification-grid">
        {libraries.map((library) => (
          <div key={library.id}>
            <strong>{library.label}</strong>
            {config.catalog.classifications.length === 0 ? (
              <span>尚无可分配分类</span>
            ) : (
              config.catalog.classifications.map((classification) => (
                <label key={classification.id}>
                  <input
                    type="checkbox"
                    checked={classification.libraryIds.includes(library.id)}
                    onChange={() => toggleAssignment(classification.id, library.id)}
                  />
                  {classification.name}
                </label>
              ))
            )}
          </div>
        ))}
      </div>
    </article>
  )
}
