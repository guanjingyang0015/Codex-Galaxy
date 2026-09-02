# Codex Galaxy

> **[下载最新版](https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest)**

[English](README.en.md) | 简体中文

Codex Galaxy 是一款本地桌面工具，帮助你在不同 Codex 账号和兼容 API 之间切换，并继续本机保存的项目任务。

**当前稳定版本：Codex Galaxy 1.9.7**

## 你可以用它做什么

- 在官方账号和多个 API 账号之间切换
- 没有官方账号时，直接使用多个 API 互相切换
- 继续已有本地任务，减少重复配置和中断
- 只在确有近期未完成回复时阻止切换，不会把崩溃遗留的旧 `inProgress` 标记当成当前任务
- 重启后从本机 SQLite 和 rollout 文件合并完整聊天记录，不再只显示被截断的最近一段
- 检查旧会话格式，必要时先备份再安全恢复后继续
- 管理本地插件、已下载的插件市场和项目数据
- Windows 自动检查并安装更新；macOS 一键打开最新版下载页
- 支持简体中文和 English

## 快速开始

1. 从上方链接下载对应系统的安装包。
2. 打开 Codex Galaxy，添加官方账号或 API 账号。
3. 选择目标账号，点击“切换并打开 Codex”。
4. 在项目列表中选择“在 Codex 中继续”，恢复已有任务。
5. 如果 Codex 只是空闲运行，Galaxy 会先正常关闭它并等待本地记录写入；只有近期仍有未完成回复时才会阻止切换。
6. 切换完成后重新打开项目，历史记录从本机 Codex 数据恢复；Galaxy 不删除 `config.toml`、项目文件、SQLite 数据库或聊天文件。

API 账号需要兼容 OpenAI Responses API。API Key 只保存在本机加密配置中，不会写入项目文档或日志。

## 1.9.5 起的历史与切换保护

- 账号切换前会检查 Codex 的本地回合状态。近期有活动迹象的回复会被保护；超过安全时间且没有后续终态记录的崩溃遗留标记不会继续阻止切换。
- Galaxy 启动时会先同步一次本地项目库，避免重启后继续使用旧的显示缓存。
- 查看线程详情时，会合并 rollout 文件和 `thread_history` SQLite 中尚未完全落盘的用户/助手消息，并自动去重；详情不再被 200 条消息上限截断。
- 发布记录以当前安装版本为首项。安装新版本后，底部不会继续显示旧版本作为最近版本。
- 如果出现异常，不要删除 `config.toml`，也不要手动删除 `~/.codex` 或 `~/.codex-galaxy`；先保留脱敏截图和错误文字。

## 插件

Galaxy 支持安装本地插件、添加 Codex CLI 支持的插件市场，以及从本地 `marketplace.json` 批量扩展插件。远程插件目录是否可用取决于 Codex 当前登录态和官方支持；Galaxy 不伪造官方权限。没有官方账号时，仍可使用纯 API、本地插件和已下载的本地插件市场。

## 更新与平台

GitHub Releases 提供 Windows x64、macOS Intel 和 macOS Apple Silicon 安装包。当前构建未配置代码签名，系统可能显示未知开发者提示；请从本项目 Releases 下载并按系统提示确认。直接覆盖安装即可，不需要先卸载旧版；账号配置、本地项目和聊天记录会保留。

每次版本更新都会同步更新版本号、README、中英文应用内教程、发布说明、发布记录、测试断言和安装包。发布检查未通过时，不会把版本标记为正式发布。

## 本地数据与安全

- Codex 数据：`~/.codex`
- Galaxy 数据：`~/.codex-galaxy`
- 切换前会创建可恢复备份
- 应用只在本机回环地址运行 API 网关，不提供公网服务
- 不要提交 `auth.json`、API Key、访问令牌、完整聊天记录或私有签名文件
- 不要为了修复切换或历史问题删除 `config.toml`

## 开发

需要 Node.js 20 或更高版本：

```powershell
npm ci
npm test
npm start
```

`npm test` 包含文档同步回归检查：当前版本必须同时出现在中英文 README、应用内教程、静态页面、发布说明和版本测试中；功能或操作规则变化时，对应说明也必须同步更新。

构建 Windows 安装包：

```powershell
npm run dist:win
```

构建 macOS 安装包：

```bash
npm run dist:mac
```

## 联系作者

作者：Guan Jingyang
邮箱：`guanjingyang@gmail.com`

本项目使用 MIT 许可证。Codex Galaxy 是独立的本地工具，不是 OpenAI 官方产品。
