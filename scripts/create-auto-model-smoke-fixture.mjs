import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { saveProfile, setCurrent } from "../profiles.js";

const upstreamPort = Number(process.argv[2]);
if (!Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) {
  throw new Error("Expected a local upstream port.");
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-galaxy-auto-model-smoke-"));
const codexHome = path.join(root, "codex-home");
const dataRoot = path.join(root, "app-data");
const paths = {
  root: dataRoot,
  profiles: path.join(dataRoot, "profiles.json"),
  vault: path.join(dataRoot, "vault.json"),
  library: path.join(dataRoot, "conversation-library.json"),
};
await fs.mkdir(codexHome, { recursive: true });
const profile = await saveProfile({
  id: "relay-auto",
  name: "自动模型中转",
  kind: "api",
  baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
  apiKey: "smoke-only-key",
  model: "",
}, paths);
await setCurrent(profile.id, paths);
await fs.writeFile(path.join(codexHome, "config.toml"), TOML.stringify({
  model: "gpt-5.5",
  model_provider: profile.providerKey,
  model_providers: {
    [profile.providerKey]: {
      name: profile.name,
      wire_api: "responses",
      base_url: "http://127.0.0.1:43821/v1",
      requires_openai_auth: true,
    },
  },
}));
await fs.writeFile(path.join(codexHome, "auth.json"), `${JSON.stringify({ OPENAI_API_KEY: "smoke-only-key" }, null, 2)}\n`);
process.stdout.write(JSON.stringify({ root, codexHome, dataRoot }));
