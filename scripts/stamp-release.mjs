import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const releaseInfoFile = path.join(root, "release-info.js");
const sha = String(process.env.GITHUB_SHA || "").trim();
const runId = String(process.env.GITHUB_RUN_ID || "").trim();

if (!/^[0-9a-f]{40}$/i.test(sha) || !/^\d+$/.test(runId)) {
  console.log(`Release metadata not stamped locally for v${packageJson.version}.`);
  process.exit(0);
}

let source = await fs.readFile(releaseInfoFile, "utf8");
const version = String(packageJson.version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = new RegExp(
  `(version: "${version}",\\s+tag: "v${version}",\\s+commit: )null(,\\s+actionsRun: )null`,
);
const updated = source.replace(pattern, `$1"${sha}"$2"${runId}"`);
if (updated === source) {
  throw new Error(`当前版本 v${packageJson.version} 的发布记录不是可写入的候选状态。`);
}
await fs.writeFile(releaseInfoFile, updated);
console.log(`Stamped v${packageJson.version} release metadata from GitHub Actions ${runId}.`);
