import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, safeStorage, screen, shell, Tray } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultPaths, inspectCodex, captureCurrent, liveProfileMatch, switchProfile as applyProfile } from "../codex.js";
import { runtimePaths, loadProfiles, publicProfiles, saveProfile, profileForSwitch, setCurrent, setResolvedModel } from "../profiles.js";
import { syncConversations, readLibrary, readThreadDetail } from "../sync.js";
import { setPlatformSecretProvider } from "../vault.js";
import { buildMacTerminalArgs, buildResumeArgs, formatResumeCommand, waitForSpawn } from "../launcher.js";
import { switchAccountTransaction } from "../account-switch.js";
import { findCodexDesktopProcesses, findCodexDesktopWindows, stopCodexDesktopAndWait } from "../desktop-process.js";
import { codexOverlayBounds, CODEX_VERSION_OVERLAY_SIZE, selectCodexOverlayTarget } from "./codex-overlay.mjs";
import { prepareGatewayRuntime, ResponsesGateway } from "../responses-gateway.js";
import { recentThreadModels, targetProviderForProfile } from "../provider-sync.js";
import { addMarketplace, installLocalPlugin, listLocalPlugins } from "../plugin-manager.js";
import { cleanupCompletedAutomations, getAutomationSettings, previewCompletedAutomations, setAutomationSettings } from "../automation-cleanup.js";
import { cleanupInvalidProjects, previewInvalidProjects } from "../project-cleanup.js";
import { AppUpdater } from "../app-updater.js";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const codexPaths = defaultPaths();
const dataPaths = runtimePaths();
if (process.env.CODEX_GALAXY_HOME || process.env.GALAXY_CHANNEL_HOME) app.setPath("userData", dataPaths.root);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let switching = false;
let refreshing = false;
let cleaning = false;
let mainWindow = null;
let tray = null;
let quitting = false;
let gatewayStartupError = null;
let switchConfirmationSequence = 0;
const pendingSwitchConfirmations = new Map();
let codexVersionOverlay = null;
let codexVersionOverlayReady = false;
let codexVersionOverlayTimer = null;
let codexVersionOverlayRefreshing = false;
let codexVersionOverlayIntervalMs = 0;
let nativeCodexWindowApiPromise = null;
let nativeCodexWindowApi = null;
let updateCheckTimer = null;
const responsesGateway = new ResponsesGateway({
  fetchUpstream: (url, options) => net.fetch(url, options),
  onModelResolved: ({ profileId, configuredModel, resolvedModel }) => setResolvedModel(profileId, configuredModel, resolvedModel, dataPaths),
});
const appUpdater = new AppUpdater({
  currentVersion: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  fetcher: (url, options) => net.fetch(url, options),
  openRelease: (url) => shell.openExternal(url),
  launchInstaller: launchVerifiedInstaller,
  onStatus: broadcastUpdateStatus,
});

function result(task) {
  return Promise.resolve()
    .then(task)
    .then((value) => ({ ok: true, value }))
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
}

async function getState() {
  const profiles = await publicProfiles(dataPaths);
  let library = await readLibrary(dataPaths.library);
  if (Number(library.version || 1) < 2 || Number(library.catalogVersion || 1) < 4) {
    await syncConversations({
      codexHome: codexPaths.home,
      libraryFile: dataPaths.library,
      accountId: profiles.currentId,
    });
    library = await readLibrary(dataPaths.library);
  }
  const codex = await inspectCodex(codexPaths);
  const running = await findCodexDesktopProcesses();
  const plugins = await listLocalPlugins(codexPaths.home);
  const automation = { settings: await getAutomationSettings(dataPaths.settings), preview: await previewCompletedAutomations(codexPaths.home) };
  return {
    version: app.getVersion(),
    profiles,
    codex: { ...codex, running: running.length > 0 },
    library: {
      syncedAt: library.syncedAt,
      threads: library.threads.map(({ messages, ...thread }) => thread),
    },
    gateway: { ...responsesGateway.status, error: gatewayStartupError },
    plugins,
    automation: { settings: automation.settings, completedFiles: automation.preview.files.length, completedRuns: automation.preview.rows || 0, completedBytes: automation.preview.bytes },
    update: { ...appUpdater.status },
  };
}

function broadcastUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("codex-galaxy:update-status", status);
  }
}

async function launchVerifiedInstaller(installerPath) {
  if (process.platform !== "win32") throw new Error("当前平台不支持直接启动更新安装包。");
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  await waitForSpawn(child);
  child.unref();
  setTimeout(() => {
    quitting = true;
    responsesGateway.stop()
      .catch(() => {})
      .finally(() => app.quit());
  }, 500).unref?.();
}

function startUpdateChecks() {
  appUpdater.check().catch(() => {});
  updateCheckTimer = setInterval(() => {
    appUpdater.check().catch(() => {});
  }, 6 * 60 * 60 * 1000);
  updateCheckTimer.unref?.();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

function hideCodexVersionOverlay() {
  if (codexVersionOverlay && !codexVersionOverlay.isDestroyed() && codexVersionOverlay.isVisible()) codexVersionOverlay.hide();
}

function destroyCodexVersionOverlay() {
  if (codexVersionOverlayTimer) {
    clearInterval(codexVersionOverlayTimer);
    codexVersionOverlayTimer = null;
  }
  codexVersionOverlayIntervalMs = 0;
  codexVersionOverlayReady = false;
  if (codexVersionOverlay && !codexVersionOverlay.isDestroyed()) codexVersionOverlay.destroy();
  codexVersionOverlay = null;
}

function overlayDipBounds(target) {
  const physical = codexOverlayBounds(target, CODEX_VERSION_OVERLAY_SIZE);
  try {
    return screen.screenToDipRect(null, physical);
  } catch {
    return physical;
  }
}

async function loadNativeCodexWindowApi() {
  if (process.platform !== "win32") return null;
  if (!nativeCodexWindowApiPromise) {
    nativeCodexWindowApiPromise = import("./windows-codex-window.mjs")
      .then((module) => { nativeCodexWindowApi = module; return module; })
      .catch(() => null);
  }
  return nativeCodexWindowApiPromise;
}

async function refreshCodexVersionOverlay() {
  if (process.platform !== "win32" || !codexVersionOverlayReady || !codexVersionOverlay || codexVersionOverlay.isDestroyed() || codexVersionOverlayRefreshing) return;
  codexVersionOverlayRefreshing = true;
  try {
    const nativeApi = await loadNativeCodexWindowApi();
    const nextIntervalMs = nativeApi ? 350 : 1600;
    if (codexVersionOverlayIntervalMs !== nextIntervalMs) {
      if (codexVersionOverlayTimer) clearInterval(codexVersionOverlayTimer);
      codexVersionOverlayIntervalMs = nextIntervalMs;
      codexVersionOverlayTimer = setInterval(() => { refreshCodexVersionOverlay().catch(() => {}); }, nextIntervalMs);
      codexVersionOverlayTimer.unref?.();
    }
    const windows = nativeApi ? nativeApi.findCodexWindows() : await findCodexDesktopWindows("win32");
    const target = selectCodexOverlayTarget(windows);
    if (!target) {
      hideCodexVersionOverlay();
      return;
    }
    const nativeDpi = nativeApi ? nativeApi.getCodexWindowDpi(target.hwnd) : 96;
    const nativeScale = nativeApi ? Math.max(0.5, nativeDpi / 96) : 1;
    const physicalBounds = codexOverlayBounds(target, CODEX_VERSION_OVERLAY_SIZE, nativeScale);
    if (nativeApi) {
      codexVersionOverlay.setAlwaysOnTop(false);
      const placed = nativeApi.placeOverlayWindow(
        nativeApi.nativeWindowHandleFromBuffer(codexVersionOverlay.getNativeWindowHandle()),
        target.hwnd,
        physicalBounds,
      );
      if (placed) codexVersionOverlay.showInactive();
      else hideCodexVersionOverlay();
    } else {
      codexVersionOverlay.setAlwaysOnTop(false);
      codexVersionOverlay.setBounds(overlayDipBounds(target), false);
      codexVersionOverlay.showInactive();
    }
  } catch {
    hideCodexVersionOverlay();
  } finally {
    codexVersionOverlayRefreshing = false;
  }
}

function startCodexVersionOverlay() {
  if (process.platform !== "win32" || process.env.CODEX_GALAXY_SKIP_OVERLAY === "1" || codexVersionOverlay) return;
  const overlay = new BrowserWindow({
    ...CODEX_VERSION_OVERLAY_SIZE,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: false,
    backgroundColor: "#00000000",
    title: "Codex Galaxy",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.on("closed", () => {
    if (codexVersionOverlay === overlay) {
      codexVersionOverlay = null;
      codexVersionOverlayReady = false;
    }
  });
  overlay.webContents.once("did-finish-load", () => {
    if (overlay.isDestroyed()) return;
    overlay.webContents.executeJavaScript(`document.getElementById("version").textContent = ${JSON.stringify(app.getVersion())};`).catch(() => {});
    codexVersionOverlayReady = true;
    refreshCodexVersionOverlay().catch(() => {});
  });
  overlay.loadFile(path.join(appRoot, "public", "codex-overlay.html")).catch(() => hideCodexVersionOverlay());
  codexVersionOverlay = overlay;
  codexVersionOverlayIntervalMs = 1600;
  codexVersionOverlayTimer = setInterval(() => { refreshCodexVersionOverlay().catch(() => {}); }, codexVersionOverlayIntervalMs);
  codexVersionOverlayTimer.unref?.();
}

async function quitFromTray() {
  const options = {
    type: "warning",
    title: "退出 Codex Galaxy",
    message: "退出后，本地 Responses 网关会停止。",
    detail: "如果 Codex 正在使用中转 API，当前请求和后续对话将无法继续。请先完成任务或切换到官方账号。",
    buttons: ["保持运行", "仍然退出"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const choice = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options);
  if (choice.response !== 1) return;
  quitting = true;
  await responsesGateway.stop();
  app.quit();
}

function updateGatewayTray() {
  if (!responsesGateway.status.running) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;
  tray = new Tray(path.join(appRoot, "build", "icon.png"));
  tray.setToolTip("Codex Galaxy - 本地 Responses 网关运行中");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Codex Galaxy", click: showMainWindow },
    { type: "separator" },
    { label: "退出", click: () => { quitFromTray().catch(() => {}); } },
  ]));
  tray.on("double-click", showMainWindow);
}

async function prepareProfileRuntime(profile) {
  let preferredModels = [];
  if (profile.kind === "api") {
    const [providerModels, recentModels] = await Promise.all([
      recentThreadModels(codexPaths.home, targetProviderForProfile(profile)),
      recentThreadModels(codexPaths.home),
    ]);
    preferredModels = [...new Set([...providerModels, ...recentModels])];
  }
  const runtime = await prepareGatewayRuntime(responsesGateway, profile, { preferredModels });
  gatewayStartupError = null;
  updateGatewayTray();
  return {
    ...runtime,
    commit: async () => {
      await runtime.commit?.();
      if (profile.kind === "api" && runtime.profile?.modelResolved) {
        await setResolvedModel(profile.id, profile.model, runtime.profile.model, dataPaths);
      }
      updateGatewayTray();
    },
    rollback: async () => {
      await runtime.rollback?.();
      updateGatewayTray();
    },
  };
}

async function restoreCurrentApiGateway() {
  const { data } = await loadProfiles(dataPaths);
  if (!data.currentId) return;
  const profile = await profileForSwitch(data.currentId, dataPaths);
  if (profile.kind !== "api") return;
  const live = await liveProfileMatch(codexPaths, profile, dataPaths.vault);
  if (!live.matches) return;
  const runtime = await prepareProfileRuntime(profile);
  await applyProfile(codexPaths, runtime.profile, dataPaths.vault);
  await runtime.commit?.();
  updateGatewayTray();
}

async function findCodexCli() {
  const candidates = [process.env.CODEX_CLI_PATH].filter(Boolean);
  if (process.platform === "win32") {
    const binRoot = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    if (binRoot) {
      candidates.push(path.join(binRoot, "codex.exe"));
      const entries = await fs.readdir(binRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) candidates.push(path.join(binRoot, entry.name, "codex.exe"));
      }
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      path.join(os.homedir(), "Applications", "Codex.app", "Contents", "Resources", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      path.join(os.homedir(), ".local", "bin", "codex"),
    );
  }
  for (const candidate of candidates) {
    if (candidate && await fs.stat(candidate).then((item) => item.isFile()).catch(() => false)) return candidate;
  }
  return null;
}

async function currentProfile() {
  const { data } = await loadProfiles(dataPaths);
  if (!data.currentId) throw new Error("请先选择要使用的账号。");
  return profileForSwitch(data.currentId, dataPaths);
}

async function launchThread(id, selectedProfile = null) {
  const library = await readLibrary(dataPaths.library);
  const thread = library.threads.find((item) => item.id === id);
  if (!thread) throw new Error("找不到该项目线程，请先刷新项目。");
  const profile = selectedProfile || await currentProfile();
  if (profile.kind === "api" && responsesGateway.status.profileId !== profile.id) {
    const runtime = await prepareProfileRuntime(profile);
    await applyProfile(codexPaths, runtime.profile, dataPaths.vault);
    await runtime.commit?.();
  }
  const cli = await findCodexCli();
  if (cli) {
    const cwd = thread.cwd && await fs.stat(thread.cwd).then((item) => item.isDirectory()).catch(() => false)
      ? thread.cwd
      : os.homedir();
    const resumeModel = profile.kind === "official" ? profile.model : null;
    const resumeArgs = buildResumeArgs(id, resumeModel);
    const executable = process.platform === "darwin" ? "/usr/bin/osascript" : cli;
    const args = process.platform === "darwin" ? buildMacTerminalArgs(cli, resumeArgs, cwd) : resumeArgs;
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    await waitForSpawn(child);
    child.unref();
    const activeModel = profile.kind === "api" ? responsesGateway.status.model || profile.resolvedModel || "自动发现" : profile.model;
    return { method: "cli", command: formatResumeCommand(id, resumeModel), profileId: profile.id, model: activeModel };
  }
  throw new Error("未找到 Codex CLI。请先安装 Codex，或在 CODEX_CLI_PATH 中指定可执行文件。");
}

async function openCodexDesktop() {
  if (process.env.CODEX_GALAXY_SKIP_LAUNCH === "1") return { method: "skipped-for-test" };
  try {
    await shell.openExternal("codex://");
    return { method: "codex-protocol" };
  } catch (protocolError) {
    const fallback = process.platform === "win32"
      ? { command: "explorer.exe", args: ["shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"] }
      : process.platform === "darwin"
        ? { command: "/usr/bin/open", args: ["-a", "Codex"] }
        : null;
    if (!fallback) throw protocolError;
    const child = spawn(fallback.command, fallback.args, { detached: true, stdio: "ignore", windowsHide: true });
    await waitForSpawn(child);
    child.unref();
    return { method: "platform-fallback" };
  }
}

async function exclusiveSwitch(task) {
  if (switching) throw new Error("另一个账号切换仍在进行，请等待完成。");
  if (refreshing) throw new Error("项目刷新仍在进行，请等待完成后再切换账号。");
  if (cleaning) throw new Error("数据清理仍在进行，请等待完成后再切换账号。");
  switching = true;
  try {
    return await task();
  } finally {
    switching = false;
  }
}

async function exclusiveRefresh(task) {
  if (switching) throw new Error("账号切换仍在进行，请等待完成后再刷新项目。");
  if (refreshing) throw new Error("另一个项目刷新仍在进行，请等待完成。");
  if (cleaning) throw new Error("数据清理仍在进行，请等待完成后再刷新项目。");
  refreshing = true;
  try {
    return await task();
  } finally {
    refreshing = false;
  }
}

async function exclusiveCleanup(task) {
  if (switching) throw new Error("账号切换仍在进行，请等待完成后再清理数据。");
  if (refreshing) throw new Error("项目刷新仍在进行，请等待完成后再清理数据。");
  if (cleaning) throw new Error("另一个数据清理仍在进行，请等待完成。");
  cleaning = true;
  try {
    return await task();
  } finally {
    cleaning = false;
  }
}

function progressReporter(event, operationId, channel = "codex-galaxy:switch-progress") {
  return (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send(channel, { operationId, ...progress });
  };
}

async function confirmRunningCodexSwitch(event) {
  const running = await findCodexDesktopProcesses();
  if (!running.length) return true;
  const owner = BrowserWindow.fromWebContents(event.sender) || undefined;
  if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return false;
  const requestId = `switch-${process.pid}-${Date.now()}-${++switchConfirmationSequence}`;
  owner.show();
  owner.focus();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingSwitchConfirmations.delete(requestId);
      resolve(false);
    }, 120000);
    pendingSwitchConfirmations.set(requestId, { sender: owner.webContents, timer, resolve });
    owner.webContents.send("codex-galaxy:confirm-switch", {
      requestId,
      title: "Codex 可能仍有任务进行中",
      message: "检测到 Codex Desktop 正在运行。",
      detail: "Codex Galaxy 无法可靠判断模型是否仍在生成或执行命令。继续切换会关闭 Codex，正在进行的任务可能被中断。\n\n如果任务仍在运行，请取消并先在 Codex 中手动停止；确认没有任务后再切换。",
    });
  });
}

