import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(import.meta.dirname, "..", "..", "data");
export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "endurance.db");

let db = null;

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table);
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

const INIT_SQL_PATH = path.resolve(import.meta.dirname, "..", "init.sql");

function loadInitSql() {
  try {
    return fs.readFileSync(INIT_SQL_PATH, "utf8");
  } catch {
    throw new Error("No se pudo cargar backend/init.sql con el esquema de la BD");
  }
}

function migrateActivityIds() {
  const db = getDbInstance();
  const migration = "activities-internal-ids-v1";
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(migration)) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    const completed = db.prepare("SELECT tenant_id, id, data FROM sessions WHERE kind = 'completed'").all();
    const idMap = new Map();
    const insert = db.prepare(
      "INSERT INTO sessions (tenant_id, id, kind, sport, start_date_local, title, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const remove = db.prepare("DELETE FROM sessions WHERE tenant_id = ? AND id = ?");
    const sourceInsert = db.prepare(
      "INSERT OR IGNORE INTO activity_sources (activity_id, tenant_id, source, external_activity_id, metadata, created_at, updated_at) VALUES (?, ?, 'garmin', ?, NULL, ?, ?)"
    );
    const now = new Date().toISOString();

    for (const row of completed) {
      const internalId = randomUUID();
      idMap.set(`${row.tenant_id}:${row.id}`, internalId);
      const data = JSON.parse(row.data);
      data.id = internalId;
      data.source = data.source ?? "garmin";
      data.external_id = data.external_id ?? String(row.id);
      insert.run(
        row.tenant_id,
        internalId,
        "completed",
        data.sport ?? null,
        data.start_date_local ?? null,
        data.title ?? null,
        data.name ?? null,
        JSON.stringify(data),
        now,
        now,
      );
      sourceInsert.run(internalId, row.tenant_id, String(row.id), now, now);
    }

    const planned = db.prepare("SELECT tenant_id, id, data FROM sessions WHERE kind = 'planned'").all();
    for (const row of planned) {
      const data = JSON.parse(row.data);
      const old = data.merged_with ? idMap.get(`${row.tenant_id}:${data.merged_with}`) : null;
      if (old) {
        data.merged_with = old;
        db.prepare("UPDATE sessions SET data = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
          .run(JSON.stringify(data), now, row.tenant_id, row.id);
      }
    }
    for (const row of completed) remove.run(row.tenant_id, row.id);
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(migration, now);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
    throw error;
  }
}

function tableColumns(tableName) {
  const rows = db.prepare("SELECT name FROM pragma_table_info(?)").all(tableName);
  return new Set(rows.map((r) => r.name));
}

function migrateRemovePlans() {
  const db = getDbInstance();
  const migration = "remove-plans-v1";
  if (db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(migration)) return;

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    // El chat pasa a ser de tenant (tabla chat_messages). Los mensajes de cada
    // plan se migran al chat del tenant al que pertenecía el plan.
    const hasPlansTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plans'")
      .get();
    if (hasPlansTable) {
      db.exec(`
        INSERT OR IGNORE INTO chat_messages (id, tenant_id, role, content, created_at)
        SELECT pm.id, p.tenant_id, pm.role, pm.content, pm.created_at
        FROM plan_messages pm JOIN plans p ON p.id = pm.plan_id
      `);
      // El estado del chat del plan activo pasa a tenant_settings. La tabla plans
      // de BDs antiguas puede carecer de las columnas de chat (se añadieron más
      // adelante): se copia solo lo que exista para que la migración no falle.
      const planCols = tableColumns("plans");
      const fields = [];
      const mapping = [];
      if (planCols.has("chat_pending")) { fields.push("chat_pending"); mapping.push("chat_pending"); }
      if (planCols.has("response_id")) { fields.push("chat_response_id"); mapping.push("response_id"); }
      if (planCols.has("context_hash")) { fields.push("chat_context_hash"); mapping.push("context_hash"); }
      if (planCols.has("chat_instructions")) { fields.push("chat_instructions"); mapping.push("chat_instructions"); }
      const hasActive = planCols.has("active");
      // Solo se migra el estado si la tabla vieja llegó a tener columnas de chat
      // (BDs muy antiguas no las tienen; no hay nada que conservar más que el
      // plan activo, que igual se elimina con la tabla).
      if (fields.length > 0) {
        const srcFields = mapping.join(", ");
        const tgtFields = fields.join(", ");
        // Sin WHERE, SQLite puede interpretar el ON de UPSERT como parte del
        // SELECT y resolver mal las columnas cuando la tabla antigua no tenía
        // active.
        const whereActive = hasActive ? "WHERE active = 1" : "WHERE 1 = 1";
        const setClause = fields.map((f) => `${f} = excluded.${f}`).join(", ");
        db.exec(`
          INSERT INTO tenant_settings (tenant_id, ${tgtFields})
          SELECT tenant_id, ${srcFields}
          FROM plans ${whereActive}
          ON CONFLICT(tenant_id) DO UPDATE SET ${setClause}
        `);
      }
    }

    // Las sesiones planificadas de IA (plan_id no nulo) pasan al marcador
    // "coach" para distinguirlas de las planificadas manuales (plan_id nulo)
    // y poder reemplazar solo el futuro propuesto por el entrenador.
    const rows = db.prepare("SELECT tenant_id, id, data FROM sessions WHERE kind = 'planned'").all();
    const update = db.prepare("UPDATE sessions SET data = ?, updated_at = ? WHERE tenant_id = ? AND id = ?");
    for (const row of rows) {
      const data = JSON.parse(row.data);
      if (data.plan_id == null) continue;
      data.plan_id = "coach";
      update.run(JSON.stringify(data), now, row.tenant_id, row.id);
    }

    db.exec("DROP TABLE IF EXISTS plan_messages;");
    db.exec("DROP TABLE IF EXISTS plans;");
    db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(migration, now);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
    throw error;
  }
}

