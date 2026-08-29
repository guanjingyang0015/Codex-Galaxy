import fs from "node:fs/promises";
import path from "node:path";
import {
  captureCurrent,
  liveProfileMatch,
  restoreLiveFiles,
  snapshotLiveFiles,
  switchProfile as applyProfile,
} from "./codex.js";
import { loadProfiles, profileForSwitch, safeProfile, setCurrent } from "./profiles.js";
import { restoreProviderMetadata, syncProviderMetadata, targetProviderForProfile } from "./provider-sync.js";
import { syncConversations } from "./sync.js";
import { cleanupCompletedAutomations } from "./automation-cleanup.js";

async function snapshotFile(file) {
  return fs.readFile(file).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
}

async function restoreFile(file, contents) {
  if (contents === null) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${Date.now()}.galaxy-rollback.tmp`;
  await fs.writeFile(temporary, contents, { mode: 0o600 });
  await fs.rename(temporary, file);
}

function conversationProgress(onProgress, { start, end, stage, label }) {
  let lastPercent = -1;
  return ({ phase, completed, total }) => {
    const percent = phase === "complete"
      ? end
      : phase === "write"
        ? end - 1
        : total
          ? start + Math.floor((completed / total) * (end - start - 1))
          : start;
    if (percent === lastPercent && phase === "scan" && completed !== total) return;
    lastPercent = percent;
    const message = phase === "complete"
      ? `${label}完成`
      : phase === "write"
        ? `${label}，正在写入本地项目库`
        : total
          ? `${label} ${completed}/${total}`
          : `${label}，未发现待扫描条目`;
    onProgress({ percent, stage, message, completed, total });
  };
}

function formatProgressBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(megabytes))} MB`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "预计不到 1 分钟";
  const rounded = Math.max(1, Math.ceil(seconds));
  if (rounded < 60) return `预计约 ${rounded} 秒`;
  const minutes = Math.ceil(rounded / 60);
  if (minutes < 60) return `预计约 ${minutes} 分钟`;
  return `预计约 ${Math.ceil(minutes / 60)} 小时`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProfileMatch(check, { timeoutMs = 8000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let latest = { matches: false };
  do {
    latest = await check();
    if (latest.matches) return latest;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await wait(Math.min(Math.max(10, intervalMs), remaining));
  } while (Date.now() <= deadline);
  return latest;
}

function createProgressReporter(onProgress) {
  const startedAt = Date.now();
  return (progress) => {
    const percent = Number(progress?.percent);
    const elapsed = (Date.now() - startedAt) / 1000;
    const etaSeconds = Number.isFinite(percent) && percent >= 8 && percent < 99 && elapsed > 1
      ? elapsed * (100 - percent) / percent
      : null;
    const baseMessage = String(progress?.message || "正在切换");
    const message = etaSeconds ? `${baseMessage} · ${formatEta(etaSeconds)}` : baseMessage;
    onProgress({ ...progress, message, etaSeconds });
  };
}

export async function switchAccountTransaction({
  profileId,
  threadId = null,
  codexPaths,
  dataPaths,
  stopCodexDesktop,
  launch,
  prepareRuntime = async (profile) => ({ profile }),
  launchMessage = "正在打开 Codex",
  launchVerificationDelayMs = 0,
  launchVerificationTimeoutMs = 8000,
  launchVerificationPollIntervalMs = 100,
  onProgress = () => {},
}) {
  if (!profileId) throw new Error("请选择要切换的账号。");
  const { data } = await loadProfiles(dataPaths);
  const profile = await profileForSwitch(profileId, dataPaths);
  const report = createProgressReporter(onProgress);

  report({ percent: 5, stage: "prepare", message: "正在检查账号和本地 Codex 状态" });
  report({ percent: 10, stage: "stop", message: "正在安全关闭 Codex Desktop" });
  const stopped = await stopCodexDesktop();

  const [liveSnapshot, profilesSnapshot, vaultSnapshot, librarySnapshot] = await Promise.all([
    snapshotLiveFiles(codexPaths),
    snapshotFile(dataPaths.profiles),
    snapshotFile(dataPaths.vault),
    snapshotFile(dataPaths.library),
  ]);
  let providerSync = null;
  let runtime = null;
  let automationCleanup = null;

  try {
    let currentProfile = null;
    let currentMatch = { matches: false };
    if (data.currentId) {
      currentProfile = data.profiles.some((item) => item.id === data.currentId)
        ? await profileForSwitch(data.currentId, dataPaths)
        : null;
      currentMatch = currentProfile ? await liveProfileMatch(codexPaths, currentProfile, dataPaths.vault) : currentMatch;
    }

    report({ percent: 14, stage: "cleanup", message: "正在检查已完成的自动化任务" });
    automationCleanup = await cleanupCompletedAutomations(codexPaths.home, dataPaths.settings || path.join(dataPaths.root, "settings.json"));
    if (automationCleanup.files || automationCleanup.rows) report({ percent: 15, stage: "cleanup", message: `已清理 ${automationCleanup.files || 0} 个历史文件和 ${automationCleanup.rows || 0} 条已完成自动化记录` });
    report({ percent: 16, stage: "pre-sync", message: "正在保存最新本地项目记录" });
    const preSwitchSync = await syncConversations({
      codexHome: codexPaths.home,
      libraryFile: dataPaths.library,
      accountId: currentMatch.matches ? data.currentId : null,
      onProgress: conversationProgress(report, { start: 16, end: 24, stage: "pre-sync", label: "正在保存最新本地记录" }),
    });

    if (data.currentId && data.currentId !== profileId) {
      if (currentProfile && currentMatch.matches) {
        if (currentProfile.kind === "official") {
          report({ percent: 25, stage: "capture", message: `正在保存 ${currentProfile.name} 的登录状态` });
          await captureCurrent(codexPaths, currentProfile, dataPaths.vault);
        } else {
          report({ percent: 25, stage: "capture", message: `${currentProfile.name} 的 API 凭据已安全保存` });
        }
      } else {
        report({ percent: 25, stage: "recover", message: "检测到上次未完成的切换，正在自动修复" });
      }
    }

    const targetMatch = await liveProfileMatch(codexPaths, profile, dataPaths.vault);

    report({
      percent: 31,
      stage: "gateway",
      message: profile.kind !== "api"
        ? "正在准备官方直连模式"
        : profile.runtimeMode === "gateway"
          ? "正在启动兼容 Responses 网关"
          : "正在准备 API 直连模式",
    });
    runtime = await prepareRuntime(profile);
    const effectiveProfile = runtime?.profile || profile;
    if (profile.kind === "api" && effectiveProfile.model !== profile.model) {
      report({ percent: 34, stage: "model", message: `${profile.model ? "已确认中转站可用模型" : "已自动选择中转站模型"} ${effectiveProfile.model}` });
    }

    report({ percent: 35, stage: "credentials", message: `正在切换到 ${profile.name}` });
    const switched = targetMatch.matches && !runtime?.forceApply
      ? { profile: profile.id, backupDir: null, recoveredLiveState: data.currentId !== profileId }
      : await applyProfile(codexPaths, effectiveProfile, dataPaths.vault);
    const appliedMatch = await liveProfileMatch(codexPaths, effectiveProfile, dataPaths.vault);
    if (!appliedMatch.matches) {
      throw new Error(`目标账号 ${profile.name} 的本地登录配置校验失败（${appliedMatch.reason || "状态不一致"}），已停止继续启动。`);
    }

    report({ percent: 47, stage: "history", message: profile.kind === "api" ? "正在同步本地线程的 API 路由" : "正在同步本地线程的官方账号和模型" });
    let lastProgress = -1;
    let lastPhase = null;
    providerSync = await syncProviderMetadata({
      codexHome: codexPaths.home,
      targetProvider: targetProviderForProfile(profile),
      targetModel: profile.kind === "official" ? profile.model : null,
      messageIdScanThreadId: profile.kind === "official" ? threadId : null,
      onProgress: ({ phase, completed, total, processedBytes, totalBytes, scanFiles, cachedFiles }) => {
        let percent = 76;
        let message = "有效线程同步完成";
        if (phase === "scan") {
          percent = totalBytes
            ? 47 + Math.floor((processedBytes / totalBytes) * 4)
            : total
              ? 47 + Math.floor((completed / total) * 4)
              : 51;
          message = totalBytes
            ? `正在检查跨接口聊天兼容性 ${formatProgressBytes(processedBytes)}/${formatProgressBytes(totalBytes)}${Number.isInteger(scanFiles) ? `（仅检查 ${scanFiles} 个变化文件，已缓存 ${cachedFiles || 0} 个）` : ""}`
            : Number.isInteger(scanFiles) && scanFiles === 0
              ? `跨接口聊天兼容性已缓存（${cachedFiles || 0} 个文件无需重新扫描）`
            : total
              ? `正在检查有效线程 ${completed}/${total}`
              : "未发现有效线程文件";
        } else if (phase === "rewrite") {
          percent = totalBytes ? 51 + Math.floor((processedBytes / totalBytes) * 23) : 74;
          message = totalBytes
            ? `正在低内存更新有效线程 ${formatProgressBytes(processedBytes)}/${formatProgressBytes(totalBytes)}`
            : "有效线程无需改写";
        } else if (phase === "database") {
          percent = 75;
          message = "正在更新 Codex 本地线程索引";
        }
        if (percent === lastProgress && phase === lastPhase && completed !== total) return;
        lastProgress = percent;
        lastPhase = phase;
        report({
          percent,
          stage: "history",
          message,
          completed,
          total,
        });
      },
    });

    report({ percent: 83, stage: "library", message: "正在为目标账号刷新项目列表" });
    const conversationSync = await syncConversations({
      codexHome: codexPaths.home,
      libraryFile: dataPaths.library,
      accountId: profileId,
      onProgress: conversationProgress(report, { start: 83, end: 91, stage: "library", label: "正在为目标账号刷新项目" }),
    });
    await setCurrent(profileId, dataPaths);
    await runtime?.commit?.();
    report({ percent: 92, stage: "activated", message: "账号和项目记录已切换完成" });
    report({ percent: 96, stage: "launch", message: launchMessage });
    const launched = await launch(profile);
    if (launchVerificationDelayMs > 0) await wait(launchVerificationDelayMs);
    report({ percent: 98, stage: "verify-launch", message: "正在确认 Codex 启动后的登录状态" });
    const launchedMatch = await waitForProfileMatch(
      () => liveProfileMatch(codexPaths, effectiveProfile, dataPaths.vault),
      { timeoutMs: launchVerificationTimeoutMs, intervalMs: launchVerificationPollIntervalMs },
    );
    if (!launchedMatch.matches) {
      report({ percent: 98, stage: "stop-invalid", message: "检测到 Codex 回写了其他登录状态，正在安全停止并恢复" });
      await stopCodexDesktop();
      throw new Error(`Codex 启动后未保持目标账号 ${profile.name}（${launchedMatch.reason || "状态不一致"}），已阻止错误账号继续运行`);
    }
    report({ percent: 100, stage: "complete", message: "本地同步完成，切换完成，可以继续原项目" });
    return { profile: safeProfile(profile), switched, preSwitchSync, providerSync, conversationSync, automationCleanup, stopped, launched };
  } catch (error) {
    report({ percent: 94, stage: "rollback", message: "切换未完成，正在恢复原账号状态" });
    const rollbackErrors = [];
    if (providerSync?.backupDir) {
      await restoreProviderMetadata({ codexHome: codexPaths.home, backupDir: providerSync.backupDir }).catch((rollbackError) => rollbackErrors.push(rollbackError));
    }
    await runtime?.rollback?.().catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreLiveFiles(codexPaths, liveSnapshot).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreFile(dataPaths.profiles, profilesSnapshot).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreFile(dataPaths.vault, vaultSnapshot).catch((rollbackError) => rollbackErrors.push(rollbackError));
    await restoreFile(dataPaths.library, librarySnapshot).catch((rollbackError) => rollbackErrors.push(rollbackError));
    const message = error instanceof Error ? error.message : String(error);
    if (rollbackErrors.length) throw new Error(`${message}；自动恢复未完全成功，请不要打开 Codex，并在教程的“异常恢复”中处理。`);
    throw new Error(`${message}；已自动恢复切换前状态，可以重试。`);
  }
}
