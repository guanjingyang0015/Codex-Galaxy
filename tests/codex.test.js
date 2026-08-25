import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { captureCurrent, liveProfileMatch, switchProfile } from "../codex.js";

test("API switching preserves common config and writes an arbitrary model", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-switch-"));
  const paths = {
    home,
    config: path.join(home, "config.toml"),
    auth: path.join(home, "auth.json"),
    modelCatalog: path.join(home, "codex-galaxy-model-catalog.json"),
    backupDir: path.join(home, "backups", "codex-galaxy"),
  };
  const vaultFile = path.join(home, "vault.json");
  await fs.writeFile(paths.config, 'model = "old-model"\nmodel_provider = "openai"\ncli_auth_credentials_store = "keyring"\nforced_login_method = "chatgpt"\nforced_chatgpt_workspace_id = "workspace-old"\n\n[mcp_servers.keep]\ncommand = "keep-me"\n');
  await fs.writeFile(paths.auth, '{"tokens":{"access_token":"not-a-real-token"}}\n');

  await switchProfile(paths, {
    id: "relay-b",
    name: "DeepSeek relay",
    kind: "api",
    providerKey: "relay-deepseek",
    baseUrl: "https://relay.invalid/v1",
    apiKey: "test-key-not-real",
    model: "deepseek-reasoner",
    singleModel: true,
    modelCatalog: [{
      sourceId: "deepseek-reasoner",
      display_name: "DeepSeek R1",
      description: "DeepSeek reasoning model",
      context_window: 131072,
    }],
  }, vaultFile);

  const configText = await fs.readFile(paths.config, "utf8");
  const config = TOML.parse(configText);
  assert.equal(config.model, "deepseek-reasoner");
  assert.equal(config.model_provider, "relay-deepseek");
  assert.equal(config.model_providers["relay-deepseek"].wire_api, "responses");
  assert.equal(config.model_catalog_json, paths.modelCatalog);
  assert.equal(config.cli_auth_credentials_store, "file");
  assert.equal(config.forced_login_method, undefined);
  assert.equal(config.forced_chatgpt_workspace_id, undefined);
  assert.equal(config.mcp_servers.keep.command, "keep-me");
  assert.equal(configText.includes("test-key-not-real"), false);
  assert.deepEqual(JSON.parse(await fs.readFile(paths.auth, "utf8")), {
    auth_mode: "apikey",
    OPENAI_API_KEY: "test-key-not-real",
  });
  assert.equal((await liveProfileMatch(paths, {
    id: "relay-b",
    kind: "api",
    providerKey: "relay-deepseek",
    apiKey: "test-key-not-real",
  }, vaultFile)).matches, true);
  const catalog = JSON.parse(await fs.readFile(paths.modelCatalog, "utf8"));
  assert.equal(catalog.models.length, 1);
  assert.equal(catalog.models[0].display_name, "DeepSeek R1");
  assert.equal(catalog.models[0].context_window, 131072);
  assert.match(catalog.models[0].base_instructions, /latest user message defines the current request/);
  assert.match(catalog.models[0].model_messages.instructions_template, /do not resume older pending work/);
});

test("GPT relay switching keeps every GPT catalog entry and excludes other vendors", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-gpt-catalog-"));
  const paths = {
    home,
    config: path.join(home, "config.toml"),
    auth: path.join(home, "auth.json"),
    modelCatalog: path.join(home, "codex-galaxy-model-catalog.json"),
    backupDir: path.join(home, "backups", "codex-galaxy"),
  };
  const vaultFile = path.join(home, "vault.json");
  await fs.writeFile(paths.config, 'model_provider = "openai"\n');
  await fs.writeFile(paths.auth, '{}\n');

  await switchProfile(paths, {
    id: "relay-gpt",
    name: "GPT relay",
    kind: "api",
    providerKey: "relay-gpt",
    baseUrl: "https://relay.invalid/v1",
    apiKey: "test-key-not-real",
    model: "gpt-5.6-sol",
    configuredModel: "gpt-5.6",
    singleModel: false,
    modelCatalog: [
      { sourceId: "gpt-5.6-sol", display_name: "GPT-5.6 Sol" },
      { sourceId: "gpt-5.6-terra", display_name: "GPT-5.6 Terra" },
      { sourceId: "gpt-5.4", display_name: "GPT-5.4" },
      { sourceId: "deepseek-v3.2", display_name: "DeepSeek V3.2" },
    ],
  }, vaultFile);

  const catalog = JSON.parse(await fs.readFile(paths.modelCatalog, "utf8"));
  assert.deepEqual(catalog.models.map((model) => model.slug), ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.4"]);
  assert.deepEqual(catalog.models.map((model) => model.display_name), ["GPT-5.6 Sol", "GPT-5.6 Terra", "GPT-5.4"]);
});

