import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = `/tmp/athlete-tests/e2e/admin-${randomUUID()}.db`;
delete process.env.ADMIN_EMAILS;

const { getDb } = await import("../lib/db.js");
const { migrate } = await import("../lib/migrate.js");
const {
  getGlobalSettings,
  updateGlobalSettings,
  getEnabledProviders,
  isProviderEnabled,
  seedDefaultGlobalSettings,
} = await import("../lib/global-settings.js");
const { createAthlete } = await import("../lib/athletes.js");
const { getProvidersList } = await import("../lib/ai-provider.js");
const { addMember, updateMemberRole, listMembers } = await import("../lib/members.js");
const { seedDefaultAiConfig, listAiConfigs, saveAiConfig, getAiConfigWithKey } = await import("../lib/ai-configs.js");

const migrated = migrate();
const tenantId = migrated.tenant.id;

test("seedDefaultGlobalSettings siembra proveedores por defecto", () => {
  seedDefaultGlobalSettings();
  const global = getGlobalSettings();
  assert.deepEqual(global.enabledProviders, ["gemini", "mock"]);
  assert.equal(isProviderEnabled("gemini"), true);
});

test("updateGlobalSettings filtra proveedores", () => {
  updateGlobalSettings({ enabledProviders: ["gemini", "inventado"] });
  assert.deepEqual(getEnabledProviders(), new Set(["gemini"]));
  assert.equal(isProviderEnabled("mock"), false);

  // getProvidersList solo devuelve los habilitados.
  const list = getProvidersList();
  assert.ok(!list.some((p) => p.id === "mock"));
  assert.ok(list.some((p) => p.id === "gemini"));

  updateGlobalSettings({ enabledProviders: ["gemini", "mock"] });
  assert.equal(isProviderEnabled("mock"), true);
});

test("createAthlete crea tenant + owner + seeds; rechaza slug duplicado", () => {
  const athlete = createAthlete({ name: "Sara", ownerEmail: "sara@example.com" });
  const db = getDb();
  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(athlete.id);
  assert.equal(tenant.slug, "sara");
  const members = listMembers(athlete.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].role, "athlete");
  assert.equal(members[0].isOwner, true);
  assert.equal(members[0].email, "sara@example.com");
  assert.ok(listAiConfigs(athlete.id).length === 0, "config de IA vacía al crear tenant");

  assert.throws(() => createAthlete({ name: "Sara", ownerEmail: "sara@example.com" }), /Ya existe un tenant/);
});

test("members: admin puede asignar rol athlete; owner sigue protegido", () => {
  const admin = createAthlete({ name: "Dani", ownerEmail: "dani@example.com" });
  const added = addMember(admin.id, { email: "coach@example.com", role: "athlete" }, new Set(["athlete", "admin", "visitor"]));
  assert.equal(added.role, "athlete");

  updateMemberRole(admin.id, added.id, "visitor", new Set(["athlete", "admin", "visitor"]));
  const member = listMembers(admin.id).find((m) => m.id === added.id);
  assert.equal(member.role, "visitor");

  const owner = listMembers(admin.id).find((m) => m.isOwner);
  assert.throws(() => updateMemberRole(admin.id, owner.id, "visitor", new Set(["athlete", "admin", "visitor"])), /propietario/);
});

test("configs de IA: proveedor genérico guarda API key y precios", () => {
  const gid = saveAiConfig(tenantId, {
    name: "Gemini custom",
    provider: "gemini",
    apiKey: "sk-test",
    model: "gemini-2.0-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    currency: "USD",
    chatDurationHours: 12,
    pricing: { "gemini-2.0-flash": { input_per_mtok: 1, output_per_mtok: 4 } },
  });
  const g = getAiConfigWithKey(tenantId, gid);
  assert.equal(g.api_key, "sk-test");
  assert.equal(g.currency, "USD");
  assert.equal(g.chat_duration_hours, 12);
  assert.deepEqual(g.pricing["gemini-2.0-flash"], { input_per_mtok: 1, output_per_mtok: 4 });
});
