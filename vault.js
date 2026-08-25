import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";
let platformSecretProvider = null;

export function setPlatformSecretProvider(provider) {
  platformSecretProvider = provider;
}

function machineKey() {
  const material = [
    os.hostname(),
    process.env.USERNAME || process.env.USER || "unknown-user",
    process.env.SystemDrive || "",
    "galaxy-channel-v1",
  ].join("\0");
  return crypto.createHash("sha256").update(material).digest();
}

export function encrypt(value) {
  if (platformSecretProvider) {
    return {
      version: 2,
      scheme: platformSecretProvider.scheme,
      data: platformSecretProvider.encrypt(String(value)),
    };
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, machineKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url"),
  };
}

export function decrypt(payload) {
  if (payload?.version === 2) {
    if (!platformSecretProvider) throw new Error("System credential protection is unavailable");
    return platformSecretProvider.decrypt(payload.data);
  }
  if (!payload || payload.version !== 1) throw new Error("Unsupported vault payload");
  const decipher = crypto.createDecipheriv(ALGORITHM, machineKey(), Buffer.from(payload.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64url")), decipher.final()]).toString("utf8");
}

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

export function maskSecret(value) {
  if (!value) return "";
  const text = String(value);
  if (text.length <= 8) return "••••••••";
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}
