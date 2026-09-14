import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "./vault.js";

export const OPENAI_STATUS_PAGE = "https://status.openai.com/";
export const OPENAI_STATUS_API = "https://status.openai.com/api/v2/summary.json";
export const OPENAI_STATUS_INCIDENTS_API = "https://status.openai.com/api/v2/incidents.json";
export const OPENAI_STATUS_HISTORY_HOURS = 24;
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

function normalizeIncidentUpdate(update) {
  const body = cleanText(update?.body || update?.message_string || update?.message?.text || update?.message?.markdown, 320);
  return {
    status: cleanText(update?.status || update?.to_status, 40) || "unknown",
    body,
    createdAt: cleanText(update?.createdAt || update?.created_at || update?.published_at || update?.display_at, 40),
  };
}

function normalizeIncident(incident) {
  const updates = Array.isArray(incident?.incident_updates)
    ? incident.incident_updates
    : Array.isArray(incident?.updates) ? incident.updates : [];
  const impacts = Array.isArray(incident?.component_impacts) ? incident.component_impacts : [];
  const affected = Array.isArray(incident?.affected_components) ? incident.affected_components : impacts;
  return {
    id: cleanText(incident?.id, 120),
    name: cleanText(incident?.name, 180),
    status: cleanText(incident?.status, 40) || "unknown",
    impact: cleanText(incident?.impact, 40) || "none",
    createdAt: cleanText(incident?.createdAt || incident?.created_at || incident?.published_at, 40),
    updatedAt: cleanText(incident?.updatedAt || incident?.updated_at, 40),
    resolvedAt: cleanText(incident?.resolvedAt || incident?.resolved_at, 40),
    affectedComponents: affected.map((item) => cleanText(item?.component_id || item?.componentId || item?.id, 120)).filter(Boolean),
    updates: updates.map(normalizeIncidentUpdate).filter((item) => item.createdAt || item.body),
  };
}

const STATUS_SEVERITY = {
  operational: 0,
  none: 0,
  unknown: 0,
  under_maintenance: 1,
  degraded_performance: 2,
  partial_outage: 3,
  major_outage: 4,
};

function incidentHealthStatus(incident, updateStatus = "") {
  const impact = String(incident?.impact || "none").toLowerCase();
  if (["major", "critical", "full_outage"].includes(impact)) return "major_outage";
  if (["partial", "high"].includes(impact)) return "partial_outage";
  if (["minor", "medium"].includes(impact)) return "degraded_performance";
  if (["investigating", "identified", "monitoring", "maintenance_scheduled", "maintenance_in_progress"].includes(updateStatus)) {
    return updateStatus.startsWith("maintenance") ? "under_maintenance" : "degraded_performance";
  }
  return "operational";
}

function hourStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));
}

function hourKey(date) {
  return date.toISOString();
}

function incidentPoint(incident, start, end) {
  const created = Date.parse(incident.createdAt);
  if (!Number.isFinite(created) || end.getTime() <= created) return null;
  const resolved = Date.parse(incident.resolvedAt);
  if (Number.isFinite(resolved) && start.getTime() >= resolved) return null;
  const updates = incident.updates
    .filter((item) => Number.isFinite(Date.parse(item.createdAt)) && Date.parse(item.createdAt) <= end.getTime())
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const update = updates.at(-1) || null;
  const status = incidentHealthStatus(incident, update?.status);
  return {
    status,
    reason: update?.body || incident.name || "Public status incident",
    incidentName: incident.name,
    incidentId: incident.id,
  };
}

export function buildStatusTimeline(incidents = [], { now = new Date(), hours = OPENAI_STATUS_HISTORY_HOURS } = {}) {
  const end = hourStart(new Date(now));
  const first = new Date(end);
  first.setUTCHours(first.getUTCHours() - Math.max(1, Math.min(168, Number(hours) || OPENAI_STATUS_HISTORY_HOURS)) + 1);
  const normalized = incidents.map(normalizeIncident).filter((item) => item.id && item.name);
  const timeline = [];
  for (let cursor = new Date(first); cursor <= end; cursor.setUTCHours(cursor.getUTCHours() + 1)) {
    const start = new Date(cursor);
    const pointEnd = new Date(cursor);
    pointEnd.setUTCHours(pointEnd.getUTCHours() + 1);
    const points = normalized.map((incident) => incidentPoint(incident, start, pointEnd)).filter(Boolean);
    points.sort((a, b) => (STATUS_SEVERITY[b.status] || 0) - (STATUS_SEVERITY[a.status] || 0));
    const primary = points[0] || { status: "operational", reason: "", incidentName: "", incidentId: "" };
    timeline.push({
      date: hourKey(start),
      status: primary.status,
      reason: cleanText(points.slice(0, 3).map((item) => item.reason).filter(Boolean).join("; "), 420),
      incidentName: primary.incidentName,
      incidentId: primary.incidentId,
      incidentCount: points.length,
    });
  }
  return timeline;
}

export async function fetchOpenAIStatus({ settingsFile, fetcher = fetch } = {}) {
  const settings = await getOpenAIStatusSettings(settingsFile);
  try {
    const headers = { accept: "application/json" };
    const [statusResult, incidentsResult] = await Promise.allSettled([
      fetcher(OPENAI_STATUS_API, { headers }),
      fetcher(OPENAI_STATUS_INCIDENTS_API, { headers }),
    ]);
    if (statusResult.status === "rejected") throw statusResult.reason;
    const response = statusResult.value;
    const incidentsResponse = incidentsResult.status === "fulfilled" ? incidentsResult.value : { ok: false };
    if (!response.ok) throw new Error(`OpenAI status HTTP ${response.status}`);
    const payload = await response.json();
    const incidentsPayload = incidentsResponse.ok ? await incidentsResponse.json() : { incidents: [] };
    const components = Array.isArray(payload?.components) ? payload.components.map(normalizeComponent).filter((item) => item.name) : [];
    const incidents = Array.isArray(incidentsPayload?.incidents) ? incidentsPayload.incidents.map(normalizeIncident).filter((item) => item.id && item.name) : [];
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
      incidents,
      timeline: buildStatusTimeline(incidents),
      historyAvailable: incidentsResponse.ok,
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
      incidents: [],
      timeline: buildStatusTimeline([]),
      historyAvailable: false,
      pinned: null,
      pinnedComponent: settings.pinnedComponent,
      error: cleanText(error?.message || error, 180),
    };
  }
}
