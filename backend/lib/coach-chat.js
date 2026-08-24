import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import {
  getTenantId,
  upsertSession,
  enrich,
  deleteSession,
  loadPlannedSessions,
  loadCompletedSessions,
  getSportCategory,
  toLocalDateKey,
} from "./sessions.js";
import { buildObjectives } from "./objectives.js";

// Marcador de las sesiones planificadas propuestas por el entrenador IA.
// Las planificadas manuales del atleta no llevan plan_id y se conservan
// siempre; el chat solo reemplaza el futuro marcado como "coach".
export const COACH_PLAN_ID = "coach";

function questionOnly(content) {
  const text = String(content ?? "");
  const marker = "MENSAJE DEL ATLETA:";
  const start = text.indexOf(marker);
  if (start < 0) return text;
  const questionStart = start + marker.length;
  const end = text.indexOf("\n\nResponde con el JSON", questionStart);
  return text.slice(questionStart, end >= 0 ? end : text.length).trim();
}

export function listChatMessages() {
  return getDb()
    .prepare(
      "SELECT id, tenant_id, role, content, created_at FROM chat_messages WHERE tenant_id = ? ORDER BY created_at"
    )
    .all(getTenantId())
    .map((message) =>
      message.role === "user" ? { ...message, content: questionOnly(message.content) } : message
    );
}

export function addChatMessage(role, content) {
  getDb()
    .prepare(
      "INSERT INTO chat_messages (id, tenant_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(randomUUID(), getTenantId(), role, role === "user" ? questionOnly(content) : content, new Date().toISOString());
}

export function deleteChatMessages(tenantId, ids) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];

  const db = getDb();
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT id FROM chat_messages WHERE tenant_id = ? AND id IN (${placeholders})`
  ).all(tenantId, ...uniqueIds);
  if (rows.length === 0) return [];

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM chat_messages WHERE tenant_id = ? AND id IN (${placeholders})`)
      .run(tenantId, ...uniqueIds);
    db.prepare(
      `INSERT INTO tenant_settings (tenant_id, chat_response_id, chat_context_hash)
       VALUES (?, NULL, NULL)
       ON CONFLICT(tenant_id) DO UPDATE SET chat_response_id = NULL, chat_context_hash = NULL`
    ).run(tenantId);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
    throw error;
  }
  return rows.map((row) => row.id);
}

export function getChatState(tenantId = getTenantId()) {
  const row = getDb()
    .prepare(
      "SELECT chat_pending, chat_response_id, chat_context_hash, chat_instructions, chat_external FROM tenant_settings WHERE tenant_id = ?"
    )
    .get(tenantId);
  return {
    chatPending: Boolean(row?.chat_pending),
    chatResponseId: row?.chat_response_id ?? null,
    chatContextHash: row?.chat_context_hash ?? null,
    chatInstructions: row?.chat_instructions ?? "",
    chatExternal: Boolean(row?.chat_external),
  };
}

function upsertSetting(column) {
  const db = getDb();
  return (tenantId, value) => {
    const bound = column === "chat_pending" || column === "chat_external" ? (value ? 1 : 0) : value;
    return db
      .prepare(
        `INSERT INTO tenant_settings (tenant_id, ${column}) VALUES (?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET ${column} = excluded.${column}`
      )
      .run(tenantId, bound);
  };
}

export const setChatPending = upsertSetting("chat_pending");
export const updateChatResponseId = upsertSetting("chat_response_id");
export const updateChatContextHash = upsertSetting("chat_context_hash");
export const updateChatInstructions = upsertSetting("chat_instructions");
export const setChatExternal = upsertSetting("chat_external");

