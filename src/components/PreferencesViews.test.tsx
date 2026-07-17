import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsView } from './PreferencesViews'

const config: StarMediaConfig = {
  schemaVersion: 3,
  updatedAt: '2026-07-17T12:00:00.000Z',
  mediaRoot: 'C:\\Media',
  theme: 'dark',
  cacheLimitMb: 4096,
  confirmBeforeClose: true,
  network: { proxyEnabled: false, proxyUrl: '' },
  scraping: { bangumiToken: '', bangumiEndpoint: 'https://api.bgm.tv', hanime1Endpoint: 'https://hanime1.com' },
  libraries: {
    erAnime: { rootPath: 'C:\\Media\\里番', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    anime: { rootPath: 'C:\\Media\\番剧', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    creator: { rootPath: 'C:\\Media\\原创', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    books: { rootPath: 'C:\\Media\\本子', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    comics: { rootPath: 'C:\\Media\\漫画', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
    general: { rootPath: 'C:\\Media\\综合', enabled: true, sortMode: 'title', sortDirection: 'ascending' },
  },
  catalog: { tags: [], classifications: [], studios: [], creators: [] },
}

describe('SettingsView', () => {
  it('renders the default application settings tab with a complete configuration object', () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        config={config}
        configMeta={{ dataRoot: 'C:\\StarMediaData', configPath: '', backupDir: '', cacheDir: '' }}
        appVersion="0.6.21"
        capabilities={{
          chooseDirectory: true,
          clearCaches: true,
          clearInvalidRecords: true,
          clearEmptyMediaDirectories: true,
          clearImportedRecords: true,
          exportAppData: true,
          importAppData: true,
          installLocalUpdate: true,
          githubUpdate: true,
          testNetworkProxy: true,
          regenerateThumbnails: true,
          verifyBangumiToken: true,
        }}
        onChange={() => {}}
        onPickMediaRoot={() => {}}
        onPickLibraryRoot={() => {}}
        onMediaRootChange={() => {}}
        onClearImportedRecords={() => {}}
        onClearEmptyMediaDirectories={() => {}}
        onClearInvalidRecords={() => {}}
        onExportAppData={() => {}}
        exportingAppData={false}
        onImportAppData={() => {}}
        onInstallLocalUpdate={() => {}}
        installingLocalUpdate={false}
        githubUpdate={null}
        githubUpdateProgress={null}
        checkingGitHubUpdate={false}
        onCheckGitHubUpdate={() => {}}
        onInstallGitHubUpdate={() => {}}
        onRegenerateThumbnails={() => {}}
        onClearCaches={() => {}}
        onOpenBangumiTokenPage={() => {}}
        onVerifyBangumiToken={async () => ({ valid: true, expiresAt: null, userName: '' })}
        onTestNetworkProxy={async () => ({ status: 200 })}
      />,
    )

    expect(markup).toContain('应用皮肤')
    expect(markup).toContain('深夜模式')
    expect(markup).toContain('C:\\StarMediaData')
    expect(markup).toContain('0.6.21')
    expect(markup).toContain('选择本地升级包')
    expect(markup).toContain('路径配置')
    expect(markup).toContain('网络代理')
  })

  it('keeps application-data import enabled when unrelated maintenance APIs are unavailable', () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        config={config}
        configMeta={{ dataRoot: '', configPath: '', backupDir: '', cacheDir: '' }}
        appVersion=""
        capabilities={{
          chooseDirectory: false,
          clearCaches: false,
          clearInvalidRecords: false,
          clearEmptyMediaDirectories: false,
          clearImportedRecords: false,
          exportAppData: false,
          importAppData: true,
          installLocalUpdate: false,
          githubUpdate: false,
          testNetworkProxy: false,
          regenerateThumbnails: false,
          verifyBangumiToken: false,
        }}
        onChange={() => {}}
        onPickMediaRoot={() => {}}
        onPickLibraryRoot={() => {}}
        onMediaRootChange={() => {}}
        onClearImportedRecords={() => {}}
        onClearEmptyMediaDirectories={() => {}}
        onClearInvalidRecords={() => {}}
        onExportAppData={() => {}}
        exportingAppData={false}
        onImportAppData={() => {}}
        onInstallLocalUpdate={() => {}}
        installingLocalUpdate={false}
        githubUpdate={null}
        githubUpdateProgress={null}
        checkingGitHubUpdate={false}
        onCheckGitHubUpdate={() => {}}
        onInstallGitHubUpdate={() => {}}
        onRegenerateThumbnails={() => {}}
        onClearCaches={() => {}}
        onOpenBangumiTokenPage={() => {}}
        onVerifyBangumiToken={async () => ({ valid: true, expiresAt: null, userName: '' })}
        onTestNetworkProxy={async () => ({ status: 200 })}
      />,
    )

    expect(markup).toMatch(/<button class="secondary-button">导入应用数据<\/button>/)
    expect(markup).toMatch(/<button class="primary-button" disabled="">导出应用数据<\/button>/)
  })
})
