import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function safeName(value) {
  const name = String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return name.slice(0, 80) || `plugin-${Date.now()}`;
}

async function readManifest(directory) {
  for (const candidate of [path.join(directory, ".codex-plugin", "plugin.json"), path.join(directory, "plugin.json"), path.join(directory, "package.json")]) {
    const value = await fs.readFile(candidate, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    if (value && typeof value === "object") return value;
  }
  return null;
}

export async function listLocalPlugins(codexHome) {
  const root = path.join(codexHome, "plugins");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const directory = path.join(root, entry.name);
    const manifest = await readManifest(directory);
    if (!manifest) continue;
    plugins.push({
      id: entry.name,
      name: String(manifest.name || manifest.displayName || entry.name).slice(0, 120),
      version: String(manifest.version || "本地").slice(0, 40),
      path: directory,
    });
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

export async function installLocalPlugin(codexHome, sourceDirectory) {
  const source = path.resolve(String(sourceDirectory || ""));
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("请选择插件目录（目录内需要有 plugin.json 或 .codex-plugin/plugin.json）。");
  const manifest = await readManifest(source);
  if (!manifest) throw new Error("未找到插件清单。需要 plugin.json、.codex-plugin/plugin.json 或 package.json。");
  const id = safeName(manifest.name || path.basename(source));
  const destination = path.join(codexHome, "plugins", id);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.galaxy-${process.pid}-${Date.now()}`;
  await fs.cp(source, temporary, { recursive: true, errorOnExist: true });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.rename(temporary, destination);
  return { id, name: String(manifest.name || id), version: String(manifest.version || "本地"), path: destination };
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk) => { output = `${output}${chunk}`.slice(-12000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(output.trim() || `Codex 插件市场命令退出码 ${code}`)));
  });
}

export async function addMarketplace({ codexHome, cli, source }) {
  const value = String(source || "").trim();
  if (!value || value.length > 500 || /[\r\n]/.test(value)) throw new Error("请输入 GitHub、Git 或本地插件市场地址。");
  if (!cli) throw new Error("未找到 Codex CLI，无法添加插件市场。");
  await run(cli, ["plugin", "marketplace", "add", value], codexHome);
  return { source: value };
}