// Libera un chat atascado en "escribiendo" cuando no hay mensaje reciente y
// devuelve 1 (o 0 si el chat sigue pendiente de forma legítima).
export function recoverStaleChat(tenantId) {
  const state = getChatState(tenantId);
  if (!state.chatPending) return 0;
  const last = getDb()
    .prepare("SELECT created_at FROM chat_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(tenantId);
  const lastAt = last?.created_at ? new Date(last.created_at).getTime() : null;
  const cutoff = Date.now() - 10 * 60 * 1000;
  if (lastAt != null && lastAt >= cutoff) return 0;
  setChatPending(tenantId, false);
  updateChatResponseId(tenantId, null);
  return 1;
}

function isCoachSession(session) {
  return session.plan_id != null;
}

// Borra solo las sesiones planificadas futuras del entrenador (no fusionadas).
// Las planificadas manuales del atleta y el pasado (haya sido realizado o no)
// se conservan intactos: el chat nunca los modifica.
export function deleteFutureCoachSessions() {
  const planned = loadPlannedSessions().filter((s) => isCoachSession(s));
  const todayKey = toLocalDateKey(new Date());
  for (const s of planned) {
    if (s.merged_with) continue;
    if ((s.start_date_local ?? "").slice(0, 10) < todayKey) continue;
    deleteSession(s.id);
  }
}

// Ventana de tolerancia para corregir el año de fechas que el modelo devuelve
// en el pasado (suele ser el año de su corte de entrenamiento, p.ej. 2025 en
// vez de 2026): se adelanta el año hasta caer hoy o en el futuro próximo.
const MAX_ROLL_YEARS = 3;
const MAX_ROLL_FUTURE_DAYS = 90;

// Devuelve { start, corrected } con la fecha efectiva (posiblemente con el año
// corregido) o null si la fecha no es corregible dentro de la ventana.
function resolveProposedStart(startDateLocal, todayKey) {
  const raw = String(startDateLocal);
  const dateKey = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const parsed = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dateKey) return null;
  if (dateKey >= todayKey) return { start: raw, corrected: false };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  let year = Number(match[1]);
  const rest = `${match[2]}-${match[3]}`;
  const today = new Date(`${todayKey}T00:00:00`);
  for (let i = 0; i < MAX_ROLL_YEARS; i++) {
    year += 1;
    const candidate = `${String(year).padStart(4, "0")}-${rest}`;
    const diff = (new Date(`${candidate}T00:00:00`) - today) / 86400000;
    if (candidate >= todayKey && diff >= 0 && diff <= MAX_ROLL_FUTURE_DAYS) {
      return { start: `${candidate}${raw.slice(10)}`, corrected: true };
    }
  }
  return null;
}

export function replaceFuturePlannedSessions(rawSessions) {
  const completed = loadCompletedSessions();
  const todayKey = toLocalDateKey(new Date());

  // Valida primero la propuesta para no borrar el plan actual si el modelo
  // devuelve fechas pasadas o sesiones que ya se han realizado.
  const candidates = [];
  const rejected = [];
  for (const raw of rawSessions) {
    if (!raw?.sport || !raw?.start_date_local) {
      rejected.push({ reason: "missing_fields" });
      continue;
    }
    const resolved = resolveProposedStart(raw.start_date_local, todayKey);
    if (!resolved) {
      rejected.push({ reason: "past_or_invalid_date", date: String(raw.start_date_local).slice(0, 10) });
      continue;
    }
    const date = resolved.start.slice(0, 10);

    const cat = getSportCategory(raw.sport);
    const alreadyDone = completed.some(
      (c) =>
        (c.start_date_local ?? "").slice(0, 10) === date &&
        getSportCategory(c.sport) === cat
    );
    if (alreadyDone) {
      rejected.push({ reason: "already_completed", date, sport: raw.sport });
      continue;
    }
    if (resolved.corrected) {
      console.warn("Se corrige el año de una sesión propuesta por el chat", {
        tenantId: getTenantId(),
        from: String(raw.start_date_local),
        to: resolved.start,
      });
    }
    candidates.push({ ...raw, start_date_local: resolved.start });
  }

  if (rawSessions.length > 0 && candidates.length === 0) {
    console.warn("El chat no produjo sesiones planificables; se conserva el futuro existente", {
      tenantId: getTenantId(),
      rejected,
    });
    return { created: [], rejected, aborted: true };
  }

  // Un array vacío significa explícitamente que el entrenador ha dejado el
  // futuro sin sesiones. Solo en ese caso, o con candidatos válidos, se borra.
  deleteFutureCoachSessions();

  const created = [];
  for (const raw of candidates) {
    const session = {
      schema_version: 2,
      id: randomUUID(),
      plan_id: COACH_PLAN_ID,
      sport: raw.sport,
      title: raw.title,
      name: raw.name ?? raw.title,
      start_date_local: raw.start_date_local,
      workout_text: raw.workout_text,
    };
    upsertSession(getTenantId(), "planned", session);
    created.push({ ...enrich(session), objectives: buildObjectives(session) });
  }
  return { created, rejected, aborted: false };
}
