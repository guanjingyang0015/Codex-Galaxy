import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearApiKey, deleteProfile, recordProfileTest, saveProfile, profileForSwitch, publicProfiles, setCurrent, setModelCatalog, setResolvedModel } from "../profiles.js";

test("profiles persist API keys in the encrypted vault only", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profiles-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({ id: "relay-b", name: "中转 B", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "sk-private-value", model: "deepseek-reasoner" }, paths);
  const publicState = await publicProfiles(paths);
  assert.equal(publicState.profiles[0].hasApiKey, true);
  assert.equal(JSON.stringify(publicState).includes("sk-private-value"), false);
  assert.equal((await profileForSwitch("relay-b", paths)).apiKey, "sk-private-value");
  assert.equal(publicState.profiles[0].model, "deepseek-reasoner");
  const vaultText = await fs.readFile(paths.vault, "utf8");
  assert.equal(vaultText.includes("sk-private-value"), false);
});

test("API profiles use provider-scoped keys and preserve official login identity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-auth-mode-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({ id: "relay-pure", name: "纯 API", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "model" }, paths);
  assert.equal((await profileForSwitch("relay-pure", paths)).preserveOfficialLogin, true);
  await saveProfile({ id: "relay-mixed", name: "插件 API", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "model", preserveOfficialLogin: true }, paths);
  assert.equal((await profileForSwitch("relay-mixed", paths)).preserveOfficialLogin, true);
  assert.equal((await publicProfiles(paths)).profiles.find((profile) => profile.id === "relay-mixed").preserveOfficialLogin, true);
});

test("legacy API profiles migrate to provider-scoped keys with official login preservation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-migration-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await fs.writeFile(paths.profiles, JSON.stringify({
    version: 1,
    currentId: "relay-legacy",
    profiles: [
      { id: "relay-legacy", name: "旧 API", kind: "api", preserveOfficialLogin: true },
      { id: "official-a", name: "官方 A", kind: "official", preserveOfficialLogin: true },
    ],
  }));

  const publicState = await publicProfiles(paths);
  assert.equal(publicState.profiles.find((profile) => profile.id === "relay-legacy").preserveOfficialLogin, true);
  assert.equal(publicState.profiles.find((profile) => profile.id === "official-a").preserveOfficialLogin, true);
  const persisted = JSON.parse(await fs.readFile(paths.profiles, "utf8"));
  assert.equal(persisted.version, 6);
  assert.equal(persisted.profiles.find((profile) => profile.id === "relay-legacy").preserveOfficialLogin, true);
  assert.equal(persisted.profiles.find((profile) => profile.id === "relay-legacy").runtimeMode, "direct");
  assert.equal(persisted.profiles.find((profile) => profile.id === "relay-legacy").runtimeProvider, "relay-legacy");
});

test("schema v2 API profiles migrate to preserved official login mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-v2-mixed-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await fs.writeFile(paths.profiles, JSON.stringify({
    version: 2,
    currentId: "relay-mixed",
    profiles: [{ id: "relay-mixed", name: "插件 API", kind: "api", preserveOfficialLogin: true }],
  }));

  assert.equal((await publicProfiles(paths)).profiles[0].preserveOfficialLogin, true);
  const persisted = JSON.parse(await fs.readFile(paths.profiles, "utf8"));
  assert.equal(persisted.version, 6);
  assert.equal(persisted.profiles[0].preserveOfficialLogin, true);
  assert.equal(persisted.profiles[0].runtimeMode, "direct");
});

test("profiles get an internal id and can be renamed without replacing credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-edit-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  const created = await saveProfile({ name: "工作 API", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "provider/model" }, paths);
  assert.match(created.id, /^api-[a-f0-9]{8}$/);

  await saveProfile({ id: created.id, name: "夜间额度", kind: "api", baseUrl: "https://relay-2.test/v1", apiKey: "", model: "deepseek-reasoner" }, paths);
  const edited = await profileForSwitch(created.id, paths);
  assert.equal(edited.name, "夜间额度");
  assert.equal(edited.baseUrl, "https://relay-2.test/v1");
  assert.equal(edited.apiKey, "secret");
});

test("a verified model survives restart and resets when API configuration changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-model-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({ id: "relay-b", name: "Relay", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "gpt-5.6" }, paths);
  assert.equal(await setResolvedModel("relay-b", "gpt-5.6", "gpt-5.6-sol", paths), true);
  assert.equal((await profileForSwitch("relay-b", paths)).resolvedModel, "gpt-5.6-sol");

  await saveProfile({ id: "relay-b", name: "Relay", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "", model: "deepseek-reasoner" }, paths);
  assert.equal((await profileForSwitch("relay-b", paths)).resolvedModel, null);
});

