# 参与 StarMedia

感谢你愿意帮助改进 StarMedia。Bug、功能建议、文档修正和代码贡献都欢迎。

## 提交 Issue

- 先搜索现有 Issue，避免重复。
- 描述操作步骤、预期结果、实际结果、StarMedia 版本和 Windows 版本。
- 如能稳定复现，请提供最小复现样例或日志片段。
- 不要上传 `StarMediaData`、私人媒体、访问令牌或包含隐私的完整路径；截图和日志请先脱敏。

## 本地开发

```powershell
npm ci
npm run dev
```

提交代码前请运行：

```powershell
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build:web
```

涉及 Windows 绿色版或升级流程时，再运行 `npm run package:win`。

## Pull Request

- 一个 PR 尽量只解决一个明确问题。
- 说明行为变化、验证方式以及可能的兼容性影响。
- 修复缺陷或新增逻辑时补充相应测试。
- 不要提交 `node_modules`、`dist`、`release`、`StarMediaData` 或其他本地生成内容。
- UI 变化请附脱敏截图；不要使用包含私人媒体内容的截图。

维护者可能会要求调整设计或补充测试。合并即表示你同意按项目的 MIT 许可证提供该贡献。
