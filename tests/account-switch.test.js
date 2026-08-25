import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { switchAccountTransaction } from "../account-switch.js";
import { captureCurrent, switchProfile } from "../codex.js";
import { loadProfiles, profileForSwitch, saveProfile, setCurrent } from "../profiles.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-account-transaction-"));
  const codexHome = path.join(root, "codex-home");
  const galaxyHome = path.join(root, "galaxy-home");
  const codexPaths = {
    home: codexHome,
    config: path.join(codexHome, "config.toml"),
    auth: path.join(codexHome, "auth.json"),
    backupDir: path.join(codexHome, "backups", "codex-galaxy"),
  };
  const dataPaths = {
    root: galaxyHome,
    profiles: path.join(galaxyHome, "profiles.json"),
    vault: path.join(galaxyHome, "vault.json"),
    library: path.join(galaxyHome, "conversation-library.json"),
  };
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(codexPaths.config, 'model = "gpt-official"\nmodel_provider = "openai"\ncli_auth_credentials_store = "file"\n');
  await fs.writeFile(codexPaths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"official-a","access_token":"test-token"}}\n');
  const official = await saveProfile({ id: "official-a", name: "官方 A", kind: "official", model: "gpt-official" }, dataPaths);
  const api = await saveProfile({ id: "api-octopus", name: "章鱼 5.6", kind: "api", baseUrl: "https://relay.invalid/v1", apiKey: "not-a-real-key", model: "model-5.6" }, dataPaths);
  await captureCurrent(codexPaths, await profileForSwitch(official.id, dataPaths), dataPaths.vault);
  await setCurrent(official.id, dataPaths);
  return { root, codexHome, codexPaths, dataPaths, official, api };
}

test("a retry repairs the stale official currentId left after an API half-switch", async () => {
  const item = await fixture();
  await switchProfile(item.codexPaths, await profileForSwitch(item.api.id, item.dataPaths), item.dataPaths.vault);
  assert.equal((await loadProfiles(item.dataPaths)).data.currentId, item.official.id);

  const progress = [];
  const result = await switchAccountTransaction({
    profileId: item.api.id,
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => ({ stopped: 1, processIds: [123] }),
    launch: async () => ({ method: "test" }),
    onProgress: (entry) => progress.push(entry),
  });

  assert.equal((await loadProfiles(item.dataPaths)).data.currentId, item.api.id);
  assert.equal(TOML.parse(await fs.readFile(item.codexPaths.config, "utf8")).model_provider, item.api.providerKey);
  assert.equal(result.switched.recoveredLiveState, true);
  assert.equal(result.preSwitchSync.threads, 0);
  assert.ok(progress.some((entry) => entry.stage === "recover"));
  assert.ok(progress.findIndex((entry) => entry.stage === "pre-sync") < progress.findIndex((entry) => entry.stage === "credentials"));
  assert.ok(progress.some((entry) => entry.stage === "pre-sync" && Number.isInteger(entry.completed)));
  assert.ok(progress.some((entry) => entry.stage === "library" && Number.isInteger(entry.completed)));
  assert.match(progress.at(-1).message, /本地同步完成/);
});

