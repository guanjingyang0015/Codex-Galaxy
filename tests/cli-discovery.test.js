import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareCliVersions, findCodexCli, parseCliVersion } from "../cli-discovery.js";

test("CLI version parsing and prerelease comparison handle Codex output", () => {
  const oldVersion = parseCliVersion("codex-cli 0.137.0-alpha.4");
  const newVersion = parseCliVersion("codex-cli 0.150.0-alpha.8");
  assert.deepEqual(oldVersion, {
    version: "0.137.0-alpha.4",
    major: 0,
    minor: 137,
    patch: 0,
    prerelease: "alpha.4",
  });
  assert.equal(compareCliVersions(newVersion, oldVersion) > 0, true);
  assert.equal(compareCliVersions(parseCliVersion("codex-cli 1.0.0"), newVersion) > 0, true);
  assert.equal(compareCliVersions(parseCliVersion("codex-cli 0.150.0-alpha.10"), newVersion) > 0, true);
});

test("automatic Windows discovery selects the newest installed CLI instead of the stale root shim", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-cli-"));
  const binRoot = path.join(root, "OpenAI", "Codex", "bin");
  const oldRoot = path.join(binRoot, "codex.exe");
  const newCopy = path.join(binRoot, "d5f4c71927a04589", "codex.exe");
  await fs.mkdir(path.dirname(newCopy), { recursive: true });
  await fs.writeFile(oldRoot, "old");
  await fs.writeFile(newCopy, "new");
  try {
    const selected = await findCodexCli({
      platform: "win32",
      env: { LOCALAPPDATA: root },
      fsModule: fs,
      probeVersion: async (candidate) => candidate === oldRoot
        ? parseCliVersion("codex-cli 0.137.0-alpha.4")
        : parseCliVersion("codex-cli 0.150.0-alpha.8"),
    });
    assert.equal(selected, path.normalize(newCopy));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("explicit CODEX_CLI_PATH remains authoritative", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-cli-explicit-"));
  const explicit = path.join(root, "preferred.exe");
  const discovered = path.join(root, "OpenAI", "Codex", "bin", "codex.exe");
  await fs.mkdir(path.dirname(discovered), { recursive: true });
  await fs.writeFile(explicit, "explicit");
  await fs.writeFile(discovered, "discovered");
  try {
    const selected = await findCodexCli({
      platform: "win32",
      env: { CODEX_CLI_PATH: explicit, LOCALAPPDATA: root },
      fsModule: fs,
      probeVersion: async () => parseCliVersion("codex-cli 0.1.0"),
    });
    assert.equal(selected, path.normalize(explicit));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a CODEX_CLI_PATH that points to the Windows compatibility shim still upgrades to a newer managed copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-cli-shim-"));
  const binRoot = path.join(root, "OpenAI", "Codex", "bin");
  const shim = path.join(binRoot, "codex.exe");
  const newer = path.join(binRoot, "new-release", "codex.exe");
  await fs.mkdir(path.dirname(newer), { recursive: true });
  await fs.writeFile(shim, "shim");
  await fs.writeFile(newer, "newer");
  try {
    const selected = await findCodexCli({
      platform: "win32",
      env: { CODEX_CLI_PATH: shim, LOCALAPPDATA: root },
      fsModule: fs,
      probeVersion: async (candidate) => candidate === shim
        ? parseCliVersion("codex-cli 0.137.0-alpha.4")
        : parseCliVersion("codex-cli 0.150.0-alpha.8"),
    });
    assert.equal(selected, path.normalize(newer));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
