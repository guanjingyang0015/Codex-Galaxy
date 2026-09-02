const $ = (selector) => document.querySelector(selector);
const state = {
  profiles: [],
  version: "1.9.7",
  threads: [],
  currentId: null,
  selectedProfileId: null,
  selectedThread: null,
  editingProfileId: null,
  switchOperationId: null,
  refreshOperationId: null,
  cleanupOperationId: null,
  switchConfirmation: null,
  switching: false,
  testingProfileId: null,
  refreshing: false,
  cleaning: false,
  repairing: false,
  gatewayRunning: false,
  gatewayError: null,
  codexRunning: false,
  codexProvider: null,
  librarySyncedAt: null,
  plugins: [],
  automation: { settings: { autoCleanCompleted: false }, completedFiles: 0, completedBytes: 0 },
  diagnostics: { path: "", text: "", bytes: 0, truncated: false },
  releases: [],
  update: {
    phase: "idle",
    currentVersion: "1.9.7",
    latestVersion: null,
    available: false,
    action: "install",
    percent: 0,
    error: null,
  },
};
const bridge = window.codexGalaxy;

const translations = {
  "zh-CN": {
    "status.connecting": "连接中",
    "status.switching": "切换中",
    "status.refreshing": "刷新中",
    "status.cleaning": "清理中",
    "status.repairing": "修复中",
    "status.updating": "更新中",
    "status.gatewayRunning": "本地网关运行中",
    "status.localProgram": "本机程序",
    "common.localError": "本地操作失败",
    "common.cancelled": "已取消",
    "common.copied": "已复制",
    "common.close": "关闭",
    "common.save": "保存",
    "common.cancel": "取消",
    "common.add": "添加",
    "common.edit": "编辑",
    "common.capture": "捕获",
    "common.test": "测试连接",
    "common.delete": "删除",
    "common.clearKey": "清除 Key",
    "common.current": "当前",
    "common.none": "无",
    "common.unknown": "未知",
    "release.local": "本地版本",
    "common.notSelected": "未选择",
    "common.pleaseSelect": "请选择账号",
    "common.selectToSwitch": "选择后可切换",
    "common.timeUnknown": "时间未知",
    "common.noProjectDir": "无项目目录",
    "common.unnamedThread": "未命名线程",
    "common.providerUnrecorded": "provider 未记录",
    "common.allProjects": "全部项目",
    "common.running": "运行中",
    "common.notRunning": "未运行",
    "common.notSynced": "未同步",
    "common.detecting": "检测中",
    "common.waitingScan": "等待扫描",
    "common.providerNotConfigured": "provider 未配置",
    "common.refreshTitle": "重新扫描本机 Codex 项目记录",
    "actions.plugins": "插件",
    "actions.cleanup": "清理数据",
    "actions.tutorial": "使用教程",
    "actions.diagnostics": "故障日志",
    "actions.refresh": "刷新项目",
    "actions.refreshTitle": "重新扫描本机 Codex 项目记录",
    "update.check": "检查更新",
    "update.checking": "检查中…",
    "update.current": "已是最新版",
    "update.retry": "重试更新",
    "update.install": "更新到 v{version}",
    "update.openMac": "获取 v{version}",
    "update.downloading": "下载 {percent}%",
    "update.starting": "正在启动安装",
    "update.availableNotice": "发现 Codex Galaxy {version}，点击顶部更新按钮即可升级。",
    "update.currentNotice": "当前 {version} 已是 GitHub 最新正式版本。",
    "update.cancelled": "已取消更新，当前任务不会受影响。",
    "update.macOpened": "已打开 GitHub 最新版页面。请按 Mac 芯片选择 x64 或 arm64 DMG；当前包未签名，请遵循 macOS 系统提示。",
    "page.title": "账号与项目",
    "status.boardLabel": "当前使用状态",
    "status.account": "当前账号",
    "status.loginMode": "登录模式",
    "status.model": "当前模型",
    "status.gateway": "本地网关",
    "status.codex": "Codex 状态",
    "status.codexSummary": "{running} · {provider}",
    "profiles.title": "账号与中转站",
    "profiles.add": "添加账号",
    "profile.modelAuto": "自动发现",
    "profile.modelAutoPrefix": "自动",
    "profile.loginMode.official": "官方登录",
    "profile.loginMode.pure": "纯 API",
    "profile.kind.official": "Codex 官方账号",
    "profile.kind.api": "中转 API",
    "profile.keySaved": "Key 已保存",
    "profile.keyMissing": "未保存 Key",
    "profile.testTitle": "测试中转站连接",
    "profile.deleteTitle": "删除此配置",
    "profile.testOk": "{name} 连接成功。",
    "profile.testFailed": "{name} 连接测试：{message}",
    "profile.testRunning": "正在测试…",
    "profile.testNotFound": "接口路径不正确",
    "profile.testAuth": "Key 无效或已失效",
    "profile.testServer": "中转站服务器异常",
    "profile.testNetwork": "网络连接失败",
    "profile.testUnsupported": "接口不兼容",
    "profile.baseUrl": "地址",
    "profile.recentTest": "最近测试",
    "profile.testNever": "未测试",
    "profile.switchMissingKey": "这个中转站还没有保存 API Key，请先编辑配置并填写 Key。",
    "profile.currentCannotDelete": "当前配置不能删除，请先切换到其他配置。",
    "profile.currentCannotClear": "当前配置不能清除 Key，请先切换到其他配置。",
    "profile.deleted": "配置已删除。",
    "profile.keyCleared": "已清除 {name} 的 API Key。",
    "profile.deleteConfirm": "确定删除“{name}”吗？这只会删除 Galaxy 保存的配置和密钥，不会删除 Codex 聊天记录。",
    "profile.clearKeyConfirm": "确定清除“{name}”的 API Key 吗？清除后必须重新填写 Key 才能切换。",
    "profile.empty": "还没有账号。点击右上角 + 添加。",
    "profile.editTitle": "编辑账号",
    "profile.addTitle": "添加账号",
    "profile.captureTitle": "保存当前 Codex 官方登录状态",
    "profile.actions.noKey": "尚未保存 API Key",
    "profile.savedOfficial": "账号已保存。请在 Codex 登录该官方账号后点击“捕获”。",
    "profile.saved": "账号设置已保存。",
    "profile.captured": "当前 Codex 官方登录状态已保存到该账号。",
    "profileForm.name": "账号名称",
    "profileForm.namePlaceholder": "例如：工作 API",
    "profileForm.type": "类型",
    "profileForm.official": "Codex 官方账号",
    "profileForm.api": "中转 API",
    "profileForm.keyPlaceholder": "留空则保留已保存的 Key",
    "profileForm.keyNote": "留空会保留原 Key；需要更换时直接填写新 Key。",
    "profileForm.model": "模型 ID",
    "profileForm.optional": "（可选）",
    "profileForm.modelPlaceholder": "留空自动发现，或填 gpt-5.6、provider/model",
    "profileForm.protocol": "API 账号始终使用独立纯 API 登录，不需要官方账号。模型 ID 可留空，由中转站模型列表自动选择；接口必须兼容 OpenAI Responses API。",
    "profileForm.runtimeMode": "运行方式",
    "profileForm.direct": "API 直连（推荐）",
    "profileForm.gateway": "兼容网关（Galaxy 需运行）",
    "apiGuide.badge": "纯 API",
    "apiGuide.title": "无官方账号也能用：手机号/邮箱注册中转站即可",
    "apiGuide.description": "点击中转站即可复制链接。打开后按服务商提示完成开通，再将 <code>Base URL</code> 和 <code>API Key</code> 填入“添加账号”即可使用。",
    "apiGuide.copyRight": "获取中转站 A 链接",
    "apiGuide.copyZyg": "获取中转站 B 链接",
    "apiGuide.copyHint": "点击获取中转站链接",
    "switch.target": "准备切换到",
    "switch.open": "切换并打开 Codex",
    "threads.empty": "还没有本地线程。点击“刷新项目”重新扫描。",
    "threads.count": "条线程",
    "threads.summary": "{count} 条 · {time}",
    "threads.title": "项目继续入口",
    "threads.search": "按项目、标题或账号搜索",
    "threads.allProjects": "全部项目",
    "threads.detailTitle": "仅查看本机线程详情，不会切换账号",
    "threads.launchTitle": "切换或同步所需账号并在 Codex 中恢复该项目",
    "threads.launchDetail": "在 Codex 中继续：切换或同步所需账号并在 Codex 中恢复该项目",
    "threads.detail": "查看详情",
    "threads.launch": "在 Codex 中继续",
    "threads.launchWithCurrent": "用当前账号继续",
    "threads.copyResume": "复制 resume 命令",
    "threads.selectAccountResume": "选择账号并继续",
    "threads.addAccountFirst": "请先添加账号。",
    "threads.messagesEmpty": "完整事件仍保存在 Codex 本地线程文件中。",
    "threads.dialogTitle": "线程",
    "threads.dialogCompatibility": "兼容性说明：此任务包含由原 provider 加密的推理状态。聊天和项目文件仍会保留，但另一家 provider 可能无法复用这段隐藏状态。",
    "threads.launched": "已用 {model} 打开原线程。",
    "threads.healthHealthy": "会话结构正常，可直接继续。",
    "threads.healthRepairRollout": "新版 Codex 要求 session_meta 必须是会话文件的第一条记录。Galaxy 已在原会话中找到匹配的真实元数据，可先完整备份，再安全调整记录顺序。",
    "threads.healthRepairBackup": "原会话缺少开头元数据，但 Galaxy 找到了该线程的可信历史备份。可先完整备份当前文件，再恢复真实元数据。",
    "threads.healthRepairRunning": " Codex 当前正在运行；请先完成任务并彻底退出 Codex，再点击修复。",
    "threads.healthBlockedMismatch": "会话中的元数据属于另一个线程。为避免串错聊天，Galaxy 不会自动修复，请保留原文件进行人工恢复。",
    "threads.healthBlockedMissing": "没有找到可验证的真实 session_meta 或可信 Galaxy 备份。Galaxy 不会伪造元数据，请保留原文件进行人工恢复。",
    "threads.healthBlocked": "该会话无法自动安全修复。原文件不会被覆盖，请保留文件和错误截图进行人工恢复。",
    "threads.healthUnavailable": "此项目没有可直接检查的 rollout 文件；Galaxy 会继续使用 Codex 本地索引恢复。",
    "threads.repair": "备份并修复旧会话",
    "threads.repairing": "正在备份并修复…",
    "threads.repaired": "旧会话已安全修复，原文件的字节级备份保存在 {path}。现在可以继续该任务。",
    "threads.repairedWithWarning": "旧会话已修复，字节级备份保存在 {path}。附加记录未能完整保存：{warning}",
    "switching": "准备切换",
    "switching.openText": "切换并打开 Codex",
    "switching.resyncText": "重新同步并打开 Codex",
    "switching.progress": "正在切换",
    "switching.to": "准备切换到 {name}",
    "switching.cancelledProgress": "已取消切换，请先处理正在进行的任务",
    "switching.cancelledNotice": "已取消切换，账号和本地项目记录均未更改。",
    "switching.doneThread": "同步完成，项目线程已打开",
    "switching.doneSwitch": "同步完成，Codex 已打开",
    "switching.doneNotice": "已切换到 {name}（{loginMode}），本地项目记录同步完成。",
    "switching.failed": "切换失败：{message}",
    "switching.pleaseSelectAccount": "请先选择要切换的账号。",
    "refresh.progress": "正在刷新项目",
    "refresh.preparing": "正在准备扫描本地项目",
    "refresh.done": "刷新完成，共发现 {count} 条项目",
    "refresh.doneNotice": "项目刷新完成，共发现 {count} 条本地项目记录。",
    "refresh.processing": "已处理 {done}/{total} 个本地条目",
    "refresh.completed": "扫描与项目库写入已完成",
    "refresh.detecting": "正在检测本地条目",
    "refresh.failed": "刷新失败：{message}",
    "gateway.localFailed": "本地网关启动失败：{error}",
    "cleanup.title": "清理本地无效数据",
    "cleanup.scanning": "正在扫描…",
    "cleanup.scanningDetail": "正在统计本机 Codex 数据，请稍候。",
    "cleanup.select": "选择要清理的数据",
    "cleanup.projects": "已归档/已删除项目",
    "cleanup.automations": "已完成自动化运行历史",
    "cleanup.projectsMeta": "{count} 个项目，{files} 个会话文件（约 {size}），涉及 {rows} 条数据库索引",
    "cleanup.noProjects": "没有已归档或已删除项目",
    "cleanup.automationsMeta": "{files} 个历史文件、{rows} 条运行记录（约 {size}）",
    "cleanup.noAutomations": "没有已完成自动化历史",
    "cleanup.warningRunning": "Codex 当前正在运行。执行项目清理会关闭 Codex；请先确认没有仍在生成或执行的任务。清理完成后会自动重新打开 Codex。",
    "cleanup.warningSafe": "执行前会创建可恢复备份；清理完成后项目列表会自动重建。",
    "cleanup.scanFailed": "扫描失败：{message}",
    "cleanup.prepare": "正在准备安全清理",
    "cleanup.done": "数据清理完成",
    "cleanup.doneNotice": "清理完成：已移除 {count} 个归档/删除项目{automation}。",
    "cleanup.automationNotice": "，以及 {files} 个自动化文件和 {rows} 条运行记录",
    "cleanup.failed": "清理失败：{message}",
    "cleanup.progress": "正在清理",
    "cleanup.run": "备份并清理",
    "cleanup.note": "项目会话会先压缩备份到 <code>.codex/backups_state</code>。不会删除用户项目文件夹或源代码。",
    "plugin.title": "插件与插件市场",
    "plugin.empty": "暂未发现本地插件。可以安装一个本地插件目录，或先添加插件市场。",
    "plugin.intro": "插件目录留在本机 Codex Home，不随账号切换删除。API 账号使用独立纯 API 登录，账号之间切换不会借用或保留官方 OAuth。",
    "plugin.authBoundary": "远程公共插件目录是否可见由 Codex 当前登录态与官方支持决定；Galaxy 不伪造权限。没有官方账号时仍可使用纯 API、本地插件和已下载的本地插件市场。",
    "plugin.installLocal": "安装本地插件目录",
    "plugin.expandMarketplace": "自动扩展本地插件市场",
    "plugin.marketplaceLabel": "添加插件市场（GitHub owner/repo、Git URL 或本地目录）",
    "plugin.marketplacePlaceholder": "例如：owner/repo",
    "plugin.addMarketplace": "添加插件市场",
    "plugin.finish": "完成",
    "plugin.installed": "插件 {name} 已安装。请重新打开 Codex 插件页面。",
    "plugin.marketplaceAdded": "插件市场已添加，请在 Codex 插件页刷新。",
    "plugin.marketplaceRequired": "请填写插件市场地址。",
    "plugin.marketplaceExpanded": "已从本地插件市场安装 {count} 个插件。请重新打开 Codex 插件页。",
    "plugin.marketplaceEmpty": "这个插件市场没有发现可安装的本地插件。",
    "plugin.autoCleanupLabel": "切换账号时自动清理已完成自动化的历史记录（仅清理完成/归档状态，保留配置；执行前自动备份）",
    "plugin.autoCleanupOn": "已开启：下次切换前会清理已完成自动化历史，并保留备份。",
    "plugin.autoCleanupOff": "已关闭自动清理。",
    "footer.codexHome": "CODEX HOME",
    "footer.library": "本地项目库",
    "footer.author": "作者邮箱",
    "release.label": "最近发布记录",
    "release.github": "GitHub Release",
    "release.meta": "提交 {commit} · Actions {run}",
    "language.chinese": "简体中文",
    "language.english": "English",
    "dialog.close": "关闭",
    "dialog.closeTutorial": "关闭教程",
    "dialog.closePlugins": "关闭插件管理",
    "dialog.finish": "我知道了",
    "confirm.title": "Codex 可能仍有任务进行中",
    "confirm.message": "检测到 Codex Desktop 正在运行。",
    "confirm.cancel": "取消，先处理任务",
    "confirm.continue": "继续切换",
    "resume.copied": "resume 命令已复制。",
    "relay.copied": "{name} 链接已复制，请粘贴到浏览器打开。",
    "bridge.notLoaded": "桌面桥未加载，请通过 Codex Galaxy 应用启动。",
    "diagnostics.title": "本地故障日志",
    "diagnostics.intro": "Galaxy 只记录操作、时间、错误类型和脱敏错误信息，不记录 API Key、OAuth、聊天正文或请求体。",
    "diagnostics.loading": "正在读取本地日志…",
    "diagnostics.empty": "暂时没有故障日志。下次切换或其他本地操作失败时，错误原因会自动记录在这里。",
    "diagnostics.path": "日志文件",
    "diagnostics.refresh": "刷新日志",
    "diagnostics.open": "打开文件",
    "diagnostics.copy": "复制日志",
    "diagnostics.copied": "日志已复制。发送前请再次确认没有添加任何未脱敏内容。",
    "diagnostics.opened": "已打开本地故障日志文件。",
    "diagnostics.truncated": "日志较长，当前只显示最后一段。",
    "tutorial.title": "安全切换教程",
    "tutorial.intro": "项目和完整聊天记录始终保存在本机同一个 Codex Home 中。Codex Galaxy 切换的是登录凭据、API provider 和继续项目所需的本地索引，不会把聊天上传到其他账号。当前版本为 v1.9.7。",
    "tutorial.step1.title": "保存第一个官方账号",
    "tutorial.step2.title": "添加一个或多个中转 API",
    "tutorial.step3.title": "API ↔ 官方的具体切换步骤",
    "tutorial.step4.title": "继续处理原项目",
    "tutorial.step5.title": "API 模式按需使用网关",
    "tutorial.step6.title": "刷新项目与清理数据",
    "tutorial.step7.title": "异常恢复",
    "tutorial.step8.title": "升级 Codex Galaxy",
    "tutorial.step9.title": "插件、图片和自动化清理",
  },
  "en": {
    "status.connecting": "Connecting",
    "status.switching": "Switching",
    "status.refreshing": "Refreshing",
    "status.cleaning": "Cleaning",
    "status.repairing": "Repairing",
    "status.updating": "Updating",
    "status.gatewayRunning": "Local gateway running",
    "status.localProgram": "Local app",
    "common.localError": "Local operation failed",
    "common.cancelled": "Cancelled",
    "common.copied": "Copied",
    "common.close": "Close",
    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.add": "Add",
    "common.edit": "Edit",
    "common.capture": "Capture",
    "common.test": "Test connection",
    "common.delete": "Delete",
    "common.clearKey": "Clear key",
    "common.current": "Current",
    "common.none": "None",
    "common.unknown": "Unknown",
    "release.local": "Local build",
    "common.notSelected": "Not selected",
    "common.pleaseSelect": "Select an account",
    "common.selectToSwitch": "Select to switch",
    "common.timeUnknown": "Unknown time",
    "common.noProjectDir": "No project directory",
    "common.unnamedThread": "Unnamed thread",
    "common.providerUnrecorded": "Provider not recorded",
    "common.allProjects": "All projects",
    "common.running": "Running",
    "common.notRunning": "Not running",
    "common.notSynced": "Not synced",
    "common.detecting": "Detecting",
    "common.waitingScan": "Waiting to scan",
    "common.providerNotConfigured": "Provider not configured",
    "common.refreshTitle": "Rescan local Codex project records",
    "actions.plugins": "Plugins",
    "actions.cleanup": "Clean data",
    "actions.tutorial": "Guide",
    "actions.diagnostics": "Error log",
    "actions.refresh": "Refresh projects",
    "actions.refreshTitle": "Rescan local Codex project records",
    "update.check": "Check updates",
    "update.checking": "Checking…",
    "update.current": "Up to date",
    "update.retry": "Retry update",
    "update.install": "Update to v{version}",
    "update.openMac": "Get v{version}",
    "update.downloading": "Downloading {percent}%",
    "update.starting": "Starting setup",
    "update.availableNotice": "Codex Galaxy {version} is available. Use the update button at the top to upgrade.",
    "update.currentNotice": "Version {version} is the latest GitHub release.",
    "update.cancelled": "Update cancelled. The current task is unaffected.",
    "update.macOpened": "The latest GitHub release page is open. Choose the x64 or arm64 DMG for your Mac. The current build is unsigned; follow the macOS security prompts.",
    "page.title": "Accounts and projects",
    "status.boardLabel": "Current usage status",
    "status.account": "Current account",
    "status.loginMode": "Login mode",
    "status.model": "Current model",
    "status.gateway": "Local gateway",
    "status.codex": "Codex status",
    "status.codexSummary": "{running} · {provider}",
    "profiles.title": "Accounts",
    "profiles.add": "Add account",
    "profile.modelAuto": "Auto detect",
    "profile.modelAutoPrefix": "Auto",
    "profile.loginMode.official": "Official login",
    "profile.loginMode.pure": "Pure API",
    "profile.kind.official": "Codex official account",
    "profile.kind.api": "Relay API",
    "profile.keySaved": "Key saved",
    "profile.keyMissing": "Key not saved",
    "profile.testTitle": "Test relay connection",
    "profile.deleteTitle": "Delete this configuration",
    "profile.testOk": "{name} connected successfully.",
    "profile.testFailed": "Connection test for {name}: {message}",
    "profile.testRunning": "Testing…",
    "profile.testNotFound": "Endpoint path is incorrect",
    "profile.testAuth": "The key is invalid or expired",
    "profile.testServer": "Relay server error",
    "profile.testNetwork": "Network connection failed",
    "profile.testUnsupported": "Incompatible endpoint",
    "profile.baseUrl": "Endpoint",
    "profile.recentTest": "Last test",
    "profile.testNever": "Not tested",
    "profile.switchMissingKey": "This relay has no saved API key. Edit it and enter a key before switching.",
    "profile.currentCannotDelete": "The current configuration cannot be deleted. Switch first.",
    "profile.currentCannotClear": "The current configuration cannot clear its key. Switch first.",
    "profile.deleted": "Configuration deleted.",
    "profile.keyCleared": "API key cleared for {name}.",
    "profile.deleteConfirm": "Delete “{name}”? This removes only the Galaxy configuration and key; Codex chats are not deleted.",
    "profile.clearKeyConfirm": "Clear the API key for “{name}”? You must enter a new key before switching to it.",
    "profile.empty": "No accounts yet. Click + in the top right to add one.",
    "profile.editTitle": "Edit account",
    "profile.addTitle": "Add account",
    "profile.captureTitle": "Save the current official Codex login",
    "profile.actions.noKey": "API key not saved yet",
    "profile.savedOfficial": "Account saved. Sign in to this official account in Codex, then click Capture.",
    "profile.saved": "Account settings saved.",
    "profile.captured": "The current official Codex login was saved to this account.",
    "profileForm.name": "Account name",
    "profileForm.namePlaceholder": "e.g. Work API",
    "profileForm.type": "Type",
    "profileForm.official": "Official Codex account",
    "profileForm.api": "Relay API",
    "profileForm.keyPlaceholder": "Leave blank to keep the saved key",
    "profileForm.keyNote": "Leave blank to keep the existing key; enter a new key to replace it.",
    "profileForm.model": "Model ID",
    "profileForm.optional": "(optional)",
    "profileForm.modelPlaceholder": "Leave blank to detect, or enter gpt-5.6, provider/model",
    "profileForm.protocol": "API accounts always use an independent pure-API login and require no official account. Model ID may be left blank for relay catalog discovery. The endpoint must support the OpenAI Responses API.",
    "profileForm.runtimeMode": "Runtime mode",
    "profileForm.direct": "Direct API (recommended)",
    "profileForm.gateway": "Compatibility gateway (Galaxy must run)",
    "apiGuide.badge": "PURE API",
    "apiGuide.title": "No official account required: register with a relay provider",
    "apiGuide.description": "Click a relay provider to copy its link. Open it and follow the provider's instructions to activate access, then add its <code>Base URL</code> and <code>API Key</code> to a new account.",
    "apiGuide.copyRight": "Get relay A link",
    "apiGuide.copyZyg": "Get relay B link",
    "apiGuide.copyHint": "Click to get the relay link",
    "switch.target": "Switch target",
    "switch.open": "Switch and open Codex",
    "threads.empty": "No local threads yet. Click “Refresh projects” to rescan.",
    "threads.count": "threads",
    "threads.summary": "{count} threads · {time}",
    "threads.title": "Resume a project",
    "threads.search": "Search by project, title, or account",
    "threads.allProjects": "All projects",
    "threads.detailTitle": "Only view local thread details; does not switch accounts",
    "threads.launchTitle": "Switch or sync the required account and resume this project in Codex",
    "threads.launchDetail": "Continue in Codex: switch or sync the required account and resume this project in Codex",
    "threads.detail": "View details",
    "threads.launch": "Continue in Codex",
    "threads.launchWithCurrent": "Continue with current account",
    "threads.copyResume": "Copy resume command",
    "threads.selectAccountResume": "Select an account to continue",
    "threads.addAccountFirst": "Add an account first.",
    "threads.messagesEmpty": "The full event log remains in the local Codex thread files.",
    "threads.dialogTitle": "Thread",
    "threads.dialogCompatibility": "Compatibility note: this task contains encrypted reasoning state from the original provider. The chat and project files remain, but another provider may not be able to reuse that hidden state.",
    "threads.launched": "Opened the original thread with {model}.",
    "threads.healthHealthy": "The session structure is healthy and can be resumed.",
    "threads.healthRepairRollout": "New Codex versions require session_meta to be the first rollout record. Galaxy found matching real metadata in this rollout and can create a full backup before safely moving it.",
    "threads.healthRepairBackup": "The rollout is missing its opening metadata, but Galaxy found a trusted historical backup for this thread. It can back up the current file before restoring the real metadata.",
    "threads.healthRepairRunning": " Codex is running. Finish the current task and fully quit Codex before repairing.",
    "threads.healthBlockedMismatch": "The metadata belongs to a different thread. Galaxy will not risk joining the wrong chats; keep the original file for manual recovery.",
    "threads.healthBlockedMissing": "No verifiable real session_meta or trusted Galaxy backup was found. Galaxy will not invent metadata; keep the original file for manual recovery.",
    "threads.healthBlocked": "This session cannot be repaired automatically and safely. The original file will not be overwritten; keep it and the error screenshot for manual recovery.",
    "threads.healthUnavailable": "This project has no rollout file that Galaxy can inspect directly. Codex's local index will be used to resume it.",
    "threads.repair": "Back up and repair old session",
    "threads.repairing": "Backing up and repairing…",
    "threads.repaired": "The old session was repaired safely. A byte-exact backup is stored at {path}. You can resume the task now.",
    "threads.repairedWithWarning": "The old session was repaired and its byte-exact backup is stored at {path}. The additional audit record was not fully saved: {warning}",
    "switching": "Preparing switch",
    "switching.openText": "Switch and open Codex",
    "switching.resyncText": "Resync and open Codex",
    "switching.progress": "Switching",
    "switching.to": "Preparing to switch to {name}",
    "switching.cancelledProgress": "Switch cancelled; finish the running task first",
    "switching.cancelledNotice": "Switch cancelled. Account and local project records are unchanged.",
    "switching.doneThread": "Sync complete; project thread opened",
    "switching.doneSwitch": "Sync complete; Codex opened",
    "switching.doneNotice": "Switched to {name} ({loginMode}); local project records synced.",
    "switching.failed": "Switch failed: {message}",
    "switching.pleaseSelectAccount": "Select an account to switch to first.",
    "refresh.progress": "Refreshing projects",
    "refresh.preparing": "Preparing to scan local projects",
    "refresh.done": "Refresh complete: {count} projects found",
    "refresh.doneNotice": "Project refresh complete: {count} local project records found.",
    "refresh.processing": "Processed {done}/{total} local entries",
    "refresh.completed": "Scan and project-library write complete",
    "refresh.detecting": "Detecting local entries",
    "refresh.failed": "Refresh failed: {message}",
    "gateway.localFailed": "Local gateway failed to start: {error}",
    "cleanup.title": "Clean local stale data",
    "cleanup.scanning": "Scanning…",
    "cleanup.scanningDetail": "Gathering local Codex data. Please wait.",
    "cleanup.select": "Select what to clean",
    "cleanup.projects": "Archived / deleted projects",
    "cleanup.automations": "Completed automation run history",
    "cleanup.projectsMeta": "{count} projects, {files} session files (about {size}) across {rows} database rows",
    "cleanup.noProjects": "No archived or deleted projects",
    "cleanup.automationsMeta": "{files} history files, {rows} run records (about {size})",
    "cleanup.noAutomations": "No completed automation history",
    "cleanup.warningRunning": "Codex is currently running. Project cleanup will close Codex; confirm no task is still generating or running first. Codex reopens automatically after cleanup.",
    "cleanup.warningSafe": "A recoverable backup is created first; the project list rebuilds automatically after cleanup.",
    "cleanup.scanFailed": "Scan failed: {message}",
    "cleanup.prepare": "Preparing safe cleanup",
    "cleanup.done": "Data cleanup complete",
    "cleanup.doneNotice": "Cleanup complete: removed {count} archived/deleted projects{automation}.",
    "cleanup.automationNotice": ", plus {files} automation files and {rows} run records",
    "cleanup.failed": "Cleanup failed: {message}",
    "cleanup.progress": "Cleaning",
    "cleanup.run": "Back up and clean",
    "cleanup.note": "Project sessions are compressed and backed up to <code>.codex/backups_state</code> first. User project folders and source code are never deleted.",
    "plugin.title": "Plugins and plugin marketplaces",
    "plugin.empty": "No local plugins found. Install a local plugin directory or add a marketplace first.",
    "plugin.intro": "The plugin directory stays in the local Codex Home and is not removed when switching accounts. API accounts use an independent pure-API login and never borrow or retain official OAuth during switching.",
    "plugin.authBoundary": "Visibility of a remote public catalog depends on the active Codex login and official support; Galaxy does not forge permissions. Without an official account, you can still use pure API profiles, local plugins, and downloaded local marketplaces.",
    "plugin.installLocal": "Install local plugin directory",
    "plugin.expandMarketplace": "Auto-expand local marketplace",
    "plugin.marketplaceLabel": "Add plugin marketplace (GitHub owner/repo, Git URL, or local directory)",
    "plugin.marketplacePlaceholder": "e.g. owner/repo",
    "plugin.addMarketplace": "Add marketplace",
    "plugin.finish": "Done",
    "plugin.installed": "Plugin {name} installed. Reopen the Codex plugin page.",
    "plugin.marketplaceAdded": "Marketplace added. Refresh the Codex plugin page.",
    "plugin.marketplaceRequired": "Enter a marketplace address.",
    "plugin.marketplaceExpanded": "Installed {count} plugins from the local marketplace. Reopen the Codex plugin page.",
    "plugin.marketplaceEmpty": "No installable local plugins were found in this marketplace.",
    "plugin.autoCleanupLabel": "Auto-clean completed automation history when switching accounts (completed/archived only; keeps configuration; backs up first)",
    "plugin.autoCleanupOn": "Enabled: completed automation history will be cleaned before the next switch, with a backup kept.",
    "plugin.autoCleanupOff": "Auto-clean disabled.",
    "footer.codexHome": "CODEX HOME",
    "footer.library": "Local project library",
    "footer.author": "Author email",
    "release.label": "Latest release record",
    "release.github": "GitHub Release",
    "release.meta": "Commit {commit} · Actions {run}",
    "language.chinese": "简体中文",
    "language.english": "English",
    "dialog.close": "Close",
    "dialog.closeTutorial": "Close tutorial",
    "dialog.closePlugins": "Close plugin manager",
    "dialog.finish": "Got it",
    "confirm.title": "Codex may still have a task running",
    "confirm.message": "Codex Desktop is detected as running.",
    "confirm.cancel": "Cancel and handle the task first",
    "confirm.continue": "Continue switching",
    "resume.copied": "Resume command copied.",
    "relay.copied": "{name} link copied. Paste it into your browser to open.",
    "bridge.notLoaded": "Desktop bridge is not loaded. Start this app through Codex Galaxy.",
    "diagnostics.title": "Local error log",
    "diagnostics.intro": "Galaxy records only operations, timestamps, error types, and redacted error messages. It does not record API keys, OAuth, chat text, or request bodies.",
    "diagnostics.loading": "Reading the local log…",
    "diagnostics.empty": "There is no error log yet. A failed switch or local operation will be recorded here automatically.",
    "diagnostics.path": "Log file",
    "diagnostics.refresh": "Refresh log",
    "diagnostics.open": "Open file",
    "diagnostics.copy": "Copy log",
    "diagnostics.copied": "Log copied. Check once more that you did not add any unredacted content before sending it.",
    "diagnostics.opened": "The local error log file was opened.",
    "diagnostics.truncated": "The log is long; only its latest section is shown.",
    "tutorial.title": "Safe switching guide",
    "tutorial.intro": "Projects and full chat history always stay in the same local Codex Home. Codex Galaxy switches login credentials, the API provider, and the local index needed to resume a project; it does not upload chats to another account. Current version: v1.9.7.",
    "tutorial.step1.title": "Save your first official account",
    "tutorial.step2.title": "Add one or more relay APIs",
    "tutorial.step3.title": "Step-by-step API ↔ official switching",
    "tutorial.step4.title": "Resume the original project",
    "tutorial.step5.title": "Use the gateway only when needed",
    "tutorial.step6.title": "Refresh projects and clean data",
    "tutorial.step7.title": "Recovery from errors",
    "tutorial.step8.title": "Upgrading Codex Galaxy",
    "tutorial.step9.title": "Plugins, images, and automation cleanup",
    "tutorial.step1.body": "<ol><li>Sign in normally in Codex Desktop and wait for its project list to load.</li><li>In Galaxy, click + and add an “Official Codex account”. You can rename it later.</li><li>Click Capture on that account. The login can only be restored after capture succeeds.</li></ol>",
    "tutorial.step2.body": "<ol><li>Click + and choose “Relay API”.</li><li>Enter a name, Base URL, and API Key. The model ID is optional; Galaxy can read the relay model catalog and remember a working model.</li><li>Every API account uses an independent pure-API login and does not require an official account. You can switch directly between multiple API accounts.</li><li>The relay must support the OpenAI Responses API. If model discovery is unavailable and no model was previously learned, enter the model ID manually.</li><li>API keys are encrypted locally and never shown in project records.</li></ol>",
    "tutorial.step3.body": "<ol><li>General preparation: finish the current Codex reply first. Switching is safe when Codex is idle; if the confirmation dialog appears, continue only after confirming that no reply is still running.</li><li>API → official: make sure the official profile is saved in Galaxy and has been captured. The first time, sign in to that official account in Codex, wait for the project list, then return to Galaxy and click Capture. Select the official profile and choose Switch and open Codex. If Windows shows setup or login, finish it in Codex, wait until the project list is normal, then return to Galaxy and click “Done, continue sync”.</li><li>Official → API: add or edit the API profile with Base URL, API Key, and an optional model ID; Direct API is recommended. Select the API profile and choose Switch and open Codex. Galaxy closes an idle Codex gracefully, waits for local writes, syncs the provider and project records, and opens Codex again. Direct API mode can run after Galaxy exits; Compatibility gateway mode requires Galaxy to remain running.</li><li>For either direction, wait until progress reaches 100%, then choose Continue in Codex from the project list. If switching fails, open Error log at the top, copy the redacted log and error text, and do not delete <code>config.toml</code>, <code>~/.codex</code>, or <code>~/.codex-galaxy</code>.</li></ol>",
    "tutorial.step4.body": "<ol><li>“View details” only previews the local thread in Galaxy and never changes accounts.</li><li>“Continue in Codex” switches or resynchronizes the selected account when needed, then restores that project in Codex.</li><li>After a restart, Galaxy merges rollout messages with user/assistant items already stored in the local <code>thread_history</code> SQLite database and de-duplicates them; thread details are not reduced to a short tail.</li><li>Historical messages are preserved across GPT, DeepSeek, and other compatible providers; new replies use the active provider.</li><li>An encrypted-state warning only means a different provider may not reuse hidden reasoning state. It does not delete chat or project files.</li></ol>",
    "tutorial.step5.body": "<p>In Direct API mode, Codex connects to the entered Base URL directly, so Galaxy can exit after switching without affecting Codex, authentication, or chat history. Only Compatibility gateway mode needs the Galaxy gateway; closing the main window minimizes it to the tray, and exiting safely hands the gateway to an independent background host.</p>",
    "tutorial.step6.body": "<ol><li>Refresh rebuilds the visible list from current Codex state and does not delete source data; Galaxy also performs one local project-library sync when the process starts.</li><li>Clean Data can remove explicitly archived/deleted projects and completed automation history only after creating a recoverable backup.</li><li>Galaxy never deletes user project folders or source code.</li></ol>",
    "tutorial.step7.body": "<ol><li>If switching fails, read the progress message and open Error log at the top to see the failure reason. Galaxy attempts to restore the previous credentials, provider, gateway, and current-account marker.</li><li>Only one Galaxy instance may switch accounts; stale locks from dead processes are reclaimed automatically.</li><li>DNS, TLS, proxy, upstream overload, and authentication errors originate outside the local project index. Error messages never include API keys or request bodies.</li><li>Copy the redacted log and error text from the diagnostics window when reporting a problem. If recovery is incomplete, do not delete <code>config.toml</code>, <code>~/.codex</code>, or <code>~/.codex-galaxy</code>.</li></ol>",
    "tutorial.step8.body": "<ol><li>Galaxy 1.9.7 checks the latest stable GitHub release at startup; the top update button can also check manually.</li><li>On Windows, one click downloads the exact installer, verifies its official Release URL and SHA-256, and starts setup. Finish active API-backed Codex work first because setup closes Galaxy and its local gateway.</li><li>The current macOS packages have no Apple Developer signature, so the update button only opens the project’s latest GitHub release page. Choose the Intel x64 or Apple Silicon arm64 DMG and follow macOS security prompts without bypassing Gatekeeper.</li><li>Install over the existing version; manual uninstall is unnecessary, and local profiles and records are retained.</li><li>Every future version must update the version surfaces, both READMEs, the Chinese and English guide, release notes, release metadata, tests, and installer artifacts together. The documentation check blocks incomplete releases.</li><li>For extra safety, back up <code>.codex-galaxy</code> locally and never upload it to Git.</li></ol>",
    "tutorial.step9.body": "<ol><li>The Plugins window installs local plugin folders or adds a marketplace. The remote public catalog requires an official ChatGPT login, so switch to a captured official account for that catalog. Users without an official account can still use independent local plugins.</li><li>Galaxy preserves image/file request fields. Actual multimodal support still depends on the relay and selected model.</li><li>Automation cleanup only removes completed/archived run history after backup. Its automatic switch-time option is off by default and is independent from project cleanup.</li></ol>",
  },
};

