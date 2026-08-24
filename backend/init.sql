-- Esquema de la base de datos. Se aplica en backend/lib/db.js al primer acceso.
-- Las migraciones incrementales (ALTER) se ejecutan desde db.js con ensureColumn.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  picture TEXT,
  is_superadmin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('athlete', 'admin', 'visitor')),
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('completed', 'planned')),
  sport TEXT,
  start_date_local TEXT,
  title TEXT,
  name TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_date ON sessions(tenant_id, kind, start_date_local);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  dedupe_key TEXT NOT NULL,
  payload TEXT,
  result TEXT,
  related_resource_type TEXT,
  related_resource_id TEXT,
  deep_link TEXT,
  progress TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  heartbeat_at TEXT,
  lease_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_created ON jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_dedupe
  ON jobs(tenant_id, dedupe_key)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS activity_sources (
  activity_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_activity_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, source, external_activity_id),
  FOREIGN KEY (tenant_id, activity_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_activity_sources_lookup
  ON activity_sources(tenant_id, source, external_activity_id);

CREATE TABLE IF NOT EXISTS session_ai_analyses (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  analysis TEXT,
  profile_version_id TEXT,
  provider TEXT,
  model TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_ai_analyses_pending
  ON session_ai_analyses(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS athlete_profiles (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  week INTEGER,
  label TEXT,
  date TEXT,
  target_pace TEXT,
  url TEXT,
  color TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_goals_tenant ON goals(tenant_id);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plan_start TEXT,
  goal_date TEXT,
  training_week_one_start TEXT,
  min_date TEXT,
  focus_sports TEXT,
  chat_pending INTEGER NOT NULL DEFAULT 0,
  chat_response_id TEXT,
  chat_context_hash TEXT,
  chat_instructions TEXT,
  chat_external INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'gemini',
  api_key TEXT NOT NULL,
  model TEXT DEFAULT 'gemini-2.0-flash',
  base_url TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  chat_duration_hours INTEGER NOT NULL DEFAULT 24,
  pricing TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS athlete_profile_history (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  author TEXT NOT NULL CHECK (author IN ('user', 'ai')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_history_tenant ON athlete_profile_history(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_prompts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'plan',
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_predefined INTEGER NOT NULL DEFAULT 0,
  default_prompt_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_tenant ON ai_prompts(tenant_id);

-- Prompts predefinidos globales gestionados por el administrador: son la plantilla
-- de los prompt predefinidos (is_predefined=1) que se copian a cada tenant nuevo.
CREATE TABLE IF NOT EXISTS default_prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Conversación con el entrenador IA a nivel de tenant (stateful vía response_id).
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant ON chat_messages(tenant_id, created_at);

-- Configuraciones de IA por tenant (proveedor + key + modelo + duración chat + precios).
CREATE TABLE IF NOT EXISTS ai_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'gemini',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT,
  base_url TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  chat_duration_hours INTEGER NOT NULL DEFAULT 24,
  pricing TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_configs_tenant ON ai_configs(tenant_id);

-- Claves de API por tenant para autenticación sin Google.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'visitor')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

-- Equipamiento del atleta por deporte (catálogo + ítems personalizados).
CREATE TABLE IF NOT EXISTS athlete_equipment (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, item)
);
CREATE INDEX IF NOT EXISTS idx_equipment_tenant ON athlete_equipment(tenant_id);

-- Catálogo de equipamiento por tenant (categorías + ítems; snapshot editable).
-- Se siembra desde el catálogo por defecto en el primer acceso.
CREATE TABLE IF NOT EXISTS equipment_categories (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  emoji TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, category)
);
CREATE INDEX IF NOT EXISTS idx_equipment_categories_tenant ON equipment_categories(tenant_id);

CREATE TABLE IF NOT EXISTS equipment_catalog (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  item TEXT NOT NULL,
  emoji TEXT DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, category, item)
);
CREATE INDEX IF NOT EXISTS idx_equipment_catalog_tenant ON equipment_catalog(tenant_id);

-- Log de cada solicitud a un proveedor de IA.
CREATE TABLE IF NOT EXISTS ai_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT,
  api_key_id TEXT,
  auth_method TEXT NOT NULL,
  actor TEXT,
  operation_type TEXT,
  provider TEXT NOT NULL,
  model TEXT,
  endpoint TEXT,
  api_key_masked TEXT,
  input TEXT,
  response TEXT,
  status INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost REAL,
  currency TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_logs_tenant ON ai_logs(tenant_id, created_at DESC);

-- Fuentes de datos externas por tenant (Garmin, Strava, ...) con sus tokens de sesión.
CREATE TABLE IF NOT EXISTS sync_sources (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  tokens TEXT,
  config TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_sync_sources_tenant ON sync_sources(tenant_id);

-- Configuración global del sistema (una fila por clave).
CREATE TABLE IF NOT EXISTS global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Catálogo global de modelos de opencode gestionado por el administrador.
-- El precio guardado (si existe) sobreescribe el que expone la instancia.
CREATE TABLE IF NOT EXISTS opencode_models (
  model_id TEXT PRIMARY KEY,
  name TEXT,
  provider_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  input_price REAL,
  output_price REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_model_catalog (
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_id TEXT,
  name TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  input_price REAL,
  output_price REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, model_id)
);

-- Suscripciones Web Push por tenant y usuario/dispositivo.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_tenant_endpoint
  ON push_subscriptions(tenant_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_tenant ON push_subscriptions(tenant_id);
