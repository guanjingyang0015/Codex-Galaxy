import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "./vault.js";

export const OPENAI_STATUS_PAGE = "https://status.openai.com/";
export const OPENAI_STATUS_API = "https://status.openai.com/api/v2/summary.json";
const DEFAULT_PIN = "Codex API";

function cleanText(value, limit = 180) {
  return String(value || "").trim().slice(0, limit);
}

export async function getOpenAIStatusSettings(settingsFile) {
  const data = await readJson(settingsFile, {});
  return { pinnedComponent: cleanText(data.openaiStatusPinned || DEFAULT_PIN, 120) || DEFAULT_PIN };
}

export async function setOpenAIStatusSettings(settingsFile, pinnedComponent) {
  const current = await readJson(settingsFile, {});
  const next = { ...current, openaiStatusPinned: cleanText(pinnedComponent, 120) || DEFAULT_PIN };
  await fs.mkdir(path.dirname(settingsFile), { recursive: true });
  await writeJson(settingsFile, next);
  return { pinnedComponent: next.openaiStatusPinned };
}

function normalizeComponent(component) {
  return {
    id: cleanText(component?.id, 120),
    name: cleanText(component?.name, 120),
    status: cleanText(component?.status, 60) || "unknown",
    updatedAt: cleanText(component?.updated_at, 40),
  };
}

export async function fetchOpenAIStatus({ settingsFile, fetcher = fetch } = {}) {
  const settings = await getOpenAIStatusSettings(settingsFile);
  try {
    const response = await fetcher(OPENAI_STATUS_API, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`OpenAI status HTTP ${response.status}`);
    const payload = await response.json();
    const components = Array.isArray(payload?.components) ? payload.components.map(normalizeComponent).filter((item) => item.name) : [];
    const pinned = components.find((item) => item.name === settings.pinnedComponent)
      || components.find((item) => item.name.toLowerCase().includes(settings.pinnedComponent.toLowerCase()))
      || components.find((item) => item.name === DEFAULT_PIN)
      || components[0]
      || null;
    return {
      ok: true,
      source: OPENAI_STATUS_PAGE,
      fetchedAt: new Date().toISOString(),
      overall: {
        description: cleanText(payload?.status?.description, 120) || "Unknown",
        indicator: cleanText(payload?.status?.indicator, 30) || "unknown",
      },
      components,
      pinned,
      pinnedComponent: settings.pinnedComponent,
    };
  } catch (error) {
    return {
      ok: false,
      source: OPENAI_STATUS_PAGE,
      fetchedAt: new Date().toISOString(),
      overall: { description: "Status unavailable", indicator: "unknown" },
      components: [],
      pinned: null,
      pinnedComponent: settings.pinnedComponent,
      error: cleanText(error?.message || error, 180),
    };
  }
}