function getStoredLanguage() {
  try { return window.localStorage.getItem("codexGalaxyLanguage") || null; } catch { return null; }
}

function detectLanguage() {
  const stored = getStoredLanguage();
  if (stored === "zh-CN" || stored === "en") return stored;
  const nav = window.navigator.language || "";
  return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

let currentLanguage = detectLanguage();

function t(key, vars = {}) {
  const table = translations[currentLanguage] || translations["zh-CN"];
  let text = table[key] ?? translations["zh-CN"][key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-en-html]").forEach((element) => {
    if (element.defaultLanguageHtml === undefined) element.defaultLanguageHtml = element.innerHTML;
    element.innerHTML = currentLanguage === "en"
      ? t(element.dataset.i18nEnHtml)
      : element.defaultLanguageHtml;
  });
  $("#languageSelect").value = currentLanguage;
  renderProfiles();
  populateProjects();
  renderThreads();
  renderPlugins();
  updateStatusBoard();
  renderUpdateAction();
}

function setLanguage(language) {
  if (language !== "zh-CN" && language !== "en") return;
  currentLanguage = language;
  try { window.localStorage.setItem("codexGalaxyLanguage", language); } catch { /* storage unavailable */ }
  $("#languageSelect").value = language;
  applyLanguage();
}

function operationBusy() {
  return state.switching || state.refreshing || state.cleaning || state.repairing || Boolean(state.testingProfileId) || updateOperationBusy();
}

