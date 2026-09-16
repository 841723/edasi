import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const dbPath = `/tmp/athlete-tests/remove-plans-migration-${randomUUID()}.db`;
process.env.DB_PATH = dbPath;
fs.mkdirSync("/tmp/athlete-tests", { recursive: true });
const oldDb = new DatabaseSync(dbPath);
oldDb.exec(`
  CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, slug TEXT, created_at TEXT);
  CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE plans (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, created_at TEXT NOT NULL,
    comments TEXT, weeks INTEGER DEFAULT 1, profile_version_id TEXT,
    prompt_id TEXT, prompt_name TEXT, response_id TEXT,
    ai_config_id TEXT, status TEXT NOT NULL DEFAULT 'completed', error TEXT,
    request_comments TEXT, started_at TEXT, finished_at TEXT,
    chat_pending INTEGER NOT NULL DEFAULT 0, context_hash TEXT
  );
  CREATE TABLE plan_messages (
    id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, role TEXT NOT NULL,
    content TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
    sport TEXT, start_date_local TEXT, title TEXT, name TEXT, data TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant_id, id)
  );
`);
oldDb.prepare("INSERT INTO tenants VALUES (?, ?, ?, ?)").run(
  "tenant-remove-plans", "Migration", "migration", "2026-01-01",
);
oldDb.prepare(
  "INSERT INTO plans (id, tenant_id, created_at, chat_pending, context_hash) VALUES (?, ?, ?, ?, ?)",
).run("plan-1", "tenant-remove-plans", "2026-01-01", 1, "hash-1");
oldDb.prepare("INSERT INTO plan_messages VALUES (?, ?, ?, ?, ?)").run(
  "message-1", "plan-1", "user", "Keep going", "2026-01-01",
);
oldDb.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  "tenant-remove-plans", "planned-1", "planned", "running", "2026-01-01",
  "Plan", "Plan", JSON.stringify({ plan_id: "plan-1" }), "2026-01-01", "2026-01-01",
);
oldDb.close();

const { getDb } = await import("../lib/db.js");

test("migra una BD de planes sin active ni chat_instructions", () => {
  const db = getDb();

  const settings = db.prepare(
    "SELECT chat_pending, chat_context_hash FROM tenant_settings WHERE tenant_id = ?",
  ).get("tenant-remove-plans");
  const message = db.prepare("SELECT content FROM chat_messages WHERE id = ?").get("message-1");
  const session = db.prepare("SELECT data FROM sessions WHERE id = ?").get("planned-1");

  assert.equal(settings.chat_pending, 1);
  assert.equal(settings.chat_context_hash, "hash-1");
  assert.equal(message.content, "Keep going");
  assert.equal(JSON.parse(session.data).plan_id, "coach");
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plans'").get(), undefined);
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("remove-plans-v1"));
  fs.rmSync(dbPath, { force: true });
});
