import { spawn } from "node:child_process";

const STOP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

export function isWindowsCodexDesktopProcess(processInfo) {
  const name = String(processInfo?.name || "");
  if (name === "Codex.exe") return true;
  if (!/^(ChatGPT|codex)\.exe$/i.test(name)) return false;

  const executable = String(processInfo?.executablePath || "").replaceAll("/", "\\").toLowerCase();
  const marker = "\\windowsapps\\";
  const markerIndex = executable.indexOf(marker);
  if (markerIndex < 0) return false;
  const afterWindowsApps = executable.slice(markerIndex + marker.length);
  const slash = afterWindowsApps.indexOf("\\");
  if (slash < 0) return false;
  const packageName = afterWindowsApps.slice(0, slash);
  const afterPackage = afterWindowsApps.slice(slash + 1);
  const supportedPackage = packageName.startsWith("openai.codex_") || packageName.startsWith("openai.chatgpt-desktop_");
  if (!supportedPackage || !afterPackage.startsWith("app\\")) return false;
  if (/^ChatGPT\.exe$/i.test(name)) return !afterPackage.startsWith("app\\resources\\");
  return afterPackage === "app\\resources\\codex.exe"
    && /(?:^|\s)app-server(?:\s|$)/i.test(String(processInfo?.commandLine || ""));
}

function run(command, args, allowedExitCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (allowedExitCodes.includes(code)) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} 退出码 ${code}`));
    });
  });
}

async function windowsDesktopProcesses() {
  const script = "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress";
  const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  const parsed = output.trim() ? JSON.parse(output) : [];
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map((item) => ({
      pid: Number(item.ProcessId),
      name: item.Name,
      executablePath: item.ExecutablePath,
      commandLine: item.CommandLine,
    }))
    .filter((item) => Number.isInteger(item.pid) && item.pid > 0 && isWindowsCodexDesktopProcess(item));
}

const windowsDesktopWindowScript = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CodexGalaxyWindowApi {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$foreground = [CodexGalaxyWindowApi]::GetForegroundWindow()
$foregroundPid = [uint32]0
if ($foreground -ne [IntPtr]::Zero) { [CodexGalaxyWindowApi]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid) | Out-Null }
$rows = @()
foreach ($process in @(Get-Process -Name ChatGPT,Codex -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) {
  $item = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction SilentlyContinue
  if (-not $item) { continue }
  $hwnd = [IntPtr]$process.MainWindowHandle
  if ($hwnd -eq [IntPtr]::Zero) { continue }
  $rect = [CodexGalaxyWindowApi+RECT]::new()
  if (-not [CodexGalaxyWindowApi]::GetWindowRect($hwnd, [ref]$rect)) { continue }
  $clientRect = [CodexGalaxyWindowApi+RECT]::new()
  $clientPoint = [CodexGalaxyWindowApi+POINT]::new()
  $hasClientRect = [CodexGalaxyWindowApi]::GetClientRect($hwnd, [ref]$clientRect) -and [CodexGalaxyWindowApi]::ClientToScreen($hwnd, [ref]$clientPoint)
  $rows += [pscustomobject]@{
    pid = [int]$item.ProcessId
    name = $item.Name
    executablePath = $item.ExecutablePath
    commandLine = $item.CommandLine
    hwnd = [long]$hwnd.ToInt64()
    left = [int]$rect.Left
    top = [int]$rect.Top
    right = [int]$rect.Right
    bottom = [int]$rect.Bottom
    clientLeft = if ($hasClientRect) { [int]$clientPoint.X } else { [int]$rect.Left }
    clientTop = if ($hasClientRect) { [int]$clientPoint.Y } else { [int]$rect.Top }
    clientRight = if ($hasClientRect) { [int]($clientPoint.X + $clientRect.Right) } else { [int]$rect.Right }
    clientBottom = if ($hasClientRect) { [int]($clientPoint.Y + $clientRect.Bottom) } else { [int]$rect.Bottom }
    visible = [bool][CodexGalaxyWindowApi]::IsWindowVisible($hwnd)
    minimized = [bool][CodexGalaxyWindowApi]::IsIconic($hwnd)
    foreground = ([uint32]$item.ProcessId -eq $foregroundPid)
  }
}
if ($rows.Count -eq 0) { '[]' } else { $rows | ConvertTo-Json -Compress }
`;

async function windowsDesktopWindows() {
  const output = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", windowsDesktopWindowScript]);
  const parsed = output.trim() ? JSON.parse(output) : [];
  return (Array.isArray(parsed) ? parsed : [parsed])
    .map((item) => ({
      pid: Number(item.pid),
      name: item.name,
      executablePath: item.executablePath,
      commandLine: item.commandLine,
      hwnd: Number(item.hwnd),
      left: Number(item.left),
      top: Number(item.top),
      right: Number(item.right),
      bottom: Number(item.bottom),
      clientLeft: Number(item.clientLeft),
      clientTop: Number(item.clientTop),
      clientRight: Number(item.clientRight),
      clientBottom: Number(item.clientBottom),
      visible: item.visible === true,
      minimized: item.minimized === true,
      foreground: item.foreground === true,
    }))
    .filter((item) => Number.isInteger(item.pid) && item.pid > 0 && Number.isInteger(item.hwnd) && item.hwnd > 0)
    .filter((item) => isWindowsCodexDesktopProcess(item));
}

async function macDesktopProcesses() {
  const ids = new Set();
  for (const name of ["Codex", "ChatGPT"]) {
    const output = await run("/usr/bin/pgrep", ["-x", name], [0, 1]);
    for (const line of output.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (Number.isInteger(pid) && pid > 0) ids.add(pid);
    }
  }
  return [...ids].map((pid) => ({ pid }));
}

async function desktopProcesses(platform) {
  if (platform === "win32") return windowsDesktopProcesses();
  if (platform === "darwin") return macDesktopProcesses();
  return [];
}

export function findCodexDesktopProcesses(platform = process.platform) {
  return desktopProcesses(platform);
}

export function findCodexDesktopWindows(platform = process.platform) {
  if (platform !== "win32") return Promise.resolve([]);
  return windowsDesktopWindows();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function stopCodexDesktopAndWait({
  platform = process.platform,
  timeoutMs = STOP_TIMEOUT_MS,
  listProcesses = () => findCodexDesktopProcesses(platform),
  terminate = (pid) => process.kill(pid, platform === "darwin" ? "SIGTERM" : "SIGKILL"),
  pollIntervalMs = POLL_INTERVAL_MS,
} = {}) {
  if (process.env.CODEX_GALAXY_SKIP_PROCESS_CONTROL === "1") return { stopped: 0, processIds: [] };
  const deadline = Date.now() + timeoutMs;
  const processIds = new Set();
  let emptyScans = 0;
  let remaining = [];
  while (Date.now() < deadline) {
    const found = await listProcesses();
    remaining = [...new Set(found.map((item) => Number(item.pid)).filter((pid) => Number.isInteger(pid) && pid > 0))];
    if (!remaining.length) {
      emptyScans += 1;
      if (emptyScans >= 2) {
        const stoppedIds = [...processIds];
        return { stopped: stoppedIds.length, processIds: stoppedIds };
      }
    } else {
      emptyScans = 0;
      for (const pid of remaining) {
        processIds.add(pid);
        try { terminate(pid); } catch (error) { if (error?.code !== "ESRCH") throw error; }
      }
    }
    await wait(Math.max(0, pollIntervalMs));
  }
  throw new Error(`无法完全关闭 Codex Desktop 及其后台服务（进程 ${remaining.join(", ") || "仍在重启"}），请手动退出后重试。`);
}
