import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { differenceInDays, parseISO, startOfWeek } from "date-fns";
import { getDb } from "./db.js";

export const tenantContext = new AsyncLocalStorage();

export function withTenant(tenantId, fn) {
  return tenantContext.run({ tenantId }, fn);
}

export function getTenantId() {
  return tenantContext.getStore()?.tenantId ?? null;
}

export const SPORT_CATEGORIES = {
  running: "running",
  trail_running: "running",
  cycling: "cycling",
  virtual_ride: "cycling",
  indoor_cycling: "cycling",
  swimming: "swimming",
  lap_swimming: "swimming",
  open_water_swimming: "swimming",
  strength_training: "strength",
  hiking: "hiking",
  walking: "walking",
  paddelball: "padel",
  other: "other",
  breathwork: "other",
  assistance: "other",
  resort_skiing: "other",
  tennis_v2: "other",
  elliptical: "other",
};

export const RACKET_SPORTS = new Set(["paddelball", "tennis_v2"]);
export const ELAPSED_TIME_SPORTS = new Set(["hiking", "walking"]);

export const TRAINING_WEEK_ONE_START = "2026-05-11";

export function getSportCategory(sport) {
  return SPORT_CATEGORIES[sport] ?? "other";
}

export function getSessionTime(s) {
  const racket = RACKET_SPORTS.has(s.sport);
  const useElapsed = ELAPSED_TIME_SPORTS.has(s.sport);
  if (racket || useElapsed) {
    return s.elapsed_time_s ?? s.moving_time_s ?? 0;
  }
  return s.moving_time_s ?? s.elapsed_time_s ?? 0;
}

export function getTenantSettings(tenantId = getTenantId()) {
  if (!tenantId) return {};
  const store = tenantContext.getStore();
  if (store?.settings) return store.settings;
  const row = getDb()
    .prepare("SELECT * FROM tenant_settings WHERE tenant_id = ?")
    .get(tenantId);
  const settings = row ?? {};
  if (store) store.settings = settings;
  return settings;
}

export function getWeekNumber(date, weekOneStart) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const anchor = parseISO(
    weekOneStart ?? getTenantSettings()?.training_week_one_start ?? TRAINING_WEEK_ONE_START
  );
  const diffDays = differenceInDays(weekStart, anchor);
  return Math.floor(diffDays / 7) + 1;
}

export function getWeekStart(date) {
  return startOfWeek(date, { weekStartsOn: 1 });
}

export function getWeekEnd(date) {
  const start = getWeekStart(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
}

export function toLocalDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function enrich(session) {
  return {
    ...session,
    category: getSportCategory(session.sport),
    time_s: getSessionTime(session),
    weekNumber: session.start_date_local
      ? getWeekNumber(new Date(session.start_date_local))
      : null,
  };
}

export function upsertSession(tenantId, kind, session) {
  const db = getDb();
  const data = JSON.stringify(session);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (tenant_id, id, kind, sport, start_date_local, title, name, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, id) DO UPDATE SET
       kind = excluded.kind,
       sport = excluded.sport,
       start_date_local = excluded.start_date_local,
       title = excluded.title,
       name = excluded.name,
       data = excluded.data,
       updated_at = excluded.updated_at`
  ).run(
    tenantId,
    String(session.id),
    kind,
    session.sport ?? null,
    session.start_date_local ?? null,
    session.title ?? null,
    session.name ?? null,
    data,
    now,
    now
  );
}

export function getSelectedCompletedSessions(tenantId, sessionIds, max = 20) {
  if (!Array.isArray(sessionIds) || sessionIds.length > max) throw new Error(`Puedes seleccionar como máximo ${max} sesiones`);
  const ids = [...new Set(sessionIds)];
  if (ids.some((id) => typeof id !== "string" || !id || id.length > 200)) throw new Error("sessionIds no válidos");
  if (!ids.length) return [];
  const rows = getDb().prepare(`SELECT id, sport, start_date_local, title, name, data FROM sessions WHERE tenant_id = ? AND kind = 'completed' AND id IN (${ids.map(() => "?").join(",")})`).all(tenantId, ...ids);
  if (rows.length !== ids.length) throw new Error("Una o más sesiones no existen o no están completadas");
  return ids.map((id) => {
    const row = rows.find((candidate) => candidate.id === id);
    const session = { ...JSON.parse(row.data), id: row.id, sport: row.sport, start_date_local: row.start_date_local, title: row.title, name: row.name };
    return { id, session, inputHash: createHash("sha256").update(JSON.stringify(session)).digest("hex") };
  });
}

export function upsertExternalSession(tenantId, source, externalId, incoming) {
  const db = getDb();
  const external = String(externalId);
  const mapping = db.prepare(
    "SELECT activity_id FROM activity_sources WHERE tenant_id = ? AND source = ? AND external_activity_id = ?"
  ).get(tenantId, source, external);
  let id = mapping?.activity_id ?? randomUUID();
  let existing = null;
  if (mapping) {
    const row = db.prepare("SELECT data FROM sessions WHERE tenant_id = ? AND id = ? AND kind = 'completed'").get(tenantId, id);
    if (row) {
      try { existing = JSON.parse(row.data); } catch { existing = null; }
    }
  }
  const session = {
    ...(incoming ?? {}),
    ...(existing ?? {}),
    ...incoming,
    id,
    source,
    external_id: external,
    // Local edits remain authoritative when the source is synced again.
    title: existing?.title ?? incoming?.title,
    notes: existing?.notes ?? incoming?.notes,
  };
  upsertSession(tenantId, "completed", session);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO activity_sources (activity_id, tenant_id, source, external_activity_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(tenant_id, source, external_activity_id) DO UPDATE SET activity_id = excluded.activity_id, updated_at = excluded.updated_at`
  ).run(id, tenantId, source, external, now, now);
  return session;
}

