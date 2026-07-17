# StarMedia

StarMedia 是一款面向 Windows 的本地优先媒体库，用一个桌面应用整理视频、番剧、本子和漫画。媒体文件与资料默认保存在用户选择的本地目录，不依赖在线账户才能使用。

> 项目仍处于早期开发阶段。升级前请备份 `StarMediaData`，并优先使用 GitHub Releases 中发布的版本。

## 主要功能

- 六类媒体库：里番、番剧、原创、本子、漫画与综合
- 视频合集与书架浏览、搜索、筛选、排序和标签管理
- 导入视频及 ZIP/7Z 书籍，自动生成视频与书籍封面缩略图
- 应用内视频播放、外挂字幕与 Matroska 内嵌字幕支持
- ZIP/7Z 本子和漫画阅读
- Bangumi、FreeAnimeHentai、Hanime1 元数据刮削
- 可迁移的 `StarMediaData` 数据目录、备份导入导出与本地 ZIP 升级
- 针对大型媒体库的虚拟化列表和缩略图缓存

## 下载与使用

稳定测试包会发布在 [GitHub Releases](https://github.com/starfishpeter/StarMedia/releases)。下载 Windows ZIP 后解压，并运行 `StarMedia.exe`。

应用数据位于程序目录旁的 `StarMediaData`。升级时可以在“应用设置 → 本地升级”中选择新版 ZIP；升级程序会保留数据目录，并在启动失败时尝试回滚。无论采用哪种升级方式，重要数据都建议另行备份。

应用内能否直接播放某个视频，取决于 Electron/Chromium 对容器、视频编码和音频编码的共同支持；文件扩展名本身不能保证兼容。无法播放的文件仍可交给系统外部播放器。

## 从源码运行

环境要求：Windows 10/11、Node.js 22 或更高版本、npm。

```powershell
git clone https://github.com/starfishpeter/StarMedia.git
cd StarMedia
npm ci
npm run dev
```

常用命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build:web
npm run package:win
```

`npm run package:win` 会先执行完整检查，再在 `release/` 中生成 Windows 绿色版 ZIP。构建产物与 `StarMediaData` 不应提交到 Git。

## 隐私与联网

媒体索引、封面缓存、应用配置和访问令牌保存在本地 `StarMediaData` 中，该目录已被 Git 忽略。网络刮削、令牌验证和打开外部网页等功能会访问相应的第三方服务。提交 Issue 时请勿上传 `StarMediaData`，并请遮盖本地路径、令牌以及私人媒体信息。

## 参与项目

欢迎提交 Issue 和 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 中的方式报告。

## 许可证

本项目采用 [MIT License](LICENSE)。
