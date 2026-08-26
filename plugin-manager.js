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

async function readMarketplaceManifest(directory) {
  for (const candidate of [
    path.join(directory, ".agents", "plugins", "marketplace.json"),
    path.join(directory, ".codex", "plugins", "marketplace.json"),
    path.join(directory, "marketplace.json"),
  ]) {
    const value = await fs.readFile(candidate, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    if (value && typeof value === "object" && Array.isArray(value.plugins)) {
      return { file: candidate, manifest: value };
    }
  }
  return null;
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function marketplacePluginSource(root, entry) {
  const raw = typeof entry === "string"
    ? entry
    : entry?.path || entry?.source?.path || entry?.directory || entry?.source;
  if (typeof raw !== "string" || !raw.trim() || /^[a-z]+:\/\//i.test(raw.trim())) return null;
  const source = path.resolve(root, raw);
  return pathInside(root, source) ? source : null;
}

/**
 * Read a local Codex marketplace without executing anything. This is the
 * safe counterpart to the official CLI marketplace command: it lets users
 * preview an imported marketplace before choosing to install its plugins.
 */
export async function discoverMarketplacePlugins(sourceDirectory) {
  const root = path.resolve(String(sourceDirectory || ""));
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("请选择插件市场目录。");
  const loaded = await readMarketplaceManifest(root);
  if (!loaded) throw new Error("未找到 marketplace.json，无法识别插件市场。");
  const plugins = [];
  for (const [index, entry] of loaded.manifest.plugins.entries()) {
    const source = marketplacePluginSource(root, entry);
    if (!source) continue;
    const pluginManifest = await readManifest(source);
    if (!pluginManifest) continue;
    plugins.push({
      id: safeName(pluginManifest.name || entry?.name || path.basename(source) || `plugin-${index + 1}`),
      name: String(pluginManifest.name || entry?.name || path.basename(source)).slice(0, 120),
      version: String(pluginManifest.version || "本地").slice(0, 40),
      path: source,
    });
  }
  return {
    name: String(loaded.manifest.name || path.basename(root)).slice(0, 120),
    path: root,
    plugins,
  };
}

/**
 * Install all valid plugins from a user-selected local marketplace. The
 * caller must obtain confirmation before invoking this bulk operation.
 */
export async function expandMarketplace(codexHome, sourceDirectory) {
  const marketplace = await discoverMarketplacePlugins(sourceDirectory);
  const installed = [];
  for (const plugin of marketplace.plugins) {
    installed.push(await installLocalPlugin(codexHome, plugin.path));
  }
  return { marketplace: { name: marketplace.name, path: marketplace.path }, installed };
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
