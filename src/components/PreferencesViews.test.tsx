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
  scraping: { bangumiToken: '', bangumiEndpoint: 'https://api.bgm.tv', hanime1Endpoint: 'https://hanime1.com' },
  libraries: {
    erAnime: { rootPath: 'C:\\Media\\里番', enabled: true },
    anime: { rootPath: 'C:\\Media\\番剧', enabled: true },
    creator: { rootPath: 'C:\\Media\\原创', enabled: true },
    books: { rootPath: 'C:\\Media\\本子', enabled: true },
    comics: { rootPath: 'C:\\Media\\漫画', enabled: true },
    general: { rootPath: 'C:\\Media\\综合', enabled: true },
  },
  catalog: { tags: [], classifications: [], studios: [], creators: [] },
}

describe('SettingsView', () => {
  it('renders the default application settings tab with a complete configuration object', () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        config={config}
        configMeta={{ dataRoot: 'C:\\StarMediaData', configPath: '', backupDir: '', cacheDir: '' }}
        capabilities={{
          chooseDirectory: true,
          clearCaches: true,
          clearEmptyMediaDirectories: true,
          clearImportedRecords: true,
          exportAppData: true,
          importAppData: true,
          installLocalUpdate: true,
          regenerateThumbnails: true,
          verifyBangumiToken: true,
        }}
        onChange={() => {}}
        onPickMediaRoot={() => {}}
        onPickLibraryRoot={() => {}}
        onMediaRootChange={() => {}}
        onClearImportedRecords={() => {}}
        onClearEmptyMediaDirectories={() => {}}
        onExportAppData={() => {}}
        exportingAppData={false}
        onImportAppData={() => {}}
        onInstallLocalUpdate={() => {}}
        installingLocalUpdate={false}
        onRegenerateThumbnails={() => {}}
        onClearCaches={() => {}}
        onOpenBangumiTokenPage={() => {}}
        onVerifyBangumiToken={async () => ({ valid: true, expiresAt: null, userName: '' })}
      />,
    )

    expect(markup).toContain('应用皮肤')
    expect(markup).toContain('深夜模式')
    expect(markup).toContain('C:\\StarMediaData')
    expect(markup).toContain('选择本地升级包')
  })

  it('keeps application-data import enabled when unrelated maintenance APIs are unavailable', () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        config={config}
        configMeta={{ dataRoot: '', configPath: '', backupDir: '', cacheDir: '' }}
        capabilities={{
          chooseDirectory: false,
          clearCaches: false,
          clearEmptyMediaDirectories: false,
          clearImportedRecords: false,
          exportAppData: false,
          importAppData: true,
          installLocalUpdate: false,
          regenerateThumbnails: false,
          verifyBangumiToken: false,
        }}
        onChange={() => {}}
        onPickMediaRoot={() => {}}
        onPickLibraryRoot={() => {}}
        onMediaRootChange={() => {}}
        onClearImportedRecords={() => {}}
        onClearEmptyMediaDirectories={() => {}}
        onExportAppData={() => {}}
        exportingAppData={false}
        onImportAppData={() => {}}
        onInstallLocalUpdate={() => {}}
        installingLocalUpdate={false}
        onRegenerateThumbnails={() => {}}
        onClearCaches={() => {}}
        onOpenBangumiTokenPage={() => {}}
        onVerifyBangumiToken={async () => ({ valid: true, expiresAt: null, userName: '' })}
      />,
    )

    expect(markup).toMatch(/<button class="secondary-button">导入应用数据<\/button>/)
    expect(markup).toMatch(/<button class="primary-button" disabled="">导出应用数据<\/button>/)
  })
})
