import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function read(relativePath) {
  return fs.readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mustMatch(text, pattern, file) {
  assert.match(text, pattern, `${file} 未同步必要内容`);
}

export async function checkDocumentationConsistency() {
  const packageJson = JSON.parse(await read("package.json"));
  const packageLock = JSON.parse(await read("package-lock.json"));
  const version = String(packageJson.version);
  const tag = `v${version}`;
  const versionPattern = escaped(version);
  const tagPattern = escaped(tag);
  const documents = {
    readme: await read("README.md"),
    readmeEn: await read("README.en.md"),
    app: await read("public/app.js"),
    html: await read("public/index.html"),
    releaseInfo: await read("release-info.js"),
    releaseNotes: await read(`release-notes/${tag}.md`),
    contributing: await read("CONTRIBUTING.md"),
    security: await read("SECURITY.md"),
    checklist: await read("RELEASE_CHECKLIST.md"),
    workflow: await read(".github/workflows/build.yml"),
  };

  assert.equal(packageLock.version, version, "package-lock.json 顶层版本未同步");
  assert.equal(packageLock.packages[""].version, version, "package-lock.json 根包版本未同步");
  mustMatch(documents.readme, new RegExp(`Codex Galaxy ${versionPattern}`), "README.md");
  mustMatch(documents.readmeEn, new RegExp(`Codex Galaxy ${versionPattern}`), "README.en.md");
  mustMatch(documents.app, new RegExp(`version: "${versionPattern}"`), "public/app.js");
  mustMatch(documents.app, new RegExp(`currentVersion: "${versionPattern}"`), "public/app.js");
  mustMatch(documents.app, new RegExp(`Current version: v${versionPattern}`), "public/app.js");
  mustMatch(documents.app, /每次版本更新都会同步更新|Every future version must update/, "public/app.js");
  mustMatch(documents.html, new RegExp(`id="appVersionInline">${versionPattern}`), "public/index.html");
  mustMatch(documents.html, new RegExp(`id="releaseRecordVersion">${tagPattern}`), "public/index.html");
  mustMatch(documents.html, new RegExp(`当前版本为 v${versionPattern}`), "public/index.html");
  mustMatch(documents.releaseInfo, new RegExp(`version: "${versionPattern}"`), "release-info.js");
  mustMatch(documents.releaseInfo, new RegExp(`tag: "${tagPattern}"`), "release-info.js");
  mustMatch(documents.releaseInfo, new RegExp(`releases/tag/${tagPattern}`), "release-info.js");
  mustMatch(documents.releaseNotes, new RegExp(`# Codex Galaxy ${versionPattern}`), `release-notes/${tag}.md`);
  mustMatch(documents.releaseNotes, /README|文档|documentation/i, `release-notes/${tag}.md`);
  mustMatch(documents.readme, /inProgress/, "README.md");
  mustMatch(documents.readme, /thread_history/, "README.md");
  mustMatch(documents.readme, /config\.toml/, "README.md");
  mustMatch(documents.readme, /API ↔ 官方切换步骤/, "README.md");
  mustMatch(documents.readmeEn, /inProgress/, "README.en.md");
  mustMatch(documents.readmeEn, /thread_history/, "README.en.md");
  mustMatch(documents.readmeEn, /config\.toml/, "README.en.md");
  mustMatch(documents.readmeEn, /API ↔ official switching steps/, "README.en.md");
  mustMatch(documents.app, /Step-by-step API ↔ official switching/, "public/app.js");
  mustMatch(documents.app, /Log/, "public/app.js");
  mustMatch(documents.html, /API ↔ 官方的具体切换步骤/, "public/index.html");
  mustMatch(documents.html, /日志/, "public/index.html");
  mustMatch(documents.releaseNotes, /gracefulTerminate.*catch|本地日志/i, `release-notes/${tag}.md`);
  mustMatch(documents.releaseNotes, /model_catalog_json|模型目录/i, `release-notes/${tag}.md`);
  mustMatch(documents.releaseNotes, /Windows.*sandbox|sandbox.*Windows/i, `release-notes/${tag}.md`);
  mustMatch(documents.contributing, /Documentation and release rule/, "CONTRIBUTING.md");
  mustMatch(documents.contributing, /galaxy\.log/, "CONTRIBUTING.md");
  mustMatch(documents.security, /Release documentation rule/, "SECURITY.md");
  mustMatch(documents.security, /galaxy\.log/, "SECURITY.md");
  mustMatch(documents.checklist, /README\.md.*README\.en\.md/s, "RELEASE_CHECKLIST.md");
  mustMatch(documents.checklist, /npm run check:docs/, "RELEASE_CHECKLIST.md");
  mustMatch(documents.checklist, /GitHub Actions/, "RELEASE_CHECKLIST.md");
  mustMatch(documents.workflow, /npm run check:docs/, ".github/workflows/build.yml");
  mustMatch(documents.workflow, /npm run stamp:release/, ".github/workflows/build.yml");

  return { version, tag, checkedFiles: Object.keys(documents) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await checkDocumentationConsistency();
  console.log(`Documentation consistency OK: ${result.version} (${result.checkedFiles.length} files)`);
}
