const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexGalaxy", {
  getState: () => ipcRenderer.invoke("codex-galaxy:get-state"),
  checkUpdate: () => ipcRenderer.invoke("codex-galaxy:check-update"),
  installUpdate: (language) => ipcRenderer.invoke("codex-galaxy:install-update", { language }),
  sync: (operationId) => ipcRenderer.invoke("codex-galaxy:sync", { operationId }),
  saveProfile: (profile) => ipcRenderer.invoke("codex-galaxy:save-profile", profile),
  captureProfile: (id) => ipcRenderer.invoke("codex-galaxy:capture-profile", id),
  switchProfile: (profileId, operationId) => ipcRenderer.invoke("codex-galaxy:switch-profile", { profileId, operationId }),
  getThread: (id) => ipcRenderer.invoke("codex-galaxy:get-thread", id),
  launchThread: (id) => ipcRenderer.invoke("codex-galaxy:launch-thread", id),
  switchAndLaunch: (profileId, threadId, operationId) => ipcRenderer.invoke("codex-galaxy:switch-and-launch", { profileId, threadId, operationId }),
  copyText: (text) => ipcRenderer.invoke("codex-galaxy:copy-text", text),
  installLocalPlugin: () => ipcRenderer.invoke("codex-galaxy:install-local-plugin"),
  expandPluginMarketplace: () => ipcRenderer.invoke("codex-galaxy:expand-plugin-marketplace"),
  addPluginMarketplace: (source) => ipcRenderer.invoke("codex-galaxy:add-plugin-marketplace", source),
  automationPreview: () => ipcRenderer.invoke("codex-galaxy:automation-preview"),
  automationCleanup: () => ipcRenderer.invoke("codex-galaxy:automation-cleanup"),
  automationSettings: (patch) => ipcRenderer.invoke("codex-galaxy:automation-settings", patch),
  dataCleanupPreview: () => ipcRenderer.invoke("codex-galaxy:data-cleanup-preview"),
  dataCleanup: (request) => ipcRenderer.invoke("codex-galaxy:data-cleanup", request),
  onSwitchProgress: (callback) => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on("codex-galaxy:switch-progress", listener);
    return () => ipcRenderer.removeListener("codex-galaxy:switch-progress", listener);
  },
  onSyncProgress: (callback) => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on("codex-galaxy:sync-progress", listener);
    return () => ipcRenderer.removeListener("codex-galaxy:sync-progress", listener);
  },
  onCleanupProgress: (callback) => {
    const listener = (_, progress) => callback(progress);
    ipcRenderer.on("codex-galaxy:cleanup-progress", listener);
    return () => ipcRenderer.removeListener("codex-galaxy:cleanup-progress", listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on("codex-galaxy:update-status", listener);
    return () => ipcRenderer.removeListener("codex-galaxy:update-status", listener);
  },
  onSwitchConfirmation: (callback) => {
    const listener = (_, request) => callback(request);
    ipcRenderer.on("codex-galaxy:confirm-switch", listener);
    return () => ipcRenderer.removeListener("codex-galaxy:confirm-switch", listener);
  },
  respondSwitchConfirmation: (requestId, confirmed) => {
    ipcRenderer.send("codex-galaxy:respond-switch-confirmation", { requestId, confirmed: confirmed === true });
  },
});