const MANUAL_SPORTS = new Set(Object.keys(SPORT_CATEGORIES));

function finiteNonNegative(value, label) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${label} no es válido`);
    error.status = 400;
    throw error;
  }
  return number;
}

function validStart(value) {
  const start = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(start)) return false;
  return !Number.isNaN(new Date(start).getTime());
}

export function createManualSession(payload = {}) {
  const sport = String(payload.sport ?? "");
  const start = String(payload.start_date_local ?? "");
  if (!MANUAL_SPORTS.has(sport)) {
    const error = new Error("El deporte no es válido");
    error.status = 400;
    throw error;
  }
  if (!validStart(start)) {
    const error = new Error("La fecha y hora no son válidas");
    error.status = 400;
    throw error;
  }

  const title = String(payload.title ?? payload.name ?? "Actividad manual").trim();
  if (!title || title.length > 200) {
    const error = new Error("El título es obligatorio y no puede superar 200 caracteres");
    error.status = 400;
    throw error;
  }
  const notes = payload.notes == null ? undefined : String(payload.notes);
  if (notes && notes.length > 20_000) {
    const error = new Error("Las notas no pueden superar 20.000 caracteres");
    error.status = 400;
    throw error;
  }

  const movingTime = finiteNonNegative(payload.moving_time_s, "La duración");
  const elapsedTime = finiteNonNegative(payload.elapsed_time_s, "La duración transcurrida");
  const distance = finiteNonNegative(payload.distance_m, "La distancia");
  const segments = payload.segments == null ? undefined : payload.segments;
  if (segments !== undefined && (!Array.isArray(segments) || segments.length > 200)) {
    const error = new Error("La lista de vueltas no es válida");
    error.status = 400;
    throw error;
  }

  const session = {
    schema_version: 4,
    id: randomUUID(),
    source: "manual",
    sport,
    title,
    name: title,
    start_date_local: start.length === 16 ? `${start}:00` : start,
    ...(movingTime !== undefined ? { moving_time_s: Math.round(movingTime), elapsed_time_s: Math.round(elapsedTime ?? movingTime) } : {}),
    ...(distance !== undefined ? { distance_m: distance } : {}),
    ...(payload.avg_pace_s_per_km != null ? { avg_pace_s_per_km: finiteNonNegative(payload.avg_pace_s_per_km, "El ritmo") } : {}),
    ...(payload.avg_speed_ms != null ? { avg_speed_ms: finiteNonNegative(payload.avg_speed_ms, "La velocidad") } : {}),
    ...(segments !== undefined ? { segments } : {}),
    ...(notes ? { notes } : {}),
  };

  if (session.avg_pace_s_per_km == null && session.moving_time_s && session.distance_m > 0) {
    session.avg_pace_s_per_km = session.moving_time_s / (session.distance_m / 1000);
  }
  if (session.avg_speed_ms == null && session.moving_time_s && session.distance_m > 0) {
    session.avg_speed_ms = session.distance_m / session.moving_time_s;
  }

  upsertSession(getTenantId(), "completed", session);
  return enrich(session);
}

export function deleteManualSession(id) {
  const tenantId = getTenantId();
  const row = getDb()
    .prepare("SELECT data, kind FROM sessions WHERE tenant_id = ? AND id = ?")
    .get(tenantId, String(id));
  if (!row || row.kind !== "completed") return false;
  const source = getDb()
    .prepare("SELECT 1 FROM activity_sources WHERE tenant_id = ? AND activity_id = ? LIMIT 1")
    .get(tenantId, String(id));
  if (source) return false;
  let data;
  try { data = JSON.parse(row.data); } catch { return false; }
  if (data.source !== "manual") return false;
  deleteSession(id);
  return true;
}

export function deleteSession(id) {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE tenant_id = ? AND id = ?").run(
    getTenantId(),
    String(id)
  );
}

function rowsToSessions(rows) {
  return rows.map((r) => enrich(JSON.parse(r.data)));
}

export function loadCompletedSessions() {
  const tenantId = getTenantId();
  if (!tenantId) return [];
  const rows = getDb()
    .prepare(
      "SELECT data FROM sessions WHERE tenant_id = ? AND kind = 'completed' ORDER BY start_date_local"
    )
    .all(tenantId);
  return rowsToSessions(rows);
}

export function loadCompletedSessionsSince(cutoffDate) {
  const tenantId = getTenantId();
  if (!tenantId) return [];
  const rows = getDb()
    .prepare(
      `SELECT data FROM sessions WHERE tenant_id = ? AND kind = 'completed'
       AND substr(start_date_local, 1, 10) >= ? ORDER BY start_date_local`
    )
    .all(tenantId, cutoffDate);
  return rowsToSessions(rows);
}

export function cleanupOldPlanned() {
  // El histórico del plan rolling no se elimina automáticamente. Las sesiones
  // antiguas se conservan para análisis, contexto y trazabilidad.
  return 0;
}

export function loadPlannedSessions() {
  cleanupOldPlanned();
  const tenantId = getTenantId();
  if (!tenantId) return [];
  const rows = getDb()
    .prepare(
      "SELECT data FROM sessions WHERE tenant_id = ? AND kind = 'planned' ORDER BY start_date_local"
    )
    .all(tenantId);
  return rowsToSessions(rows);
}

export function loadAllSessions() {
  return { completed: loadCompletedSessions(), planned: loadPlannedSessions() };
}

export function getSession(id) {
  const row = getDb()
    .prepare("SELECT data, kind FROM sessions WHERE tenant_id = ? AND id = ?")
    .get(getTenantId(), String(id));
  if (!row) return null;
  const session = JSON.parse(row.data);
  return { ...enrich(session), kind: row.kind };
}

export function getMergedCompletedSession(plannedSession, tenantId = getTenantId()) {
  const completedId = plannedSession?.merged_with;
  if (!completedId || !tenantId) return null;
  const row = getDb()
    .prepare("SELECT data FROM sessions WHERE tenant_id = ? AND kind = 'completed' AND id = ?")
    .get(tenantId, String(completedId));
  if (!row) return null;
  try {
    return enrich(JSON.parse(row.data));
  } catch {
    return null;
  }
}

export function updateSession(id, updates) {
  const row = getDb()
    .prepare("SELECT data, kind FROM sessions WHERE tenant_id = ? AND id = ?")
    .get(getTenantId(), String(id));
  if (!row) return null;
  const session = { ...JSON.parse(row.data), ...updates, id: String(id) };
  upsertSession(getTenantId(), row.kind, session);
  return enrich(session);
}

export function getAthleteProfile(tenantId = getTenantId()) {
  if (!tenantId) return null;
  const row = getDb()
    .prepare("SELECT data FROM athlete_profiles WHERE tenant_id = ?")
    .get(tenantId);
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export function saveAthleteProfile(tenantId, profile) {
  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    Object.keys(profile).length === 0
  ) {
    return false;
  }
  getDb()
    .prepare(
      `INSERT INTO athlete_profiles (tenant_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .run(tenantId, JSON.stringify(profile), new Date().toISOString());
  return true;
}
