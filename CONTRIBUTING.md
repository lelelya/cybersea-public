# 参与开发

使用 Node.js 24 或更高版本，在仓库根目录执行：

```bash
npm ci
npm run check
npm test
npm run release:check
```

修改前后端代码时，请用独立的空数据库或虚构数据验证。避免把真实角色、对话、API 密钥、服务器地址、截图或上传内容放进提交。

提交问题时附复现步骤、Node.js 版本和经过脱敏的错误信息。不要公开 API Key 或私人对话。

默认图标与合成环境音可用 `npm run assets:generate` 重建。深海背景保留作者提供的 AI 生成原图，该命令不会覆盖它。自备音乐和运行数据保持在 Git 忽略目录中。