function updateOperationBusy(update = state.update) {
  return ["downloading", "ready", "installing"].includes(update?.phase);
}

function updateStatusPill() {
  $("#statusPill").textContent = state.switching
    ? t("status.switching")
    : state.refreshing
      ? t("status.refreshing")
      : state.cleaning
        ? t("status.cleaning")
        : state.repairing
          ? t("status.repairing")
        : updateOperationBusy()
          ? t("status.updating")
        : state.gatewayRunning
          ? t("status.gatewayRunning")
          : t("status.localProgram");
}

function updateOperationControls() {
  const busy = operationBusy();
  $("#syncBtn").disabled = busy;
  $("#cleanupBtn").disabled = busy;
  $("#pluginBtn").disabled = busy;
  $("#diagnosticsBtn").disabled = busy;
  $("#addProfileBtn").disabled = busy;
  $("#search").disabled = busy;
  $("#projectFilter").disabled = busy;
  renderUpdateAction();
  $("#profileForm").querySelectorAll("button, input, select").forEach((control) => { control.disabled = busy; });
  updateStatusPill();
  renderProfiles();
  renderThreads();
  if (state.selectedThread && $("#threadDialog").open) renderThreadDialog(state.selectedThread);
}

function renderUpdateAction() {
  const button = $("#updateBtn");
  if (!button) return;
  const update = state.update || {};
  const version = update.latestVersion || update.currentVersion || state.version;
  button.classList.toggle("available", update.available === true);
  button.title = update.error || (update.available ? t("update.availableNotice", { version }) : "");
  if (update.phase === "checking") button.textContent = t("update.checking");
  else if (update.phase === "downloading") button.textContent = t("update.downloading", { percent: Math.max(0, Math.min(100, Number(update.percent) || 0)) });
  else if (update.phase === "ready" || update.phase === "installing") button.textContent = t("update.starting");
  else if (update.available) button.textContent = update.action === "open-release"
    ? t("update.openMac", { version })
    : t("update.install", { version });
  else if (update.phase === "current") button.textContent = t("update.current");
  else if (update.phase === "error") button.textContent = t("update.retry");
  else button.textContent = t("update.check");
  button.disabled = state.switching
    || state.refreshing
    || state.cleaning
    || state.repairing
    || ["checking", "downloading", "ready", "installing"].includes(update.phase);
}

