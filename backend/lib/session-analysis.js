import { createHash } from "node:crypto";
import { getDb } from "./db.js";
import { getAthleteProfile, getTenantId } from "./sessions.js";
import { getActivePrompt } from "./ai-prompts.js";
import { applyChatProfileUpdate } from "./trainer.js";
import { callAi } from "./ai-provider.js";

const MAX_ANALYSIS_SESSIONS = 20;
const MAX_ANALYSIS_CHARS = 100_000;

function parseData(value) {
  try { return JSON.parse(value); } catch { return {}; }
}

function sessionHash(session) {
  return createHash("sha256").update(JSON.stringify(session)).digest("hex");
}

function rowsForTenant(tenantId) {
  return getDb().prepare(
    `SELECT s.id, s.sport, s.start_date_local, s.title, s.name, s.data, a.input_hash, a.status, a.analysis, a.profile_version_id, a.updated_at
     FROM sessions s
     LEFT JOIN session_ai_analyses a ON a.tenant_id = s.tenant_id AND a.session_id = s.id
     WHERE s.tenant_id = ? AND s.kind = 'completed'
     ORDER BY s.start_date_local DESC`
  ).all(tenantId);
}

function toSession(row) {
  const session = parseData(row.data);
  return { ...session, id: row.id, sport: row.sport, start_date_local: row.start_date_local, title: row.title, name: row.name };
}

export function getSelectedCompletedSessions(tenantId, sessionIds) {
  if (!Array.isArray(sessionIds) || sessionIds.length > MAX_ANALYSIS_SESSIONS) {
    throw new Error(`Puedes seleccionar como máximo ${MAX_ANALYSIS_SESSIONS} sesiones`);
  }
  const ids = [...new Set(sessionIds)];
  if (ids.some((id) => typeof id !== "string" || !id || id.length > 200)) throw new Error("sessionIds no válidos");
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb().prepare(
    `SELECT s.id, s.sport, s.start_date_local, s.title, s.name, s.data, a.input_hash, a.status
     FROM sessions s LEFT JOIN session_ai_analyses a ON a.tenant_id = s.tenant_id AND a.session_id = s.id
     WHERE s.tenant_id = ? AND s.kind = 'completed' AND s.id IN (${placeholders})`
  ).all(tenantId, ...ids);
  if (rows.length !== ids.length) throw new Error("Una o más sesiones no existen o no están completadas");
  return ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    const session = toSession(row);
    return { id, session, inputHash: sessionHash(session), status: row.status ?? null };
  });
}

export function markSessionsAnalyzed(tenantId, items, result, profileVersionId = null, provider = "chat", model = null) {
  for (const item of items ?? []) {
    const hash = item.inputHash ?? sessionHash(item.session);
    claimSessionAnalysis(tenantId, item.id, hash, provider, model);
    completeSessionAnalysis(tenantId, item.id, hash, result, profileVersionId);
  }
}

export function listSessionAnalyses(tenantId = getTenantId()) {
  return rowsForTenant(tenantId).map((row) => {
    const session = toSession(row);
    const inputHash = sessionHash(session);
    const completed = row.input_hash === inputHash && row.status === "completed";
    return { id: row.id, session, inputHash, status: completed ? "completed" : (row.status ?? "pending"), analysis: row.analysis ? parseData(row.analysis) : null, profileVersionId: row.profile_version_id ?? null, updatedAt: row.updated_at ?? null };
  });
}

export function listPendingSessionAnalyses(tenantId = getTenantId(), limit = MAX_ANALYSIS_SESSIONS) {
  const pending = [];
  for (const row of rowsForTenant(tenantId)) {
    const session = toSession(row);
    const hash = sessionHash(session);
    if (row.input_hash === hash && row.status === "completed") continue;
    pending.push({ id: row.id, session, inputHash: hash, status: row.status ?? null });
  }
  return pending.slice(0, Math.min(Math.max(Number(limit) || MAX_ANALYSIS_SESSIONS, 1), MAX_ANALYSIS_SESSIONS));
}

export function getSessionAnalysisSummary(tenantId = getTenantId()) {
  const all = rowsForTenant(tenantId);
  let pending = 0;
  for (const row of all) {
    const session = toSession(row);
    if (!(row.input_hash === sessionHash(session) && row.status === "completed")) pending++;
  }
  const latest = getDb().prepare(
    "SELECT session_id, analysis, profile_version_id, status, updated_at FROM session_ai_analyses WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 20"
  ).all(tenantId).map((row) => ({ ...row, analysis: row.analysis ? parseData(row.analysis) : null }));
  return { pendingCount: pending, completedCount: all.length - pending, latest };
}

