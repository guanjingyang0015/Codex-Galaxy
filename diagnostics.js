import fs from "node:fs/promises";
import path from "node:path";

const LOG_DIRECTORY = "logs";
const LOG_FILE = "galaxy.log";
const MAX_LOG_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 256 * 1024;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /api[-_]?key|authorization|cookie|password|secret|access[-_]?token|refresh[-_]?token|oauth|request[-_]?body|chat|prompt|content/i;

function redactString(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|sess|token|key)-[A-Za-z0-9_-]{8,}\b/gi, REDACTED)
    .replace(/([?&](?:api[_-]?key|token|secret|password|authorization)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi, `$1"${REDACTED}"`);
}

function safeValue(value, key = "", seen = new WeakSet(), depth = 0) {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[TRUNCATED]";
  if (value instanceof Error) {
    return {
      name: redactString(value.name || "Error"),
      message: redactString(value.message),
      code: redactString(value.code || ""),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, "", seen, depth + 1));
  if (typeof value !== "object") return redactString(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const result = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 40)) {
    result[entryKey] = safeValue(entryValue, entryKey, seen, depth + 1);
  }
  return result;
}

export function diagnosticLogPath(root) {
  return path.join(root, LOG_DIRECTORY, LOG_FILE);
}

export function sanitizeDiagnosticValue(value) {
  return safeValue(value);
}

async function appendRecord(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  const stat = await fs.stat(file);
  if (stat.size > MAX_LOG_BYTES) {
    const contents = await fs.readFile(file);
    await fs.writeFile(file, contents.subarray(-Math.floor(MAX_LOG_BYTES / 2)));
  }
}

export function createDiagnosticLogger(root, versionProvider = () => null) {
  const file = diagnosticLogPath(root);
  let queue = Promise.resolve();
  const enqueue = (level, event, message, details) => {
    const task = queue.then(async () => {
      const record = {
        timestamp: new Date().toISOString(),
        version: redactString(versionProvider?.() || ""),
        level,
        event: redactString(event),
        message: redactString(message),
        details: safeValue(details),
      };
      await appendRecord(file, record);
      return file;
    });
    queue = task.catch(() => {});
    return task.catch(() => null);
  };
  return {
    path: file,
    info: (event, message, details = null) => enqueue("info", event, message, details),
    error: (event, error, details = null) => enqueue(
      "error",
      event,
      error instanceof Error ? error.message : String(error ?? ""),
      { ...details, error: safeValue(error) },
    ),
  };
}

export async function readDiagnosticLog(root) {
  const file = diagnosticLogPath(root);
  const contents = await fs.readFile(file).catch((error) => {
    if (error?.code === "ENOENT") return Buffer.alloc(0);
    throw error;
  });
  const truncated = contents.length > MAX_READ_BYTES;
  const text = contents.subarray(truncated ? -MAX_READ_BYTES : 0).toString("utf8");
  return {
    path: file,
    bytes: contents.length,
    truncated,
    text: redactString(text),
  };
}

export const diagnosticLimits = { maxLogBytes: MAX_LOG_BYTES, maxReadBytes: MAX_READ_BYTES };
