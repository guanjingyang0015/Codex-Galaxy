const $ = (selector) => document.querySelector(selector);
const state = {
  profiles: [],
  version: "2.1.0",
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
  auditTasks: {},
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
    currentVersion: "2.1.0",
    latestVersion: null,
    available: false,
    action: "install",
    percent: 0,
    error: null,
  },
};
const bridge = window.codexGalaxy;
let auditCountdownTimer = null;

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
    "actions.diagnostics": "日志",
    "actions.refresh": "刷新项目",
    "actions.refreshTitle": "重新扫描本机 Codex 项目记录",
    "actions.audit": "API 检测",
    "actions.rankings": "API 排名",
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
    "page.title": "账号与 API",
    "status.boardLabel": "当前使用状态",
    "status.account": "当前账号",
    "status.loginMode": "登录模式",
    "status.model": "当前模型",
    "status.gateway": "本地网关",
    "status.codex": "Codex 状态",
    "status.codexSummary": "{running} · {provider}",
    "profiles.title": "账号管理",
    "profiles.add": "添加账号",
    "profile.modelAuto": "自动发现",
    "profile.modelAutoPrefix": "自动",
    "profile.loginMode.official": "官方登录",
    "profile.loginMode.pure": "纯 API",
    "confirm.running": "未结束",
    "confirm.lastActivity": "最近活动",
    "profile.moveTop": "置顶",
    "profile.moveBottom": "置底",
    "profile.moveUp": "上移",
    "profile.moveDown": "下移",
    "confirm.automation": "定时任务",
    "confirm.background": "后台任务",
    "confirm.chat": "聊天任务",
    "confirm.openTask": "打开聊天",
    "confirm.unknownTasks": "无法读取具体任务，请检查 Codex 的运行中聊天与定时任务，稍后重试。",
    "tutorial.switch.officialToOfficialTitle": "官方 A → 官方 B",
    "tutorial.switch.officialToOfficial1": "先分别添加 A、B；在 Codex 登录对应账号后，回到 Galaxy 在对应卡片点击“捕获”。仅填写名称不代表已经登录。",
    "tutorial.switch.officialToOfficial2": "等待所有聊天和定时任务完成；若切换被阻止，在提示列表查看任务名称并点击“打开聊天”。",
    "tutorial.switch.officialToOfficial3": "选中已捕获的 B，点击“切换并打开 Codex”，等待 100%；系统先保存 A 最新登录状态，再恢复 B。切回 A 使用同样步骤。",
    "tutorial.switch.officialToOfficial4": "本地项目和聊天继续保留；两个账号套餐和额度各自独立。登录失效时重新登录对应账号并捕获。",
    "tutorial.manage": "账号卡片支持置顶、置底和 ↑ / ↓，可调整全部账号顺序，自动保存；编辑账号不会改变排序。首页右侧直接显示完整 API 排名，可筛选模型或刷新。",
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
    "profile.recentAudit": "最近检测 · {score} 分 · {assessment} · {time}",
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
    "profileForm.model": "模型 ID（也是检测期望型号）",
    "profileForm.optional": "（可选）",
    "profileForm.modelPlaceholder": "留空自动发现，或填 gpt-5.6、provider/model",
    "profileForm.protocol": "API 账号始终使用独立纯 API 登录，不需要官方账号。模型 ID 可留空，由中转站模型列表自动选择；接口必须兼容 OpenAI Responses API。",
    "profileForm.homepage": "平台主页（可选）",
    "profileForm.homepagePlaceholder": "https://example.com",
    "profileForm.runtimeMode": "运行方式",
    "profileForm.direct": "API 直连（推荐）",
    "profileForm.gateway": "兼容网关（Galaxy 需运行）",
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
    "threads.largeContextTitle": "这个聊天历史较大，直接继续可能触发上下文压缩失败",
    "threads.largeContextText": "建议在同一项目下新建聊天，并带上当前聊天的深度链接继续；原聊天会保留，不会被删除。",
    "threads.copyLink": "复制深度链接",
    "threads.copyContinuationPrompt": "复制新聊天继续提示",
    "threads.continuationPromptCopied": "已复制新聊天提示。请在同一项目下新建聊天后粘贴发送。",
    "audit.explain": "检测与评分说明",
    "audit.panelTitle": "API 检测与排名",
    "audit.intro": "已保存 API 可直接检测；临时 API 才需要填写地址和 Key。检测在后台运行，完成后自动保存并提交脱敏排名。",
    "audit.rubric": "评分：模型核对 40 分、接口协议 25 分、能力探针 15 分、稳定性 10 分、速度 10 分。GPT/o 系列测试推理强度，其他模型测试确定性一致性；模型不匹配时总分最高 49 分。",
    "audit.rankings": "查看排名",
    "audit.rankingsTitle": "API 中转站测试排名",
    "audit.rankingsNote": "排名代表社区测试表现，不等于官方上游认证。",
    "audit.refreshRankings": "刷新排名",
    "audit.sortOverall": "综合排名",
    "audit.sortRecent": "最近测试",
    "audit.adHoc": "测试新 API",
    "audit.queueStarted": "{name} 已加入后台检测；可以继续添加其他 API。",
    "audit.queued": "排队等待",
    "audit.queueStatus": "后台检测 {running} 个，排队 {queued} 个 · 预计还需 {time}",
    "audit.modelAll": "全部模型总榜",
    "audit.history90": "近90天全站最高：{score} 分",
    "audit.historySite90": "本站近90天最高 {score} 分",
    "audit.rankWindow": "排行分取同站点最近7天最高测试分；7天内只有本次测试时使用本次分数。",
    "audit.scoreBreakdown": "协议 {protocol} · 模型 {model} · 能力 {effort} · 稳定 {stability} · 速度 {speed}",
    "audit.level.excellent": "优秀",
    "audit.level.good": "良好",
    "audit.level.usable": "可用",
    "audit.level.uncertain": "证据不足",
    "audit.level.risky": "高风险",
    "audit.summaryTitle": "最近排名参考",
    "audit.rankingsLoading": "正在读取排名…",
    "audit.rankingsUnavailable": "排名服务暂时不可用",
    "audit.savedProfile": "测试已添加 API",
    "audit.providerName": "平台名称",
    "audit.providerNamePlaceholder": "例如：我的 API 平台",
    "audit.homepage": "平台主页（可选）",
    "audit.homepagePlaceholder": "https://example.com",
    "audit.baseUrl": "Base URL",
    "audit.apiKey": "API Key",
    "audit.apiKeyPlaceholder": "只用于本次本机测试",
    "audit.model": "模型 ID（可选）",
    "audit.modelPlaceholder": "留空则使用 /models 第一个模型",
    "audit.securityNote": "临时 Key 只用于本次本机检测，不会保存、上传或写入日志；检测完成后只自动提交脱敏指标。",
    "audit.start": "开始检测",
    "audit.running": "正在检测 API…",
    "audit.dialogTitle": "测试临时 API",
    "audit.backgroundStarted": "{name} 已在后台开始检测，预计最多约 {time}。你可以继续使用其他功能。",
    "audit.progress": "后台检测 {percent}% · {stage} · 预计还需 {time}",
    "audit.progressUnknown": "后台检测 {percent}% · {stage} · 正在估算剩余时间",
    "audit.done": "检测完成：{score}/100 · {assessment}",
    "audit.rankingSaved": "脱敏结果已自动提交到公共排名。",
    "audit.rankingFailed": "检测已完成，但脱敏排名提交失败：{message}",
    "audit.rankingSkipped": "检测未成功完成，因此没有提交公共排名。",
    "audit.completeTitle": "API 检测完成",
    "audit.completeClose": "关闭",
    "audit.failedTitle": "API 检测失败",
    "audit.batchComplete": "检测报告：{success}/{total} 个成功生成",
    "audit.scoreUnit": "{score} 分",
    "audit.checkScore": "{score}/{max} 分",
    "audit.expectedModel": "期望模型",
    "audit.requestedModel": "请求模型",
    "audit.observedModel": "响应声明模型",
    "audit.modelUnknown": "响应未声明，无法核验",
    "audit.model.exact": "与期望模型完全一致",
    "audit.model.compatible": "与期望模型属于同一型号系列",
    "audit.model.listed-only": "模型列表声明支持，但响应没有 model 字段",
    "audit.model.mismatch": "与期望模型不一致",
    "audit.model.unverified": "无法验证模型身份",
    "audit.model.unspecified": "未设置期望模型",
    "audit.check.catalog": "模型目录",
    "audit.check.responses": "Responses 协议",
    "audit.check.model": "模型核对",
    "audit.check.reasoning": "能力探针",
    "audit.check.stability": "稳定性",
    "audit.check.performance": "响应速度",
    "audit.check.pass": "通过",
    "audit.check.warn": "部分通过",
    "audit.check.fail": "未通过",
    "audit.check.catalogDetail": "/models HTTP {status}，返回 {count} 个模型",
    "audit.check.responsesDetail": "{success}/{total} 个请求成功，{ids} 个含 response id，{usage} 个含 usage",
    "audit.check.reasoningDetail": "{success}/{total} 个能力探针返回固定校验词",
    "audit.check.stabilityDetail": "{success}/{total} 个请求成功，超时 {timeouts} 次",
    "audit.check.performanceDetail": "成功请求平均 {time}",
    "audit.effortTitle": "各次能力实测",
    "audit.effortRow": "{effort} · HTTP {status} · {time} · {result} · 模型 {model}",
    "audit.assessment.conforming": "基本符合声明",
    "audit.assessment.inconclusive": "证据不足",
    "audit.assessment.suspicious": "存在可疑点",
    "audit.rank": "第 {rank} 名",
    "audit.tests": "{count} 次测试",
    "audit.latest": "最近：{time}",
    "audit.noHomepage": "未提供主页",
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
    "diagnostics.title": "本地日志",
    "diagnostics.intro": "日志只记录操作、时间、错误类型和脱敏错误信息，不记录 API Key、OAuth、聊天正文或请求体。",
    "diagnostics.loading": "正在读取本地日志…",
    "diagnostics.empty": "暂时没有日志。下次切换或其他本地操作失败时，原因会自动记录在这里。",
    "diagnostics.path": "日志文件",
    "diagnostics.refresh": "刷新日志",
    "diagnostics.open": "打开文件",
    "diagnostics.copy": "复制日志",
    "diagnostics.copied": "日志已复制。发送前请再次确认没有添加任何未脱敏内容。",
    "diagnostics.opened": "已打开本地日志文件。",
    "diagnostics.truncated": "日志较长，当前只显示最后一段。",
    "tutorial.title": "分阶段使用教程",
    "tutorial.intro": "按使用阶段阅读教程：先完成一次账号配置，日常按步骤切换，出问题先看日志，超大聊天先复制深度链接新建聊天继续，最后了解本地历史和其他特色功能。当前版本为 v2.1.0。",
    "tutorial.stageNav": "教程阶段",
    "tutorial.stage1.tab": "首次配置",
    "tutorial.stage1.short": "添加账号和模型",
    "tutorial.stage1.kicker": "STAGE 1 · FIRST SETUP",
    "tutorial.stage1.title": "第一次添加账号配置",
    "tutorial.stage1.intro": "只需完成一次，之后日常使用只需要选择账号并切换。",
    "tutorial.stage2.tab": "日常切换",
    "tutorial.stage2.short": "按步骤切换账号",
    "tutorial.stage2.kicker": "STAGE 2 · DAILY SWITCHING",
    "tutorial.stage2.title": "日常使用：按步骤切换账号",
    "tutorial.stage2.intro": "每次只选择一个目标账号，等进度到 100% 后再回 Codex 继续项目。",
    "tutorial.stage3.tab": "异常处理",
    "tutorial.stage3.short": "先看日志再恢复",
    "tutorial.stage3.kicker": "STAGE 3 · RECOVERY",
    "tutorial.stage3.title": "异常故障：先判断，再恢复",
    "tutorial.stage3.intro": "失败时不要删除配置、不要反复点击，也不要手动结束进程；先保留现场。",
    "tutorial.stage4.tab": "特色功能",
    "tutorial.stage4.short": "历史、模型和网关",
    "tutorial.stage4.kicker": "STAGE 4 · FEATURES",
    "tutorial.stage4.title": "特色功能：知道什么时候使用它们",
    "tutorial.stage4.intro": "Galaxy 不只切换账号，还负责本地项目连续性和可恢复操作。",
    "tutorial.setup.officialTitle": "添加官方账号",
    "tutorial.setup.official1": "先在 Codex Desktop 中正常登录官方账号，等待项目列表加载完成。",
    "tutorial.setup.official2": "回到 Galaxy，点击账号区右上角“+”，类型选择“Codex 官方账号”。",
    "tutorial.setup.official3": "点击账号右侧“捕获”，看到保存成功后，官方登录状态才可以被恢复。",
    "tutorial.setup.apiTitle": "添加 API 账号",
    "tutorial.setup.api1": "点击“+”，类型选择“中转 API”，填写名称、Base URL 和 API Key。",
    "tutorial.setup.api2": "模型 ID 可留空自动发现；首次切换时 Galaxy 会读取中转站模型列表。",
    "tutorial.setup.api3": "优先选择“API 直连”。它不依赖官方登录，也不需要 Galaxy 一直运行。",
    "tutorial.setup.safety": "账号配置完成后，进入第二阶段，按照对应方向完成一次切换。API Key 和官方登录快照都会留在本机安全存储中。",
    "tutorial.switch.commonTitle": "每次切换前",
    "tutorial.switch.commonHeading": "先完成这 3 件事",
    "tutorial.switch.common1": "在 Codex 中结束当前回复，确认没有正在生成的任务。",
    "tutorial.switch.common2": "回到 Galaxy，选中本次要使用的目标账号。",
    "tutorial.switch.common3": "如果出现确认框，只在确认 Codex 空闲后点击“继续切换”。切换期间不要再次点击按钮。",
    "tutorial.switch.apiToOfficialTitle": "API → 官方",
    "tutorial.switch.apiToOfficial1": "选中已捕获的官方账号，点击“切换并打开 Codex”。",
    "tutorial.switch.apiToOfficial2": "首次使用时，在 Codex 中完成官方登录和 Windows 设置，看到正常项目列表后回 Galaxy 点击“已完成，继续同步”。",
    "tutorial.switch.apiToOfficial3": "已有快照时，Galaxy 会自动恢复并验证官方配置，并清理旧的 [model_providers.openai] 覆盖。",
    "tutorial.switch.apiToOfficial4": "等待 Galaxy 进度到 100%，再从项目列表点击“在 Codex 中继续”。",
    "tutorial.switch.officialToApiTitle": "官方 → API",
    "tutorial.switch.officialToApi1": "选中目标 API 账号，建议使用“API 直连”，点击“切换并打开 Codex”。",
    "tutorial.switch.officialToApi2": "Galaxy 会先保存官方快照，安全关闭空闲 Codex，并移除实时官方 OAuth，只留下目标 API provider。",
    "tutorial.switch.officialToApi3": "等待进度到 100%，确认 Codex 显示 API 账号后，再点击“在 Codex 中继续”。",
    "tutorial.switch.officialToApi4": "直连模式可以退出 Galaxy；“兼容网关”模式必须保持 Galaxy 运行。",
    "tutorial.switch.apiToApiTitle": "API → API",
    "tutorial.switch.apiToApi1": "选中目标 API 账号，确认 Base URL、Key 和模型 ID 正确后点击“切换并打开 Codex”。",
    "tutorial.switch.apiToApi2": "API 之间不会改写整套历史文件，只更新当前 provider、模型和必要的线程索引，通常比跨官方账号切换更快。",
    "tutorial.switch.apiToApi3": "等待进度到 100%，确认 Codex 使用目标 API 后，再点击“在 Codex 中继续”。",
    "tutorial.switch.doneTitle": "完成标准",
    "tutorial.switch.doneText": "进度 100% + Codex 已打开目标账号 + 原项目仍在列表中。",
    "tutorial.recovery.logTitle": "1 · 先打开“日志”",
    "tutorial.recovery.logText": "复制本次失败的进度提示和脱敏日志。日志不会记录 API Key、OAuth 或聊天正文。",
    "tutorial.recovery.configTitle": "2 · 看到 config_load / Windows 设置",
    "tutorial.recovery.configText": "这通常是旧配置格式问题。1.9.8 起 Galaxy 会自动清理保留 provider 覆盖；不要删除 config.toml。",
    "tutorial.recovery.switchTitle": "3 · 账号没有切过去",
    "tutorial.recovery.switchText": "如果进度未到 100% 或发生自动回滚，说明切换没有成功；先看日志，再重试。2.1.0 修复 API 切回官方时推理条目 item_ ID 引发的 invalid_id_prefix（期望 rs）错误，覆盖原始及压缩历史，并使旧兼容缓存失效。升级后待回复结束，在 Galaxy 重新选择官方账号并切换，完成后重新打开原任务。两个官方账号需要分别完成登录和捕获，此后可切换；登录失效时需重新登录，各账号套餐与额度独立。",
    "tutorial.recovery.windowsTitle": "4 · 只有真正的 Windows 沙盒故障",
    "tutorial.recovery.windowsText": "如果 Galaxy 明确提示 elevated 沙盒被本机策略阻止，才选择“兼容模式重试”；它不是日常切换步骤。",
    "tutorial.recovery.never": "不要删除 config.toml、~/.codex、~/.codex-galaxy，也不要为了“清空状态”手动退出官方账号。若自动恢复不完整，停止继续操作并提交脱敏日志。",
    "tutorial.feature.historyTitle": "本地历史连续",
    "tutorial.feature.historyText": "项目、SQLite 索引和 rollout 历史保留在同一个 Codex Home，跨不同 provider 继续项目。",
    "tutorial.feature.modelsTitle": "模型目录",
    "tutorial.feature.modelsText": "API 模型 ID 可留空自动发现；填写具体 GPT 型号时仍会读取完整目录，并保留你的型号作为默认值。",
    "tutorial.feature.gatewayTitle": "直连与兼容网关",
    "tutorial.feature.gatewayText": "直连模式让 Codex 直接访问 Base URL；兼容网关模式使用本机回环网关，需要 Galaxy 保持运行。",
    "tutorial.feature.auditTitle": "后台 API 检测",
    "tutorial.feature.auditText": "可并行检测全部已保存 API。报告按模型核对、协议、推理、稳定性和速度逐项显示证据；期望模型不匹配时总分最高 49 分。",
    "tutorial.feature.toolsTitle": "插件、刷新和清理",
    "tutorial.feature.toolsText": "插件窗口管理本地插件市场；刷新只重建列表；清理数据会先创建备份。",
    "tutorial.feature.updateTitle": "安全更新",
    "tutorial.feature.updateText": "Windows 更新会核对官方 Release 地址和 SHA-256；覆盖安装不会删除账号和本地记录。每次版本更新都会同步更新版本号、教程、发布说明和安装包。",
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
    "actions.diagnostics": "Log",
    "actions.refresh": "Refresh projects",
    "actions.refreshTitle": "Rescan local Codex project records",
    "actions.audit": "API audit",
    "actions.rankings": "API ranking",
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
    "page.title": "Accounts and APIs",
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
    "confirm.running": "Unfinished",
    "confirm.lastActivity": "Last activity",
    "profile.moveTop": "To top",
    "profile.moveBottom": "To bottom",
    "profile.moveUp": "Move up",
    "profile.moveDown": "Move down",
    "confirm.automation": "Scheduled task",
    "confirm.background": "Background task",
    "confirm.chat": "Chat",
    "confirm.openTask": "Open chat",
    "confirm.unknownTasks": "Task details are unavailable. Check running chats and scheduled tasks in Codex, then retry.",
    "tutorial.switch.officialToOfficialTitle": "Official A → official B",
    "tutorial.switch.officialToOfficial1": "Add A and B separately. Sign in to each in Codex, then Capture on its matching Galaxy card. A saved name alone is not a captured login.",
    "tutorial.switch.officialToOfficial2": "Wait for all chats and scheduled tasks to finish. If switching is blocked, use the task list and Open chat to locate the active task.",
    "tutorial.switch.officialToOfficial3": "Select captured B, click Switch and open Codex, and wait for 100%. Galaxy saves the latest A login before restoring B. Follow the same steps to return to A.",
    "tutorial.switch.officialToOfficial4": "Local projects and chats remain available. Account plans and quotas are separate. If login expires, sign in to that account again and capture it.",
    "tutorial.manage": "Use To top, To bottom or ↑ / ↓ on any account card to save its position. Editing preserves that order. The complete API ranking is shown on the homepage, with model filtering and refresh.",
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
    "profile.recentAudit": "Last audit · {score} pts · {assessment} · {time}",
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
    "profileForm.model": "Model ID (also the expected audit model)",
    "profileForm.optional": "(optional)",
    "profileForm.modelPlaceholder": "Leave blank to detect, or enter gpt-5.6, provider/model",
    "profileForm.protocol": "API accounts always use an independent pure-API login and require no official account. Model ID may be left blank for relay catalog discovery. The endpoint must support the OpenAI Responses API.",
    "profileForm.homepage": "Platform homepage (optional)",
    "profileForm.homepagePlaceholder": "https://example.com",
    "profileForm.runtimeMode": "Runtime mode",
    "profileForm.direct": "Direct API (recommended)",
    "profileForm.gateway": "Compatibility gateway (Galaxy must run)",
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
    "threads.largeContextTitle": "This chat history is large and direct resume may fail during context compaction",
    "threads.largeContextText": "Create a new chat in the same project and include this chat's deep link. The original chat stays unchanged.",
    "threads.copyLink": "Copy deep link",
    "threads.copyContinuationPrompt": "Copy new-chat continuation prompt",
    "threads.continuationPromptCopied": "Continuation prompt copied. Create a new chat in the same project and paste it.",
    "audit.explain": "About audits and scoring",
    "audit.panelTitle": "API audit and ranking",
    "audit.intro": "Saved APIs can be tested directly; only temporary APIs require an address and key. Audits run in the background and automatically submit redacted results.",
    "audit.rubric": "Score: model identity 40, protocol 25, capability probes 15, stability 10, latency 10. GPT/o models test reasoning efforts; other models test deterministic consistency. A model mismatch caps the total at 49.",
    "audit.rankings": "View ranking",
    "audit.rankingsTitle": "API relay test ranking",
    "audit.rankingsNote": "Ranking reflects community test performance, not official upstream certification.",
    "audit.refreshRankings": "Refresh ranking",
    "audit.sortOverall": "Overall ranking",
    "audit.sortRecent": "Most recent",
    "audit.adHoc": "Test new API",
    "audit.queueStarted": "{name} was added to the background audit queue. You can add more APIs immediately.",
    "audit.queued": "Queued",
    "audit.queueStatus": "{running} background audits running, {queued} queued · about {time} remaining",
    "audit.modelAll": "All-model overall ranking",
    "audit.history90": "90-day network high: {score} pts",
    "audit.historySite90": "Site 90-day high: {score} pts",
    "audit.rankWindow": "Ranking uses each site's highest test in the last 7 days; if only the current test exists, that score is used.",
    "audit.scoreBreakdown": "Protocol {protocol} · Model {model} · Capability {effort} · Stability {stability} · Latency {speed}",
    "audit.level.excellent": "Excellent",
    "audit.level.good": "Good",
    "audit.level.usable": "Usable",
    "audit.level.uncertain": "Inconclusive",
    "audit.level.risky": "High risk",
    "audit.summaryTitle": "Recent ranking reference",
    "audit.rankingsLoading": "Loading ranking…",
    "audit.rankingsUnavailable": "Ranking service is temporarily unavailable",
    "audit.savedProfile": "Test a saved API",
    "audit.providerName": "Platform name",
    "audit.providerNamePlaceholder": "e.g. My API platform",
    "audit.homepage": "Platform homepage (optional)",
    "audit.homepagePlaceholder": "https://example.com",
    "audit.baseUrl": "Base URL",
    "audit.apiKey": "API Key",
    "audit.apiKeyPlaceholder": "Used only for this local test",
    "audit.model": "Model ID (optional)",
    "audit.modelPlaceholder": "Blank uses the first model from /models",
    "audit.securityNote": "A temporary key is used only for this local audit and is never saved, uploaded, or logged; only redacted metrics are submitted automatically.",
    "audit.start": "Start audit",
    "audit.running": "Testing API…",
    "audit.dialogTitle": "Test temporary API",
    "audit.backgroundStarted": "{name} started in the background and should take no more than about {time}. You can keep using other features.",
    "audit.progress": "Background audit {percent}% · {stage} · about {time} remaining",
    "audit.progressUnknown": "Background audit {percent}% · {stage} · estimating remaining time",
    "audit.done": "Audit complete: {score}/100 · {assessment}",
    "audit.rankingSaved": "The redacted result was submitted to public ranking automatically.",
    "audit.rankingFailed": "The audit completed, but redacted ranking submission failed: {message}",
    "audit.rankingSkipped": "The audit did not complete successfully, so no public ranking was submitted.",
    "audit.completeTitle": "API audit complete",
    "audit.completeClose": "Close",
    "audit.failedTitle": "API audit failed",
    "audit.batchComplete": "Audit reports: {success}/{total} generated",
    "audit.scoreUnit": "{score} pts",
    "audit.checkScore": "{score}/{max} pts",
    "audit.expectedModel": "Expected model",
    "audit.requestedModel": "Requested model",
    "audit.observedModel": "Response-declared model",
    "audit.modelUnknown": "Not declared; cannot verify",
    "audit.model.exact": "Exact expected model",
    "audit.model.compatible": "Same expected model family",
    "audit.model.listed-only": "Listed by /models, but responses omit model",
    "audit.model.mismatch": "Different from the expected model",
    "audit.model.unverified": "Model identity could not be verified",
    "audit.model.unspecified": "No expected model configured",
    "audit.check.catalog": "Model catalog",
    "audit.check.responses": "Responses protocol",
    "audit.check.model": "Model identity",
    "audit.check.reasoning": "Capability probes",
    "audit.check.stability": "Stability",
    "audit.check.performance": "Latency",
    "audit.check.pass": "Pass",
    "audit.check.warn": "Partial",
    "audit.check.fail": "Fail",
    "audit.check.catalogDetail": "/models HTTP {status}, {count} models returned",
    "audit.check.responsesDetail": "{success}/{total} requests succeeded, {ids} with response id, {usage} with usage",
    "audit.check.reasoningDetail": "{success}/{total} capability probes returned the exact canary",
    "audit.check.stabilityDetail": "{success}/{total} requests succeeded, {timeouts} timeouts",
    "audit.check.performanceDetail": "Successful-request average: {time}",
    "audit.effortTitle": "Per-probe observations",
    "audit.effortRow": "{effort} · HTTP {status} · {time} · {result} · model {model}",
    "audit.assessment.conforming": "Basically conforms",
    "audit.assessment.inconclusive": "Inconclusive",
    "audit.assessment.suspicious": "Suspicious",
    "audit.rank": "Rank {rank}",
    "audit.tests": "{count} tests",
    "audit.latest": "Latest: {time}",
    "audit.noHomepage": "No homepage provided",
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
    "diagnostics.title": "Local log",
    "diagnostics.intro": "The log records only operations, timestamps, error types, and redacted error messages. It does not record API keys, OAuth, chat text, or request bodies.",
    "diagnostics.loading": "Reading the local log…",
    "diagnostics.empty": "There is no log yet. A failed switch or local operation will be recorded here automatically.",
    "diagnostics.path": "Log file",
    "diagnostics.refresh": "Refresh log",
    "diagnostics.open": "Open file",
    "diagnostics.copy": "Copy log",
    "diagnostics.copied": "Log copied. Check once more that you did not add any unredacted content before sending it.",
    "diagnostics.opened": "The local log file was opened.",
    "diagnostics.truncated": "The log is long; only its latest section is shown.",
    "tutorial.title": "Phased usage guide",
    "tutorial.intro": "Read the guide by stage: configure accounts once, follow the daily switch steps, preserve the scene when something fails, use a deep link to continue oversized chats in a new thread, then learn local history and other features. Current version: v2.1.0.",
    "tutorial.stageNav": "Tutorial stages",
    "tutorial.stage1.tab": "First setup",
    "tutorial.stage1.short": "Accounts and models",
    "tutorial.stage1.kicker": "STAGE 1 · FIRST SETUP",
    "tutorial.stage1.title": "Add and configure accounts",
    "tutorial.stage1.intro": "Do this once. Daily use only requires choosing a target account and switching.",
    "tutorial.stage2.tab": "Daily switch",
    "tutorial.stage2.short": "Follow the steps",
    "tutorial.stage2.kicker": "STAGE 2 · DAILY SWITCHING",
    "tutorial.stage2.title": "Daily use: switch accounts step by step",
    "tutorial.stage2.intro": "Choose one target account, wait for 100%, then continue the project in Codex.",
    "tutorial.stage3.tab": "Recovery",
    "tutorial.stage3.short": "Log first, then recover",
    "tutorial.stage3.kicker": "STAGE 3 · RECOVERY",
    "tutorial.stage3.title": "Failures: diagnose before recovering",
    "tutorial.stage3.intro": "Do not delete configuration, click repeatedly, or end processes manually; preserve the scene first.",
    "tutorial.stage4.tab": "Features",
    "tutorial.stage4.short": "History, models, gateway",
    "tutorial.stage4.kicker": "STAGE 4 · FEATURES",
    "tutorial.stage4.title": "Features: know when to use them",
    "tutorial.stage4.intro": "Galaxy switches accounts and also protects local project continuity and recoverable operations.",
    "tutorial.setup.officialTitle": "Add an official account",
    "tutorial.setup.official1": "Sign in normally in Codex Desktop and wait for the project list to load.",
    "tutorial.setup.official2": "Return to Galaxy, click + in the account panel, and choose “Official Codex account”.",
    "tutorial.setup.official3": "Click Capture on the account. The official login can be restored only after the capture succeeds.",
    "tutorial.setup.apiTitle": "Add an API account",
    "tutorial.setup.api1": "Click +, choose “Relay API”, and enter a name, Base URL, and API Key.",
    "tutorial.setup.api2": "The model ID can be blank for automatic discovery; Galaxy reads the relay catalog on the first switch.",
    "tutorial.setup.api3": "Direct API is recommended. It does not depend on official login or require Galaxy to stay open.",
    "tutorial.setup.safety": "After setup, open stage 2 and follow the steps for the direction you need. API keys and the official login snapshot stay in local secure storage.",
    "tutorial.switch.commonTitle": "Before every switch",
    "tutorial.switch.commonHeading": "Do these 3 things first",
    "tutorial.switch.common1": "Finish the current Codex reply and confirm that no task is still generating.",
    "tutorial.switch.common2": "Return to Galaxy and select the target account for this session.",
    "tutorial.switch.common3": "If a confirmation dialog appears, click Continue only after confirming Codex is idle. Do not click the switch button again while it runs.",
    "tutorial.switch.apiToOfficialTitle": "API → official",
    "tutorial.switch.apiToOfficial1": "Select the captured official account and click Switch and open Codex.",
    "tutorial.switch.apiToOfficial2": "On first use, finish official login and Windows setup in Codex. When the normal project list appears, return to Galaxy and click Done, continue sync.",
    "tutorial.switch.apiToOfficial3": "With an existing snapshot, Galaxy restores and verifies the official configuration and removes an old [model_providers.openai] override.",
    "tutorial.switch.apiToOfficial4": "Wait for Galaxy to reach 100%, then click Continue in Codex from the project list.",
    "tutorial.switch.officialToApiTitle": "official → API",
    "tutorial.switch.officialToApi1": "Select the target API account, preferably Direct API, and click Switch and open Codex.",
    "tutorial.switch.officialToApi2": "Galaxy saves the official snapshot, gracefully closes idle Codex, removes live official OAuth, and leaves only the target API provider.",
    "tutorial.switch.officialToApi3": "Wait for 100%, confirm Codex shows the API account, then click Continue in Codex.",
    "tutorial.switch.officialToApi4": "Direct API can run after Galaxy exits; Compatibility gateway requires Galaxy to stay running.",
    "tutorial.switch.apiToApiTitle": "API → API",
    "tutorial.switch.apiToApi1": "Select the target API profile, verify its Base URL, key, and model ID, then click Switch and open Codex.",
    "tutorial.switch.apiToApi2": "API-to-API switching does not rewrite the entire history. It updates the active provider, model, and necessary thread indexes, so it is normally faster than switching across the official account.",
    "tutorial.switch.apiToApi3": "Wait for 100%, confirm Codex is using the target API, then click Continue in Codex.",
    "tutorial.switch.doneTitle": "Done means",
    "tutorial.switch.doneText": "100% progress + Codex opened with the target account + the original project is still listed.",
    "tutorial.recovery.logTitle": "1 · Open Log first",
    "tutorial.recovery.logText": "Copy the failed progress message and redacted log. Logs never record API keys, OAuth, or chat text.",
    "tutorial.recovery.configTitle": "2 · config_load / Windows setup appears",
    "tutorial.recovery.configText": "This is usually an old configuration-format problem. Since 1.9.8, Galaxy removes the stale provider override automatically; never delete config.toml.",
    "tutorial.recovery.switchTitle": "3 · The account did not switch",
    "tutorial.recovery.switchText": "If progress did not reach 100% or the transaction rolled back, the switch did not succeed; read Log before retrying. 2.1.0 repairs invalid_id_prefix (expected rs) after API-to-official switching by removing incompatible reasoning item IDs from original and compacted history and invalidating the old scan cache. After upgrading, wait for replies to finish, switch to the official profile in Galaxy, then reopen the task. Capture each official account after its own login; saved accounts can then switch independently. Expired login requires reauthentication; plans and quotas remain separate.",
    "tutorial.recovery.windowsTitle": "4 · Only a genuine Windows sandbox failure",
    "tutorial.recovery.windowsText": "Choose Compatibility retry only when Galaxy explicitly says the elevated sandbox is blocked by a machine policy; it is not a daily switching step.",
    "tutorial.recovery.never": "Do not delete config.toml, ~/.codex, or ~/.codex-galaxy, and do not manually log out of the official account just to clear state. Stop and submit the redacted log if recovery is incomplete.",
    "tutorial.feature.historyTitle": "Local history continuity",
    "tutorial.feature.historyText": "Projects, SQLite indexes, and rollout history stay in one Codex Home so a project can continue across providers.",
    "tutorial.feature.modelsTitle": "Model catalog",
    "tutorial.feature.modelsText": "Leave the API model ID blank for discovery; an exact GPT ID still loads the full catalog and remains the default.",
    "tutorial.feature.gatewayTitle": "Direct API and gateway",
    "tutorial.feature.gatewayText": "Direct API connects Codex to the Base URL; Compatibility gateway uses a local loopback gateway and requires Galaxy to run.",
    "tutorial.feature.auditTitle": "Background API audit",
    "tutorial.feature.auditText": "Audit all saved APIs in parallel. Reports show evidence for model identity, protocol, reasoning, stability, and latency; a model mismatch caps the total at 49.",
    "tutorial.feature.toolsTitle": "Plugins, refresh, and cleanup",
    "tutorial.feature.toolsText": "Plugins manage local marketplaces; Refresh rebuilds the list; Clean Data creates a backup first.",
    "tutorial.feature.updateTitle": "Safe updates",
    "tutorial.feature.updateText": "Windows updates verify the official Release URL and SHA-256; overlay installation keeps accounts and local records. Every future version must update the version surfaces, guide, release notes, and installers together.",
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

