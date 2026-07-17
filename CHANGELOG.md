# 更新日志

本项目从公开版本开始采用接近 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的格式，版本号遵循语义化版本。

## [0.6.27] - 2026-07-17

### 修复

- 改用独立的 Windows 命令引导器启动 PowerShell 升级器，修复部分系统中直接启动 PowerShell 后不执行脚本、导致握手超时的问题；升级日志会记录升级器启动尝试。

## [0.6.25] - 2026-07-17

### 改进

- 侧栏媒体库图标统一使用首页的灰白色导航样式，选中时仍使用应用强调色。

## [0.6.24] - 2026-07-17

### 新增

- 设置页新增应用网络代理开关、HTTP/SOCKS5 代理地址和 GitHub 连通性测试；启用后 GitHub 更新与全部在线刮削请求都使用该代理。

### 修复

- GitHub 更新下载显示实时字节进度，并在升级器就绪后立即退出、安装和重启，移除固定延时退出的竞态。

## [0.6.23] - 2026-07-17

### 新增

- 每个刮削来源的字段预览面板增加“填入全部”，一次写入该来源提供的全部有效字段。

### 修复

- 单项或全部写入刮削结果后保留原有日语搜索标题，不再切换为当前来源标题。

## [0.6.22] - 2026-07-17

### 改进

- 设置页的应用数据区域显示当前应用版本。

### 修复

- 本地升级器增加启动握手，避免主程序过早退出导致独立升级进程尚未就绪。
- 升级器初始化失败时保留主程序并显示具体错误，不再错误提示即将重启。

## [0.6.21] - 2026-07-17

### 新增

- GitHub 最新正式版检查、Release ZIP 下载、SHA-256 校验与自动安装。
- 受管理媒体库目录扫描，可将新增资源按所在媒体库自动加入导入计划。

### 修复

- 首次刮削并写入合集中文名时，网络刮削面板意外关闭的问题。

### 仓库

- 精简贡献与安全流程文档，README 留待项目说明重写。

## [0.6.20] - 2026-07-17

### 新增

- Windows 绿色版的本地 ZIP 升级、数据保留与失败回滚机制。
- 首页按媒体库随机展示合集。
- Matroska 内嵌字幕提取与播放器字幕选择。

### 改进

- 大型本子与漫画媒体库的虚拟化、缩略图缓存及滚动加载。
- 视频导入缩略图、媒体卡片布局和播放器交互。
- 刮削字段写入面板与多来源切换体验。

### 修复

- 数据备份导入后的失效记录、缺失封面与压缩包兼容问题。
- 媒体库目录内资源重新导入和缺失文件记录移除问题。

[0.6.20]: https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.20
[0.6.21]: https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.21
[0.6.22]: https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.22
[0.6.23]: https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.23
[0.6.24]: https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.24
[0.6.25]: https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.25
[0.6.27]: https://github.com/starfishpeter/StarMedia/releases/tag/v0.6.27
