import fs from "node:fs/promises";
import path from "node:path";

const headerScanBytes = 2 * 1024 * 1024;
const headerScanLines = 256;
const copyBufferBytes = 1024 * 1024;

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function parseSessionMeta(line) {
  let record;
  try { record = JSON.parse(line); } catch { return null; }
  return record?.type === "session_meta" && record.payload && typeof record.payload === "object"
    ? record
    : null;
}

function threadIdMatches(metadata, expectedThreadId) {
  return String(metadata?.payload?.id || "") === String(expectedThreadId || "");
}

async function readHeaderPrefix(file) {
  const stat = await fs.stat(file);
  const length = Math.min(Number(stat.size || 0), headerScanBytes);
  if (!length) return { stat, buffer: Buffer.alloc(0) };
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return { stat, buffer: buffer.subarray(0, bytesRead) };
  } finally {
    await handle.close();
  }
}

function statSignature(stat) {
  return [
    Number(stat.size || 0),
    Number(stat.mtimeMs || 0),
    Number(stat.ctimeMs || 0),
    Number(stat.ino || 0),
  ].join(":");
}

function scanHeaderBuffer(buffer, expectedThreadId) {
  if (!buffer.length) return { issue: "empty", status: "blocked" };
  let offset = 0;
  let firstRecordType = null;
  let firstRecordLine = null;
  for (let lineNumber = 0; lineNumber < headerScanLines && offset < buffer.length; lineNumber += 1) {
    const newline = buffer.indexOf(0x0a, offset);
    const lineEnd = newline >= 0 ? newline : buffer.length;
    const nextOffset = newline >= 0 ? newline + 1 : lineEnd;
    const contentEnd = lineEnd > offset && buffer[lineEnd - 1] === 0x0d ? lineEnd - 1 : lineEnd;
    let contentOffset = offset;
    let hadBom = false;
    if (lineNumber === 0 && contentEnd - contentOffset >= 3
      && buffer[contentOffset] === 0xef && buffer[contentOffset + 1] === 0xbb && buffer[contentOffset + 2] === 0xbf) {
      contentOffset += 3;
      hadBom = true;
    }
    const line = buffer.subarray(contentOffset, contentEnd).toString("utf8");
    if (!line.trim()) {
      offset = nextOffset;
      continue;
    }
    let record = null;
    try { record = JSON.parse(line); } catch {}
    if (firstRecordLine === null) {
      firstRecordLine = lineNumber;
      firstRecordType = record?.type ? String(record.type) : "invalid-json";
    }
    const metadata = record?.type === "session_meta" && record.payload && typeof record.payload === "object"
      ? record
      : null;
    if (metadata) {
      if (!threadIdMatches(metadata, expectedThreadId)) {
        return { issue: "thread-mismatch", status: "blocked", firstRecordType, firstRecordLine };
      }
      if (lineNumber === 0 && contentOffset === 0) {
        return { issue: null, status: "healthy", firstRecordType, firstRecordLine };
      }
      if (firstRecordLine === lineNumber) {
        return {
          issue: hadBom ? "utf8-bom" : "leading-blank-lines",
          status: "repairable",
          mode: "trim-prefix",
          startOffset: contentOffset,
          firstRecordType,
          firstRecordLine,
        };
      }
      return {
        issue: "metadata-later",
        status: "repairable",
        mode: "move-existing",
        metadataStart: contentOffset,
        metadataLineStart: offset,
        metadataLineEnd: nextOffset,
        firstRecordType,
        firstRecordLine,
      };
    }
    offset = nextOffset;
  }
  return { issue: "missing-metadata", status: "blocked", firstRecordType, firstRecordLine };
}

function backupCandidates(item) {
  const candidates = [];
  for (const entry of item?.lineBackups || []) {
    if (entry?.lineNumber !== 0) continue;
    if (typeof entry.nextLine === "string") candidates.push(entry.nextLine);
    if (typeof entry.originalLine === "string") candidates.push(entry.originalLine);
  }
  for (const entry of item?.originalSessionMetaEntries || []) {
    if (entry?.lineNumber === 0 && typeof entry.line === "string") candidates.push(entry.line);
  }
  for (const line of item?.originalSessionMetaLines || []) if (typeof line === "string") candidates.push(line);
  return candidates;
}