test("an API profile can leave its model blank and remember the discovered model", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-auto-model-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  const saved = await saveProfile({ id: "relay-auto", name: "Auto Relay", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "" }, paths);

  assert.equal(saved.model, "");
  assert.equal(await setResolvedModel("relay-auto", "", "vendor/text-model@2026", paths), true);
  const profile = await profileForSwitch("relay-auto", paths);
  assert.equal(profile.model, "");
  assert.equal(profile.resolvedModel, "vendor/text-model@2026");

  await saveProfile({ id: "relay-auto", name: "Renamed Relay", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "", model: "" }, paths);
  assert.equal((await profileForSwitch("relay-auto", paths)).resolvedModel, "vendor/text-model@2026");
});

test("an API profile persists a bounded model catalog without exposing API keys", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-catalog-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({ id: "relay-catalog", name: "Relay", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "" }, paths);

  assert.equal(await setModelCatalog("relay-catalog", "", "https://relay.test/v1", [
    { sourceId: "gpt-5.6-sol", display_name: "GPT-5.6 Sol", supported_reasoning_levels: [{ effort: "high", description: "Deep" }] },
    { sourceId: "gpt-5.6-terra", display_name: "GPT-5.6 Terra", supported_reasoning_levels: [{ effort: "low", description: "Fast" }] },
  ], paths), true);
  const profile = await profileForSwitch("relay-catalog", paths);
  assert.deepEqual(profile.modelCatalog.map((item) => item.sourceId), ["gpt-5.6-sol", "gpt-5.6-terra"]);
  assert.equal(JSON.stringify(await publicProfiles(paths)).includes("secret"), false);
});

test("API profile Base URLs cannot hide plaintext credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-url-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await assert.rejects(() => saveProfile({
    id: "relay-userinfo",
    name: "Relay",
    kind: "api",
    baseUrl: "https://user:plaintext-secret@relay.test/v1",
    apiKey: "synthetic-key",
    model: "model",
  }, paths), /不能包含用户名或密码/);
});

test("API profile key clearing and deletion protect the current profile", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-lifecycle-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({ id: "relay-a", name: "Relay A", kind: "api", baseUrl: "https://relay-a.test/v1", apiKey: "synthetic-a", model: "model-a" }, paths);
  await saveProfile({ id: "relay-b", name: "Relay B", kind: "api", baseUrl: "https://relay-b.test/v1", apiKey: "synthetic-b", model: "model-b" }, paths);
  await setCurrent("relay-a", paths);

  await assert.rejects(() => clearApiKey("relay-a", paths), /不能清除当前正在使用/);
  assert.deepEqual(await clearApiKey("relay-b", paths), { id: "relay-b", cleared: true });
  assert.equal((await publicProfiles(paths)).profiles.find((profile) => profile.id === "relay-b").hasApiKey, false);
  await assert.rejects(() => deleteProfile("relay-a", paths), /不能删除当前正在使用/);
  assert.deepEqual(await deleteProfile("relay-b", paths), { id: "relay-b" });
  assert.equal((await publicProfiles(paths)).profiles.some((profile) => profile.id === "relay-b"), false);
});

test("profile connection results persist only safe status metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-test-result-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({ id: "relay-result", name: "Relay", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "synthetic-key", model: "model" }, paths);
  const testedAt = "2026-08-30T03:20:00.000Z";
  assert.equal(await recordProfileTest("relay-result", {
    status: "auth",
    httpStatus: 401,
    testedAt,
    reason: "synthetic upstream detail",
    body: "must not persist",
  }, paths), true);
  const profile = (await publicProfiles(paths)).profiles[0];
  assert.deepEqual(profile.lastTest, { status: "auth", httpStatus: 401, testedAt });
  assert.doesNotMatch(JSON.stringify(profile), /synthetic upstream detail|must not persist/);

  await saveProfile({ id: "relay-result", name: "Relay", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "replacement-key", model: "model" }, paths);
  assert.equal((await publicProfiles(paths)).profiles[0].lastTest, null);
  await recordProfileTest("relay-result", { status: "ok", httpStatus: 200, testedAt }, paths);
  await clearApiKey("relay-result", paths);
  const cleared = (await publicProfiles(paths)).profiles[0];
  assert.equal(cleared.hasApiKey, false);
  assert.equal(cleared.lastTest, null);
});
