import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VERSION_PATTERN = /(?:codex(?:-cli)?\s*)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i;

function normalizedPath(value) {
  const candidate = String(value || "").trim();
  return candidate ? path.normalize(candidate) : "";
}

function comparePrerelease(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const a = left.split(".");
  const b = right.split(".");
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= a.length) return -1;
    if (index >= b.length) return 1;
    const first = a[index];
    const second = b[index];
    if (first === second) continue;
    const firstNumber = /^\d+$/.test(first);
    const secondNumber = /^\d+$/.test(second);
    if (firstNumber && secondNumber) return Number(first) - Number(second);
    if (firstNumber !== secondNumber) return firstNumber ? -1 : 1;
    return first < second ? -1 : 1;
  }
  return 0;
}

export function parseCliVersion(output) {
  const match = String(output || "").match(VERSION_PATTERN);
  if (!match) return null;
  const version = match[1];
  const core = version.split("-", 1)[0].split(".").map(Number);
  return {
    version,
    major: core[0],
    minor: core[1],
    patch: core[2],
    prerelease: version.includes("-") ? version.slice(version.indexOf("-") + 1) : "",
  };
}

export function compareCliVersions(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (const key of ["major", "minor", "patch"]) {
    const difference = Number(left[key] || 0) - Number(right[key] || 0);
    if (difference) return difference;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function pushUnique(list, seen, value) {
  const candidate = normalizedPath(value);
  if (!candidate || seen.has(candidate.toLowerCase())) return;
  seen.add(candidate.toLowerCase());
  list.push(candidate);
}

export async function codexCliCandidates({ platform = process.platform, env = process.env, homeDir = os.homedir(), fsModule = fs } = {}) {
  const candidates = [];
  const seen = new Set();
  if (platform === "win32") {
    const binRoot = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
    if (binRoot) {
      pushUnique(candidates, seen, path.join(binRoot, "codex.exe"));
      const entries = await fsModule.readdir(binRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) pushUnique(candidates, seen, path.join(binRoot, entry.name, "codex.exe"));
      }
    }
  } else if (platform === "darwin") {
    [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      path.join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      path.join(homeDir, ".local", "bin", "codex"),
    ].forEach((candidate) => pushUnique(candidates, seen, candidate));
  }
  return candidates;
}

async function isFile(candidate, fsModule) {
  return fsModule.stat(candidate).then((item) => item.isFile()).catch(() => false);
}

export async function probeCodexCliVersion(candidate, { platform = process.platform, execFileAsyncOverride = execFileAsync } = {}) {
  try {
    const result = await execFileAsyncOverride(candidate, ["--version"], {
      timeout: 1800,
      maxBuffer: 64 * 1024,
      windowsHide: platform === "win32",
    });
    return parseCliVersion(`${result?.stdout || ""}\n${result?.stderr || ""}`);
  } catch (error) {
    return parseCliVersion(`${error?.stdout || ""}\n${error?.stderr || ""}`);
  }
}

export async function findCodexCli({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
  fsModule = fs,
  probeVersion = (candidate) => probeCodexCliVersion(candidate, { platform }),
} = {}) {
  const explicit = normalizedPath(env.CODEX_CLI_PATH);
  const candidates = await codexCliCandidates({ platform, env, homeDir, fsModule });
  const managedWindowsShim = platform === "win32" && env.LOCALAPPDATA
    ? normalizedPath(path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "codex.exe"))
    : "";
  // CODEX_CLI_PATH is normally an intentional override. The one exception is
  // the Windows installer's compatibility shim (`bin\\codex.exe`), which is
  // exactly the stale entry that can remain after a Codex update. Include that
  // shim in normal version selection so a newer versioned copy can replace it.
  if (explicit && await isFile(explicit, fsModule)
    && explicit.toLowerCase() !== managedWindowsShim.toLowerCase()) return explicit;

  const existing = [];
  for (const candidate of candidates) {
    if (await isFile(candidate, fsModule)) existing.push(candidate);
  }
  if (!existing.length) return null;

  const inspected = await Promise.all(existing.map(async (candidate, index) => ({
    candidate,
    index,
    version: await probeVersion(candidate),
  })));
  inspected.sort((left, right) => compareCliVersions(right.version, left.version) || left.index - right.index);
  return inspected[0].candidate;
}
