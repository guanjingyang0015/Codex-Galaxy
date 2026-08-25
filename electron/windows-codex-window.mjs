import koffi from "koffi";

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const HANDLE = koffi.pointer("HANDLE", koffi.opaque());
const HWND = koffi.alias("HWND", HANDLE);
const RECT = koffi.struct("RECT", { left: "long", top: "long", right: "long", bottom: "long" });
const POINT = koffi.struct("POINT", { x: "long", y: "long" });

const FindWindowExW = user32.func("HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, const char16_t *lpszClass, const char16_t *lpszWindow)");
const GetWindowThreadProcessId = user32.func("uint32_t __stdcall GetWindowThreadProcessId(HWND hWnd, _Out_ uint32_t *lpdwProcessId)");
const GetWindowRect = user32.func("bool __stdcall GetWindowRect(HWND hWnd, _Out_ RECT *lpRect)");
const GetClientRect = user32.func("bool __stdcall GetClientRect(HWND hWnd, _Out_ RECT *lpRect)");
const ClientToScreen = user32.func("bool __stdcall ClientToScreen(HWND hWnd, _Inout_ POINT *lpPoint)");
const GetDpiForWindow = user32.func("uint32_t __stdcall GetDpiForWindow(HWND hWnd)");
const IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(HWND hWnd)");
const IsIconic = user32.func("bool __stdcall IsIconic(HWND hWnd)");
const GetForegroundWindow = user32.func("HWND __stdcall GetForegroundWindow(void)");
const GetAncestor = user32.func("HWND __stdcall GetAncestor(HWND hWnd, uint32_t gaFlags)");
const GetWindow = user32.func("HWND __stdcall GetWindow(HWND hWnd, uint32_t uCmd)");
const SetWindowPos = user32.func("bool __stdcall SetWindowPos(HWND hWnd, HWND hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)");
const OpenProcess = kernel32.func("HANDLE __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)");
const QueryFullProcessImageNameW = kernel32.func("bool __stdcall QueryFullProcessImageNameW(HANDLE hProcess, uint32_t dwFlags, _Out_ char16_t *lpExeName, _Inout_ uint32_t *lpdwSize)");
const CloseHandle = kernel32.func("bool __stdcall CloseHandle(HANDLE hObject)");

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOZORDER = 0x0004;
const SWP_NOOWNERZORDER = 0x0200;
const SWP_SHOWWINDOW = 0x0040;
const GW_HWNDPREV = 3;
const GA_ROOT = 2;
const GW_OWNER = 4;

const CODEX_DESKTOP_PATH_RE = /^[a-z]:\\program files\\windowsapps\\openai\.(?:codex|chatgpt(?:-desktop)?)_[^\\]+\\app\\chatgpt\.exe$/i;

function asBigIntHandle(value) {
  if (typeof value === "bigint") return value;
  if (value === null || value === undefined || value === 0) return null;
  try { return BigInt(value); } catch { return null; }
}

function handleKey(value) {
  const handle = asBigIntHandle(value);
  return handle === null ? "0" : handle.toString();
}

function imagePathForProcess(pid) {
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(4096);
    const size = [2048];
    if (!QueryFullProcessImageNameW(handle, 0, buffer, size)) return null;
    return koffi.decode(buffer, "char16_t", size[0]);
  } finally {
    CloseHandle(handle);
  }
}

function isCodexDesktopPath(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^"|"$/g, "")
    .replaceAll("/", "\\");
  return CODEX_DESKTOP_PATH_RE.test(normalized);
}

export const isSupportedCodexExecutablePath = isCodexDesktopPath;

function processIdForWindow(hwnd) {
  const output = [0];
  const threadId = GetWindowThreadProcessId(hwnd, output);
  return threadId ? Number(output[0]) : 0;
}

function windowRect(hwnd) {
  const outer = {};
  if (!GetWindowRect(hwnd, outer)) return null;
  const client = {};
  const point = { x: 0, y: 0 };
  const hasClient = GetClientRect(hwnd, client) && ClientToScreen(hwnd, point);
  return {
    left: Number(outer.left),
    top: Number(outer.top),
    right: Number(outer.right),
    bottom: Number(outer.bottom),
    clientLeft: hasClient ? Number(point.x) : Number(outer.left),
    clientTop: hasClient ? Number(point.y) : Number(outer.top),
    clientRight: hasClient ? Number(point.x) + Number(client.right) : Number(outer.right),
    clientBottom: hasClient ? Number(point.y) + Number(client.bottom) : Number(outer.bottom),
  };
}

