import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AppUpdater,
  RELEASE_API_URL,
  RELEASES_LATEST_PAGE_URL,
  checkForUpdate,
  compareVersions,
  downloadVerifiedWindowsInstaller,
  parseLatestRelease,
  parseSha256File,
  windowsAssetName,
} from "../app-updater.js";

function releasePayload(version = "1.4.0", installer = Buffer.from("verified installer")) {
  const filename = windowsAssetName(version);
  const hash = crypto.createHash("sha256").update(installer).digest("hex");
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/guanjingyang0015/Codex-Galaxy/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: filename,
        size: installer.length,
        digest: `sha256:${hash}`,
        browser_download_url: `https://github.com/guanjingyang0015/Codex-Galaxy/releases/download/v${version}/${filename}`,
      },
      {
        name: `${filename}.sha256`,
        size: 100,
        browser_download_url: `https://github.com/guanjingyang0015/Codex-Galaxy/releases/download/v${version}/${filename}.sha256`,
      },
    ],
  };
}

function fetcherFor(payload, installer = Buffer.from("verified installer"), checksumOverride = null) {
  const filename = payload.assets[0]?.name || windowsAssetName(payload.tag_name);
  const hash = checksumOverride || crypto.createHash("sha256").update(installer).digest("hex");
  return async (url) => {
    if (url === RELEASE_API_URL) return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith(".sha256")) return new Response(`${hash}  ${filename}\n`, { status: 200 });
    if (url.endsWith(".exe")) return new Response(installer, { status: 200, headers: { "Content-Length": String(installer.length) } });
    return new Response("not found", { status: 404 });
  };
}

test("semantic version comparison does not use lexical ordering", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("v1.4.0", "1.4.0"), 0);
  assert.equal(compareVersions("1.3.9", "1.4.0"), -1);
});

test("latest release parser accepts only the official repository and exact Windows assets", () => {
  const parsed = parseLatestRelease(releasePayload(), { currentVersion: "1.3.1", platform: "win32", arch: "x64" });
  assert.equal(parsed.available, true);
  assert.equal(parsed.latestVersion, "1.4.0");
  assert.equal(parsed.asset.name, "Codex-Galaxy-1.4.0-Windows-x64.exe");

  const untrusted = releasePayload();
  untrusted.assets[0].browser_download_url = "https://example.com/update.exe";
  assert.throws(
    () => parseLatestRelease(untrusted, { currentVersion: "1.3.1", platform: "win32", arch: "x64" }),
    /下载地址校验失败/,
  );
});

test("macOS update action opens the stable latest-release page and does not require DMG assets", async () => {
  const payload = releasePayload();
  payload.assets = [];
  const checked = await checkForUpdate({
    fetcher: fetcherFor(payload),
    currentVersion: "1.3.1",
    platform: "darwin",
    arch: "arm64",
  });
  assert.equal(checked.available, true);
  assert.equal(checked.action, "open-release");

  let opened = null;
  const updater = new AppUpdater({
    currentVersion: "1.3.1",
    platform: "darwin",
    arch: "arm64",
    fetcher: fetcherFor(payload),
    openRelease: async (url) => { opened = url; },
    launchInstaller: async () => assert.fail("macOS must not launch an installer"),
  });
  const result = await updater.act();
  assert.equal(result.opened, true);
  assert.equal(opened, RELEASES_LATEST_PAGE_URL);
});

test("SHA-256 parser requires the exact installer filename", () => {
  const filename = "Codex-Galaxy-1.4.0-Windows-x64.exe";
  const hash = "a".repeat(64);
  assert.equal(parseSha256File(`${hash}  ${filename}\n`, filename), hash);
  assert.throws(() => parseSha256File(`${hash}  other.exe\n`, filename), /内容无效/);
});

test("Windows updater streams, verifies, and launches only the matching installer", async () => {
  const installer = Buffer.from("verified installer");
  const payload = releasePayload("1.4.0", installer);
  const release = parseLatestRelease(payload, { currentVersion: "1.3.1", platform: "win32", arch: "x64" });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-updater-test-"));
  try {
    const progress = [];
    const result = await downloadVerifiedWindowsInstaller(release, {
      fetcher: fetcherFor(payload, installer),
      tempRoot,
      onProgress: (item) => progress.push(item.percent),
    });
    assert.equal(await fs.readFile(result.path, "utf8"), installer.toString());
    assert.equal(progress.at(-1), 100);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("Windows updater deletes a corrupted download and never launches it", async () => {
  const published = Buffer.from("published installer");
  const corrupted = Buffer.from("corrupted installer");
  const payload = releasePayload("1.4.0", published);
  const release = parseLatestRelease(payload, { currentVersion: "1.3.1", platform: "win32", arch: "x64" });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-updater-test-"));
  try {
    await assert.rejects(
      () => downloadVerifiedWindowsInstaller(release, {
        fetcher: fetcherFor(payload, corrupted, crypto.createHash("sha256").update(published).digest("hex")),
        tempRoot,
      }),
      /校验失败/,
    );
    assert.deepEqual(await fs.readdir(tempRoot), []);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
