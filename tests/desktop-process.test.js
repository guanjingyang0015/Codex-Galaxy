import test from "node:test";
import assert from "node:assert/strict";
import { isWindowsCodexCliProcess, isWindowsCodexDesktopProcess, stopCodexDesktopAndWait } from "../desktop-process.js";
import { codexOverlayBounds, selectCodexOverlayTarget } from "../electron/codex-overlay.mjs";

test("Windows process filter matches Codex Desktop without matching the CLI or normal ChatGPT", () => {
  assert.equal(isWindowsCodexDesktopProcess({ name: "Codex.exe", executablePath: "C:\\Tools\\Codex.exe" }), true);
  assert.equal(isWindowsCodexDesktopProcess({ name: "codex.exe", executablePath: "C:\\Users\\test\\.codex\\bin\\codex.exe" }), false);
  assert.equal(isWindowsCodexDesktopProcess({
    name: "ChatGPT.exe",
    executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3_x64__id\\app\\ChatGPT.exe",
  }), true);
  assert.equal(isWindowsCodexDesktopProcess({
    name: "codex.exe",
    executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3_x64__id\\app\\resources\\codex.exe",
    commandLine: '"C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3_x64__id\\app\\resources\\codex.exe" -c features.code_mode_host=true app-server --analytics-default-enabled',
  }), true);
  assert.equal(isWindowsCodexDesktopProcess({
    name: "codex.exe",
    executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3_x64__id\\app\\resources\\codex.exe",
    commandLine: '"C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3_x64__id\\app\\resources\\codex.exe" resume thread-id',
  }), false);
  assert.equal(isWindowsCodexDesktopProcess({ name: "ChatGPT.exe", executablePath: "C:\\Apps\\ChatGPT.exe" }), false);
});

test("Windows process filter recognizes Codex CLI writers but not Galaxy or unrelated executables", () => {
  assert.equal(isWindowsCodexCliProcess({
    name: "codex.exe",
    executablePath: "C:\\Users\\test\\.codex\\bin\\codex.exe",
    commandLine: '"C:\\Users\\test\\.codex\\bin\\codex.exe" resume thread-id',
  }), true);
  assert.equal(isWindowsCodexCliProcess({
    name: "codex.exe",
    executablePath: "C:\\Users\\test\\.codex\\bin\\codex.exe",
    commandLine: '"C:\\Users\\test\\.codex\\bin\\codex.exe" app-server',
  }), true);
  assert.equal(isWindowsCodexCliProcess({
    name: "Codex Galaxy.exe",
    executablePath: "C:\\Program Files\\Codex Galaxy\\Codex Galaxy.exe",
    commandLine: '"C:\\Program Files\\Codex Galaxy\\Codex Galaxy.exe"',
  }), false);
  assert.equal(isWindowsCodexCliProcess({
    name: "codex.exe",
    executablePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3_x64__id\\app\\resources\\codex.exe",
    commandLine: '"C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.2.3_x64__id\\app\\resources\\codex.exe" app-server',
  }), false);
  assert.equal(isWindowsCodexCliProcess({
    name: "codex.exe",
    executablePath: "C:\\Users\\test\\.codex\\bin\\codex.exe",
  }), false);
});

test("desktop process shutdown waits until the selected processes exit", async () => {
  let running = [{ pid: 41 }, { pid: 42 }];
  const terminated = [];
  const result = await stopCodexDesktopAndWait({
    platform: "win32",
    listProcesses: async () => running,
    terminate: (pid) => {
      terminated.push(pid);
      running = running.filter((item) => item.pid !== pid);
    },
    pollIntervalMs: 0,
  });
  assert.deepEqual(terminated, [41, 42]);
  assert.deepEqual(result, { stopped: 2, processIds: [41, 42] });
});

test("desktop process shutdown also catches an app-server that appears after the main window exits", async () => {
  let running = [{ pid: 51 }];
  let spawnedResidual = false;
  const terminated = [];
  const result = await stopCodexDesktopAndWait({
    platform: "win32",
    listProcesses: async () => running,
    terminate: (pid) => {
      terminated.push(pid);
      running = running.filter((item) => item.pid !== pid);
      if (pid === 51 && !spawnedResidual) {
        spawnedResidual = true;
        running.push({ pid: 52 });
      }
    },
    pollIntervalMs: 0,
  });
  assert.deepEqual(terminated, [51, 52]);
  assert.deepEqual(result, { stopped: 2, processIds: [51, 52] });
});

test("Codex overlay selects only a visible foreground desktop window and reserves the native controls", () => {
  const target = selectCodexOverlayTarget([
    { pid: 1, visible: true, minimized: false, foreground: false, left: 0, top: 0, right: 1600, bottom: 900 },
    { pid: 2, visible: true, minimized: false, foreground: true, left: 1761, top: 118, right: 3041, bottom: 899, clientLeft: 1761, clientTop: 118, clientRight: 3041, clientBottom: 899 },
    { pid: 3, visible: false, minimized: false, foreground: true, left: 0, top: 0, right: 2000, bottom: 1200 },
  ]);
  assert.equal(target.pid, 2);
  assert.deepEqual(codexOverlayBounds(target), { x: 2631, y: 128, width: 178, height: 26 });
  assert.deepEqual(codexOverlayBounds(target, undefined, 1.5), { x: 2426, y: 133, width: 267, height: 39 });
});
