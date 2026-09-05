# Codex Galaxy

> **[下载最新版](https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest)**

[English](README.en.md) | 简体中文

Codex Galaxy 是一款本地桌面工具，帮助你在不同 Codex 账号和兼容 API 之间切换，并继续本机保存的项目任务。

**当前版本：Codex Galaxy 1.10.2**

使用教程已按使用阶段重新整理：**第一次添加账号配置 → 日常使用切换账号 → 异常故障处理 → 特色功能**。打开应用内“使用教程”后，点击对应阶段查看，不需要一次读完全部内容。

## 你可以用它做什么

- 在官方账号和多个 API 账号之间切换
- 没有官方账号时，直接使用多个 API 互相切换
- 继续已有本地任务，减少重复配置和中断
- 只在确有近期未完成回复时阻止切换，不会把崩溃遗留的旧 `inProgress` 标记当成当前任务
- 重启后从本机 SQLite 和 rollout 文件合并完整聊天记录，不再只显示被截断的最近一段
- 检查旧会话格式，必要时先备份再安全恢复后继续
- 管理本地插件、已下载的插件市场和项目数据
- 记录带时间和脱敏内容的本地日志，便于查看切换失败原因并复制反馈
- Windows 自动检查并安装更新；macOS 一键打开最新版下载页
- 支持简体中文和 English

## 快速开始

1. 从上方链接下载对应系统的安装包。
2. 打开 Codex Galaxy，添加官方账号或 API 账号。
3. 选择目标账号，点击“切换并打开 Codex”。
4. 在项目列表中选择“在 Codex 中继续”，恢复已有任务。
5. 如果 Codex 只是空闲运行，Galaxy 会先正常关闭它并等待本地记录写入；只有近期仍有未完成回复时才会阻止切换。
6. 切换完成后重新打开项目，历史记录从本机 Codex 数据恢复；Galaxy 不删除 `config.toml`、项目文件、SQLite 数据库或聊天文件。
7. 如果切换失败，点击顶部“日志”，查看或复制脱敏日志；不要删除配置和聊天数据。

API 账号需要兼容 OpenAI Responses API。API Key 只保存在本机加密配置中，不会写入项目文档或日志。

## 1.9.5 起的历史与切换保护

- 账号切换前会检查 Codex 的本地回合状态。近期有活动迹象的回复会被保护；超过安全时间且没有后续终态记录的崩溃遗留标记不会继续阻止切换。
- Galaxy 启动时会先同步一次本地项目库，避免重启后继续使用旧的显示缓存。
- 查看线程详情时，会合并 rollout 文件和 `thread_history` SQLite 中尚未完全落盘的用户/助手消息，并自动去重；详情不再被 200 条消息上限截断。
- 发布记录以当前安装版本为首项。安装新版本后，底部不会继续显示旧版本作为最近版本。
- 如果出现异常，不要删除 `config.toml`，也不要手动删除 `~/.codex` 或 `~/.codex-galaxy`；先查看顶部“日志”，保留脱敏截图和错误文字。
- 如果右下角只显示一个模型和推理强度，先在 Galaxy 中把 API 账号的模型 ID 留空并重新切换，让 Galaxy 重新读取中转站 `/models`；如果中转站只返回一个型号，或 Codex Desktop 的官方账号门控隐藏自定义型号，这是上游/中转站能力限制，命令行模型列表仍可单独验证。
- 即使填写了具体 GPT 型号，Galaxy 首次切换时也会读取 `/models` 并保存完整可选目录；你填写的型号仍会作为默认型号。

## API ↔ 官方切换步骤

### API → 官方

1. 先等待 API 回复完成；Codex 只是空闲时才继续切换。
2. 确认官方账号已经添加并“捕获”。第一次使用时，先在 Codex 中登录官方账号，看到项目列表后回 Galaxy 点击“捕获”。
3. 选中官方账号，点击“切换并打开 Codex”。
4. Windows 如果出现设置或登录页面，在 Codex 中完成设置/登录，等项目列表正常显示后回 Galaxy 点击“已完成，继续同步”。
5. 等进度到 100%，再从项目列表点击“在 Codex 中继续”。

### 官方 → API

1. 添加或编辑 API 账号，填写 Base URL、API Key；模型 ID 可留空自动发现，优先选择“API 直连”。
2. 选中 API 账号，点击“切换并打开 Codex”。
3. Galaxy 会正常关闭空闲的 Codex、保存官方登录快照，然后从实时 `auth.json` 中移除官方 OAuth，只保留 API provider 自己的凭据，再同步 provider 和项目记录并重新打开 Codex。
4. 等进度到 100%，从项目列表点击“在 Codex 中继续”。API 直连模式完成后可以退出 Galaxy；兼容网关模式需要保持 Galaxy 运行。
5. 如果失败，打开顶部“日志”，复制脱敏日志和错误文字。日志文件默认位于 `~/.codex-galaxy/logs/galaxy.log`，每条记录包含 UTC 时间和本地时间。

### API → API

1. 选中目标 API 账号，确认 Base URL、API Key 和模型 ID 正确。
2. 点击“切换并打开 Codex”。
3. Galaxy 只更新 provider、模型和必要的线程索引，不会为了 API → API 切换重写数 GB 的历史文件。
4. 等进度到 100% 后，再点击“在 Codex 中继续”。

1.9.9 修复了官方 → API 被回滚到官方账号的问题：新版 Codex 的官方 `auth.json` 可能包含值为空的 `OPENAI_API_KEY` 字段，1.9.8 会把“字段存在”误判为旧 API 登录并报 `api-auth-legacy`。现在只把非空 Key 视为旧 API 凭据，并且 API 模式不会继续激活官方 OAuth；已捕获的官方登录仍加密保存在 Galaxy 中，切回官方时会原样恢复，不需要手动退出官方账号或结束 Codex 进程。

1.10.2 将应用内使用教程改为四个阶段：第一次添加账号配置、日常使用切换账号、异常故障处理、特色功能。打开“使用教程”后，点击需要的阶段即可，不必一次读完全部内容。

官方切换时，Galaxy 不再把当前 API 的 Windows sandbox 配置合并到官方账号配置；已保存的官方配置会保留自己的 sandbox 设置。Galaxy 也不会把 `[model_providers.openai]` 写成覆盖 Codex 内置 provider，旧快照中的过期覆盖会自动移除；这能避免 Codex 把 `config_load` 错误误显示成 Windows setup 页面，也不需要删除 `config.toml`。首次官方登录如果卡在 Windows setup，可在提示框选择“兼容模式重试”，仅在你明确选择后改用 `unelevated` 后端；完成登录并看到项目列表后，再点击“已完成，继续同步”，系统会重新捕获并验证官方状态。

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
