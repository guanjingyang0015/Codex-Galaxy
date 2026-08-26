import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverMarketplacePlugins, expandMarketplace, listLocalPlugins } from "../plugin-manager.js";

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value)}\n`);
}

test("local marketplace discovery is read-only and lists only valid plugin entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-plugin-marketplace-"));
  await writeJson(path.join(root, ".agents", "plugins", "marketplace.json"), {
    name: "local-market",
    plugins: [
      { name: "first", path: "./plugins/first" },
      { name: "missing", path: "./plugins/missing" },
      { name: "outside", path: "../outside" },
    ],
  });
  await writeJson(path.join(root, "plugins", "first", ".codex-plugin", "plugin.json"), {
    name: "first",
    version: "1.0.0",
  });
  const discovered = await discoverMarketplacePlugins(root);
  assert.equal(discovered.name, "local-market");
  assert.equal(discovered.plugins.length, 1);
  assert.equal(discovered.plugins[0].name, "first");
  assert.equal(await fs.stat(path.join(root, "plugins", "first", ".codex-plugin", "plugin.json")).then(() => true), true);
});

test("local marketplace auto-expansion installs all valid plugins without official auth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-plugin-expand-source-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "galaxy-plugin-expand-home-"));
  await writeJson(path.join(root, "marketplace.json"), {
    name: "local-market",
    plugins: [
      { name: "alpha", path: "./alpha" },
      { name: "beta", path: "./beta" },
    ],
  });
  await writeJson(path.join(root, "alpha", "plugin.json"), { name: "alpha", version: "1" });
  await writeJson(path.join(root, "beta", ".codex-plugin", "plugin.json"), { name: "beta", version: "2" });
  const result = await expandMarketplace(home, root);
  assert.equal(result.installed.length, 2);
  assert.deepEqual((await listLocalPlugins(home)).map((plugin) => plugin.name), ["alpha", "beta"]);
});
