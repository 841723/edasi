// Configuración global del sistema (por clave, sin tenant).
// Claves:
//   enabled_providers: JSON array de ids de proveedores de IA habilitados.
import { getDb } from "./db.js";
import { PROVIDER_LIST } from "./providers.js";

export const SETTINGS_KEYS = {
  enabledProviders: "enabled_providers",
};

function getValue(key, fallback = null) {
  const row = getDb().prepare("SELECT value FROM global_settings WHERE key = ?").get(key);
  return row?.value ?? fallback;
}

function setValue(key, value) {
  getDb()
    .prepare(
      `INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString());
}

function parseJsonArray(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function seedDefaultGlobalSettings() {
  if (getDb().prepare("SELECT COUNT(*) AS c FROM global_settings").get().c === 0) {
    setValue(SETTINGS_KEYS.enabledProviders, JSON.stringify(PROVIDER_LIST.map((p) => p.id)));
  }
}

export function getGlobalSettings() {
  return {
    enabledProviders: parseJsonArray(
      getValue(SETTINGS_KEYS.enabledProviders, null),
      PROVIDER_LIST.map((p) => p.id)
    ),
  };
}

export function getEnabledProviders() {
  return new Set(getGlobalSettings().enabledProviders);
}

export function isProviderEnabled(providerId) {
  return getEnabledProviders().has(providerId);
}

export function updateGlobalSettings({ enabledProviders }) {
  if (Array.isArray(enabledProviders)) {
    const valid = PROVIDER_LIST.map((p) => p.id);
    const cleaned = [...new Set(enabledProviders.filter((id) => valid.includes(id)))];
    setValue(SETTINGS_KEYS.enabledProviders, JSON.stringify(cleaned));
  }
  return getGlobalSettings();
}
