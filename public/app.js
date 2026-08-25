const $ = (selector) => document.querySelector(selector);
const state = {
  profiles: [],
  version: "1.3.1",
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
  refreshing: false,
  cleaning: false,
  gatewayRunning: false,
  gatewayError: null,
  codexRunning: false,
  codexProvider: null,
  librarySyncedAt: null,
  plugins: [],
  automation: { settings: { autoCleanCompleted: false }, completedFiles: 0, completedBytes: 0 },
};
const bridge = window.codexGalaxy;

const translations = {
  "zh-CN": {
    "status.connecting": "连接中",
    "status.switching": "切换中",
    "status.refreshing": "刷新中",
    "status.cleaning": "清理中",
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
    "common.current": "当前",
    "common.none": "无",
    "common.unknown": "未知",
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
    "actions.refresh": "刷新项目",
    "actions.refreshTitle": "重新扫描本机 Codex 项目记录",
    "page.title": "账号与项目",
    "status.boardLabel": "当前使用状态",
    "status.account": "当前账号",
    "status.loginMode": "登录模式",
    "status.model": "当前模型",
    "status.gateway": "本地网关",
    "status.codex": "Codex 状态",
    "status.codexSummary": "{running} · {provider}",
    "profiles.title": "账号",
    "profiles.add": "添加账号",
    "profile.modelAuto": "自动发现",
    "profile.modelAutoPrefix": "自动",
    "profile.loginMode.official": "官方登录",
    "profile.loginMode.pure": "纯 API",
    "profile.kind.official": "Codex 官方账号",
    "profile.kind.api": "中转 API",
    "profile.keySaved": "Key 已保存",
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
    "profileForm.model": "模型 ID",
    "profileForm.optional": "（可选）",
    "profileForm.modelPlaceholder": "留空自动发现，或填 gpt-5.6、provider/model",
    "profileForm.protocol": "API 账号始终使用独立纯 API 登录，不需要官方账号。模型 ID 可留空，由中转站模型列表自动选择；接口必须兼容 OpenAI Responses API。",
    "apiGuide.badge": "纯 API",
    "apiGuide.title": "无官方账号也能用：手机号/邮箱注册中转站即可",
    "apiGuide.description": "点击中转站即可复制注册地址。注册后，将 <code>Base URL</code> 和 <code>API Key</code> 填入“添加账号”即可使用。",
    "apiGuide.copyRight": "复制 RightAPI 注册链接",
    "apiGuide.copyZyg": "复制 ZYG Token 注册链接",
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
    "plugin.authBoundary": "远程公共插件目录需要先切换到已捕获的官方 ChatGPT 账号。使用纯 API 或没有官方账号时，仍可安装不依赖远程目录的独立本地插件。",
    "plugin.installLocal": "安装本地插件目录",
    "plugin.marketplaceLabel": "添加插件市场（GitHub owner/repo、Git URL 或本地目录）",
    "plugin.marketplacePlaceholder": "例如：owner/repo",
    "plugin.addMarketplace": "添加插件市场",
    "plugin.finish": "完成",
    "plugin.installed": "插件 {name} 已安装。请重新打开 Codex 插件页面。",
    "plugin.marketplaceAdded": "插件市场已添加，请在 Codex 插件页刷新。",
    "plugin.marketplaceRequired": "请填写插件市场地址。",
    "plugin.autoCleanupLabel": "切换账号时自动清理已完成自动化的历史记录（仅清理完成/归档状态，保留配置；执行前自动备份）",
    "plugin.autoCleanupOn": "已开启：下次切换前会清理已完成自动化历史，并保留备份。",
    "plugin.autoCleanupOff": "已关闭自动清理。",
    "footer.codexHome": "CODEX HOME",
    "footer.library": "本地项目库",
    "footer.author": "作者邮箱",
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
    "relay.copied": "{name} 注册链接已复制，请粘贴到浏览器打开。",
    "bridge.notLoaded": "桌面桥未加载，请通过 Codex Galaxy 应用启动。",
    "tutorial.title": "安全切换教程",
    "tutorial.intro": "项目和完整聊天记录始终保存在本机同一个 Codex Home 中。Codex Galaxy 切换的是登录凭据、API provider 和继续项目所需的本地索引，不会把聊天上传到其他账号。",
    "tutorial.step1.title": "保存第一个官方账号",
    "tutorial.step2.title": "添加一个或多个中转 API",
    "tutorial.step3.title": "一键安全切换",
    "tutorial.step4.title": "继续处理原项目",
    "tutorial.step5.title": "API 模式保持托盘运行",
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
    "common.current": "Current",
    "common.none": "None",
    "common.unknown": "Unknown",
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
    "actions.refresh": "Refresh projects",
    "actions.refreshTitle": "Rescan local Codex project records",
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
    "profileForm.model": "Model ID",
    "profileForm.optional": "(optional)",
    "profileForm.modelPlaceholder": "Leave blank to detect, or enter gpt-5.6, provider/model",
    "profileForm.protocol": "API accounts always use an independent pure-API login and require no official account. Model ID may be left blank for relay catalog discovery. The endpoint must support the OpenAI Responses API.",
    "apiGuide.badge": "PURE API",
    "apiGuide.title": "No official account required: register with a relay provider",
    "apiGuide.description": "Click a relay provider to copy its registration URL. After registering, add its <code>Base URL</code> and <code>API Key</code> to a new account.",
    "apiGuide.copyRight": "Copy RightAPI registration link",
    "apiGuide.copyZyg": "Copy ZYG Token registration link",
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
    "plugin.authBoundary": "The remote public plugin catalog requires switching to a captured official ChatGPT account. In pure API mode, or without an official account, you can still install independent local plugins that do not use the remote catalog.",
    "plugin.installLocal": "Install local plugin directory",
    "plugin.marketplaceLabel": "Add plugin marketplace (GitHub owner/repo, Git URL, or local directory)",
    "plugin.marketplacePlaceholder": "e.g. owner/repo",
    "plugin.addMarketplace": "Add marketplace",
    "plugin.finish": "Done",
    "plugin.installed": "Plugin {name} installed. Reopen the Codex plugin page.",
    "plugin.marketplaceAdded": "Marketplace added. Refresh the Codex plugin page.",
    "plugin.marketplaceRequired": "Enter a marketplace address.",
    "plugin.autoCleanupLabel": "Auto-clean completed automation history when switching accounts (completed/archived only; keeps configuration; backs up first)",
    "plugin.autoCleanupOn": "Enabled: completed automation history will be cleaned before the next switch, with a backup kept.",
    "plugin.autoCleanupOff": "Auto-clean disabled.",
    "footer.codexHome": "CODEX HOME",
    "footer.library": "Local project library",
    "footer.author": "Author email",
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
    "relay.copied": "{name} registration link copied. Paste it into your browser to open.",
    "bridge.notLoaded": "Desktop bridge is not loaded. Start this app through Codex Galaxy.",
    "tutorial.title": "Safe switching guide",
    "tutorial.intro": "Projects and full chat history always stay in the same local Codex Home. Codex Galaxy switches login credentials, the API provider, and the local index needed to resume a project; it does not upload chats to another account.",
    "tutorial.step1.title": "Save your first official account",
    "tutorial.step2.title": "Add one or more relay APIs",
    "tutorial.step3.title": "One-click safe switch",
    "tutorial.step4.title": "Resume the original project",
    "tutorial.step5.title": "Keep the tray running in API mode",
    "tutorial.step6.title": "Refresh projects and clean data",
    "tutorial.step7.title": "Recovery from errors",
    "tutorial.step8.title": "Upgrading Codex Galaxy",
    "tutorial.step9.title": "Plugins, images, and automation cleanup",
    "tutorial.step1.body": "<ol><li>Sign in normally in Codex Desktop and wait for its project list to load.</li><li>In Galaxy, click + and add an “Official Codex account”. You can rename it later.</li><li>Click Capture on that account. The login can only be restored after capture succeeds.</li></ol>",
    "tutorial.step2.body": "<ol><li>Click + and choose “Relay API”.</li><li>Enter a name, Base URL, and API Key. The model ID is optional; Galaxy can read the relay model catalog and remember a working model.</li><li>Every API account uses an independent pure-API login and does not require an official account. You can switch directly between multiple API accounts.</li><li>The relay must support the OpenAI Responses API. If model discovery is unavailable and no model was previously learned, enter the model ID manually.</li><li>API keys are encrypted locally and never shown in project records.</li></ol>",
    "tutorial.step3.body": "<ol><li>Select the target account and confirm the displayed login mode and model.</li><li>Click “Switch and open Codex”. If Codex is still running, Galaxy warns that an active task may be interrupted; cancel first if a task is generating.</li><li>Galaxy waits for Codex to stop writing, saves the local index, applies the target credentials/provider, and starts the loopback Responses gateway for API accounts.</li><li>Compatibility checks cover only new or changed history. When “Continue in Codex” opens a specific thread, Galaxy prioritizes that rollout instead of rescanning the entire Codex Home.</li><li>Session provider metadata is updated with bounded memory and progress feedback, then Codex reopens after synchronization reaches 100%.</li></ol>",
    "tutorial.step4.body": "<ol><li>“View details” only previews the local thread in Galaxy and never changes accounts.</li><li>“Continue in Codex” switches or resynchronizes the selected account when needed, then restores that project in Codex.</li><li>Historical messages are preserved across GPT, DeepSeek, and other compatible providers; new replies use the active provider.</li><li>An encrypted-state warning only means a different provider may not reuse hidden reasoning state. It does not delete chat or project files.</li></ol>",
    "tutorial.step5.body": "<p>API traffic passes through Galaxy’s loopback Responses gateway. Closing the main window minimizes Galaxy to the system tray; keep it running until the task finishes or you switch back to an official account. Exiting Galaxy in API mode stops the gateway.</p>",
    "tutorial.step6.body": "<ol><li>Refresh rebuilds the visible list from current Codex state and does not delete source data.</li><li>Clean Data can remove explicitly archived/deleted projects and completed automation history only after creating a recoverable backup.</li><li>Galaxy never deletes user project folders or source code.</li></ol>",
    "tutorial.step7.body": "<ol><li>If switching fails, read the progress message. Galaxy attempts to restore the previous credentials, provider, gateway, and current-account marker.</li><li>Only one Galaxy instance may switch accounts; stale locks from dead processes are reclaimed automatically.</li><li>DNS, TLS, proxy, upstream overload, and authentication errors originate outside the local project index. Error messages never include API keys or request bodies.</li><li>If recovery is incomplete, keep the screenshot and report it without exposing secrets; do not manually edit the <code>.codex</code> files.</li></ol>",
    "tutorial.step8.body": "<ol><li>Finish any active API-backed Codex task before upgrading because the installer closes Galaxy and its local gateway.</li><li>Run the new installer over the existing version; manual uninstall is unnecessary, and local profiles/project records are retained.</li><li>Version 1.1.0 removes the ambiguous mixed-login mode. Existing API profiles are automatically migrated to independent pure-API login without changing their encrypted API keys.</li><li>Version 1.3.0 adds a click-through Codex Galaxy version badge that follows the external Codex Desktop window’s top-right area on Windows. It hides when Codex is not the foreground window and never edits Codex files.</li><li>For extra safety, back up <code>.codex-galaxy</code> locally and never upload it to Git.</li></ol>",
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
}

function setLanguage(language) {
  if (language !== "zh-CN" && language !== "en") return;
  currentLanguage = language;
  try { window.localStorage.setItem("codexGalaxyLanguage", language); } catch { /* storage unavailable */ }
  $("#languageSelect").value = language;
  applyLanguage();
}

function operationBusy() {
  return state.switching || state.refreshing || state.cleaning;
}

function updateStatusPill() {
  $("#statusPill").textContent = state.switching
    ? t("status.switching")
    : state.refreshing
      ? t("status.refreshing")
      : state.cleaning
        ? t("status.cleaning")
        : state.gatewayRunning
          ? t("status.gatewayRunning")
          : t("status.localProgram");
}

function updateOperationControls() {
  const busy = operationBusy();
  $("#syncBtn").disabled = busy;
  $("#cleanupBtn").disabled = busy;
  $("#pluginBtn").disabled = busy;
  $("#addProfileBtn").disabled = busy;
  $("#search").disabled = busy;
  $("#projectFilter").disabled = busy;
  $("#profileForm").querySelectorAll("button, input, select").forEach((control) => { control.disabled = busy; });
  updateStatusPill();
  renderProfiles();
  renderThreads();
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

function profileModelLabel(profile) {
  if (!profile.model) return profile.resolvedModel ? `${t("profile.modelAutoPrefix")} → ${profile.resolvedModel}` : t("profile.modelAuto");
  return profile.resolvedModel && profile.resolvedModel !== profile.model
    ? `${profile.model} → ${profile.resolvedModel}`
    : profile.model;
}

function profileLoginModeLabel(profile) {
  if (profile.kind === "official") return t("profile.loginMode.official");
  return t("profile.loginMode.pure");
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
            <div class="profile-kind">${profile.kind === "official" ? t("profile.kind.official") : `${t("profile.kind.api")} · ${profileLoginModeLabel(profile)}`}${profile.hasApiKey ? ` · ${t("profile.keySaved")}` : ""}</div>
            <div class="profile-model">${escapeHtml(profileModelLabel(profile))}</div>
          </div>
        </div>
        <div class="profile-actions">
          ${current ? `<span class="profile-status">${t("common.current")}</span>` : ""}
          <button data-action="edit" data-id="${escapeHtml(profile.id)}" title="${t("profile.editTitle")}" aria-label="${t("profile.editTitle")} ${escapeHtml(profile.name)}"${disabled}>${t("common.edit")}</button>
          ${profile.kind === "official" ? `<button data-action="capture" data-id="${escapeHtml(profile.id)}" title="${t("profile.captureTitle")}"${disabled}>${t("common.capture")}</button>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  const selected = selectedProfile();
  $("#selectedProfileName").textContent = selected?.name || t("common.pleaseSelect");
  $("#selectedProfileModel").textContent = selected ? `${profileLoginModeLabel(selected)} · ${profileModelLabel(selected)}` : t("common.selectToSwitch");
  $("#switchOpenBtn").disabled = !selected || state.switching || state.refreshing || state.cleaning;
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
  state.gatewayRunning = Boolean(snapshot.gateway?.running);
  state.codexRunning = Boolean(snapshot.codex.running);
  state.codexProvider = snapshot.codex.provider || null;
  state.librarySyncedAt = snapshot.library.syncedAt || null;
  if (!state.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId = state.currentId || state.profiles[0]?.id || null;
  }
  $("#codexHome").textContent = snapshot.codex.home;
  applyLanguage();
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
  if (state.switching || state.refreshing || state.cleaning) return;
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
  if (state.cleaning) return;
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
  if (state.switching || state.refreshing || state.cleaning) return;
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

async function switchAccount(profileId, threadId = null) {
  if (state.switching || state.refreshing || state.cleaning) return;
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return notice(t("switching.pleaseSelectAccount"), true);
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

async function showThread(id) {
  const thread = unwrap(await bridge.getThread(id));
  state.selectedThread = thread;
  $("#dialogTitle").textContent = thread.title || t("common.unnamedThread");
  $("#dialogMeta").textContent = `${thread.cwd || t("common.noProjectDir")} · ${thread.provider || t("common.providerUnrecorded")} · ${formatDate(thread.updatedAt)}`;
  const compatibility = $("#dialogCompatibility");
  compatibility.hidden = !thread.compatibility?.encryptedContent;
  compatibility.textContent = thread.compatibility?.encryptedContent
    ? t("threads.dialogCompatibility")
    : "";
  $("#dialogMessages").innerHTML = (thread.messages || []).slice(-80).map((message) => `<div class="message ${escapeHtml(message.role)}"><div class="message-label">${escapeHtml(message.role)} · ${formatDate(message.timestamp)}</div>${escapeHtml(message.content)}</div>`).join("") || `<div class="empty">${t("threads.messagesEmpty")}</div>`;
  $("#resumeProfiles").innerHTML = state.profiles.map((profile) => `<button data-profile-id="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}<small>${escapeHtml(profileModelLabel(profile))}</small></button>`).join("") || `<span class="empty">${t("threads.addAccountFirst")}</span>`;
  $("#threadDialog").showModal();
}

async function launch(id) {
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
  form.elements.baseUrl.value = profile?.baseUrl || "";
  form.elements.apiKey.value = "";
  form.elements.model.value = profile?.model || "";
  $("#profileFormTitle").textContent = profile ? t("profile.editTitle") : t("profile.addTitle");
  form.hidden = false;
  $("#addProfileBtn").hidden = true;
  updateProfileFields();
  form.elements.name.focus();
}

function closeProfileForm() {
  state.editingProfileId = null;
  $("#profileForm").hidden = true;
  $("#addProfileBtn").hidden = false;
}

$("#syncBtn").addEventListener("click", sync);
$("#languageSelect").addEventListener("change", (event) => setLanguage(event.currentTarget.value));
$("#tutorialBtn").addEventListener("click", () => $("#tutorialDialog").showModal());
$("#pluginBtn").addEventListener("click", openPlugins);
$("#closeTutorial").addEventListener("click", () => $("#tutorialDialog").close());
$("#finishTutorial").addEventListener("click", () => $("#tutorialDialog").close());
$("#closePlugins").addEventListener("click", () => $("#pluginDialog").close());
$("#finishPlugins").addEventListener("click", () => $("#pluginDialog").close());
$("#autoCleanupCompleted").addEventListener("change", async (event) => {
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
  try {
    const result = unwrap(await bridge.installLocalPlugin());
    if (!result.cancelled) {
      notice(t("plugin.installed", { name: result.installed.name }));
      await refresh();
      renderPlugins();
    }
  } catch (error) { notice(error.message, true); }
});
$("#addMarketplace").addEventListener("click", async () => {
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
  if (!state.selectedThread) return;
  const profile = selectedProfile() || state.profiles.find((item) => item.id === state.currentId);
  const model = profile?.model ? ` --model "${profile.model}"` : "";
  unwrap(await bridge.copyText(`codex resume "${state.selectedThread.id}"${model}`));
  notice(t("resume.copied"));
});

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
  if (button && state.selectedThread) switchAccount(button.dataset.profileId, state.selectedThread.id);
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
  bridge.onSwitchConfirmation(showSwitchConfirmation);
  refresh().catch((error) => notice(error.message, true));
}