test("official switching restores file credentials and removes stale forced-login settings", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-codex-official-restore-"));
  const paths = { home, config: path.join(home, "config.toml"), auth: path.join(home, "auth.json"), modelCatalog: path.join(home, "catalog.json"), backupDir: path.join(home, "backups") };
  const vaultFile = path.join(home, "vault.json");
  const profile = { id: "official-a", name: "Official A", kind: "official", model: "gpt-5.6" };
  await fs.writeFile(paths.config, 'model_provider = "openai"\ncli_auth_credentials_store = "keyring"\nforced_login_method = "chatgpt"\nforced_chatgpt_workspace_id = "workspace-a"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-a","access_token":"official-token"}}\n');
  await captureCurrent(paths, profile, vaultFile);
  await fs.writeFile(paths.config, 'model_provider = "galaxy"\nforced_login_method = "apikey"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"apikey","OPENAI_API_KEY":"relay-key"}\n');

  await switchProfile(paths, profile, vaultFile);

  const config = TOML.parse(await fs.readFile(paths.config, "utf8"));
  assert.equal(config.model_provider, "openai");
  assert.equal(config.cli_auth_credentials_store, "file");
  assert.equal(config.forced_login_method, undefined);
  assert.equal(config.forced_chatgpt_workspace_id, undefined);
  assert.equal(JSON.parse(await fs.readFile(paths.auth, "utf8")).auth_mode, "chatgpt");
  assert.equal((await liveProfileMatch(paths, profile, vaultFile)).matches, true);
});

test("official capture rejects API auth and protects a captured account identity", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-official-capture-"));
  const paths = { home, config: path.join(home, "config.toml"), auth: path.join(home, "auth.json"), backupDir: path.join(home, "backups") };
  const vaultFile = path.join(home, "vault.json");
  const profile = { id: "official-a", name: "Official A", kind: "official", model: "gpt-5.6" };
  await fs.writeFile(paths.config, 'model_provider = "openai"\n');
  await fs.writeFile(paths.auth, '{"OPENAI_API_KEY":"relay-key"}\n');
  await assert.rejects(captureCurrent(paths, profile, vaultFile), /不是官方 ChatGPT 登录状态/);

  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-a","access_token":"token-a"}}\n');
  await captureCurrent(paths, profile, vaultFile);
  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-b","access_token":"token-b"}}\n');
  await assert.rejects(captureCurrent(paths, profile, vaultFile), /与该槽位不一致/);
});

test("legacy official snapshots without a stored fingerprint remain valid and protected", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-legacy-official-"));
  const paths = { home, config: path.join(home, "config.toml"), auth: path.join(home, "auth.json"), backupDir: path.join(home, "backups") };
  const vaultFile = path.join(home, "vault.json");
  const profile = { id: "official-a", name: "Official A", kind: "official", model: "gpt-5.6" };
  await fs.writeFile(paths.config, 'model_provider = "openai"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-a","access_token":"token-a"}}\n');
  await captureCurrent(paths, profile, vaultFile);
  const vault = JSON.parse(await fs.readFile(vaultFile, "utf8"));
  delete vault.profiles[profile.id].authAccountFingerprint;
  await fs.writeFile(vaultFile, `${JSON.stringify(vault, null, 2)}\n`);

  await fs.writeFile(paths.config, 'model_provider = "galaxy"\n');
  await fs.writeFile(paths.auth, '{"auth_mode":"apikey","OPENAI_API_KEY":"relay-key"}\n');
  await switchProfile(paths, profile, vaultFile);
  assert.equal((await liveProfileMatch(paths, profile, vaultFile)).matches, true);

  await fs.writeFile(paths.auth, '{"auth_mode":"chatgpt","tokens":{"account_id":"account-b","access_token":"token-b"}}\n');
  await assert.rejects(captureCurrent(paths, profile, vaultFile), /与该槽位不一致/);
});
