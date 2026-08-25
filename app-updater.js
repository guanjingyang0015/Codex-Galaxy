import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const RELEASE_API_URL = "https://api.github.com/repos/guanjingyang0015/Codex-Galaxy/releases/latest";
export const RELEASES_LATEST_PAGE_URL = "https://github.com/guanjingyang0015/Codex-Galaxy/releases/latest";
const RELEASE_TAG_PREFIX = "https://github.com/guanjingyang0015/Codex-Galaxy/releases/tag/";
const RELEASE_DOWNLOAD_PREFIX = "/guanjingyang0015/Codex-Galaxy/releases/download/";
const USER_AGENT = "Codex-Galaxy-Updater";

export function normalizeVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error("版本号格式无效。");
  return match.slice(1).map(Number).join(".");
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left).split(".").map(Number);
  const b = normalizeVersion(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function windowsAssetName(version, arch = "x64") {
  if (arch !== "x64") throw new Error(`暂不支持 Windows ${arch} 自动更新。`);
  return `Codex-Galaxy-${normalizeVersion(version)}-Windows-x64.exe`;
}

function trustedReleaseUrl(value, version) {
  return value === `${RELEASE_TAG_PREFIX}v${normalizeVersion(version)}`;
}

function trustedDownloadUrl(value, version, filename) {
  try {
    const url = new URL(value);
    const expectedPath = `${RELEASE_DOWNLOAD_PREFIX}v${normalizeVersion(version)}/${filename}`;
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && decodeURIComponent(url.pathname) === expectedPath
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function publicRelease(release) {
  return {
    currentVersion: release.currentVersion,
    latestVersion: release.latestVersion,
    available: release.available,
    action: release.action,
    releaseUrl: RELEASES_LATEST_PAGE_URL,
  };
}

export function parseLatestRelease(payload, { currentVersion, platform = process.platform, arch = process.arch } = {}) {
  if (!payload || payload.draft === true || payload.prerelease === true) throw new Error("GitHub 最新版本信息无效。");
  const installed = normalizeVersion(currentVersion);
  const latest = normalizeVersion(payload.tag_name);
  if (!trustedReleaseUrl(payload.html_url, latest)) throw new Error("GitHub Release 地址校验失败。");

  const release = {
    currentVersion: installed,
    latestVersion: latest,
    available: compareVersions(latest, installed) > 0,
    action: platform === "win32" ? "install" : "open-release",
    releaseUrl: RELEASES_LATEST_PAGE_URL,
  };
  if (!release.available || platform !== "win32") return release;

  const filename = windowsAssetName(latest, arch);
  const checksumName = `${filename}.sha256`;
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const asset = assets.find((item) => item?.name === filename);
  const checksumAsset = assets.find((item) => item?.name === checksumName);
  if (!asset || !checksumAsset) throw new Error("最新版缺少 Windows 安装包或 SHA-256 校验文件。");
  if (!trustedDownloadUrl(asset.browser_download_url, latest, filename)
    || !trustedDownloadUrl(checksumAsset.browser_download_url, latest, checksumName)) {
    throw new Error("更新文件下载地址校验失败。");
  }
  release.asset = {
    name: filename,
    url: asset.browser_download_url,
    size: Number(asset.size) || 0,
    digest: typeof asset.digest === "string" ? asset.digest.toLowerCase() : null,
  };
  release.checksumAsset = {
    name: checksumName,
    url: checksumAsset.browser_download_url,
  };
  return release;
}

export async function checkForUpdate({
  fetcher,
  currentVersion,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (typeof fetcher !== "function") throw new Error("更新检查网络组件不可用。");
  const response = await fetcher(RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "follow",
  });
  if (!response?.ok) throw new Error(`检查更新失败（GitHub ${response?.status || "网络错误"}）。`);
  return parseLatestRelease(await response.json(), { currentVersion, platform, arch });
}

export function parseSha256File(text, filename) {
  const normalizedName = String(filename || "");
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match && path.basename(match[2].trim()) === normalizedName) return match[1].toLowerCase();
  }
  throw new Error("SHA-256 校验文件内容无效。");
}

async function fetchChecksum(fetcher, release) {
  const response = await fetcher(release.checksumAsset.url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!response?.ok) throw new Error(`下载 SHA-256 校验文件失败（GitHub ${response?.status || "网络错误"}）。`);
  const text = await response.text();
  if (text.length > 4096) throw new Error("SHA-256 校验文件大小异常。");
  return parseSha256File(text, release.asset.name);
}

async function streamDownload(fetcher, release, destination, onProgress) {
  const response = await fetcher(release.asset.url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!response?.ok || !response.body) throw new Error(`下载安装包失败（GitHub ${response?.status || "网络错误"}）。`);
  const headerSize = Number(response.headers?.get?.("content-length")) || 0;
  const total = headerSize || release.asset.size || 0;
  let completed = 0;
  let lastPercent = -1;
  let lastProgressAt = 0;
  const hash = crypto.createHash("sha256");
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      completed += chunk.length;
      hash.update(chunk);
      const percent = total ? Math.min(99, Math.floor((completed / total) * 100)) : 0;
      const now = Date.now();
      if (percent !== lastPercent || now - lastProgressAt >= 250) {
        lastPercent = percent;
        lastProgressAt = now;
        onProgress?.({ completed, total, percent });
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(destination, { flags: "wx" }));
  return hash.digest("hex");
}

export async function downloadVerifiedWindowsInstaller(release, {
  fetcher,
  tempRoot = os.tmpdir(),
  onProgress,
} = {}) {
  if (release?.action !== "install" || !release.asset || !release.checksumAsset) throw new Error("当前版本没有可用的 Windows 自动更新文件。");
  const expectedHash = await fetchChecksum(fetcher, release);
  if (release.asset.digest?.startsWith("sha256:") && release.asset.digest.slice(7) !== expectedHash) {
    throw new Error("GitHub 安装包摘要与发布校验文件不一致。");
  }
  const directory = await fsp.mkdtemp(path.join(tempRoot, "codex-galaxy-update-"));
  const destination = path.join(directory, release.asset.name);
  try {
    onProgress?.({ completed: 0, total: release.asset.size, percent: 0 });
    const actualHash = await streamDownload(fetcher, release, destination, onProgress);
    if (actualHash !== expectedHash) throw new Error("安装包 SHA-256 校验失败，已取消更新。");
    onProgress?.({ completed: release.asset.size, total: release.asset.size, percent: 100 });
    return { path: destination, sha256: actualHash };
  } catch (error) {
    await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export class AppUpdater {
  constructor({
    currentVersion,
    platform = process.platform,
    arch = process.arch,
    fetcher,
    openRelease,
    launchInstaller,
    tempRoot,
    onStatus,
  }) {
    this.currentVersion = normalizeVersion(currentVersion);
    this.platform = platform;
    this.arch = arch;
    this.fetcher = fetcher;
    this.openRelease = openRelease;
    this.launchInstaller = launchInstaller;
    this.tempRoot = tempRoot;
    this.onStatus = onStatus;
    this.release = null;
    this.checkPromise = null;
    this.actionPromise = null;
    this.status = {
      phase: "idle",
      currentVersion: this.currentVersion,
      latestVersion: null,
      available: false,
      action: platform === "win32" ? "install" : "open-release",
      releaseUrl: RELEASES_LATEST_PAGE_URL,
      percent: 0,
      completed: 0,
      total: 0,
      error: null,
    };
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus?.({ ...this.status });
    return { ...this.status };
  }

  async check() {
    if (this.checkPromise) return this.checkPromise;
    this.setStatus({ phase: "checking", error: null });
    this.checkPromise = checkForUpdate({
      fetcher: this.fetcher,
      currentVersion: this.currentVersion,
      platform: this.platform,
      arch: this.arch,
    }).then((release) => {
      this.release = release;
      return this.setStatus({
        ...publicRelease(release),
        phase: release.available ? "available" : "current",
        percent: 0,
        completed: 0,
        total: 0,
        error: null,
      });
    }).catch((error) => {
      this.release = null;
      this.setStatus({
        phase: "error",
        available: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }).finally(() => {
      this.checkPromise = null;
    });
    return this.checkPromise;
  }

  async act() {
    if (this.actionPromise) return this.actionPromise;
    this.actionPromise = this.performAction().finally(() => {
      this.actionPromise = null;
    });
    return this.actionPromise;
  }

  async performAction() {
    if (!this.release) await this.check();
    if (!this.release?.available) return { current: true, status: { ...this.status } };
    if (this.release.action === "open-release") {
      await this.openRelease(RELEASES_LATEST_PAGE_URL);
      return { opened: true, status: { ...this.status } };
    }
    this.setStatus({ phase: "downloading", percent: 0, completed: 0, total: this.release.asset.size, error: null });
    try {
      const installer = await downloadVerifiedWindowsInstaller(this.release, {
        fetcher: this.fetcher,
        tempRoot: this.tempRoot,
        onProgress: (progress) => this.setStatus({ phase: "downloading", ...progress }),
      });
      this.setStatus({ phase: "ready", percent: 100, error: null });
      await this.launchInstaller(installer.path);
      this.setStatus({ phase: "installing", percent: 100 });
      return { launched: true, sha256: installer.sha256, status: { ...this.status } };
    } catch (error) {
      this.setStatus({
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