export function findCodexWindows() {
  const foreground = GetForegroundWindow();
  const foregroundPid = foreground ? processIdForWindow(foreground) : 0;
  const foregroundRoot = foreground ? GetAncestor(foreground, GA_ROOT) : null;
  const foregroundRootKey = handleKey(foregroundRoot);
  const windows = [];
  for (let hwnd = null;;) {
    hwnd = FindWindowExW(null, hwnd, null, null);
    if (!hwnd) break;
    if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) continue;
    const pid = processIdForWindow(hwnd);
    if (!pid) continue;
    const executablePath = imagePathForProcess(pid);
    if (!isCodexDesktopPath(executablePath)) continue;
    const rect = windowRect(hwnd);
    if (!rect || rect.right <= rect.left + 320 || rect.bottom <= rect.top + 120) continue;
    const owner = GetWindow(hwnd, GW_OWNER);
    const root = GetAncestor(hwnd, GA_ROOT);
    if (owner || handleKey(root) !== handleKey(hwnd)) continue;
    windows.push({
      pid,
      hwnd: asBigIntHandle(hwnd),
      executablePath,
      // Prefer the exact root HWND.  PID-only matching would mark every
      // top-level window owned by the same Chromium process as foreground.
      foreground: foregroundRootKey !== "0"
        ? handleKey(hwnd) === foregroundRootKey
        : pid === foregroundPid,
      visible: true,
      minimized: false,
      ...rect,
    });
  }
  windows.sort((left, right) => {
    const foregroundOrder = Number(right.foreground) - Number(left.foreground);
    if (foregroundOrder) return foregroundOrder;
    const leftArea = (left.right - left.left) * (left.bottom - left.top);
    const rightArea = (right.right - right.left) * (right.bottom - right.top);
    return rightArea - leftArea;
  });
  return windows;
}

/** Pure selector used by the overlay loop and by unit tests. */
export function selectForegroundCodexWindow(windows, foregroundHwnd = null) {
  const rows = (Array.isArray(windows) ? windows : [])
    .filter((item) => item && item.visible !== false && item.minimized !== true);
  if (!rows.length) return null;
  const foregroundKey = handleKey(foregroundHwnd);
  const marked = rows.filter((item) => item.foreground === true || handleKey(item.hwnd) === foregroundKey);
  if (!marked.length) return null;
  return [...marked].sort((left, right) => {
    const leftArea = Math.max(0, Number(left.right) - Number(left.left)) * Math.max(0, Number(left.bottom) - Number(left.top));
    const rightArea = Math.max(0, Number(right.right) - Number(right.left)) * Math.max(0, Number(right.bottom) - Number(right.top));
    return rightArea - leftArea;
  })[0];
}

export function getCodexWindowRect(hwnd) {
  const handle = asBigIntHandle(hwnd);
  return handle ? windowRect(handle) : null;
}

export function getCodexWindowDpi(hwnd) {
  const handle = asBigIntHandle(hwnd);
  if (!handle) return 96;
  try {
    const dpi = Number(GetDpiForWindow(handle));
    return Number.isFinite(dpi) && dpi > 0 ? dpi : 96;
  } catch {
    return 96;
  }
}

export function nativeWindowHandleFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
}

export function placeOverlayWindow(overlayHwnd, targetHwnd, bounds) {
  const handle = asBigIntHandle(overlayHwnd);
  const target = asBigIntHandle(targetHwnd);
  if (!handle || !target || !bounds) return false;
  const previous = asBigIntHandle(GetWindow(target, GW_HWNDPREV));
  const alreadyAboveTarget = previous && previous === handle;
  const insertAfter = previous && !alreadyAboveTarget ? previous : null;
  const flags = SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW | (alreadyAboveTarget ? SWP_NOZORDER : 0);
  return Boolean(SetWindowPos(
    handle,
    insertAfter,
    Math.round(Number(bounds.x)),
    Math.round(Number(bounds.y)),
    Math.max(1, Math.round(Number(bounds.width))),
    Math.max(1, Math.round(Number(bounds.height))),
    flags,
  ));
}