test("a launch failure restores credentials, provider metadata, currentId, and the local library", async () => {
  const item = await fixture();
  const sessions = path.join(item.codexHome, "sessions");
  const sessionFile = path.join(sessions, "root.jsonl");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(sessionFile, `${JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: item.root, model_provider: "openai" } })}\n`);
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = path.join(item.codexHome, "state_5.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("create table threads (id text primary key, model_provider text, model text)");
  db.prepare("insert into threads values (?, ?, ?)").run("thread-1", "openai", "gpt-5.4");
  db.close();
  const originalLibrary = '{"version":1,"syncedAt":null,"threads":[]}\n';
  await fs.mkdir(item.dataPaths.root, { recursive: true });
  await fs.writeFile(item.dataPaths.library, originalLibrary);
  let stoppedBeforeMutation = false;

  await assert.rejects(switchAccountTransaction({
    profileId: item.api.id,
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => {
      stoppedBeforeMutation = TOML.parse(await fs.readFile(item.codexPaths.config, "utf8")).model_provider === "openai";
      return { stopped: 1, processIds: [123] };
    },
    launch: async () => { throw new Error("launch test failure"); },
  }), /已自动恢复切换前状态/);

  assert.equal(stoppedBeforeMutation, true);
  assert.equal(TOML.parse(await fs.readFile(item.codexPaths.config, "utf8")).model_provider, "openai");
  assert.equal(JSON.parse(await fs.readFile(item.codexPaths.auth, "utf8")).auth_mode, "chatgpt");
  assert.equal((await loadProfiles(item.dataPaths)).data.currentId, item.official.id);
  assert.equal(JSON.parse((await fs.readFile(sessionFile, "utf8")).trim()).payload.model_provider, "openai");
  const restoredDb = new DatabaseSync(databasePath, { readOnly: true });
  const restoredThread = restoredDb.prepare("select model_provider, model from threads where id = ?").get("thread-1");
  assert.equal(restoredThread.model_provider, "openai");
  assert.equal(restoredThread.model, "gpt-5.4");
  restoredDb.close();
  assert.equal(await fs.readFile(item.dataPaths.library, "utf8"), originalLibrary);
});

test("an official launch failure restores relay message IDs removed during the attempted switch", async () => {
  const item = await fixture();
  const sessions = path.join(item.codexHome, "sessions");
  const sessionFile = path.join(sessions, "root.jsonl");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(sessionFile, [
    JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: item.root, model_provider: "openai" } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-official" } }),
  ].join("\n") + "\n");
  const common = {
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => ({ stopped: 0, processIds: [] }),
  };
  await switchAccountTransaction({
    ...common,
    profileId: item.api.id,
    launch: async () => ({ method: "test" }),
  });

  const invalidId = "chatcmpl-202608251102513098513998268d9d6GUHxOt7g_msg_0";
  await fs.appendFile(sessionFile, `${JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      id: invalidId,
      role: "assistant",
      content: [{ type: "output_text", text: "must survive rollback" }],
    },
  })}\n`);
  const originalSession = await fs.readFile(sessionFile, "utf8");
  let sanitizedBeforeLaunch = false;

  await assert.rejects(switchAccountTransaction({
    ...common,
    profileId: item.official.id,
    launch: async () => {
      const lines = (await fs.readFile(sessionFile, "utf8")).trim().split("\n").map(JSON.parse);
      sanitizedBeforeLaunch = !Object.hasOwn(lines.at(-1).payload, "id");
      throw new Error("official launch test failure");
    },
  }), /已自动恢复切换前状态/);

  assert.equal(sanitizedBeforeLaunch, true);
  assert.equal(await fs.readFile(sessionFile, "utf8"), originalSession);
  assert.equal((await loadProfiles(item.dataPaths)).data.currentId, item.api.id);
});

test("authentication overwritten after launch stops Codex and fully rolls back the switch", async () => {
  const item = await fixture();
  const originalLibrary = '{"version":1,"syncedAt":null,"threads":[]}\n';
  await fs.mkdir(item.dataPaths.root, { recursive: true });
  await fs.writeFile(item.dataPaths.library, originalLibrary);
  const [originalConfig, originalAuth, originalProfiles, originalVault] = await Promise.all([
    fs.readFile(item.codexPaths.config),
    fs.readFile(item.codexPaths.auth),
    fs.readFile(item.dataPaths.profiles),
    fs.readFile(item.dataPaths.vault),
  ]);
  let stopCalls = 0;

  await assert.rejects(switchAccountTransaction({
    profileId: item.api.id,
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => {
      stopCalls += 1;
      return { stopped: 1, processIds: [123] };
    },
    launch: async () => {
      await fs.writeFile(item.codexPaths.config, 'model = "gpt-official"\nmodel_provider = "openai"\ncli_auth_credentials_store = "file"\n');
      await fs.writeFile(item.codexPaths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"official-a","access_token":"rewritten-token"}}\n');
      return { method: "test" };
    },
  }), /Codex 启动后未保持目标账号.*已自动恢复切换前状态/);

  assert.equal(stopCalls, 2);
  assert.deepEqual(await fs.readFile(item.codexPaths.config), originalConfig);
  assert.deepEqual(await fs.readFile(item.codexPaths.auth), originalAuth);
  assert.deepEqual(await fs.readFile(item.dataPaths.profiles), originalProfiles);
  assert.deepEqual(await fs.readFile(item.dataPaths.vault), originalVault);
  assert.equal(await fs.readFile(item.dataPaths.library, "utf8"), originalLibrary);
  assert.equal((await loadProfiles(item.dataPaths)).data.currentId, item.official.id);
});