function registerHandlers() {
  ipcMain.on("codex-galaxy:respond-switch-confirmation", (event, payload) => {
    const requestId = String(payload?.requestId || "");
    const pending = pendingSwitchConfirmations.get(requestId);
    if (!pending || pending.sender !== event.sender) return;
    pendingSwitchConfirmations.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(payload?.confirmed === true);
  });
  ipcMain.handle("codex-galaxy:get-state", () => result(getState));
  ipcMain.handle("codex-galaxy:check-update", () => result(() => appUpdater.check()));
  ipcMain.handle("codex-galaxy:install-update", (event, request) => result(async () => {
    const status = appUpdater.status.available
      ? { ...appUpdater.status }
      : await appUpdater.check();
    if (!status.available) return { current: true, status };
    if (status.action === "open-release") return appUpdater.act();

    const english = request?.language === "en";
    const owner = BrowserWindow.fromWebContents(event.sender) || undefined;
    const options = {
      type: "warning",
      title: english ? "Update Codex Galaxy" : "更新 Codex Galaxy",
      message: english
        ? `Download and install Codex Galaxy ${status.latestVersion}?`
        : `下载并安装 Codex Galaxy ${status.latestVersion}？`,
      detail: english
        ? "Setup will close Galaxy and its local API gateway. Finish any active Codex response first; otherwise the current request may be interrupted. Local profiles and chats are retained."
        : "安装程序会关闭 Galaxy 和本地 API 网关。若 Codex 正在生成回复，请先等待当前回复完成，否则请求可能中断；本地账号配置和聊天记录会保留。",
      buttons: english ? ["Cancel", "Download and install"] : ["取消", "下载并安装"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const choice = owner && !owner.isDestroyed()
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options);
    if (choice.response !== 1) return { cancelled: true, status };
    return appUpdater.act();
  }));
  ipcMain.handle("codex-galaxy:sync", (event, request) => result(() => exclusiveRefresh(async () => {
    const { data } = await loadProfiles(dataPaths);
    const report = progressReporter(event, request?.operationId, "codex-galaxy:sync-progress");
    report({ percent: 2, stage: "prepare", message: "正在准备扫描本地项目", completed: 0, total: 0 });
    const synced = await syncConversations({
      codexHome: codexPaths.home,
      libraryFile: dataPaths.library,
      accountId: data.currentId,
      onProgress: ({ phase, completed, total }) => {
        const percent = phase === "complete" ? 100 : phase === "write" ? 96 : total ? 5 + Math.floor((completed / total) * 88) : 5;
        const message = phase === "complete"
          ? "项目刷新完成"
          : phase === "write"
            ? "正在写入本地项目库"
            : total
              ? `正在扫描本地项目 ${completed}/${total}`
              : "未发现待扫描条目";
        report({ percent, stage: phase, message, completed, total });
      },
    });
    const removedMessage = synced.removed ? `，已从列表隐藏 ${synced.removed} 条归档或失效记录` : "";
    report({ percent: 100, stage: "complete", message: `刷新完成，共发现 ${synced.threads} 条有效项目${removedMessage}`, completed: synced.threads, total: synced.threads });
    return synced;
  })));
  ipcMain.handle("codex-galaxy:save-profile", (_, profile) => result(async () => {
    const saved = await saveProfile(profile, dataPaths);
    const profiles = await publicProfiles(dataPaths);
    return { profile: profiles.profiles.find((item) => item.id === saved.id) };
  }));
  ipcMain.handle("codex-galaxy:capture-profile", (_, id) => result(async () => {
    const captured = await captureCurrent(codexPaths, await profileForSwitch(id, dataPaths), dataPaths.vault);
    await setCurrent(id, dataPaths);
    return captured;
  }));
  ipcMain.handle("codex-galaxy:switch-profile", (event, request) => result(() => exclusiveSwitch(async () => {
    const id = typeof request === "string" ? request : request?.profileId;
    if (!id) throw new Error("请选择要切换的账号。");
    const report = progressReporter(event, request?.operationId);
    if (!await confirmRunningCodexSwitch(event)) return { cancelled: true };
    return switchAccountTransaction({
      profileId: id,
      codexPaths,
      dataPaths,
      stopCodexDesktop: stopCodexDesktopAndWait,
      launch: openCodexDesktop,
      prepareRuntime: prepareProfileRuntime,
      launchVerificationDelayMs: 2500,
      onProgress: report,
    });
  })));
  ipcMain.handle("codex-galaxy:get-thread", (_, id) => result(async () => {
    const library = await readLibrary(dataPaths.library);
    const thread = library.threads.find((item) => item.id === id);
    if (!thread) throw new Error("找不到线程");
    return readThreadDetail(thread, codexPaths.home);
  }));
  ipcMain.handle("codex-galaxy:launch-thread", (_, id) => result(() => launchThread(id)));
  ipcMain.handle("codex-galaxy:switch-and-launch", (event, request) => result(() => exclusiveSwitch(async () => {
    if (!request?.profileId || !request?.threadId) throw new Error("账号和线程不能为空。");
    const report = progressReporter(event, request.operationId);
    if (!await confirmRunningCodexSwitch(event)) return { cancelled: true };
    return switchAccountTransaction({
      profileId: request.profileId,
      threadId: request.threadId,
      codexPaths,
      dataPaths,
      stopCodexDesktop: stopCodexDesktopAndWait,
      launch: (profile) => launchThread(request.threadId, profile),
      prepareRuntime: prepareProfileRuntime,
      launchMessage: "正在打开该项目线程",
      launchVerificationDelayMs: 2500,
      onProgress: report,
    });
  })));
  ipcMain.handle("codex-galaxy:copy-text", (_, text) => result(() => clipboard.writeText(String(text))));
  ipcMain.handle("codex-galaxy:install-local-plugin", async (event) => result(async () => {
    const owner = BrowserWindow.fromWebContents(event.sender) || undefined;
    const picked = await dialog.showOpenDialog(owner, { title: "选择 Codex 插件目录", properties: ["openDirectory"] });
    if (picked.canceled || !picked.filePaths[0]) return { cancelled: true };
    const installed = await installLocalPlugin(codexPaths.home, picked.filePaths[0]);
    return { installed };
  }));
  ipcMain.handle("codex-galaxy:add-plugin-marketplace", (_, source) => result(async () => addMarketplace({ codexHome: codexPaths.home, cli: await findCodexCli(), source })));
  ipcMain.handle("codex-galaxy:automation-preview", () => result(() => previewCompletedAutomations(codexPaths.home)));
  ipcMain.handle("codex-galaxy:automation-cleanup", () => result(() => cleanupCompletedAutomations(codexPaths.home, dataPaths.settings, { force: true })));
  ipcMain.handle("codex-galaxy:automation-settings", (_, patch) => result(() => setAutomationSettings(dataPaths.settings, patch)));
  ipcMain.handle("codex-galaxy:data-cleanup-preview", () => result(async () => {
    const [projects, automations, running] = await Promise.all([
      previewInvalidProjects(codexPaths.home, dataPaths.library),
      previewCompletedAutomations(codexPaths.home),
      findCodexDesktopProcesses(),
    ]);
    return { projects, automations, codexRunning: running.length > 0 };
  }));
  ipcMain.handle("codex-galaxy:data-cleanup", (event, request) => result(() => exclusiveCleanup(async () => {
    const cleanProjects = request?.projects === true;
    const cleanAutomations = request?.automations === true;
    if (!cleanProjects && !cleanAutomations) throw new Error("请选择至少一种要清理的数据。");
    const report = progressReporter(event, request?.operationId, "codex-galaxy:cleanup-progress");
    const running = cleanProjects ? await findCodexDesktopProcesses() : [];
    const reopenCodex = running.length > 0;
    let reopenedCodex = false;
    if (reopenCodex) {
      report({ percent: 2, stage: "stop", message: "正在安全关闭 Codex，准备清理项目数据库" });
      await stopCodexDesktopAndWait();
    }
    try {
      let automationResult = null;
      let projectResult = null;
      if (cleanAutomations) {
        report({ percent: cleanProjects ? 5 : 15, stage: "automations", message: "正在备份并清理已完成自动化历史" });
        automationResult = await cleanupCompletedAutomations(codexPaths.home, dataPaths.settings, { force: true });
      }
      if (cleanProjects) {
        projectResult = await cleanupInvalidProjects(codexPaths.home, dataPaths.library, {
          onProgress: (progress) => {
            let percent = 12;
            let message = "正在备份项目数据库";
            if (progress.phase === "compress") {
              const ratio = progress.bytesTotal ? Math.min(1, Number(progress.bytesCompleted || 0) / Number(progress.bytesTotal)) : 0;
              percent = 12 + Math.floor(ratio * 58);
              message = `正在压缩备份归档会话${progress.current ? `：${progress.current}` : ""}`;
            } else if (progress.phase === "database") {
              percent = 76;
              message = `正在清理数据库索引${progress.current ? `：${progress.current}` : ""}`;
            } else if (progress.phase === "index") {
              percent = 84;
              message = "正在清理 Codex 项目名称索引";
            } else if (progress.phase === "library") {
              percent = 88;
              message = "正在清理 Galaxy 项目列表";
            } else if (progress.phase === "remove") {
              percent = 92;
              message = `正在删除已完成备份的归档文件${progress.current ? `：${progress.current}` : ""}`;
            } else if (progress.phase === "complete") {
              percent = 94;
              message = "无效项目数据清理完成";
            }
            report({ percent, stage: progress.phase, message });
          },
        });
        const { data } = await loadProfiles(dataPaths);
        report({ percent: 95, stage: "refresh", message: "正在重建有效项目列表" });
        await syncConversations({
          codexHome: codexPaths.home,
          libraryFile: dataPaths.library,
          accountId: data.currentId,
        });
      }
      if (reopenCodex) {
        report({ percent: 98, stage: "launch", message: "清理完成，正在重新打开 Codex" });
        await openCodexDesktop();
        reopenedCodex = true;
      }
      report({ percent: 100, stage: "complete", message: "数据清理完成" });
      return { projects: projectResult, automations: automationResult, reopenedCodex };
    } catch (error) {
      if (reopenCodex && !reopenedCodex) {
        try {
          report({ percent: 98, stage: "launch", message: "清理未完成，正在恢复打开 Codex" });
          await openCodexDesktop();
          reopenedCodex = true;
        } catch (launchError) {
          throw new Error(`${error instanceof Error ? error.message : String(error)}；Codex 重新打开失败：${launchError instanceof Error ? launchError.message : String(launchError)}`);
        }
      }
      throw error;
    }
  })));
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#090c12",
    title: "Codex Galaxy",
    icon: path.join(appRoot, "build", "icon.png"),
    webPreferences: {
      preload: path.join(appRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  window.loadFile(path.join(appRoot, "public", "index.html"));
  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (!quitting && responsesGateway.status.running) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow = window;
  return window;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.whenReady().then(async () => {
    if (safeStorage.isEncryptionAvailable()) {
      setPlatformSecretProvider({
        scheme: process.platform === "darwin" ? "keychain" : "os-crypt",
        encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
      });
    }
    await restoreCurrentApiGateway().catch((error) => {
      gatewayStartupError = error instanceof Error ? error.message : String(error);
    });
    registerHandlers();
    createWindow();
    startCodexVersionOverlay();
    startUpdateChecks();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Codex Galaxy 启动失败", message);
    app.quit();
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
  destroyCodexVersionOverlay();
});

app.on("will-quit", () => {
  responsesGateway.stop().catch(() => {});
});

app.on("window-all-closed", () => {
  if (responsesGateway.status.running) return;
  if (process.platform !== "darwin") app.quit();
});
