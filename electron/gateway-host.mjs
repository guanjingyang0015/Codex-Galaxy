import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { ResponsesGateway } from "../responses-gateway.js";

const OWNER = "codex-galaxy-gateway-host-v1";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 43821;
const DEFAULT_TIMEOUT_MS = 8000;
const modulePath = fileURLToPath(import.meta.url);

function stateFile(root) {
  return path.join(root, "gateway-host.json");
}

function stopFile(root) {
  return path.join(root, "gateway-host.stop");
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, file);
}

async function removeFile(file) {
  await fs.rm(file, { force: true }).catch(() => {});
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHostState(file, pid, timeoutMs) {
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  while (Date.now() < deadline) {
    const state = await readJson(file);
    if (state?.pid === pid && state.owner === OWNER) {
      if (state.status === "ready") return state;
      if (state.status === "error") throw new Error(state.error || "后台网关启动失败。");
    }
    if (!isPidAlive(pid)) break;
    await wait(50);
  }
  const state = await readJson(file);
  if (state?.status === "error") throw new Error(state.error || "后台网关启动失败。");
  throw new Error("后台网关未能在规定时间内启动。");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try { child.kill(); } catch {}
  await wait(100);
}

export async function readGatewayHostState(root) {
  return readJson(stateFile(root));
}

export async function stopOwnedGatewayHost(root, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const file = stateFile(root);
  const stop = stopFile(root);
  const state = await readJson(file);
  if (!state || state.owner !== OWNER || !Number.isInteger(state.pid)) {
    await removeFile(file);
    await removeFile(stop);
    return { stopped: false, stale: Boolean(state) };
  }
  if (!isPidAlive(state.pid)) {
    await removeFile(file);
    await removeFile(stop);
    return { stopped: false, stale: true, pid: state.pid };
  }
  await writeJson(stop, { owner: OWNER, pid: state.pid, token: state.token, requestedAt: new Date().toISOString() });
  const deadline = Date.now() + Math.max(1000, timeoutMs);
  while (Date.now() < deadline) {
    if (!isPidAlive(state.pid)) {
      await removeFile(file);
      await removeFile(stop);
      return { stopped: true, pid: state.pid };
    }
    await wait(50);
  }
  // Never terminate by PID here. The state file can be stale or locally
  // tampered with; only the helper that proves possession of its token may
  // honour the stop request. This keeps Galaxy from ever killing Codex or an
  // unrelated process during cleanup.
  return { stopped: false, pid: state.pid, timedOut: true };
}

export async function handoffGatewayToHost({
  gateway,
  root,
  executable = process.execPath,
  script = modulePath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!gateway?.status?.running || !gateway?.snapshot) return { handedOff: false, reason: "not-running" };
  const snapshot = gateway.snapshot();
  if (!snapshot.running || !snapshot.active?.apiKey || !snapshot.active?.baseUrl) {
    return { handedOff: false, reason: "not-api" };
  }
  if (typeof gateway.waitForIdle === "function" && !await gateway.waitForIdle(timeoutMs)) {
    return { handedOff: false, reason: "busy" };
  }

  const file = stateFile(root);
  const stop = stopFile(root);
  await removeFile(file);
  await removeFile(stop);
  const localPort = Number(new URL(gateway.status.baseUrl || "http://127.0.0.1:43821").port)
    || Number(gateway.port || process.env.CODEX_GALAXY_GATEWAY_PORT || DEFAULT_PORT);
  await gateway.stop();

  const token = crypto.randomUUID();
  const child = spawn(executable, [script, "--gateway-host"], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      CODEX_GALAXY_GATEWAY_HOST: "1",
      CODEX_GALAXY_GATEWAY_STATE: file,
      CODEX_GALAXY_GATEWAY_STOP: stop,
    },
  });
  child.stdin.end(JSON.stringify({
    owner: OWNER,
    token,
    host: "127.0.0.1",
    port: localPort,
    profile: { ...snapshot.active, kind: "api" },
  }));

  try {
    const ready = await waitForHostState(file, child.pid, timeoutMs);
    child.unref();
    return { handedOff: true, pid: ready.pid, port: ready.port };
  } catch (error) {
    await stopChild(child);
    try {
      gateway.configure({ ...snapshot.active, kind: "api" });
      await gateway.start();
    } catch (restoreError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}；本地网关恢复失败：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
    throw error;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function runGatewayHost() {
  const statePath = process.env.CODEX_GALAXY_GATEWAY_STATE;
  const stopPath = process.env.CODEX_GALAXY_GATEWAY_STOP;
  if (!statePath || !stopPath) throw new Error("后台网关缺少受控状态路径。");
  const request = JSON.parse(await readStdin());
  if (request?.owner !== OWNER || !request?.token || !request?.profile) throw new Error("后台网关启动参数无效。");
  const gateway = new ResponsesGateway({
    host: request.host || DEFAULT_HOST,
    port: Number(request.port || DEFAULT_PORT),
    fetchUpstream: globalThis.fetch,
  });
  gateway.configure(request.profile);
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    await gateway.stop().catch(() => {});
    await removeFile(statePath);
    await removeFile(stopPath);
  };
  const exit = async (code = 0) => {
    await cleanup();
    process.exit(code);
  };
  process.once("SIGINT", () => { exit().catch(() => process.exit(1)); });
  process.once("SIGTERM", () => { exit().catch(() => process.exit(1)); });
  try {
    await gateway.start();
    await writeJson(statePath, {
      owner: OWNER,
      token: request.token,
      pid: process.pid,
      host: request.host || DEFAULT_HOST,
      port: gateway.status.baseUrl ? Number(new URL(gateway.status.baseUrl).port) : Number(request.port || DEFAULT_PORT),
      status: "ready",
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    await writeJson(statePath, {
      owner: OWNER,
      token: request.token,
      pid: process.pid,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    await cleanup();
    throw error;
  }

  const poll = setInterval(async () => {
    const command = await readJson(stopPath);
    if (command?.owner === OWNER && command.pid === process.pid && command.token === request.token) {
      clearInterval(poll);
      await exit();
    }
  }, 250);
  poll.unref?.();
}

if (process.env.CODEX_GALAXY_GATEWAY_HOST === "1") {
  runGatewayHost().catch(async (error) => {
    const file = process.env.CODEX_GALAXY_GATEWAY_STATE;
    if (file) await writeJson(file, { owner: OWNER, pid: process.pid, status: "error", error: error instanceof Error ? error.message : String(error) }).catch(() => {});
    process.exitCode = 1;
  });
}

export { OWNER, stateFile, stopFile };