export function getSessionAnalysis(tenantId, sessionId) {
  const row = getDb().prepare(
    "SELECT session_id, analysis, profile_version_id, status, error, updated_at FROM session_ai_analyses WHERE tenant_id = ? AND session_id = ?"
  ).get(tenantId, sessionId);
  return row ? { ...row, analysis: row.analysis ? parseData(row.analysis) : null } : null;
}

export function claimSessionAnalysis(tenantId, sessionId, inputHash, provider, model) {
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO session_ai_analyses
      (tenant_id, session_id, input_hash, status, provider, model, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
     ON CONFLICT(tenant_id, session_id) DO UPDATE SET
       input_hash = excluded.input_hash, status = 'running', analysis = NULL,
       profile_version_id = NULL, provider = excluded.provider, model = excluded.model,
       error = NULL, updated_at = excluded.updated_at`
  ).run(tenantId, sessionId, inputHash, provider ?? null, model ?? null, now, now);
}

export function completeSessionAnalysis(tenantId, sessionId, inputHash, result, profileVersionId = null) {
  const now = new Date().toISOString();
  getDb().prepare(
    `UPDATE session_ai_analyses
     SET status = 'completed', analysis = ?, profile_version_id = ?, error = NULL, updated_at = ?
     WHERE tenant_id = ? AND session_id = ? AND input_hash = ?`
  ).run(JSON.stringify(result), profileVersionId, now, tenantId, sessionId, inputHash);
}

export function failSessionAnalysis(tenantId, sessionId, inputHash, error) {
  getDb().prepare(
    `UPDATE session_ai_analyses SET status = 'failed', error = ?, updated_at = ?
     WHERE tenant_id = ? AND session_id = ? AND input_hash = ?`
  ).run(String(error).slice(0, 2000), new Date().toISOString(), tenantId, sessionId, inputHash);
}

function extractObject(text) {
  if (typeof text !== "string" || text.length > MAX_ANALYSIS_CHARS) throw new Error("La respuesta del análisis supera el tamaño permitido");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("La respuesta del análisis no contiene JSON válido");
  try { return JSON.parse(text.slice(start, end + 1)); } catch { throw new Error("La respuesta del análisis no contiene JSON válido"); }
}

function analysisPrompt(sessions) {
  const profile = JSON.stringify(getAthleteProfile() ?? {}, null, 2);
  const active = getActivePrompt(getTenantId());
  return `Analiza críticamente los entrenamientos completados del atleta. Evalúa fatiga, molestias, lesiones, carga, evolución, puntos débiles y cualquier dato nuevo que deba incorporarse al perfil. No inventes datos y no modifiques sesiones pasadas ni la planificación.

OBJETIVO DE ENTRENAMIENTO ACTIVO:
${active ? `${active.name}\n${active.content}` : "Sin objetivo específico"}

PERFIL ACTUAL DEL ATLETA (actualízalo solo si hay información nueva y relevante):
${profile}

ENTRENAMIENTOS A ANALIZAR:
${sessions.map((session) => JSON.stringify(session)).join("\n")}

Responde únicamente con este JSON:
{
  "analysis": "evaluación crítica y conclusiones",
  "updated_profile": {},
  "profile_change": "explicación breve de los cambios o cadena vacía"
}`;
}

export async function analyzeSessions({ tenantId, sessionItems, settings, actor, isCancelled = () => false, onProgress = () => {} }) {
  const results = [];
  for (const item of sessionItems) {
    if (isCancelled()) return { cancelled: true, analyzed: results.length };
    claimSessionAnalysis(tenantId, item.id, item.inputHash, settings.provider, settings.model);
    try {
      const text = await callAi(settings, {
        systemPrompt: "Eres un analista de rendimiento deportivo. Debes devolver únicamente JSON válido y actualizar automáticamente el perfil si los entrenamientos aportan información nueva.",
        userPrompt: analysisPrompt([item.session]),
      }, actor);
      const parsed = extractObject(text);
      const profileResult = parsed.updated_profile && typeof parsed.updated_profile === "object"
        ? applyChatProfileUpdate(tenantId, parsed.updated_profile, { includeVersionId: true })
        : { updated: false, versionId: null };
      completeSessionAnalysis(tenantId, item.id, item.inputHash, {
        analysis: String(parsed.analysis ?? "").trim(),
        profileChange: String(parsed.profile_change ?? "").trim(),
      }, profileResult.versionId ?? null);
      results.push({ sessionId: item.id, profileUpdated: profileResult.updated });
      onProgress({ completed: results.length, total: sessionItems.length, percent: Math.round((results.length / sessionItems.length) * 100) });
    } catch (error) {
      failSessionAnalysis(tenantId, item.id, item.inputHash, error?.message ?? error);
      throw error;
    }
  }
  return { analyzed: results.length, profileUpdated: results.some((item) => item.profileUpdated) };
}

export { MAX_ANALYSIS_SESSIONS };