test("switching to an API profile preserves the internal thread model to avoid migration compaction", async () => {
  const item = await fixture();
  const sessions = path.join(item.codexHome, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, "root.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: item.root, model_provider: "openai" } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4" } }),
  ].join("\n") + "\n");

  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = path.join(item.codexHome, "state_5.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("create table threads (id text primary key, model_provider text, model text)");
  db.prepare("insert into threads values (?, ?, ?)").run("thread-1", "openai", "gpt-5.4");
  db.close();

  const result = await switchAccountTransaction({
    profileId: item.api.id,
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => ({ stopped: 1, processIds: [123] }),
    launch: async () => ({ method: "test" }),
  });

  const switchedDb = new DatabaseSync(databasePath, { readOnly: true });
  const switchedThread = switchedDb.prepare("select model_provider, model from threads where id = ?").get("thread-1");
  assert.equal(switchedThread.model_provider, item.api.providerKey);
  assert.equal(switchedThread.model, "gpt-5.4");
  switchedDb.close();
  assert.equal(result.providerSync.modelRowsUpdated, 0);

  const history = (await fs.readFile(path.join(sessions, "root.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(history[1].payload.model, "gpt-5.4");
});

test("official to API to official to API does not repeatedly rewrite the thread model", async () => {
  const item = await fixture();
  const sessions = path.join(item.codexHome, "sessions");
  await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, "root.jsonl"), [
    JSON.stringify({ type: "session_meta", payload: { id: "thread-1", cwd: item.root, model_provider: "openai" } }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-official" } }),
  ].join("\n") + "\n");
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = path.join(item.codexHome, "state_5.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("create table threads (id text primary key, model_provider text, model text)");
  db.prepare("insert into threads values (?, ?, ?)").run("thread-1", "openai", "gpt-official");
  db.close();
  const common = {
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => ({ stopped: 0, processIds: [] }),
    launch: async () => ({ method: "test" }),
  };

  const firstApi = await switchAccountTransaction({ ...common, profileId: item.api.id });
  const official = await switchAccountTransaction({ ...common, profileId: item.official.id });
  const secondApi = await switchAccountTransaction({ ...common, profileId: item.api.id });

  const verify = new DatabaseSync(databasePath, { readOnly: true });
  const thread = verify.prepare("select model_provider, model from threads where id = ?").get("thread-1");
  verify.close();
  assert.equal(thread.model_provider, item.api.providerKey);
  assert.equal(thread.model, "gpt-official");
  assert.equal(firstApi.providerSync.modelRowsUpdated, 0);
  assert.equal(official.providerSync.modelRowsUpdated, 0);
  assert.equal(secondApi.providerSync.modelRowsUpdated, 0);
});

test("API switching writes the prepared local gateway URL and commits its runtime", async () => {
  const item = await fixture();
  let committed = false;
  const result = await switchAccountTransaction({
    profileId: item.api.id,
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => ({ stopped: 0, processIds: [] }),
    prepareRuntime: async (profile) => ({
      profile: { ...profile, baseUrl: "http://127.0.0.1:43821/v1" },
      forceApply: true,
      commit: async () => { committed = true; },
      rollback: async () => {},
    }),
    launch: async () => ({ method: "test" }),
  });

  const config = TOML.parse(await fs.readFile(item.codexPaths.config, "utf8"));
  assert.equal(config.model_providers[item.api.providerKey].base_url, "http://127.0.0.1:43821/v1");
  assert.equal(committed, true);
  assert.equal(result.profile.baseUrl, "https://relay.invalid/v1");
});

test("a failed launch rolls back the prepared gateway runtime", async () => {
  const item = await fixture();
  let committed = false;
  let rolledBack = false;
  await assert.rejects(switchAccountTransaction({
    profileId: item.api.id,
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => ({ stopped: 0, processIds: [] }),
    prepareRuntime: async (profile) => ({
      profile: { ...profile, baseUrl: "http://127.0.0.1:43821/v1" },
      forceApply: true,
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
    }),
    launch: async () => { throw new Error("launch failed"); },
  }), /已自动恢复切换前状态/);

  assert.equal(committed, true);
  assert.equal(rolledBack, true);
  assert.equal(TOML.parse(await fs.readFile(item.codexPaths.config, "utf8")).model_provider, "openai");
});

test("API profiles switch without any official account or OAuth snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-api-only-switch-"));
  const codexHome = path.join(root, "codex-home");
  const galaxyHome = path.join(root, "galaxy-home");
  const codexPaths = {
    home: codexHome,
    config: path.join(codexHome, "config.toml"),
    auth: path.join(codexHome, "auth.json"),
    backupDir: path.join(codexHome, "backups", "codex-galaxy"),
  };
  const dataPaths = {
    root: galaxyHome,
    profiles: path.join(galaxyHome, "profiles.json"),
    vault: path.join(galaxyHome, "vault.json"),
    library: path.join(galaxyHome, "conversation-library.json"),
    settings: path.join(galaxyHome, "settings.json"),
  };
  await fs.mkdir(codexHome, { recursive: true });
  const apiA = await saveProfile({
    id: "api-a",
    name: "API A",
    kind: "api",
    baseUrl: "https://api-a.invalid/v1",
    apiKey: "not-a-real-key-a",
    model: "model-a",
  }, dataPaths);
  const apiB = await saveProfile({
    id: "api-b",
    name: "API B",
    kind: "api",
    baseUrl: "https://api-b.invalid/v1",
    apiKey: "not-a-real-key-b",
    model: "model-b",
  }, dataPaths);
  const committed = [];
  const common = {
    codexPaths,
    dataPaths,
    stopCodexDesktop: async () => ({ stopped: 0, processIds: [] }),
    prepareRuntime: async (profile) => ({
      profile: { ...profile, baseUrl: "http://127.0.0.1:43821/v1" },
      forceApply: true,
      commit: async () => { committed.push(profile.id); },
      rollback: async () => {},
    }),
    launch: async () => ({ method: "test" }),
  };

  await switchAccountTransaction({ ...common, profileId: apiA.id });
  const result = await switchAccountTransaction({ ...common, profileId: apiB.id });

  const { data, vault } = await loadProfiles(dataPaths);
  const config = TOML.parse(await fs.readFile(codexPaths.config, "utf8"));
  const auth = JSON.parse(await fs.readFile(codexPaths.auth, "utf8"));
  assert.deepEqual(data.profiles.map((profile) => profile.kind), ["api", "api"]);
  assert.equal(data.currentId, apiB.id);
  assert.equal(config.model_provider, apiB.providerKey);
  assert.equal(config.model, "model-b");
  assert.equal(config.model_providers[apiB.providerKey].name, "API B");
  assert.equal(config.model_providers[apiB.providerKey].base_url, "http://127.0.0.1:43821/v1");
  assert.deepEqual(auth, { auth_mode: "apikey", OPENAI_API_KEY: "not-a-real-key-b" });
  assert.equal(vault.profiles[apiA.id]?.auth, undefined);
  assert.equal(vault.profiles[apiB.id]?.auth, undefined);
  assert.deepEqual(committed, [apiA.id, apiB.id]);
  assert.equal(result.profile.baseUrl, "https://api-b.invalid/v1");
});

test("an uncaptured official slot cannot silently capture a different official account", async () => {
  const item = await fixture();
  const officialB = await saveProfile({ id: "official-b", name: "官方 B", kind: "official", model: "gpt-other" }, item.dataPaths);
  await assert.rejects(switchAccountTransaction({
    profileId: officialB.id,
    codexPaths: item.codexPaths,
    dataPaths: item.dataPaths,
    stopCodexDesktop: async () => ({ stopped: 1, processIds: [123] }),
    launch: async () => ({ method: "test" }),
  }), /尚未捕获登录状态/);
  const { data, vault } = await loadProfiles(item.dataPaths);
  assert.equal(data.currentId, item.official.id);
  assert.equal(vault.profiles[officialB.id]?.auth, undefined);
});
