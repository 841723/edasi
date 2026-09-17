import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = `/tmp/athlete-tests/jobs-activity-${randomUUID()}.db`;

const { getDb } = await import("../lib/db.js");
const { withTenant, upsertExternalSession } = await import("../lib/sessions.js");
const { createJob, claimNextJob, finishJob, getJob } = await import("../lib/jobs.js");

const tenantId = randomUUID();
const now = new Date().toISOString();
getDb().prepare("INSERT INTO tenants (id, name, slug, created_at) VALUES (?, ?, ?, ?)")
  .run(tenantId, "Jobs", `jobs-${tenantId}`, now);

test("los jobs se persisten, se reclaman una vez y bloquean duplicados activos", () => {
  const job = createJob({ tenantId, type: "sync", dedupeKey: "sync:garmin", payload: { force: false } });
  assert.equal(job.status, "pending");
  assert.throws(
    () => createJob({ tenantId, type: "sync", dedupeKey: "sync:garmin" }),
    /operación equivalente/
  );

  const claimed = claimNextJob();
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, "running");
  assert.equal(claimNextJob(), null);

  finishJob(claimed.id, claimed.lease_id, "completed", { result: { synced: 2 } });
  assert.equal(getJob(tenantId, job.id).status, "completed");
  const next = createJob({ tenantId, type: "sync", dedupeKey: "sync:garmin" });
  assert.equal(next.status, "pending");
});

test("una actividad externa reutiliza UUID interno y conserva edición local", () => {
  const first = withTenant(tenantId, () => upsertExternalSession(tenantId, "garmin", "12345", {
    sport: "running",
    name: "Garmin run",
    title: "Título local",
    start_date_local: "2026-08-20T08:00:00",
    distance_m: 5000,
  }));
  const second = withTenant(tenantId, () => upsertExternalSession(tenantId, "garmin", "12345", {
    sport: "running",
    name: "Garmin actualizado",
    title: "Título remoto",
    start_date_local: "2026-08-20T08:00:00",
    distance_m: 5100,
  }));
  assert.equal(first.id, second.id);
  assert.equal(second.title, "Título local");
  const mapping = getDb().prepare(
    "SELECT activity_id, source, external_activity_id FROM activity_sources WHERE tenant_id = ?"
  ).get(tenantId);
  assert.equal(mapping.activity_id, first.id);
  assert.equal(mapping.source, "garmin");
  assert.equal(mapping.external_activity_id, "12345");
});
