# Release Checklist

每次版本更新必须在同一个版本变更中同步更新所有受影响内容，不能只更新代码或版本号。

## 必须同步的内容

- `package.json`、`package-lock.json` 和软件界面版本号
- `README.md`、`README.en.md`
- 软件内中文和 English 使用说明：`public/index.html`、`public/app.js`
- `release-notes/v<version>.md`
- `release-info.js`、发布记录和更新入口
- `CONTRIBUTING.md`、`SECURITY.md` 中受影响的操作、恢复和安全说明
- 对应回归测试、文档同步检查和安装包内容
- 日志路径、时间字段、脱敏规则和用户查看/复制入口

## 发布门禁

1. 运行 `npm run check:docs`。
2. 运行 `npm test`、语法检查、依赖审计和 `git diff --check`。
3. 构建并检查 Windows、macOS Intel、macOS Apple Silicon 安装包。
4. 提交代码，创建 `v<version>` 标签，推送 `main` 和标签。
5. 等待 GitHub Actions 的测试、跨平台构建和公开 Release 完成。
6. 核验标签目标、公开 Release、全部安装包和 SHA-256 文件。

GitHub Actions 会在构建安装包前写入当前提交和运行编号，使已发布版本的应用内发布记录不会显示旧版本或“本地版本”。任何一项检查失败，版本都不能交付。
