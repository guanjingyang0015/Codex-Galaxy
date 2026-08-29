import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { saveProfile, profileForSwitch, publicProfiles, setResolvedModel } from "../profiles.js";

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

test("API profiles always use pure API login even when old clients request mixed mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-auth-mode-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await saveProfile({ id: "relay-pure", name: "纯 API", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "model" }, paths);
  assert.equal((await profileForSwitch("relay-pure", paths)).preserveOfficialLogin, false);
  await saveProfile({ id: "relay-mixed", name: "插件 API", kind: "api", baseUrl: "https://relay.test/v1", apiKey: "secret", model: "model", preserveOfficialLogin: true }, paths);
  assert.equal((await profileForSwitch("relay-mixed", paths)).preserveOfficialLogin, false);
  assert.equal((await publicProfiles(paths)).profiles.find((profile) => profile.id === "relay-mixed").preserveOfficialLogin, false);
});

test("legacy API profiles migrate once from mixed login to pure API mode", async () => {
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
  assert.equal(publicState.profiles.find((profile) => profile.id === "relay-legacy").preserveOfficialLogin, false);
  assert.equal(publicState.profiles.find((profile) => profile.id === "official-a").preserveOfficialLogin, true);
  const persisted = JSON.parse(await fs.readFile(paths.profiles, "utf8"));
  assert.equal(persisted.version, 4);
  assert.equal(persisted.profiles.find((profile) => profile.id === "relay-legacy").preserveOfficialLogin, false);
  assert.equal(persisted.profiles.find((profile) => profile.id === "relay-legacy").runtimeMode, "direct");
  assert.equal(persisted.profiles.find((profile) => profile.id === "relay-legacy").runtimeProvider, "relay-legacy");
});

test("schema v2 mixed API profiles migrate to pure API mode", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-profile-v2-mixed-"));
  const paths = { root, profiles: path.join(root, "profiles.json"), vault: path.join(root, "vault.json"), library: path.join(root, "library.json") };
  await fs.writeFile(paths.profiles, JSON.stringify({
    version: 2,
    currentId: "relay-mixed",
    profiles: [{ id: "relay-mixed", name: "插件 API", kind: "api", preserveOfficialLogin: true }],
  }));

  assert.equal((await publicProfiles(paths)).profiles[0].preserveOfficialLogin, false);
  const persisted = JSON.parse(await fs.readFile(paths.profiles, "utf8"));
  assert.equal(persisted.version, 4);
  assert.equal(persisted.profiles[0].preserveOfficialLogin, false);
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