function selectTutorialStage(stage) {
  const target = ["setup", "switch", "recovery", "features"].includes(stage) ? stage : "setup";
  document.querySelectorAll("[data-tutorial-stage]").forEach((button) => {
    const active = button.dataset.tutorialStage === target;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-tutorial-stage-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.tutorialStagePanel !== target;
  });
}

function openTutorial() {
  selectTutorialStage("setup");
  $("#tutorialDialog").showModal();
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
        : Object.keys(state.auditTasks).length
          ? t("audit.running")
        : updateOperationBusy()
          ? t("status.updating")
        : state.gatewayRunning
          ? t("status.gatewayRunning")
          : t("status.localProgram");
}

function updateOperationControls() {
  const busy = operationBusy();
  if ($("#syncBtn")) $("#syncBtn").disabled = busy;
  $("#cleanupBtn").disabled = busy;
  $("#pluginBtn").disabled = busy;
  $("#diagnosticsBtn").disabled = busy;
  $("#addProfileBtn").disabled = busy;
  $("#adHocAuditBtn").disabled = busy;
  if ($("#search")) $("#search").disabled = busy;
  if ($("#projectFilter")) $("#projectFilter").disabled = busy;
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
  $("#statusGateway").textContent = state.gatewayRunning ? t("common.running") : t("common.notRunning");
  $("#statusCodex").textContent = t("status.codexSummary", {
    running,
    provider: state.codexProvider || t("common.providerNotConfigured"),
  });
  if ($("#libraryMeta")) {
    $("#libraryMeta").textContent = t("threads.summary", {
      count: state.threads.length,
      time: state.librarySyncedAt ? formatDate(state.librarySyncedAt) : t("common.notSynced"),
    });
  }
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
  if (profile.lastAudit?.testedAt) {
    return t("profile.recentAudit", {
      score: Math.round(Number(profile.lastAudit.score) || 0),
      assessment: auditAssessmentLabel(profile.lastAudit.assessment),
      time: formatDate(profile.lastAudit.testedAt),
    });
  }
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
    root.innerHTML = state.profiles.map((profile, index) => {
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
          <button data-action="move-top" data-id="${escapeHtml(profile.id)}" aria-label="${t("profile.moveTop")} ${escapeHtml(profile.name)}"${disabled || index === 0 ? " disabled" : ""}>${t("profile.moveTop")}</button>
          <button data-action="move-bottom" data-id="${escapeHtml(profile.id)}" aria-label="${t("profile.moveBottom")} ${escapeHtml(profile.name)}"${disabled || index === state.profiles.length - 1 ? " disabled" : ""}>${t("profile.moveBottom")}</button>
          <button data-action="move-up" data-id="${escapeHtml(profile.id)}" title="${t("profile.moveUp")}" aria-label="${t("profile.moveUp")} ${escapeHtml(profile.name)}"${disabled || index === 0 ? " disabled" : ""}>↑</button>
          <button data-action="move-down" data-id="${escapeHtml(profile.id)}" title="${t("profile.moveDown")}" aria-label="${t("profile.moveDown")} ${escapeHtml(profile.name)}"${disabled || index === state.profiles.length - 1 ? " disabled" : ""}>↓</button>
          ${current ? `<span class="profile-status">${t("common.current")}</span>` : ""}
          <button data-action="edit" data-id="${escapeHtml(profile.id)}" title="${t("profile.editTitle")}" aria-label="${t("profile.editTitle")} ${escapeHtml(profile.name)}"${disabled}>${t("common.edit")}</button>
          ${profile.kind === "official" ? `<button data-action="capture" data-id="${escapeHtml(profile.id)}" title="${t("profile.captureTitle")}"${disabled}>${t("common.capture")}</button>` : `<button data-action="test" data-id="${escapeHtml(profile.id)}" title="${t("profile.testTitle")}"${disabled}>${state.testingProfileId === profile.id ? t("profile.testRunning") : t("common.test")}</button><button data-action="audit" data-id="${escapeHtml(profile.id)}" title="${t("audit.adHoc")}"${disabled}>${t("actions.audit")}</button><button data-action="clear-key" data-id="${escapeHtml(profile.id)}" title="${current ? t("profile.currentCannotClear") : profile.hasApiKey ? t("common.clearKey") : t("profile.actions.noKey")}"${disabled || current || !profile.hasApiKey ? " disabled" : ""}>${t("common.clearKey")}</button>`}
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
  if (!$("#threads") || !$("#search") || !$("#projectFilter")) return;
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
  if (!$("#projectFilter")) return;
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
  const activeAuditIds = new Set((snapshot.audits || []).map((audit) => audit.taskId));
  for (const taskId of Object.keys(state.auditTasks)) {
    if (!activeAuditIds.has(taskId)) delete state.auditTasks[taskId];
  }
  for (const audit of snapshot.audits || []) {
    if (!audit.done) state.auditTasks[audit.taskId] = { ...audit, progressAt: Date.now() };
  }
  if (Object.keys(state.auditTasks).length) {
    $("#auditProgress").hidden = false;
    renderAuditCountdown();
    startAuditCountdown();
  }
  if (!state.profiles.some((profile) => profile.id === state.selectedProfileId)) {
    state.selectedProfileId = state.currentId || state.profiles[0]?.id || null;
  }
  $("#codexHome").textContent = snapshot.codex.home;
  applyLanguage();
  renderReleaseRecord();
  loadRankings().catch(() => {});
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
  $("#activeTasks").innerHTML = (request.tasks || []).map(task => `<div class="active-task"><div><strong>${escapeHtml(task.title || task.id || t("common.unknown"))}</strong><small>${escapeHtml(/automation|cron|heartbeat/i.test(task.source) ? t("confirm.automation") : /subagent|sub_agent|internal/i.test(task.source) ? t("confirm.background") : t("confirm.chat"))} · ${escapeHtml(t("confirm.running"))} · ${escapeHtml(t("confirm.lastActivity"))} ${escapeHtml(formatDate(task.lastActivityAt))}</small><small>${escapeHtml(task.cwd || task.id)}</small></div>${/^[0-9a-f-]{36}$/i.test(task.id) ? `<button class="button secondary" data-task-id="${escapeHtml(task.id)}">${t("confirm.openTask")}</button>` : ""}</div>`).join("") || (request.canContinue === false ? `<p class="confirm-detail">${t("confirm.unknownTasks")}</p>` : "");
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
  return ["repairable", "blocked"].includes(thread?.health?.status) || threadNeedsNewContinuation(thread);
}

const LARGE_THREAD_FILE_BYTES = 20 * 1024 * 1024;

function threadNeedsNewContinuation(thread) {
  return Number(thread?.health?.fileSize || 0) >= LARGE_THREAD_FILE_BYTES;
}

function threadDeepLink(thread) {
  return thread?.id ? `codex://threads/${encodeURIComponent(String(thread.id))}` : "";
}

function continuationPrompt(thread) {
  const link = threadDeepLink(thread);
  const project = thread?.cwd || "当前项目目录";
  return `请在项目目录 ${project} 中继续这个具体聊天未完成的工作。\n\n原聊天深度链接：${link}\n\n请先打开并理解这个聊天的上下文，再读取项目文件和 .codex-project 进度；不要删除历史，不要修改代码，先说明你理解的未完成任务和下一步。`;
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
  const largeContext = threadNeedsNewContinuation(thread);
  $("#dialogLargeContext").hidden = !largeContext;
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
  form.elements.homepage.value = profile?.homepage || "";
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

function auditAssessmentLabel(value) {
  return t(`audit.assessment.${value || "inconclusive"}`);
}

function renderRankingItems(items, target = $("#rankingsList"), ranking = {}) {
  if (!target) return;
  if (!Array.isArray(items) || !items.length) {
    target.innerHTML = `<div class="empty">${t("audit.rankingsLoading")}</div>`;
    return;
  }
  const detailed = target?.id === "rankingsList";
  const visibleItems = items;
  target.innerHTML = visibleItems.map((item, index) => {
    const visitUrl = safeHomepageForDisplay(item.homepage) || safeHomepageForDisplay(`https://${item.base_host || ""}/`);
    const rankingScore = Math.round(Number(item.ranking_score) || Number(item.score) || 0);
    const level = rankingScore >= 90 ? "excellent" : rankingScore >= 75 ? "good" : rankingScore >= 60 ? "usable" : rankingScore >= 50 ? "uncertain" : "risky";
    const body = `
    <span class="ranking-number">${item.rank || index + 1}</span>
    <div class="ranking-main"><strong>${escapeHtml(item.provider_name || item.base_host)}</strong><small>${escapeHtml(item.expected_model || item.model || "")}${item.observed_model ? ` → ${escapeHtml(item.observed_model)}` : ""} · ${escapeHtml(t("audit.tests", { count: item.samples || 0 }))}</small>${detailed ? `<small>${escapeHtml(t("audit.scoreBreakdown", { protocol: item.protocol_score || 0, model: item.model_score || 0, effort: item.effort_score || 0, stability: item.stability_score || 0, speed: item.speed_score || 0 }))}</small><small class="ranking-footer"><span>${escapeHtml(t("audit.historySite90", { score: item.history_90d_max || item.ranking_score || item.score || 0 }))}</span><span>${escapeHtml(t("audit.latest", { time: formatDate(item.last_test) }))}</span></small>` : ""}</div>
    <b class="ranking-score">${escapeHtml(t("audit.scoreUnit", { score: rankingScore }))}<small>${escapeHtml(t(`audit.level.${level}`))}</small></b>
    <span class="ranking-link">↗</span>`;
    return visitUrl
      ? `<a class="ranking-item" href="${escapeHtml(visitUrl)}" target="_blank" rel="noreferrer">${body}</a>`
      : `<div class="ranking-item">${body}</div>`;
  }).join("");
}

function safeHomepageForDisplay(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

async function loadRankings(target = $("#rankingsList"), sort = $("#rankingSort")?.value || "overall") {
  try {
    const model = target?.id === "rankingsList" ? $("#rankingModel")?.value || "" : "";
    const ranking = unwrap(await bridge.getRankings(sort, model));
    renderRankingItems(ranking.items, target, ranking);
    populateRankingModels(ranking.models);
    if ($("#rankingHistory90")) $("#rankingHistory90").textContent = t("audit.history90", { score: ranking.history90dMax || 0 });
    return ranking.items;
  } catch (error) {
    if (target) target.innerHTML = `<div class="empty">${t("audit.rankingsUnavailable")}</div>`;
    return [];
  }
}

function populateRankingModels(models = []) {
  const select = $("#rankingModel");
  if (!select) return;
  const previous = select.value;
  const values = [...new Set(models.filter(Boolean))].sort();
  select.innerHTML = `<option value="">${t("audit.modelAll")}</option>` + values.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
  if (values.includes(previous)) select.value = previous;
}

function fillAuditForm(profile = null) {
  const form = $("#relayAuditForm");
  if (!profile) {
    form.elements.providerName.value = "";
    form.elements.homepage.value = "";
    form.elements.baseUrl.value = "";
    form.elements.model.value = "";
    form.elements.apiKey.value = "";
    form.elements.apiKey.required = true;
    return;
  }
  form.elements.providerName.value = profile.name || "";
  form.elements.homepage.value = profile.homepage || "";
  form.elements.baseUrl.value = profile.baseUrl || "";
  form.elements.model.value = profile.resolvedModel || profile.model || "";
  form.elements.apiKey.value = "";
  form.elements.apiKey.required = false;
}

function openRelayAudit(profile = null) {
  const form = $("#relayAuditForm");
  form.reset();
  fillAuditForm(profile);
  $("#auditResult").hidden = true;
  $("#relayAuditDialog").showModal();
}

function formatRemaining(ms) {
  const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  if (currentLanguage === "en") {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function updateAuditProgress(progress) {
  const root = $("#auditProgress");
  if (!root) return;
  const taskId = progress?.taskId;
  if (!taskId) return;
  if (!state.auditTasks[taskId]) state.auditTasks[taskId] = { taskId, items: [] };
  const task = state.auditTasks[taskId];
  const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
  if (!progress?.done && progress?.stage !== "error") {
    state.auditTasks[taskId] = {
      ...task,
      taskId: progress?.taskId || task.taskId,
      status: progress?.status || task.status || "running",
      percent,
      stage: progress.message || t("audit.running"),
      estimatedRemainingMs: Math.max(0, Number(progress?.estimatedRemainingMs) || 0),
      progressAt: Date.now(),
      items: Array.isArray(progress?.items) ? progress.items : task.items || [],
    };
  }
  state.auditTasks[taskId] = { ...state.auditTasks[taskId], items: progress.items || state.auditTasks[taskId].items };
  renderAuditCountdown();
  if (progress?.done || progress?.stage === "error") {
    delete state.auditTasks[taskId];
    root.hidden = Object.keys(state.auditTasks).length === 0;
    updateOperationControls();
    if (progress.stage === "complete" && Array.isArray(progress.value?.items)) {
      const reports = progress.value.items;
      state.lastAuditResult = reports;
      showAuditComplete(reports);
      const successful = reports.filter((item) => item.result).length;
      notice(t("audit.batchComplete", { success: successful, total: reports.length }));
      loadRankings().catch(() => {});
      refresh().catch(() => {});
    } else if (progress.error) {
      showAuditComplete([{ name: "API", error: progress.error }]);
      notice(progress.error, true);
    }
  }
}

function renderAuditCountdown() {
  const tasks = Object.values(state.auditTasks);
  if (!tasks.length) {
    if (auditCountdownTimer) {
      clearInterval(auditCountdownTimer);
      auditCountdownTimer = null;
    }
    if ($("#auditProgress")) $("#auditProgress").hidden = true;
    return;
  }
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status !== "running").length;
  const now = Date.now();
  const remaining = Math.max(...tasks.map((task) => Math.max(
    0,
    Number(task.estimatedRemainingMs || 0) - Math.max(0, now - Number(task.progressAt || now)),
  )), 0);
  $("#auditProgressMessage").textContent = t("audit.queueStatus", { running, queued, time: formatRemaining(remaining) });
  $("#auditProgressPercent").textContent = `${Math.round(tasks.reduce((sum, task) => sum + (Number(task.percent) || 0), 0) / tasks.length)}%`;
  $("#auditProgressBar").value = Number($("#auditProgressPercent").textContent.replace("%", "")) || 0;
  const list = $("#auditProgressList");
  if (list) {
    list.innerHTML = tasks.flatMap((task) => task.items || [{ name: task.taskId, percent: task.percent, message: task.stage }]).map((item) => `<div class="audit-progress-item">
      <span>${escapeHtml(item.name || "API")}</span><small>${escapeHtml(item.message || item.stage || t("audit.running"))}</small><strong>${Math.max(0, Math.min(100, Number(item.percent) || 0))}%</strong>
    </div>`).join("");
  }
}

function startAuditCountdown() {
  if (auditCountdownTimer) return;
  auditCountdownTimer = window.setInterval(renderAuditCountdown, 1000);
}

function modelVerdictLabel(value) {
  return t(`audit.model.${value || "unverified"}`);
}

function checkDetail(check) {
  if (check.key === "catalog") return t("audit.check.catalogDetail", { status: check.httpStatus || 0, count: check.modelsCount || 0 });
  if (check.key === "model") {
    return `${t("audit.expectedModel")}: ${check.expectedModel || t("common.none")} · ${t("audit.requestedModel")}: ${check.requestedModel || t("common.none")} · ${t("audit.observedModel")}: ${check.observedModel || t("audit.modelUnknown")}`;
  }
  if (check.key === "responses") return t("audit.check.responsesDetail", { success: check.successCount || 0, total: check.total || 0, ids: check.responseIdCount || 0, usage: check.usageCount || 0 });
  if (check.key === "reasoning") return t("audit.check.reasoningDetail", { success: check.successCount || 0, total: check.total || 0 });
  if (check.key === "stability") return t("audit.check.stabilityDetail", { success: check.successCount || 0, total: check.total || 0, timeouts: check.timeoutCount || 0 });
  return t("audit.check.performanceDetail", { time: check.averageMs == null ? t("common.unknown") : `${check.averageMs} ms` });
}

function renderAuditReport(item) {
  if (!item?.result) {
    return `<article class="audit-report suspicious"><div class="audit-report-head"><strong>${escapeHtml(item?.name || "API")}</strong><b>${escapeHtml(t("audit.failedTitle"))}</b></div><p>${escapeHtml(item?.error || t("common.unknown"))}</p></article>`;
  }
  const result = item.result;
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const score = result.score?.total ?? 0;
  return `<article class="audit-report ${escapeHtml(result.assessment || "")}">
    <div class="audit-report-head"><div><strong>${escapeHtml(item.name || result.profile?.name || result.baseHost || "API")}</strong><small>${escapeHtml(result.baseHost || "")}</small></div><b>${escapeHtml(t("audit.scoreUnit", { score }))}</b></div>
    <div class="audit-model-verdict ${escapeHtml(result.modelVerdict || "unverified")}"><strong>${escapeHtml(modelVerdictLabel(result.modelVerdict))}</strong><span>${escapeHtml(`${t("audit.expectedModel")}: ${result.expectedModel || t("common.none")} · ${t("audit.observedModel")}: ${result.observedModel || t("audit.modelUnknown")}`)}</span></div>
    <div class="audit-check-grid">${checks.map((check) => `<div class="audit-check ${escapeHtml(check.status || "warn")}"><span>${escapeHtml(t(`audit.check.${check.key}`))}</span><b>${escapeHtml(t("audit.checkScore", { score: check.score || 0, max: check.maxScore }))}</b><small>${escapeHtml(t(`audit.check.${check.status || "warn"}`))} · ${escapeHtml(checkDetail(check))}</small></div>`).join("")}</div>
    <details><summary>${escapeHtml(t("audit.effortTitle"))}</summary><div class="audit-effort-list">${(result.efforts || []).map((effort) => `<div>${escapeHtml(t("audit.effortRow", { effort: effort.effort, status: effort.status || 0, time: `${effort.elapsedMs || 0} ms`, result: effort.ok && effort.canary ? t("audit.check.pass") : t("audit.check.fail"), model: effort.observedModels?.[0] || t("audit.modelUnknown") }))}</div>`).join("")}</div></details>
    <p>${escapeHtml((result.findings || []).join("；"))}</p>
    <small>${escapeHtml(item.ranking?.error ? t("audit.rankingFailed", { message: item.ranking.error }) : item.ranking?.skipped ? t("audit.rankingSkipped") : t("audit.rankingSaved"))}</small>
  </article>`;
}

function showAuditComplete(items) {
  const dialog = $("#auditCompleteDialog");
  if (!dialog) return;
  const reports = Array.isArray(items) ? items : [];
  const resultsRoot = $("#auditCompleteResults");
  showAuditComplete.reports = dialog.open ? [...(showAuditComplete.reports || []), ...reports] : reports;
  const allReports = showAuditComplete.reports;
  $("#auditCompleteSummary").textContent = t("audit.batchComplete", { success: allReports.filter((item) => item.result).length, total: allReports.length });
  resultsRoot.innerHTML = allReports.map(renderAuditReport).join("");
  if (!dialog.open) dialog.showModal();
}

async function runRelayAudit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  try {
    const started = unwrap(await bridge.startAudit({
      language: currentLanguage,
      providerName: data.providerName,
      homepage: data.homepage,
      input: {
        baseUrl: data.baseUrl,
        apiKey: data.apiKey,
        model: data.model,
      },
    }));
    state.auditTasks[started.taskId] = { taskId: started.taskId, status: started.queued ? "queued" : "running", percent: 0, stage: started.queued ? t("audit.queued") : t("audit.running"), estimatedRemainingMs: started.estimatedTotalMs, progressAt: Date.now(), items: [{ name: data.providerName || "API", percent: 0, message: started.queued ? t("audit.queued") : t("audit.running") }] };
    $("#relayAuditDialog").close();
    form.reset();
    $("#auditProgress").hidden = false;
    $("#auditProgressMessage").textContent = t("audit.progressUnknown", { percent: 0, stage: t("audit.running") });
    $("#auditProgressPercent").textContent = "0%";
    $("#auditProgressBar").value = 0;
    updateOperationControls();
    notice(started.queued ? t("audit.queueStarted", { name: data.providerName || "API" }) : t("audit.backgroundStarted", { name: data.providerName || "API", time: formatRemaining(started.estimatedTotalMs) }));
  } catch (error) {
    notice(error.message, true);
  }
}

async function startSavedProfileAudit(profile) {
  if (!profile || profile.kind !== "api") return;
  if (!profile.hasApiKey) return notice(t("profile.switchMissingKey"), true);
  try {
    const started = unwrap(await bridge.startAudit({
      language: currentLanguage,
      profileId: profile.id,
      providerName: profile.name,
      homepage: profile.homepage,
    }));
    state.auditTasks[started.taskId] = { taskId: started.taskId, profileId: profile.id, status: started.queued ? "queued" : "running", percent: 0, stage: started.queued ? t("audit.queued") : t("audit.running"), estimatedRemainingMs: started.estimatedTotalMs, progressAt: Date.now(), items: [{ profileId: profile.id, name: profile.name, percent: 0, message: started.queued ? t("audit.queued") : t("audit.running") }] };
    $("#auditProgress").hidden = false;
    $("#auditProgressMessage").textContent = t("audit.progressUnknown", { percent: 0, stage: t("audit.running") });
    $("#auditProgressPercent").textContent = "0%";
    $("#auditProgressBar").value = 0;
    updateOperationControls();
    notice(started.queued ? t("audit.queueStarted", { name: profile.name }) : t("audit.backgroundStarted", { name: profile.name, time: formatRemaining(started.estimatedTotalMs) }));
  } catch (error) { notice(error.message, true); }
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

if ($("#syncBtn")) $("#syncBtn").addEventListener("click", sync);
$("#updateBtn").addEventListener("click", handleUpdateAction);
$("#languageSelect").addEventListener("change", (event) => setLanguage(event.currentTarget.value));
$("#tutorialBtn").addEventListener("click", openTutorial);
$("#reloadRankings").addEventListener("click", () => loadRankings($("#rankingsList")));
$("#rankingSort").addEventListener("change", () => loadRankings($("#rankingsList")));
$("#rankingModel").addEventListener("change", () => loadRankings($("#rankingsList")));
$("#adHocAuditBtn").addEventListener("click", () => openRelayAudit());
$("#closeRelayAudit").addEventListener("click", () => $("#relayAuditDialog").close());
$("#cancelRelayAudit").addEventListener("click", () => $("#relayAuditDialog").close());
$("#relayAuditForm").addEventListener("submit", runRelayAudit);
$("#closeAuditComplete").addEventListener("click", () => $("#auditCompleteDialog").close());
$("#dismissAuditComplete").addEventListener("click", () => $("#auditCompleteDialog").close());
document.querySelectorAll("[data-tutorial-stage]").forEach((button) => {
  button.addEventListener("click", () => selectTutorialStage(button.dataset.tutorialStage));
  button.addEventListener("keydown", (event) => {
    const buttons = [...document.querySelectorAll("[data-tutorial-stage]")];
    const index = buttons.indexOf(button);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % buttons.length
          : event.key === "ArrowLeft"
            ? (index - 1 + buttons.length) % buttons.length
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = buttons[nextIndex];
    selectTutorialStage(next.dataset.tutorialStage);
    next.focus();
  });
});
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
$("#addProfileBtn").addEventListener("click", () => openProfileForm());
$("#cancelProfileBtn").addEventListener("click", closeProfileForm);
$("#profileForm [name=kind]").addEventListener("change", updateProfileFields);
$("#switchOpenBtn").addEventListener("click", () => state.selectedProfileId && switchAccount(state.selectedProfileId));
$("#closeDialog").addEventListener("click", () => $("#threadDialog").close());
$("#activeTasks").addEventListener("click", async event => {
  const button = event.target.closest("[data-task-id]");
  if (!button) return;
  try { unwrap(await bridge.openActiveTask(state.switchConfirmation, button.dataset.taskId)); }
  catch (error) { notice(error.message, true); }
});
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
$("#copyThreadLinkBtn").addEventListener("click", async () => {
  if (!state.selectedThread) return;
  unwrap(await bridge.copyText(threadDeepLink(state.selectedThread)));
  notice(t("threads.copyLink"));
});
$("#copyContinuationPromptBtn").addEventListener("click", async () => {
  if (!state.selectedThread) return;
  unwrap(await bridge.copyText(continuationPrompt(state.selectedThread)));
  notice(t("threads.continuationPromptCopied"));
});
$("#repairThreadBtn").addEventListener("click", repairSelectedThread);

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
  if (["move-up", "move-down", "move-top", "move-bottom"].includes(action.dataset.action)) {
    const ids = state.profiles.map(item => item.id);
    const index = ids.indexOf(id);
    const next = action.dataset.action === "move-top" ? 0 : action.dataset.action === "move-bottom" ? ids.length - 1 : index + (action.dataset.action === "move-up" ? -1 : 1);
    if (index < 0 || next < 0 || next >= ids.length) return;
    ids.splice(index, 1);
    ids.splice(next, 0, id);
    state.refreshing = true;
    updateOperationControls();
    try { unwrap(await bridge.reorderProfiles(ids)); await refresh(); }
    catch (error) { notice(error.message, true); }
    finally { state.refreshing = false; updateOperationControls(); }
    return;
  }
  if (action.dataset.action === "test") return testProfile(id);
  if (action.dataset.action === "audit") return startSavedProfileAudit(profile);
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
  bridge.onAuditProgress(updateAuditProgress);
  startAuditCountdown();
  bridge.onUpdateStatus(applyUpdateStatus);
  bridge.onSwitchConfirmation(showSwitchConfirmation);
  refresh().catch((error) => notice(error.message, true));
}
