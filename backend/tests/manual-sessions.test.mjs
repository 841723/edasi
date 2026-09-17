import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = `/tmp/athlete-tests/manual-sessions-${randomUUID()}.db`;

const { getDb } = await import("../lib/db.js");
const { withTenant, createManualSession } = await import("../lib/sessions.js");
const { listPlanned } = await import("../lib/planned.js");
const { mergePlannedWithCompleted } = await import("../lib/merge.js");

const tenantId = randomUUID();
const now = new Date().toISOString();
getDb().prepare("INSERT INTO tenants (id, name, slug, created_at) VALUES (?, ?, ?, ?)").run(
  tenantId,
  "Test manual",
  `manual-${tenantId}`,
  now,
);

test("crea una actividad manual con segmentos y la fusiona con la planificada", () => {
  const date = "2026-08-15";
  withTenant(tenantId, () => {
    const plannedId = randomUUID();
    getDb().prepare(
      "INSERT INTO sessions (tenant_id, id, kind, sport, start_date_local, title, name, data, created_at, updated_at) VALUES (?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      tenantId,
      plannedId,
      "running",
      `${date}T08:00:00`,
      "Series planificadas",
      "Series planificadas",
      JSON.stringify({ id: plannedId, sport: "running", title: "Series planificadas", name: "Series planificadas", start_date_local: `${date}T08:00:00` }),
      now,
      now,
    );
    const session = createManualSession({
      sport: "running",
      title: "Series realizadas",
      start_date_local: `${date}T08:10:00`,
      moving_time_s: 1800,
      distance_m: 5000,
      segments: [{ label: "Serie", time_s: 300, distance_m: 1000, avg_pace_s_per_km: 300 }],
    });
    assert.equal(session.source, "manual");
    assert.equal(session.distance_m, 5000);
    assert.equal(session.segments.length, 1);
    assert.equal(mergePlannedWithCompleted(), 1);
    const planned = listPlanned().find((item) => item.id === plannedId);
    assert.equal(planned.merged_with, session.id);
    assert.equal(planned.completed_session.id, session.id);
  });
});

test("rechaza una actividad manual sin deporte válido", () => {
  assert.throws(
    () => withTenant(tenantId, () => createManualSession({ start_date_local: "2026-08-15T08:00:00" })),
    /deporte no es válido/,
  );
});
