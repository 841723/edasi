import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = `/tmp/athlete-tests/e2e/test-${randomUUID()}.db`;

const { getDb } = await import("../lib/db.js");
const { migrate } = await import("../lib/migrate.js");
const {
  seedDefaultAiConfig,
  listAiConfigs,
  getAiConfigWithKey,
  getDefaultAiConfig,
  saveAiConfig,
  setDefaultAiConfig,
  deleteAiConfig,
  chatDurationLabel,
  getChatWindowMs,
  MAX_AI_CONFIGS,
} = await import("../lib/ai-configs.js");
const {
  seedDefaultEquipment,
  getEquipmentLabels,
  getEquipment,
  saveEquipment,
  getEquipmentCatalog,
  saveEquipmentCatalog,
} = await import("../lib/equipment.js");

const migrated = migrate();
assert.equal(migrated.migrated, true, "migrate debe ejecutarse en BD vacía");
const tenantId = migrated.tenant.id;

test("chatDurationLabel y getChatWindowMs", () => {
  assert.equal(chatDurationLabel(24), "24 h");
  assert.equal(chatDurationLabel(48), "2 días");
  assert.equal(chatDurationLabel(0), "Sin límite");
  assert.equal(chatDurationLabel(null), "Sin límite");
  assert.equal(getChatWindowMs({ chat_duration_hours: 48 }), 48 * 3600 * 1000);
  assert.equal(getChatWindowMs({ chat_duration_hours: 0 }), null);
});

test("seedDefaultAiConfig crea config por defecto con key legada", async () => {
  const db = getDb();
  // migrate ya sembró una config; la eliminamos para probar la migración desde ai_provider_settings.
  db.prepare("DELETE FROM ai_configs WHERE tenant_id = ?").run(tenantId);
  db.prepare(
    "INSERT INTO ai_provider_settings (tenant_id, provider, api_key, model, base_url, currency, chat_duration_hours, pricing, updated_at) VALUES (?, 'gemini', 'SK-LEGADA', 'gemini-2.0-flash', NULL, 'USD', 48, NULL, ?)"
  ).run(tenantId, new Date().toISOString());

  seedDefaultAiConfig(tenantId);
  const list = listAiConfigs(tenantId);
  assert.equal(list.length, 1);
  assert.equal(list[0].is_default, true);
  assert.equal(list[0].provider, "gemini");
  assert.equal(list[0].currency, "USD");
  assert.equal(list[0].chatDurationLabel, "2 días");

  const withKey = getAiConfigWithKey(tenantId, list[0].id);
  assert.equal(withKey.api_key, "SK-LEGADA");
  assert.equal("api_key" in getDefaultAiConfig(tenantId), false, "sin key por defecto");
});

test("saveAiConfig: crear, conservar key, max, moneda mayúsculas", () => {
  const id1 = saveAiConfig(tenantId, {
    name: "Mock dev",
    provider: "mock",
    apiKey: "",
    model: "mock-1",
    currency: "eur",
    chatDurationHours: 72,
    isDefault: true,
  });
  const id2 = saveAiConfig(tenantId, {
    name: "Gemini",
    provider: "gemini",
    apiKey: "SK-GEMINI",
    model: "gemini-2.0-flash",
    currency: "EUR",
  });

  const dto1 = getAiConfigWithKey(tenantId, id1);
  assert.equal(dto1.currency, "EUR", "moneda normalizada a mayúsculas");
  assert.equal(dto1.is_default, true, "id1 es default");
  assert.equal(getAiConfigWithKey(tenantId, id2).is_default, false);

  // Guardar de nuevo sin apiKey conserva la anterior
  saveAiConfig(tenantId, {
    id: id2,
    name: "Gemini edit",
    provider: "gemini",
    apiKey: "",
    currency: "EUR",
    chatDurationHours: 24,
  });
  assert.equal(getAiConfigWithKey(tenantId, id2).api_key, "SK-GEMINI", "key conservada");

  assert.throws(() => {
    for (let i = 0; i < MAX_AI_CONFIGS; i++) {
      saveAiConfig(tenantId, { name: `extra${i}`, provider: "mock", apiKey: "", currency: "EUR", chatDurationHours: 24 });
    }
  }, /Máximo/);
});

test("setDefaultAiConfig y deleteAiConfig", () => {
  const list = listAiConfigs(tenantId);
  const gemini = list.find((c) => c.provider === "gemini");
  setDefaultAiConfig(tenantId, gemini.id);
  assert.equal(getDefaultAiConfig(tenantId).id, gemini.id);

  const other = list.find((c) => !c.is_default && c.id !== gemini.id);
  assert.equal(deleteAiConfig(tenantId, other.id), true);
  assert.throws(() => setDefaultAiConfig(tenantId, "no-existe"), /no encontrada/);

  // Borrar hasta dejar una sola config: la última no puede eliminarse.
  while (listAiConfigs(tenantId).length > 1) {
    const remaining = listAiConfigs(tenantId);
    const toDelete = remaining.find((c) => c.id !== gemini.id) ?? remaining[0];
    deleteAiConfig(tenantId, toDelete.id);
  }
  assert.throws(() => deleteAiConfig(tenantId, gemini.id), /única/);
});

test("equipment: seed, labels y save", () => {
  seedDefaultEquipment(tenantId);
  const labels = getEquipmentLabels(tenantId);
  assert.ok(labels.length >= 3, "se siembra catálogo de equipamiento");
  assert.ok(labels.includes("Rodillo inteligente"));

  const before = getEquipment(tenantId).length;
  saveEquipment(tenantId, [{ item: "Prueba", category: "custom", quantity: 1 }]);
  const after = getEquipment(tenantId);
  assert.equal(after.length, 1, "saveEquipment reemplaza el conjunto");
  assert.equal(after[0].item, "Prueba");
  assert.deepEqual(getEquipmentLabels(tenantId), ["Prueba"]);
});

test("equipment: catálogo por tenant editable", () => {
  const catalog = getEquipmentCatalog(tenantId);
  assert.ok(catalog.length >= 4, "se siembra el catálogo por defecto");
  const running = catalog.find((c) => c.category === "running");
  assert.ok(running, "categoría running presente");
  assert.ok(running.items.length > 0);

  // El tenant puede quitar ítems de una categoría y añadir otros nuevos.
  const custom = [
    { category: "mi_categoria", label: "Mi categoría", emoji: "🔥", items: [{ label: "Cosa rara", emoji: "" }] },
  ];
  const swimming = catalog.find((c) => c.category === "swimming");
  const filtered = swimming.items.filter((i) => i.label !== "Gafas de natación");
  const final = catalog
    .map((c) => {
      if (c.category === "swimming") return { ...c, items: filtered.concat([{ label: "Tapones", emoji: "" }]) };
      return c;
    })
    .concat(custom);
  saveEquipmentCatalog(tenantId, final);

  const saved = getEquipmentCatalog(tenantId);
  const savedSwimming = saved.find((c) => c.category === "swimming");
  assert.ok(!savedSwimming.items.some((i) => i.label === "Gafas de natación"), "ítem quitado");
  assert.ok(savedSwimming.items.some((i) => i.label === "Tapones"), "ítem añadido a natación");
  assert.ok(saved.some((c) => c.category === "mi_categoria" && c.label === "Mi categoría"), "categoría nueva");
});