async function findBackedUpMetadata(codexHome, sessionPath, expectedThreadId) {
  const root = path.join(codexHome, "backups_state", "codex-galaxy-provider-sync");
  const directories = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const stat = await fs.stat(directory).catch(() => null);
    if (stat) directories.push({ directory, mtimeMs: stat.mtimeMs });
  }
  directories.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const item of directories) {
    const [manifest, metadata] = await Promise.all([
      fs.readFile(path.join(item.directory, "session-meta-backup.json"), "utf8")
        .then((value) => JSON.parse(value))
        .catch(() => null),
      fs.readFile(path.join(item.directory, "metadata.json"), "utf8")
        .then((value) => JSON.parse(value))
        .catch(() => null),
    ]);
    if (metadata?.namespace !== "codex-galaxy-provider-sync" || ![2, 3].includes(Number(metadata.version))) continue;
    if (!Array.isArray(manifest)) continue;
    for (const entry of manifest) {
      if (!entry?.path || !samePath(entry.path, sessionPath)) continue;
      for (const line of backupCandidates(entry)) {
        const metadata = parseSessionMeta(line);
        if (threadIdMatches(metadata, expectedThreadId)) {
          return { line: line.replace(/[\r\n]+$/g, ""), backupDir: item.directory };
        }
      }
    }
  }
  return null;
}

async function resolvePlan({ codexHome, thread }) {
  if (!thread?.source) return { status: "unavailable", issue: "no-rollout" };
  const sessionPath = path.resolve(String(thread.source));
  const sessionsRoot = path.join(codexHome, "sessions");
  const archivedRoot = path.join(codexHome, "archived_sessions");
  if (!pathInside(sessionsRoot, sessionPath) && !pathInside(archivedRoot, sessionPath)) {
    return { status: "blocked", issue: "unsafe-path" };
  }
  let header;
  try { header = await readHeaderPrefix(sessionPath); } catch (error) {
    return {
      status: "blocked",
      issue: error?.code === "ENOENT" ? "file-missing" : "file-unreadable",
    };
  }
  const plan = scanHeaderBuffer(header.buffer, thread.id);
  if (plan.status === "blocked" && plan.issue === "missing-metadata") {
    const backedUp = await findBackedUpMetadata(codexHome, sessionPath, thread.id);
    if (backedUp) {
      return {
        ...plan,
        status: "repairable",
        mode: "prepend-backup",
        metadataLine: backedUp.line,
        metadataBackupDir: backedUp.backupDir,
        sessionPath,
        fileSize: Number(header.stat.size || 0),
        originalSignature: statSignature(header.stat),
        originalMode: Number(header.stat.mode || 0) & 0o777,
      };
    }
  }
  return {
    ...plan,
    sessionPath,
    fileSize: Number(header.stat.size || 0),
    originalSignature: statSignature(header.stat),
    originalMode: Number(header.stat.mode || 0) & 0o777,
  };
}

function publicDiagnosis(plan) {
  return {
    status: plan.status,
    issue: plan.issue,
    repairSource: plan.mode === "prepend-backup" ? "galaxy-backup" : plan.status === "repairable" ? "rollout" : null,
    firstRecordType: plan.firstRecordType || null,
    firstRecordLine: Number.isInteger(plan.firstRecordLine) ? plan.firstRecordLine + 1 : null,
    fileSize: Number(plan.fileSize || 0),
  };
}

export async function diagnoseThreadRollout({ codexHome, thread }) {
  return publicDiagnosis(await resolvePlan({ codexHome, thread }));
}

async function copyRange(source, destination, start, end) {
  if (end <= start) return;
  const input = await fs.open(source, "r");
  try {
    const buffer = Buffer.allocUnsafe(copyBufferBytes);
    let position = start;
    while (position < end) {
      const length = Math.min(buffer.length, end - position);
      const { bytesRead } = await input.read(buffer, 0, length, position);
      if (!bytesRead) throw new Error("读取旧会话时提前结束。");
      await destination.write(buffer, 0, bytesRead);
      position += bytesRead;
    }
  } finally {
    await input.close();
  }
}

function repairBackupName() {
  return `${new Date().toISOString().replace(/[.:]/g, "-")}-${process.pid}-${Math.random().toString(16).slice(2, 10)}`;
}

async function acquireRepairLock(codexHome) {
  const lockFile = path.join(codexHome, "backups_state", ".codex-galaxy-thread-repair.lock");
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockFile, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      await handle.sync();
      return async () => {
        await handle.close().catch(() => {});
        await fs.rm(lockFile, { force: true }).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = await fs.readFile(lockFile, "utf8")
        .then((value) => JSON.parse(value))
        .catch(() => null);
      let alive = false;
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
          alive = true;
        } catch {}
      }
      if (alive || attempt > 0) throw new Error("另一个旧会话修复仍在进行，请等待完成。");
      await fs.rm(lockFile, { force: true }).catch(() => {});
    }
  }
  throw new Error("无法取得旧会话修复锁。");
}

async function replaceWithRollback(source, temporary, rollbackFile) {
  await fs.rename(source, rollbackFile);
  try {
    await fs.rename(temporary, source);
  } catch (error) {
    await fs.rename(rollbackFile, source).catch(() => {});
    throw error;
  }
}