function applyUpdateStatus(status) {
  const wasBusy = updateOperationBusy(state.update);
  state.update = { ...state.update, ...(status || {}) };
  const isBusy = updateOperationBusy(state.update);
  if (wasBusy !== isBusy) updateOperationControls();
  else {
    renderUpdateAction();
    updateStatusPill();
  }
}

async function handleUpdateAction() {
  if (operationBusy() || state.update.phase === "checking") return;
  try {
    if (!state.update.available) {
      const status = unwrap(await bridge.checkUpdate());
      applyUpdateStatus(status);
      notice(status.available
        ? t("update.availableNotice", { version: status.latestVersion })
        : t("update.currentNotice", { version: status.currentVersion }));
      return;
    }
    const response = unwrap(await bridge.installUpdate(currentLanguage));
    if (response.cancelled) notice(t("update.cancelled"));
    else if (response.opened) notice(t("update.macOpened"));
    else if (response.current) notice(t("update.currentNotice", { version: response.status?.currentVersion || state.version }));
  } catch (error) {
    notice(error.message, true);
  }
}

async function loadDiagnostics() {
  const snapshot = unwrap(await bridge.getDiagnosticLog());
  state.diagnostics = {
    path: String(snapshot.path || ""),
    text: String(snapshot.text || ""),
    bytes: Number(snapshot.bytes) || 0,
    truncated: snapshot.truncated === true,
  };
  $("#diagnosticsPath").textContent = state.diagnostics.path || t("common.unknown");
  const text = state.diagnostics.text || t("diagnostics.empty");
  $("#diagnosticsText").textContent = state.diagnostics.truncated
    ? `${t("diagnostics.truncated")}\n\n${text}`
    : text;
}

