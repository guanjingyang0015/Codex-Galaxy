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

function mustNotMatch(text, pattern, file) {
  assert.doesNotMatch(text, pattern, `${file} 包含不应公开的内部说明`);
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
    relayReadme: await read("relay-ranking-server/README.md"),
  };

  const archivedReleaseNotes = (await fs.readdir(path.join(PROJECT_ROOT, "release-notes")))
    .filter((name) => /^v.*\.md$/i.test(name))
    .map((name) => fs.readFile(path.join(PROJECT_ROOT, "release-notes", name), "utf8"));
  const publicReleaseHistory = (await Promise.all(archivedReleaseNotes)).join("\n");
  const publicDescriptions = [
    documents.readme,
    documents.readmeEn,
    documents.app,
    documents.html,
    documents.security,
    documents.relayReadme,
    publicReleaseHistory,
  ].join("\n");

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
  mustMatch(documents.readme, /config\.toml/, "README.md");
  mustMatch(documents.readme, /API ↔ 官方切换步骤/, "README.md");
  mustMatch(documents.readme, /第一次添加账号配置.*日常使用切换账号.*异常故障处理.*特色功能/s, "README.md");
  mustMatch(documents.readmeEn, /config\.toml/, "README.en.md");
  mustMatch(documents.readmeEn, /API ↔ official switching steps/, "README.en.md");
  mustMatch(documents.readmeEn, /first account setup.*daily account switching.*failure recovery.*features/s, "README.en.md");
  mustMatch(documents.app, /tutorial\.stage2\.title|tutorial\.switch\.officialToApi1/, "public/app.js");
  mustMatch(documents.app, /Log/, "public/app.js");
  mustMatch(documents.html, /tutorial-stage-tabs/, "public/index.html");
  mustMatch(documents.html, /日常切换/, "public/index.html");
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
  mustNotMatch(
    publicDescriptions,
    /\/admin\/|admin_links\.py|admin_auth_setup\.py|PBKDF2|不可逆哈希|已自定义|使用默认链接|ranking destinations|排行榜跳转|排名跳转|服务器所有者|服务所有者|server owner|service owner|SSH-only|root-only/i,
    "公开项目说明",
  );
  mustNotMatch(
    publicDescriptions,
    /inProgress|crash residue|崩溃遗留/i,
    "公开项目说明",
  );

  mustMatch(documents.readme, /手动排序/, "README.md");
  mustMatch(documents.readmeEn, /account order/, "README.en.md");
  mustMatch(documents.app, /tutorial\.switch\.officialToOfficialTitle/, "public/app.js");
  mustMatch(documents.html, /tutorial\.switch\.officialToOfficialTitle/, "public/index.html");
  mustMatch(documents.html, /id="activeTasks"/, "public/index.html");
  mustMatch(documents.html, /id="rankingsList"/, "public/index.html");
  mustMatch(documents.readme, /GPT 代充/, "README.md");
  mustMatch(documents.readmeEn, /GPT Top-up/, "README.en.md");
  mustMatch(documents.html, /id="topupBtn"[^>]+\/topup\//, "public/index.html");
  mustMatch(documents.app, /tutorial\.feature\.topupTitle/, "public/app.js");
  mustMatch(documents.security, /top-up information page is read-only/i, "SECURITY.md");
  mustMatch(documents.relayReadme, /\/topup\//, "relay-ranking-server/README.md");
  return { version, tag, checkedFiles: Object.keys(documents) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await checkDocumentationConsistency();
  console.log(`Documentation consistency OK: ${result.version} (${result.checkedFiles.length} files)`);
}
