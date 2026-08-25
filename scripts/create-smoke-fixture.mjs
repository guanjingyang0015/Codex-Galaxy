import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { captureCurrent } from "../codex.js";
import { saveProfile, profileForSwitch, setCurrent } from "../profiles.js";
import { syncConversations } from "../sync.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-electron-smoke-"));
const codexHome = path.join(root, "codex-home");
const dataRoot = path.join(root, "app-data");
const sessions = path.join(codexHome, "sessions");
const archivedSessions = path.join(codexHome, "archived_sessions", "2026", "08");
const profilePaths = {
  root: dataRoot,
  profiles: path.join(dataRoot, "profiles.json"),
  vault: path.join(dataRoot, "vault.json"),
  library: path.join(dataRoot, "conversation-library.json"),
};
const codexPaths = {
  home: codexHome,
  config: path.join(codexHome, "config.toml"),
  auth: path.join(codexHome, "auth.json"),
  backupDir: path.join(codexHome, "backups", "codex-galaxy"),
};

await fs.mkdir(sessions, { recursive: true });
await fs.mkdir(archivedSessions, { recursive: true });
await fs.writeFile(codexPaths.config, 'model = "gpt-5.5"\nmodel_provider = "openai"\n');
await fs.writeFile(codexPaths.auth, '{"auth_mode":"chatgpt","tokens":{"access_token":"fake-smoke-token"}}\n');

const threadId = "019c-smoke-7000-8000-codexgalaxy";
const archivedThreadId = "019c-smoke-7000-8000-archivedgalaxy";
const rollout = path.join(sessions, `rollout-${threadId}.jsonl`);
const archivedRollout = path.join(archivedSessions, `rollout-${archivedThreadId}.jsonl`);
await fs.writeFile(path.join(codexHome, "session_index.jsonl"), [
  JSON.stringify({ id: threadId, thread_name: "Codex 已重命名任务", updated_at: "2026-08-24T08:00:00Z" }),
  JSON.stringify({ id: archivedThreadId, thread_name: "已归档测试任务", updated_at: "2026-08-22T08:00:00Z" }),
].join("\n") + "\n");
await fs.writeFile(rollout, [
  JSON.stringify({ type: "session_meta", payload: { id: threadId, cwd: "C:\\demo\\codex-galaxy", model_provider: "openai" } }),
  JSON.stringify({ timestamp: "2026-08-23T05:00:00Z", type: "event_msg", payload: { type: "user_message", message: "用 GPT-5.5 开始这个项目" } }),
  JSON.stringify({ timestamp: "2026-08-23T05:00:30Z", type: "response_item", payload: { type: "reasoning", encrypted_content: "fake-smoke-encrypted-state" } }),
  JSON.stringify({ timestamp: "2026-08-23T05:01:00Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "项目历史已保存在本地线程中。" }] } }),
].join("\n") + "\n");
await fs.writeFile(archivedRollout, [
  JSON.stringify({ type: "session_meta", payload: { id: archivedThreadId, cwd: "C:\\demo\\archived-project", model_provider: "openai" } }),
  JSON.stringify({ timestamp: "2026-08-22T05:00:00Z", type: "event_msg", payload: { type: "user_message", message: "这个任务已经归档" } }),
].join("\n") + "\n");

const database = new DatabaseSync(path.join(codexHome, "state_5.sqlite"));
database.exec("create table threads (id text primary key, title text, cwd text, model_provider text, model text, rollout_path text, updated_at_ms integer, has_user_event integer, archived integer)");
database.prepare("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(threadId, "SQLite 旧标题", "C:\\demo\\codex-galaxy", "openai", "gpt-5.5", path.relative(codexHome, rollout), Date.now(), 1, 0);
database.prepare("insert into threads values (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(archivedThreadId, "已归档测试任务", "C:\\demo\\archived-project", "openai", "gpt-5.5", path.relative(codexHome, archivedRollout), Date.now() - 172800000, 1, 1);
database.close();

await saveProfile({ id: "official-a", name: "官方账号 A", kind: "official", model: "gpt-5.5" }, profilePaths);
await saveProfile({ id: "relay-b", name: "中转账号 B", kind: "api", baseUrl: "https://relay.invalid/v1", apiKey: "fake-smoke-key", model: "deepseek-reasoner" }, profilePaths);
await captureCurrent(codexPaths, await profileForSwitch("official-a", profilePaths), profilePaths.vault);
await setCurrent("official-a", profilePaths);
await syncConversations({ codexHome, libraryFile: profilePaths.library, accountId: "official-a" });

process.stdout.write(JSON.stringify({ root, codexHome, dataRoot, threadId, archivedThreadId }));