async function openDiagnostics() {
  if (operationBusy()) return;
  if (!bridge) return notice(t("bridge.notLoaded"), true);
  $("#diagnosticsDialog").showModal();
  $("#diagnosticsText").textContent = t("diagnostics.loading");
  try {
    await loadDiagnostics();
  } catch (error) {
    $("#diagnosticsText").textContent = error.message;
    notice(error.message, true);
  }
}

async function copyDiagnostics() {
  if (!state.diagnostics.text) return notice(t("diagnostics.empty"), true);
  try {
    unwrap(await bridge.copyText(state.diagnostics.text));
    notice(t("diagnostics.copied"));
  } catch (error) {
    notice(error.message, true);
  }
}

async function openDiagnosticsFile() {
  try {
    unwrap(await bridge.openDiagnosticLog());
    notice(t("diagnostics.opened"));
  } catch (error) {
    notice(error.message, true);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function notice(message, error = false) {
  const element = $("#notice");
  element.textContent = message;
  element.hidden = false;
  element.className = `notice${error ? " error" : ""}`;
  window.clearTimeout(notice.timer);
  notice.timer = window.setTimeout(() => { element.hidden = true; }, 6500);
}

function unwrap(response) {
  if (!response?.ok) throw new Error(response?.error || t("common.localError"));
  return response.value;
}

function formatDate(value) {
  if (!value) return t("common.timeUnknown");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function selectedProfile() {
  return state.profiles.find((profile) => profile.id === state.selectedProfileId) || null;
}

function updateStatusBoard() {
  const current = state.profiles.find((profile) => profile.id === state.currentId);
  const running = state.codexRunning ? t("common.running") : t("common.notRunning");
  $("#statusProfile").textContent = current?.name || t("common.notSelected");
  $("#statusLoginMode").textContent = current ? profileLoginModeLabel(current) : t("common.notSelected");
  $("#statusModel").textContent = current ? profileModelLabel(current) : t("common.notSelected");
  $("#statusGateway").textContent = state.gatewayRunning ? t("common.running") : t("common.notRunning");
  $("#statusCodex").textContent = t("status.codexSummary", {
    running,
    provider: state.codexProvider || t("common.providerNotConfigured"),
  });
  $("#libraryMeta").textContent = t("threads.summary", {
    count: state.threads.length,
    time: state.librarySyncedAt ? formatDate(state.librarySyncedAt) : t("common.notSynced"),
  });
  updateStatusPill();
}

function renderReleaseRecord() {
  const release = state.releases[0];
  const version = $("#releaseRecordVersion");
  const link = $("#releaseRecordLink");
  const meta = $("#releaseRecordMeta");
  if (!version || !link || !meta) return;
  if (!release) {
    version.textContent = t("common.none");
    link.hidden = true;
    meta.textContent = "";
    return;
  }
  version.textContent = release.tag || `v${release.version}`;
  link.hidden = false;
  link.href = release.url;
  meta.textContent = t("release.meta", {
    commit: release.commit ? String(release.commit).slice(0, 7) : t("release.local"),
    run: release.actionsRun || t("common.unknown"),
  });
}

function profileModelLabel(profile) {
  if (!profile.model) return profile.resolvedModel ? `${t("profile.modelAutoPrefix")} → ${profile.resolvedModel}` : t("profile.modelAuto");
  return profile.resolvedModel && profile.resolvedModel !== profile.model
    ? `${profile.model} → ${profile.resolvedModel}`
    : profile.model;
}

function profileLoginModeLabel(profile) {
  if (profile.kind === "official") return t("profile.loginMode.official");
  return profile.runtimeMode === "gateway"
    ? `${t("profile.loginMode.pure")} · ${t("profileForm.gateway")}`
    : `${t("profile.loginMode.pure")} · ${t("profileForm.direct")}`;
}

function profileTestLabel(profile) {
  if (profile.kind !== "api") return "";
  const test = profile.lastTest;
  if (!test?.status) return t("profile.testNever");
  const labels = {
    ok: currentLanguage === "en" ? "Connected" : "连接成功",
    auth: t("profile.testAuth"),
    "not-found": t("profile.testNotFound"),
    server: t("profile.testServer"),
    network: t("profile.testNetwork"),
    unsupported: t("profile.testUnsupported"),
    invalid: t("profile.testUnsupported"),
  };
  const status = labels[test.status] || t("profile.testNetwork");
  return `${t("profile.recentTest")} · ${status}${test.httpStatus ? ` (${test.httpStatus})` : ""} · ${formatDate(test.testedAt)}`;
}

function renderProfiles() {
  const root = $("#profiles");
  const disabled = operationBusy() ? " disabled" : "";
  if (!state.profiles.length) {
    root.innerHTML = `<div class="empty">${t("profile.empty")}</div>`;
  } else {
    root.innerHTML = state.profiles.map((profile) => {
      const selected = profile.id === state.selectedProfileId;
      const current = profile.id === state.currentId;
      return `<div class="profile-item${selected ? " selected" : ""}${current ? " current" : ""}" data-action="select" data-id="${escapeHtml(profile.id)}" tabindex="0" role="radio" aria-checked="${selected}">
        <span class="choice-indicator"></span>
        <div class="profile-main">
          <span class="profile-dot ${profile.kind}"></span>
          <div class="profile-copy">
            <div class="profile-name">${escapeHtml(profile.name)}</div>
            <div class="profile-kind">${profile.kind === "official" ? t("profile.kind.official") : `${t("profile.kind.api")} · ${profileLoginModeLabel(profile)} · ${t(profile.hasApiKey ? "profile.keySaved" : "profile.keyMissing")}`}</div>
            ${profile.kind === "api" ? `<div class="profile-endpoint" title="${escapeHtml(profile.baseUrl || "")}">${escapeHtml(t("profile.baseUrl"))}: ${escapeHtml(profile.baseUrl || t("common.unknown"))}</div><div class="profile-test ${escapeHtml(profile.lastTest?.status || "never")}">${escapeHtml(profileTestLabel(profile))}</div>` : ""}
            <div class="profile-model">${escapeHtml(profileModelLabel(profile))}</div>
          </div>
        </div>
        <div class="profile-actions">
          ${current ? `<span class="profile-status">${t("common.current")}</span>` : ""}
          <button data-action="edit" data-id="${escapeHtml(profile.id)}" title="${t("profile.editTitle")}" aria-label="${t("profile.editTitle")} ${escapeHtml(profile.name)}"${disabled}>${t("common.edit")}</button>
          ${profile.kind === "official" ? `<button data-action="capture" data-id="${escapeHtml(profile.id)}" title="${t("profile.captureTitle")}"${disabled}>${t("common.capture")}</button>` : `<button data-action="test" data-id="${escapeHtml(profile.id)}" title="${t("profile.testTitle")}"${disabled}>${state.testingProfileId === profile.id ? t("profile.testRunning") : t("common.test")}</button><button data-action="clear-key" data-id="${escapeHtml(profile.id)}" title="${current ? t("profile.currentCannotClear") : profile.hasApiKey ? t("common.clearKey") : t("profile.actions.noKey")}"${disabled || current || !profile.hasApiKey ? " disabled" : ""}>${t("common.clearKey")}</button>`}
          <button data-action="delete" data-id="${escapeHtml(profile.id)}" title="${current ? t("profile.currentCannotDelete") : t("profile.deleteTitle")}"${disabled || current ? " disabled" : ""}>${t("common.delete")}</button>
        </div>
      </div>`;
    }).join("");
  }

  const selected = selectedProfile();
  $("#selectedProfileName").textContent = selected?.name || t("common.pleaseSelect");
  $("#selectedProfileModel").textContent = selected ? `${profileLoginModeLabel(selected)} · ${profileModelLabel(selected)}` : t("common.selectToSwitch");
  $("#switchOpenBtn").disabled = !selected || operationBusy();
  $("#switchOpenBtn").textContent = selected?.id === state.currentId ? t("switching.resyncText") : t("switching.openText");
  const current = state.profiles.find((profile) => profile.id === state.currentId);
  $("#currentProfileName").textContent = current?.name || t("common.notSelected");
}

function renderThreads() {
  const query = $("#search").value.trim().toLowerCase();
  const project = $("#projectFilter").value;
  const disabled = operationBusy() ? " disabled" : "";
  const filtered = state.threads.filter((thread) => {
    const text = `${thread.title} ${thread.cwd || ""} ${thread.provider || ""} ${(thread.accounts || []).join(" ")}`.toLowerCase();
    return (!query || text.includes(query)) && (!project || (thread.cwd || "") === project);
  });
  $("#threadCount").textContent = `${filtered.length} ${t("threads.count")}`;
  const root = $("#threads");
  if (!filtered.length) {
    root.innerHTML = `<div class="empty">${t("threads.empty")}</div>`;
    return;
  }
  root.innerHTML = filtered.map((thread) => `<article class="thread-item">
    <div class="thread-icon">↗</div>
    <div class="thread-body"><p class="thread-title">${escapeHtml(thread.title || t("common.unnamedThread"))}</p><div class="thread-meta"><span>${escapeHtml(thread.cwd || t("common.noProjectDir"))}</span><span>${escapeHtml(thread.provider || t("common.providerUnrecorded"))}</span><span>${formatDate(thread.updatedAt)}</span></div></div>
    <div class="thread-actions"><button data-action="detail" data-id="${escapeHtml(thread.id)}" title="${t("threads.detailTitle")}" aria-label="${t("threads.detailTitle")}"${disabled}>${t("threads.detail")}</button><button data-action="launch" data-id="${escapeHtml(thread.id)}" title="${t("threads.launchTitle")}" aria-label="${t("threads.launchDetail")}"${disabled}>${t("threads.launch")}</button></div>
  </article>`).join("");
}

function populateProjects() {
  const previous = $("#projectFilter").value;
  const values = [...new Set(state.threads.map((thread) => thread.cwd).filter(Boolean))].sort();
  $("#projectFilter").innerHTML = `<option value="">${t("common.allProjects")}</option>` + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if (values.includes(previous)) $("#projectFilter").value = previous;
}

async function refresh() {
  const snapshot = unwrap(await bridge.getState());
  state.version = String(snapshot.version || state.version);
  $("#appVersionInline").textContent = state.version;
  state.currentId = snapshot.profiles.currentId;
  state.profiles = snapshot.profiles.profiles;
  state.threads = snapshot.library.threads;
  state.plugins = snapshot.plugins || [];
  state.automation = snapshot.automation || state.automation;
  state.releases = Array.isArray(snapshot.releases) ? snapshot.releases : [];
  state.update = snapshot.update || state.update;
  state.gatewayRunning = Boolean(snapshot.gateway?.running);
  state.codexRunning = Boolean(snapshot.codex.running);
  state.codexProvider = snapshot.codex.provider || null;
  state.librarySyncedAt = snapshot.library.syncedAt || null;
  if (!state.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId = state.currentId || state.profiles[0]?.id || null;
  }
  $("#codexHome").textContent = snapshot.codex.home;
  applyLanguage();
  renderReleaseRecord();
  if (snapshot.gateway?.error && snapshot.gateway.error !== state.gatewayError) {
    notice(t("gateway.localFailed", { error: snapshot.gateway.error }), true);
  }
  state.gatewayError = snapshot.gateway?.error || null;
}

function renderPlugins() {
  const root = $("#pluginList");
  if (!root) return;
  if (!state.plugins.length) {
    root.innerHTML = `<div class="empty">${t("plugin.empty")}</div>`;
    return;
  }
  root.innerHTML = state.plugins.map((plugin) => `<div class="message event"><strong>${escapeHtml(plugin.name)}</strong> <small>v${escapeHtml(plugin.version)}</small><br><code>${escapeHtml(plugin.path)}</code></div>`).join("");
}

function openPlugins() {
  if (operationBusy()) return;
  renderPlugins();
  $("#autoCleanupCompleted").checked = state.automation.settings?.autoCleanCompleted === true;
  $("#pluginDialog").showModal();
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setCleaning(value) {
  state.cleaning = value;
  const projectsAvailable = Number(state.cleanupPreview?.projects?.projects || 0) > 0;
  const automationsAvailable = Number(state.cleanupPreview?.automations?.files?.length || 0) > 0
    || Number(state.cleanupPreview?.automations?.rows || 0) > 0;
  $("#cleanupProjects").disabled = value || !projectsAvailable;
  $("#cleanupAutomations").disabled = value || !automationsAvailable;
  $("#runCleanup").disabled = value || (!$("#cleanupProjects").checked && !$("#cleanupAutomations").checked);
  $("#cancelCleanup").disabled = value;
  $("#closeCleanup").disabled = value;
  updateOperationControls();
}

function updateCleanupAction() {
  $("#runCleanup").disabled = state.cleaning || (!$("#cleanupProjects").checked && !$("#cleanupAutomations").checked);
}

function updateCleanupProgress({ percent = 0, message = t("cleanup.progress") }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  $("#cleanupProgress").hidden = false;
  $("#cleanupProgressMessage").textContent = message;
  $("#cleanupProgressPercent").textContent = `${value}%`;
  $("#cleanupProgressBar").value = value;
}

async function openCleanup() {
  if (operationBusy()) return;
  const dialog = $("#cleanupDialog");
  state.cleanupPreview = null;
  $("#cleanupProjectsMeta").textContent = t("cleanup.scanning");
  $("#cleanupAutomationsMeta").textContent = t("cleanup.scanning");
  $("#cleanupWarning").textContent = t("cleanup.scanningDetail");
  $("#cleanupProgress").hidden = true;
  $("#cleanupProjects").disabled = true;
  $("#cleanupAutomations").disabled = true;
  $("#runCleanup").disabled = true;
  dialog.showModal();
  try {
    const preview = unwrap(await bridge.dataCleanupPreview());
    state.cleanupPreview = preview;
    const projects = preview.projects;
    const automations = preview.automations;
    $("#cleanupProjectsMeta").textContent = projects.projects
      ? t("cleanup.projectsMeta", { count: projects.projects, files: projects.files, size: formatBytes(projects.bytes), rows: projects.databaseRows })
      : t("cleanup.noProjects");
    $("#cleanupAutomationsMeta").textContent = automations.files.length || automations.rows
      ? t("cleanup.automationsMeta", { files: automations.files.length, rows: automations.rows || 0, size: formatBytes(automations.bytes) })
      : t("cleanup.noAutomations");
    $("#cleanupProjects").disabled = !projects.projects;
    $("#cleanupProjects").checked = projects.projects > 0;
    $("#cleanupAutomations").disabled = !automations.files.length && !automations.rows;
    $("#cleanupAutomations").checked = false;
    $("#cleanupWarning").textContent = preview.codexRunning && projects.projects
      ? t("cleanup.warningRunning")
      : t("cleanup.warningSafe");
    updateCleanupAction();
  } catch (error) {
    $("#cleanupWarning").textContent = t("cleanup.scanFailed", { message: error.message });
    notice(error.message, true);
  }
}

async function runCleanup() {
  if (operationBusy()) return;
  const projects = $("#cleanupProjects").checked;
  const automations = $("#cleanupAutomations").checked;
  if (!projects && !automations) return;
  state.cleanupOperationId = crypto.randomUUID();
  setCleaning(true);
  updateCleanupProgress({ percent: 1, message: t("cleanup.prepare") });
  try {
    const result = unwrap(await bridge.dataCleanup({ projects, automations, operationId: state.cleanupOperationId }));
    updateCleanupProgress({ percent: 100, message: t("cleanup.done") });
    const projectCount = result.projects?.projects || 0;
    const automationRows = result.automations?.rows || 0;
    const automation = result.automations
      ? t("cleanup.automationNotice", { files: result.automations.files || 0, rows: automationRows })
      : "";
    notice(t("cleanup.doneNotice", { count: projectCount, automation }), false);
    await refresh();
    window.setTimeout(() => $("#cleanupDialog").open && $("#cleanupDialog").close(), 1200);
  } catch (error) {
    updateCleanupProgress({ percent: 0, message: t("cleanup.failed", { message: error.message }) });
    notice(error.message, true);
  } finally {
    state.cleanupOperationId = null;
    setCleaning(false);
  }
}

async function sync() {
  if (operationBusy()) return;
  state.refreshOperationId = crypto.randomUUID();
  setRefreshing(true);
  updateRefreshProgress({ percent: 1, message: t("refresh.preparing"), completed: 0, total: 0 });
  try {
    const synced = unwrap(await bridge.sync(state.refreshOperationId));
    updateRefreshProgress({ percent: 100, message: t("refresh.done", { count: synced.threads }), completed: synced.threads, total: synced.threads });
    notice(t("refresh.doneNotice", { count: synced.threads }));
    await refresh();
  } catch (error) {
    updateRefreshProgress({ percent: 0, message: t("refresh.failed", { message: error.message }), completed: 0, total: 0 });
    notice(error.message, true);
  } finally {
    state.refreshOperationId = null;
    setRefreshing(false);
  }
}

function updateRefreshProgress({ percent = 0, message = t("refresh.progress"), completed = 0, total = 0 }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const root = $("#refreshProgress");
  root.hidden = false;
  $("#refreshProgressMessage").textContent = message;
  $("#refreshProgressPercent").textContent = `${value}%`;
  $("#refreshProgressBar").value = value;
  $("#refreshProgressCount").textContent = total
    ? t("refresh.processing", { done: completed, total })
    : value === 100
      ? t("refresh.completed")
      : t("refresh.detecting");
  window.clearTimeout(updateRefreshProgress.timer);
  if (value === 100) updateRefreshProgress.timer = window.setTimeout(() => { root.hidden = true; }, 6500);
}

function updateProgress({ percent = 0, message = t("switching.progress") }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  $("#switchProgress").hidden = false;
  $("#progressMessage").textContent = message;
  $("#progressPercent").textContent = `${value}%`;
  $("#progressBar").value = value;
}

function closeSwitchConfirmation(confirmed) {
  const requestId = state.switchConfirmation;
  if (!requestId) return;
  state.switchConfirmation = null;
  const dialog = $("#switchConfirmDialog");
  if (dialog.open) dialog.close();
  bridge.respondSwitchConfirmation(requestId, confirmed === true);
}

function showSwitchConfirmation(request) {
  if (!request?.requestId) return;
  const dialog = $("#switchConfirmDialog");
  if (dialog.open) dialog.close();
  state.switchConfirmation = request.requestId;
  $("#continueSwitchConfirm").hidden = request.canContinue === false;
  $("#switchConfirmTitle").textContent = request.title || t("confirm.title");
  $("#switchConfirmMessage").textContent = request.message || t("confirm.message");
  $("#switchConfirmDetail").textContent = request.detail || "";
  dialog.showModal();
  $("#cancelSwitchConfirm").focus();
}

function setSwitching(value) {
  state.switching = value;
  updateOperationControls();
}

function setRefreshing(value) {
  state.refreshing = value;
  updateOperationControls();
}

function setRepairing(value) {
  state.repairing = value;
  updateOperationControls();
}

async function switchAccount(profileId, threadId = null) {
  if (operationBusy()) return;
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return notice(t("switching.pleaseSelectAccount"), true);
  if (profile.kind === "api" && !profile.hasApiKey) return notice(t("profile.switchMissingKey"), true);
  state.switchOperationId = crypto.randomUUID();
  setSwitching(true);
  updateProgress({ percent: 1, message: t("switching.to", { name: profile.name }) });
  try {
    const response = threadId
      ? unwrap(await bridge.switchAndLaunch(profileId, threadId, state.switchOperationId))
      : unwrap(await bridge.switchProfile(profileId, state.switchOperationId));
    if (response.cancelled) {
      updateProgress({ percent: 0, message: t("switching.cancelledProgress") });
      notice(t("switching.cancelledNotice"), false);
      return;
    }
    updateProgress({ percent: 100, message: threadId ? t("switching.doneThread") : t("switching.doneSwitch") });
    const loginMode = profileLoginModeLabel(profile);
    notice(t("switching.doneNotice", { name: profile.name, loginMode }));
    await refresh();
  } catch (error) {
    updateProgress({ percent: 0, message: t("switching.failed", { message: error.message }) });
    notice(error.message, true);
  } finally {
    state.switchOperationId = null;
    setSwitching(false);
  }
}

function threadHealthBlocksResume(thread) {
  return ["repairable", "blocked"].includes(thread?.health?.status);
}

function threadHealthMessage(thread) {
  const health = thread?.health || { status: "unavailable" };
  if (health.status === "healthy") return t("threads.healthHealthy");
  if (health.status === "repairable") {
    const message = health.repairSource === "galaxy-backup"
      ? t("threads.healthRepairBackup")
      : t("threads.healthRepairRollout");
    return `${message}${state.codexRunning ? t("threads.healthRepairRunning") : ""}`;
  }
  if (health.status === "blocked" && health.issue === "thread-mismatch") return t("threads.healthBlockedMismatch");
  if (health.status === "blocked" && ["empty", "missing-metadata"].includes(health.issue)) return t("threads.healthBlockedMissing");
  if (health.status === "blocked") return t("threads.healthBlocked");
  return t("threads.healthUnavailable");
}

function renderThreadDialog(thread) {
  $("#dialogTitle").textContent = thread.title || t("common.unnamedThread");
  $("#dialogMeta").textContent = `${thread.cwd || t("common.noProjectDir")} · ${thread.provider || t("common.providerUnrecorded")} · ${formatDate(thread.updatedAt)}`;
  const health = $("#dialogHealth");
  health.className = `thread-health ${thread.health?.status || "unavailable"}`;
  health.textContent = threadHealthMessage(thread);
  const compatibility = $("#dialogCompatibility");
  compatibility.hidden = !thread.compatibility?.encryptedContent;
  compatibility.textContent = thread.compatibility?.encryptedContent
    ? t("threads.dialogCompatibility")
    : "";
  $("#dialogMessages").innerHTML = (thread.messages || []).map((message) => `<div class="message ${escapeHtml(message.role)}"><div class="message-label">${escapeHtml(message.role)} · ${formatDate(message.timestamp)}</div>${escapeHtml(message.content)}</div>`).join("") || `<div class="empty">${t("threads.messagesEmpty")}</div>`;
  const blocked = threadHealthBlocksResume(thread);
  const disabled = blocked || operationBusy() ? " disabled" : "";
  $("#resumeProfiles").innerHTML = state.profiles.map((profile) => `<button data-profile-id="${escapeHtml(profile.id)}"${disabled}>${escapeHtml(profile.name)}<small>${escapeHtml(profileModelLabel(profile))}</small></button>`).join("") || `<span class="empty">${t("threads.addAccountFirst")}</span>`;
  const repairButton = $("#repairThreadBtn");
  repairButton.hidden = thread.health?.status !== "repairable";
  repairButton.disabled = state.repairing || state.switching || state.refreshing || state.cleaning || updateOperationBusy();
  repairButton.textContent = state.repairing ? t("threads.repairing") : t("threads.repair");
  $("#launchBtn").disabled = blocked || operationBusy();
  $("#copyResumeBtn").disabled = blocked || operationBusy();
}

async function showThread(id) {
  const thread = unwrap(await bridge.getThread(id));
  state.selectedThread = thread;
  renderThreadDialog(thread);
  $("#threadDialog").showModal();
}

async function repairSelectedThread() {
  if (!state.selectedThread || operationBusy()) return;
  setRepairing(true);
  try {
    const repaired = unwrap(await bridge.repairThread(state.selectedThread.id));
    state.selectedThread = repaired.thread;
    state.codexRunning = false;
    renderThreadDialog(state.selectedThread);
    notice(t(repaired.warning ? "threads.repairedWithWarning" : "threads.repaired", {
      path: repaired.backupFile,
      warning: repaired.warning || "",
    }), Boolean(repaired.warning));
  } catch (error) {
    notice(error.message, true);
  } finally {
    setRepairing(false);
  }
}

async function launch(id) {
  if (operationBusy()) return;
  const profileId = state.selectedProfileId || state.currentId;
  const profile = state.profiles.find((item) => item.id === profileId);
  if (profileId && (profileId !== state.currentId || profile?.kind === "api")) return switchAccount(profileId, id);
  try {
    const launched = unwrap(await bridge.launchThread(id));
    notice(t("threads.launched", { model: launched.model }));
  } catch (error) {
    notice(error.message, true);
  }
}

function updateProfileFields() {
  const isApi = $("#profileForm [name=kind]").value === "api";
  document.querySelectorAll("#profileForm .api-field").forEach((field) => { field.hidden = !isApi; });
  $("#profileForm [name=model]").required = !isApi;
}

function openProfileForm(profile = null) {
  const form = $("#profileForm");
  form.reset();
  state.editingProfileId = profile?.id || null;
  form.elements.id.value = profile?.id || "";
  form.elements.name.value = profile?.name || "";
  form.elements.kind.value = profile?.kind || "official";
  form.elements.runtimeMode.value = profile?.runtimeMode || "direct";
  form.elements.baseUrl.value = profile?.baseUrl || "";
  form.elements.apiKey.value = "";
  form.elements.model.value = profile?.model || "";
  $("#profileFormTitle").textContent = profile ? t("profile.editTitle") : t("profile.addTitle");
  form.hidden = false;
  $("#addProfileBtn").hidden = true;
  updateProfileFields();
  form.elements.name.focus();
}

async function testProfile(id) {
  if (operationBusy()) return;
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile || profile.kind !== "api") return;
  if (!profile.hasApiKey) return notice(t("profile.switchMissingKey"), true);
  state.testingProfileId = id;
  updateOperationControls();
  try {
    const result = unwrap(await bridge.testProfile(id));
    notice(result.status === "ok"
      ? t("profile.testOk", { name: profile.name })
      : t("profile.testFailed", { name: profile.name, message: result.message || t("profile.testNetwork") }), result.status !== "ok");
    await refresh();
  } catch (error) {
    notice(t("profile.testFailed", { name: profile.name, message: error.message }), true);
  } finally {
    state.testingProfileId = null;
    updateOperationControls();
  }
}

async function clearProfileKey(id) {
  if (operationBusy()) return;
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile || profile.kind !== "api") return;
  if (profile.id === state.currentId) return notice(t("profile.currentCannotClear"), true);
  if (!window.confirm(t("profile.clearKeyConfirm", { name: profile.name }))) return;
  try {
    unwrap(await bridge.clearProfileKey(id));
    notice(t("profile.keyCleared", { name: profile.name }));
    await refresh();
  } catch (error) { notice(error.message, true); }
}

async function deleteProfile(id) {
  if (operationBusy()) return;
  const profile = state.profiles.find((item) => item.id === id);
  if (!profile) return;
  if (profile.id === state.currentId) return notice(t("profile.currentCannotDelete"), true);
  if (!window.confirm(t("profile.deleteConfirm", { name: profile.name }))) return;
  try {
    unwrap(await bridge.deleteProfile(id));
    if (state.selectedProfileId === id) state.selectedProfileId = state.currentId;
    notice(t("profile.deleted"));
    await refresh();
  } catch (error) { notice(error.message, true); }
}

function closeProfileForm() {
  state.editingProfileId = null;
  $("#profileForm").hidden = true;
  $("#addProfileBtn").hidden = false;
}

$("#syncBtn").addEventListener("click", sync);
$("#updateBtn").addEventListener("click", handleUpdateAction);
$("#languageSelect").addEventListener("change", (event) => setLanguage(event.currentTarget.value));
$("#tutorialBtn").addEventListener("click", () => $("#tutorialDialog").showModal());
$("#pluginBtn").addEventListener("click", openPlugins);
$("#diagnosticsBtn").addEventListener("click", openDiagnostics);
$("#closeTutorial").addEventListener("click", () => $("#tutorialDialog").close());
$("#finishTutorial").addEventListener("click", () => $("#tutorialDialog").close());
$("#closePlugins").addEventListener("click", () => $("#pluginDialog").close());
$("#finishPlugins").addEventListener("click", () => $("#pluginDialog").close());
$("#closeDiagnostics").addEventListener("click", () => $("#diagnosticsDialog").close());
$("#refreshDiagnostics").addEventListener("click", async () => {
  try {
    await loadDiagnostics();
  } catch (error) {
    notice(error.message, true);
  }
});
$("#openDiagnosticsFile").addEventListener("click", openDiagnosticsFile);
$("#copyDiagnostics").addEventListener("click", copyDiagnostics);
$("#autoCleanupCompleted").addEventListener("change", async (event) => {
  if (operationBusy()) return;
  try {
    state.automation.settings = unwrap(await bridge.automationSettings({ autoCleanCompleted: event.currentTarget.checked }));
    notice(event.currentTarget.checked ? t("plugin.autoCleanupOn") : t("plugin.autoCleanupOff"), false);
  } catch (error) { event.currentTarget.checked = !event.currentTarget.checked; notice(error.message, true); }
});
$("#cleanupBtn").addEventListener("click", openCleanup);
$("#closeCleanup").addEventListener("click", () => !state.cleaning && $("#cleanupDialog").close());
$("#cancelCleanup").addEventListener("click", () => !state.cleaning && $("#cleanupDialog").close());
$("#runCleanup").addEventListener("click", runCleanup);
$("#cleanupProjects").addEventListener("change", updateCleanupAction);
$("#cleanupAutomations").addEventListener("change", updateCleanupAction);
$("#cleanupDialog").addEventListener("cancel", (event) => {
  if (state.cleaning) event.preventDefault();
});
$("#installLocalPlugin").addEventListener("click", async () => {
  if (operationBusy()) return;
  try {
    const result = unwrap(await bridge.installLocalPlugin());
    if (!result.cancelled) {
      notice(t("plugin.installed", { name: result.installed.name }));
      await refresh();
      renderPlugins();
    }
  } catch (error) { notice(error.message, true); }
});
$("#expandPluginMarketplace").addEventListener("click", async () => {
  if (operationBusy()) return;
  try {
    const result = unwrap(await bridge.expandPluginMarketplace());
    if (result.cancelled) return;
    const count = Array.isArray(result.installed) ? result.installed.length : 0;
    notice(count ? t("plugin.marketplaceExpanded", { count }) : t("plugin.marketplaceEmpty"), !count);
    await refresh();
    renderPlugins();
  } catch (error) { notice(error.message, true); }
});
$("#addMarketplace").addEventListener("click", async () => {
  if (operationBusy()) return;
  const source = $("#marketplaceSource").value.trim();
  if (!source) return notice(t("plugin.marketplaceRequired"), true);
  try {
    unwrap(await bridge.addPluginMarketplace(source));
    notice(t("plugin.marketplaceAdded"), false);
    $("#marketplaceSource").value = "";
  } catch (error) { notice(error.message, true); }
});
$("#search").addEventListener("input", renderThreads);
$("#projectFilter").addEventListener("change", renderThreads);
$("#addProfileBtn").addEventListener("click", () => openProfileForm());
$("#cancelProfileBtn").addEventListener("click", closeProfileForm);
$("#profileForm [name=kind]").addEventListener("change", updateProfileFields);
$("#switchOpenBtn").addEventListener("click", () => state.selectedProfileId && switchAccount(state.selectedProfileId));
$("#closeDialog").addEventListener("click", () => $("#threadDialog").close());
$("#cancelSwitchConfirm").addEventListener("click", () => closeSwitchConfirmation(false));
$("#continueSwitchConfirm").addEventListener("click", () => closeSwitchConfirmation(true));
$("#switchConfirmDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSwitchConfirmation(false);
});
$("#switchConfirmDialog").addEventListener("close", () => {
  if (state.switchConfirmation) closeSwitchConfirmation(false);
});

$("#copyResumeBtn").addEventListener("click", async () => {
  if (!state.selectedThread || threadHealthBlocksResume(state.selectedThread) || operationBusy()) return;
  const profile = selectedProfile() || state.profiles.find((item) => item.id === state.currentId);
  const model = profile?.model ? ` --model "${profile.model}"` : "";
  unwrap(await bridge.copyText(`codex resume "${state.selectedThread.id}"${model}`));
  notice(t("resume.copied"));
});
$("#repairThreadBtn").addEventListener("click", repairSelectedThread);

document.querySelectorAll(".relay-copy").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      if (!bridge) throw new Error(t("bridge.notLoaded"));
      unwrap(await bridge.copyText(button.dataset.copy));
      button.classList.add("copied");
      window.clearTimeout(button.copyTimer);
      button.copyTimer = window.setTimeout(() => button.classList.remove("copied"), 1800);
      notice(t("relay.copied", { name: button.dataset.name }));
    } catch (error) {
      notice(error.message, true);
    }
  });
});

