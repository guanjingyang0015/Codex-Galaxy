# Codex Galaxy

> **[下载最新版](https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest)**

[English](README.en.md) | 简体中文

Codex Galaxy 是一款本地桌面工具，帮助你在不同 Codex 账号和兼容 API 之间切换，并继续本机保存的项目任务。

## 你可以用它做什么

- 在官方账号和多个 API 账号之间切换
- 没有官方账号时，直接使用多个 API 互相切换
- 继续已有本地任务，减少重复配置和中断
- 管理本地插件、已下载的插件市场和项目数据
- Windows 自动检查并安装更新；macOS 一键打开最新版下载页
- 支持简体中文和 English

## 快速开始

1. 从上方链接下载对应系统的安装包。
2. 打开 Codex Galaxy，添加官方账号或 API 账号。
3. 选择目标账号，点击“切换并打开 Codex”。
4. 在项目列表中选择“在 Codex 中继续”，恢复已有任务。

API 账号需要兼容 OpenAI Responses API。API Key 只保存在本机加密配置中，不会写入项目文档或日志。

## 插件

Galaxy 支持安装本地插件、添加 Codex CLI 支持的插件市场，以及从本地 `marketplace.json` 批量扩展插件。远程插件目录是否可用取决于 Codex 当前登录态和官方支持；Galaxy 不伪造官方权限。没有官方账号时，仍可使用纯 API、本地插件和已下载的本地插件市场。

## 更新与平台

GitHub Releases 提供 Windows x64、macOS Intel 和 macOS Apple Silicon 安装包。当前构建未配置代码签名，系统可能显示未知开发者提示；请从本项目 Releases 下载并按系统提示确认。

## 本地数据与安全

- Codex 数据：`~/.codex`
- Galaxy 数据：`~/.codex-galaxy`
- 切换前会创建可恢复备份
- 应用只在本机回环地址运行 API 网关，不提供公网服务
- 不要提交 `auth.json`、API Key、访问令牌或私有签名文件

## 开发

需要 Node.js 20 或更高版本：

```powershell
npm ci
npm test
npm start
```

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