function getDbInstance() {
  return db;
}

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(loadInitSql());
  // activity_tracks ya no forma parte del modelo actual, pero no se destruye
  // automáticamente: puede contener datos de instalaciones antiguas.
  ensureColumn("users", "is_superadmin", "is_superadmin INTEGER NOT NULL DEFAULT 0");
  ensureColumn("goals", "url", "url TEXT");
  ensureColumn("goals", "is_primary", "is_primary INTEGER NOT NULL DEFAULT 0");
  ensureColumn("goals", "color", "color TEXT");
  ensureColumn("ai_provider_settings", "base_url", "base_url TEXT");
  ensureColumn("ai_provider_settings", "currency", "currency TEXT NOT NULL DEFAULT 'EUR'");
  ensureColumn("ai_provider_settings", "chat_duration_hours", "chat_duration_hours INTEGER NOT NULL DEFAULT 24");
  ensureColumn("ai_provider_settings", "pricing", "pricing TEXT");
  ensureColumn("tenant_settings", "focus_sports", "focus_sports TEXT");
  ensureColumn("tenant_settings", "chat_pending", "chat_pending INTEGER NOT NULL DEFAULT 0");
  ensureColumn("tenant_settings", "chat_response_id", "chat_response_id TEXT");
  ensureColumn("tenant_settings", "chat_context_hash", "chat_context_hash TEXT");
  ensureColumn("tenant_settings", "chat_instructions", "chat_instructions TEXT");
  ensureColumn("tenant_settings", "chat_external", "chat_external INTEGER NOT NULL DEFAULT 0");
  ensureColumn("ai_logs", "input_tokens", "input_tokens INTEGER");
  ensureColumn("ai_logs", "output_tokens", "output_tokens INTEGER");
  ensureColumn("ai_logs", "cost", "cost REAL");
  ensureColumn("ai_logs", "currency", "currency TEXT");
  ensureColumn("ai_logs", "operation_type", "operation_type TEXT");
  ensureColumn("ai_prompts", "role", "role TEXT NOT NULL DEFAULT 'chat'");
  ensureColumn("ai_prompts", "is_active", "is_active INTEGER NOT NULL DEFAULT 0");
  ensureColumn("ai_prompts", "default_prompt_id", "default_prompt_id TEXT");
  ensureColumn("ai_model_catalog", "provider_id", "provider_id TEXT");
  ensureColumn("jobs", "lease_id", "lease_id TEXT");
  db.exec(`INSERT OR IGNORE INTO ai_model_catalog
    (provider, model_id, provider_id, name, enabled, input_price, output_price, currency, updated_at)
    SELECT 'opencode', model_id, provider_id, name, enabled, input_price, output_price, 'EUR', updated_at
    FROM opencode_models`);
  migrateRemovePlans();
  migrateActivityIds();
  return db;
}