$("#launchBtn").addEventListener("click", () => state.selectedThread && launch(state.selectedThread.id));
$("#resumeProfiles").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-profile-id]");
  if (button && state.selectedThread && !threadHealthBlocksResume(state.selectedThread)) switchAccount(button.dataset.profileId, state.selectedThread.id);
});

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const saved = unwrap(await bridge.saveProfile(Object.fromEntries(new FormData(event.currentTarget))));
    state.selectedProfileId = saved.profile.id;
    closeProfileForm();
    notice(saved.profile.kind === "official" && !saved.profile.hasAuthSnapshot
      ? t("profile.savedOfficial")
      : t("profile.saved"));
    await refresh();
  } catch (error) {
    notice(error.message, true);
  }
});

$("#profiles").addEventListener("keydown", (event) => {
  if (!operationBusy() && (event.key === "Enter" || event.key === " ") && event.target.matches('[data-action="select"]')) {
    event.preventDefault();
    state.selectedProfileId = event.target.dataset.id;
    renderProfiles();
  }
});

$("#profiles").addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]");
  if (!action || operationBusy()) return;
  const id = action.dataset.id;
  if (action.dataset.action === "select") {
    state.selectedProfileId = id;
    renderProfiles();
    return;
  }
  event.stopPropagation();
  const profile = state.profiles.find((item) => item.id === id);
  if (action.dataset.action === "edit" && profile) return openProfileForm(profile);
  if (action.dataset.action === "test") return testProfile(id);
  if (action.dataset.action === "clear-key") return clearProfileKey(id);
  if (action.dataset.action === "delete") return deleteProfile(id);
  if (action.dataset.action === "capture") {
    try {
      unwrap(await bridge.captureProfile(id));
      notice(t("profile.captured"), false);
      await refresh();
    } catch (error) {
      notice(error.message, true);
    }
  }
});

$("#threads").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || operationBusy()) return;
  if (button.dataset.action === "detail") showThread(button.dataset.id).catch((error) => notice(error.message, true));
  if (button.dataset.action === "launch") launch(button.dataset.id);
});

applyLanguage();

if (!bridge) {
  notice(t("bridge.notLoaded"), true);
} else {
  bridge.onSwitchProgress((progress) => {
    if (progress.operationId === state.switchOperationId) updateProgress(progress);
  });
  bridge.onSyncProgress((progress) => {
    if (progress.operationId === state.refreshOperationId) updateRefreshProgress(progress);
  });
  bridge.onCleanupProgress((progress) => {
    if (progress.operationId === state.cleanupOperationId) updateCleanupProgress(progress);
  });
  bridge.onUpdateStatus(applyUpdateStatus);
  bridge.onSwitchConfirmation(showSwitchConfirmation);
  refresh().catch((error) => notice(error.message, true));
}
