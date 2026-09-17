import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const dbPath = `/tmp/athlete-tests/activity-migration-${randomUUID()}.db`;
process.env.DB_PATH = dbPath;
fs.mkdirSync("/tmp/athlete-tests", { recursive: true });
const oldDb = new DatabaseSync(dbPath);
oldDb.exec(`
  CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, slug TEXT, created_at TEXT);
  CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE sessions (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL,
    sport TEXT, start_date_local TEXT, title TEXT, name TEXT, data TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant_id, id)
  );
`);
oldDb.prepare("INSERT INTO tenants VALUES (?, ?, ?, ?)").run("tenant-migration", "Migration", "migration", "2026-01-01");
oldDb.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  "tenant-migration", "garmin-123", "completed", "running", "2026-01-01T08:00:00", "Run", "Run",
  JSON.stringify({ id: "garmin-123", sport: "running", start_date_local: "2026-01-01T08:00:00" }), "2026-01-01", "2026-01-01"
);
oldDb.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
  "tenant-migration", "planned-1", "planned", "running", "2026-01-01T08:00:00", "Plan", "Plan",
  JSON.stringify({ id: "planned-1", plan_id: "plan-1", merged_with: "garmin-123", sport: "running", start_date_local: "2026-01-01T08:00:00" }), "2026-01-01", "2026-01-01"
);
oldDb.close();

const { getDb } = await import("../lib/db.js");

test("migra IDs externos Garmin a UUID internos y reescribe merged_with", () => {
  const db = getDb();
  const completed = db.prepare("SELECT id, data FROM sessions WHERE kind = 'completed'").get();
  const source = db.prepare("SELECT activity_id, source, external_activity_id FROM activity_sources").get();
  const planned = JSON.parse(db.prepare("SELECT data FROM sessions WHERE id = 'planned-1'").get().data);

  assert.notEqual(completed.id, "garmin-123");
  assert.equal(source.activity_id, completed.id);
  assert.equal(source.source, "garmin");
  assert.equal(source.external_activity_id, "garmin-123");
  assert.equal(planned.merged_with, completed.id);
  assert.equal(JSON.parse(completed.data).external_id, "garmin-123");
  assert.ok(db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("activities-internal-ids-v1"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE tenant_id = ?").get("tenant-migration").n, 2);
  fs.rmSync(dbPath, { force: true });
});
