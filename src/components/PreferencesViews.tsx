import {
  Database,
  FolderOpen,
  HardDrive,
  LibraryBig,
  Network,
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
  clearInvalidRecords: boolean
  clearEmptyMediaDirectories: boolean
  clearImportedRecords: boolean
  exportAppData: boolean
  importAppData: boolean
  installLocalUpdate: boolean
  githubUpdate: boolean
  testNetworkProxy: boolean
  regenerateThumbnails: boolean
  verifyBangumiToken: boolean
}

function formatConfigTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '尚未保存' : configDateLabel.format(date)
}

function normalizeProxyInput(value: string) {
  return value.replace(/^\s*(?:https?:\/\/)+/i, 'http://')
}

export function SettingsView({
  config,
  configMeta,
  appVersion,
  capabilities,
  onChange,
  onPickMediaRoot,
  onPickLibraryRoot,
  onMediaRootChange,
  onClearImportedRecords,
  onClearEmptyMediaDirectories,
  onClearInvalidRecords,
  onExportAppData,
  exportingAppData,
  onImportAppData,
  onInstallLocalUpdate,
  installingLocalUpdate,
  githubUpdate,
  githubUpdateProgress,
  checkingGitHubUpdate,
  onCheckGitHubUpdate,
  onInstallGitHubUpdate,
  onRegenerateThumbnails,
  onClearCaches,
  onOpenBangumiTokenPage,
  onVerifyBangumiToken,
  onTestNetworkProxy,
}: {
  config: StarMediaConfig
  configMeta: { dataRoot: string; configPath: string; backupDir: string; cacheDir: string }
  appVersion: string
  capabilities: SettingsCapabilities
  onChange: (config: StarMediaConfig) => void
  onPickMediaRoot: () => void
  onPickLibraryRoot: (id: LibraryId) => void
  onMediaRootChange: (mediaRoot: string) => void
  onClearImportedRecords: () => void
  onClearEmptyMediaDirectories: () => void
  onClearInvalidRecords: () => void
  onExportAppData: () => void
  exportingAppData: boolean
  onImportAppData: () => void
  onInstallLocalUpdate: () => void
  installingLocalUpdate: boolean
  githubUpdate: StarMediaGitHubUpdateResult | null
  githubUpdateProgress: StarMediaGitHubUpdateProgress | null
  checkingGitHubUpdate: boolean
  onCheckGitHubUpdate: () => void
  onInstallGitHubUpdate: () => void
  onRegenerateThumbnails: () => void
  onClearCaches: () => void
  onOpenBangumiTokenPage: () => void
  onVerifyBangumiToken: () => Promise<{ valid: boolean; expiresAt: string | null; userName: string }>
  onTestNetworkProxy: (config: StarMediaConfig) => Promise<{ status: number }>
}) {
  const [tab, setTab] = useState<'app' | 'paths' | 'network' | 'scraping'>('app')
  const [tokenStatus, setTokenStatus] = useState('')
  const [verifyingToken, setVerifyingToken] = useState(false)
  const [proxyStatus, setProxyStatus] = useState('')
  const [testingProxy, setTestingProxy] = useState(false)

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

  async function testNetworkProxy() {
    setTestingProxy(true)
    setProxyStatus('')
    try {
      const result = await onTestNetworkProxy(config)
      setProxyStatus(`代理已连接 GitHub（HTTP ${result.status}）。`)
    } catch (error) {
      setProxyStatus(error instanceof Error ? error.message : '代理连接测试失败')
    } finally {
      setTestingProxy(false)
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
            <span>路径配置</span>
          </button>
          <button className={tab === 'network' ? 'active' : ''} onClick={() => setTab('network')}>
            <Network size={16} />
            <span>网络代理</span>
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
                      <dt>当前版本</dt>
                      <dd>{appVersion || '开发版本'}</dd>
                    </div>
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
                    <h2>应用升级</h2>
                    <p>从 GitHub 获取正式版，或选择已下载的本地 ZIP。</p>
                  </div>
                </div>
                <div className="application-setting-control local-update-control">
                  <div className="data-management-actions">
                    <button
                      className="primary-button"
                      onClick={githubUpdate?.updateAvailable ? onInstallGitHubUpdate : onCheckGitHubUpdate}
                      disabled={!capabilities.githubUpdate || checkingGitHubUpdate || installingLocalUpdate}
                    >
                      {checkingGitHubUpdate
                        ? '正在检查更新…'
                        : installingLocalUpdate
                          ? githubUpdateProgress?.stage === 'downloading'
                            ? `正在下载 ${Math.floor((githubUpdateProgress.downloadedBytes / githubUpdateProgress.totalBytes) * 100)}%…`
                            : githubUpdateProgress?.stage === 'restarting'
                              ? '正在重启…'
                              : '正在校验并准备升级…'
                          : githubUpdate?.updateAvailable
                            ? `下载并安装 ${githubUpdate.latestVersion}`
                            : '检查 GitHub 更新'}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={onInstallLocalUpdate}
                      disabled={!capabilities.installLocalUpdate || installingLocalUpdate || checkingGitHubUpdate}
                    >
                      选择本地升级包
                    </button>
                  </div>
                  {githubUpdateProgress && (
                    <div
                      className="update-progress"
                      role="progressbar"
                      aria-label="GitHub 更新下载进度"
                      aria-valuemin={0}
                      aria-valuemax={githubUpdateProgress.totalBytes}
                      aria-valuenow={githubUpdateProgress.downloadedBytes}
                    >
                      <div>
                        <strong>
                          {githubUpdateProgress.stage === 'downloading'
                            ? '正在下载更新包'
                            : githubUpdateProgress.stage === 'preparing'
                              ? '正在校验并准备安装'
                              : '正在退出并重启应用'}
                        </strong>
                        <span>{Math.floor((githubUpdateProgress.downloadedBytes / githubUpdateProgress.totalBytes) * 100)}%</span>
                      </div>
                      <i>
                        <b
                          style={{
                            width: `${Math.floor((githubUpdateProgress.downloadedBytes / githubUpdateProgress.totalBytes) * 100)}%`,
                          }}
                        />
                      </i>
                    </div>
                  )}
                  <small>
                    {githubUpdate && !githubUpdate.updateAvailable
                      ? `当前版本 ${githubUpdate.currentVersion} 已是最新正式版。`
                      : '下载后会校验 GitHub 提供的 SHA-256，并再次验证 ZIP 结构；StarMediaData 不会被覆盖。'}
                  </small>
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
                  <button className="secondary-button" onClick={onClearInvalidRecords} disabled={!capabilities.clearInvalidRecords}>
                    清理失效记录
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

          {tab === 'network' && (
            <article className="settings-card network-proxy-card">
              <div className="card-title">
                <Network size={18} />
                <div>
                  <h2>应用网络代理</h2>
                  <p>启用后，GitHub 更新和全部在线刮削都通过此代理；关闭后始终直连。</p>
                </div>
              </div>
              <div className="network-proxy-controls">
                <label className="toggle-pill">
                  <input
                    type="checkbox"
                    checked={config.network.proxyEnabled}
                    onChange={(event) => onChange({ ...config, network: { ...config.network, proxyEnabled: event.target.checked } })}
                  />
                  启用应用代理
                </label>
                <label className="settings-field">
                  <span>代理地址</span>
                  <input
                    name="starmedia-network-proxy"
                    value={config.network.proxyUrl}
                    onChange={(event) =>
                      onChange({ ...config, network: { ...config.network, proxyUrl: normalizeProxyInput(event.target.value) } })
                    }
                    placeholder="http://127.0.0.1:8390"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <div className="bangumi-token-help">
                  <button
                    className="secondary-button"
                    onClick={() => void testNetworkProxy()}
                    disabled={!capabilities.testNetworkProxy || !config.network.proxyEnabled || testingProxy}
                  >
                    {testingProxy ? '测试中…' : '测试 GitHub 连接'}
                  </button>
                </div>
                <small className="network-proxy-help">
                  FlClash 混合端口推荐填入 http://127.0.0.1:8390，也支持 socks5:// 地址；Bangumi 始终直连。
                </small>
                {proxyStatus && <p className="proxy-status">{proxyStatus}</p>}
              </div>
            </article>
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

export function VocabularyView({ config, onChange }: { config: StarMediaConfig; onChange: (config: StarMediaConfig) => void }) {
  return (
    <section className="utility-page vocabulary-page">
      <StringListManager
        title="标签管理"
        description=""
        items={config.catalog.tags}
        inputLabel="新增标签"
        onAdd={(value) => onChange({ ...config, catalog: { ...config.catalog, tags: [...config.catalog.tags, value] } })}
        onRemove={(value) =>
          onChange({ ...config, catalog: { ...config.catalog, tags: config.catalog.tags.filter((item) => item !== value) } })
        }
      />
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