async function writeSyncedFile(file, content, options) {
  const handle = await fs.open(file, "wx", options?.mode || 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function repairThreadRollout({ codexHome, thread, onProgress, onBeforeCommit }) {
  // Every replacement is preceded by a byte-exact backup of the original rollout.
  const releaseLock = await acquireRepairLock(codexHome);
  try {
    return await repairThreadRolloutLocked({ codexHome, thread, onProgress, onBeforeCommit });
  } finally {
    await releaseLock();
  }
}

async function repairThreadRolloutLocked({ codexHome, thread, onProgress, onBeforeCommit }) {
  const plan = await resolvePlan({ codexHome, thread });
  if (plan.status !== "repairable") throw new Error("该会话无法自动安全修复，请保留原文件并进行人工恢复。");

  const backupDir = path.join(codexHome, "backups_state", "codex-galaxy-thread-repair", repairBackupName());
  const backupFile = path.join(backupDir, `${path.basename(plan.sessionPath)}.before-repair`);
  const temporary = `${plan.sessionPath}.${process.pid}-${Date.now()}.repair.tmp`;
  const rollbackFile = `${plan.sessionPath}.${process.pid}-${Date.now()}.repair.original`;
  const pendingRecord = path.join(backupDir, "repair.json.pending");
  const repairRecord = path.join(backupDir, "repair.json");
  await fs.mkdir(backupDir, { recursive: true });
  await onProgress?.({ phase: "backup", sessionPath: plan.sessionPath });
  await fs.copyFile(plan.sessionPath, backupFile);
  await fs.chmod(backupFile, 0o600).catch(() => {});
  // Windows rejects fsync on a read-only handle. Open the private backup
  // read/write so the completed copy can be flushed before any replacement.
  const backupHandle = await fs.open(backupFile, "r+");
  await backupHandle.sync().finally(() => backupHandle.close());

  let output;
  try {
    output = await fs.open(temporary, "wx", plan.originalMode || 0o600);
    await onProgress?.({ phase: "write", sessionPath: plan.sessionPath });
    if (plan.mode === "trim-prefix") {
      await copyRange(plan.sessionPath, output, plan.startOffset, plan.fileSize);
    } else if (plan.mode === "move-existing") {
      await copyRange(plan.sessionPath, output, plan.metadataStart, plan.metadataLineEnd);
      if (plan.metadataLineEnd === plan.fileSize) await output.write(Buffer.from("\n", "utf8"));
      await copyRange(plan.sessionPath, output, 0, plan.metadataLineStart);
      await copyRange(plan.sessionPath, output, plan.metadataLineEnd, plan.fileSize);
    } else {
      await output.write(Buffer.from(`${plan.metadataLine}\n`, "utf8"));
      await copyRange(plan.sessionPath, output, 0, plan.fileSize);
    }
    await output.sync();
    await output.close();
    output = null;

    const verified = scanHeaderBuffer((await readHeaderPrefix(temporary)).buffer, thread.id);
    if (verified.status !== "healthy") throw new Error("修复副本未通过会话元数据校验。");
    await onProgress?.({ phase: "verify", sessionPath: plan.sessionPath });
    const current = await fs.stat(plan.sessionPath);
    if (statSignature(current) !== plan.originalSignature) {
      throw new Error("会话文件在修复期间发生了变化，请关闭 Codex 后重试。");
    }
    await onBeforeCommit?.();
    const repairedBytes = await fs.stat(temporary).then((item) => Number(item.size || 0));
    await writeSyncedFile(pendingRecord, `${JSON.stringify({
      version: 1,
      namespace: "codex-galaxy-thread-repair",
      createdAt: new Date().toISOString(),
      threadId: String(thread.id),
      source: plan.sessionPath,
      backup: backupFile,
      issue: plan.issue,
      repairSource: plan.mode === "prepend-backup" ? plan.metadataBackupDir : "rollout",
      originalBytes: plan.fileSize,
      repairedBytes,
    }, null, 2)}\n`, { mode: 0o600 });
    await replaceWithRollback(plan.sessionPath, temporary, rollbackFile);
    let warning = null;
    try {
      await onProgress?.({ phase: "record", sessionPath: plan.sessionPath, backupDir });
      await fs.rename(pendingRecord, repairRecord);
    } catch (error) {
      warning = `会话已经修复，但修复记录未能完成保存：${error instanceof Error ? error.message : String(error)}`;
    }
    try {
      await fs.rm(rollbackFile, { force: true });
    } catch (error) {
      warning = `${warning ? `${warning}；` : ""}替换前的临时恢复文件仍保留在 ${rollbackFile}`;
    }
    return {
      backupDir,
      backupFile,
      warning,
      diagnosis: publicDiagnosis({ ...verified, fileSize: repairedBytes }),
    };
  } catch (error) {
    await output?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    await fs.rm(pendingRecord, { force: true }).catch(() => {});
    if (await fs.stat(rollbackFile).then(() => true).catch(() => false)
      && !await fs.stat(plan.sessionPath).then(() => true).catch(() => false)) {
      await fs.rename(rollbackFile, plan.sessionPath).catch(() => {});
    }
    throw error;
  }
}
