import type {
  Session,
  SessionsResponse,
  PlannedSessionView,
  WeeklySummary,
  StatsData,
  ChartsData,
  RaceGoal,
  MetaData,
  MetaPayload,
  StatsRecordsData,
  SyncResult,
  SyncSourcesResponse,
  SyncSource,
  Job,
  SessionAnalysisSummary,
  AiSettings,
  AiConfigsResponse,
  AiConfigPayload,
  AdminSettings,
  AdminTenant,
  AdminTenantPayload,
  ApiKey,
  AiLogsPage,
  EquipmentResponse,
  EquipmentCategory,
  AiPrompt,
  DefaultPrompt,
} from "@/types/session";
import type { MeResponse, Member, User, TenantRole } from "@/types/auth";

const BASE = "/api";

let activeTenantId: string | null = null;

export function setApiTenant(tenantId: string | null) {
  activeTenantId = tenantId;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (activeTenantId) headers["X-Tenant-Id"] = activeTenantId;
  return headers;
}

function handleUnauthorized() {
  window.dispatchEvent(new Event("auth:unauthorized"));
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: authHeaders(),
  });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `API ${res.status}: ${path}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function fetchSessions(): Promise<SessionsResponse> {
  return get("/sessions");
}

export function createManualSession(payload: Partial<Session>): Promise<{ session: Session; merged: number }> {
  return send("/sessions", "POST", payload);
}

export function deleteSession(id: string): Promise<void> {
  return send(`/sessions/${encodeURIComponent(id)}`, "DELETE");
}

export function fetchWeekly(): Promise<WeeklySummary[]> {
  return get("/weekly");
}

export function fetchStats(): Promise<StatsData> {
  return get("/stats");
}

export function fetchCharts(): Promise<ChartsData> {
  return get("/charts");
}

export function fetchGoals(): Promise<RaceGoal[]> {
  return get("/goals");
}

export function updateGoals(goals: RaceGoal[]): Promise<{ ok: boolean }> {
  return send("/goals", "PUT", { goals });
}

export function fetchMeta(): Promise<MetaData> {
  return get("/meta");
}

export function updateMeta(payload: Partial<MetaPayload>): Promise<MetaData> {
  return send("/meta", "PUT", payload);
}
export function fetchPlanned(): Promise<PlannedSessionView[]> {
  return get("/planned");
}

export function createPlanned(payload: Partial<Session>): Promise<PlannedSessionView> {
  return send("/planned", "POST", payload);
}

export function updatePlanned(
  id: string,
  payload: Partial<Session>
): Promise<PlannedSessionView> {
  return send(`/planned/${encodeURIComponent(id)}`, "PUT", payload);
}

export function deletePlanned(id: string): Promise<void> {
  return send(`/planned/${encodeURIComponent(id)}`, "DELETE");
}

export function syncGarmin(): Promise<Job> {
  return send("/sync", "POST");
}

export function fetchJobs(active = false): Promise<Job[]> {
  return get(`/jobs${active ? "?active=true" : ""}`);
}

export function cancelJob(id: string): Promise<Job> {
  return send(`/jobs/${encodeURIComponent(id)}/cancel`, "POST");
}

export function fetchSessionAnalysis(): Promise<SessionAnalysisSummary> {
  return get("/session-analysis");
}

export function startSessionAnalysis(): Promise<{ pending: number; jobId: string | null }> {
  return send("/session-analysis", "POST");
}

export function fetchAdminSyncJobs(): Promise<Record<string, unknown>[]> {
  return get("/admin/sync/jobs");
}

export function fetchAdminAiUsage(): Promise<Record<string, unknown>[]> {
  return get("/admin/ai-usage/summary");
}

export function fetchAdminAiLogs(): Promise<Record<string, unknown>[]> {
  return get("/admin/ai-logs");
}

export function fetchSyncSources(): Promise<SyncSourcesResponse> {
  return get("/sync-sources");
}

export function garminConnect(body: { email: string; password: string }): Promise<{ ok: boolean; item?: SyncSource; mfaRequired?: boolean }> {
  return send("/sync-sources/garmin/connect", "POST", body);
}

export function garminMfa(body: { email: string; password: string; code: string }): Promise<{ ok: boolean; item?: SyncSource }> {
  return send("/sync-sources/garmin/mfa", "POST", body);
}

export function garminTokens(body: { tokens: string }): Promise<{ ok: boolean; item?: SyncSource }> {
  return send("/sync-sources/garmin/tokens", "POST", body);
}

export function stravaConnect(): Promise<{ url: string; redirectUri: string }> {
  return send("/sync-sources/strava/connect", "POST");
}

export function disconnectSyncSource(provider: string): Promise<{ ok: boolean; item: SyncSource }> {
  return send(`/sync-sources/${encodeURIComponent(provider)}/disconnect`, "POST");
}

export function updateSyncSourceConfig(provider: string, body: { min_date?: string | null; max_date?: string | null }): Promise<{ ok: boolean; item: SyncSource }> {
  return send(`/sync-sources/${encodeURIComponent(provider)}/config`, "PUT", body);
}

export function updateSession(id: string, payload: Partial<Session>): Promise<Session> {
  return send(`/sessions/${encodeURIComponent(id)}`, "PUT", payload);
}

export function fetchSession(id: string): Promise<Session> {
  return get(`/sessions/${encodeURIComponent(id)}`);
}

export function fetchStatsRecords(): Promise<StatsRecordsData> {
  return get("/stats-records");
}

export function fetchAuthConfig(): Promise<{ clientId: string | null }> {
  return get("/auth/config");
}

export function googleLogin(credential: string): Promise<{ user: User }> {
  return send("/auth/google", "POST", { credential });
}

export function logout(): Promise<{ ok: boolean }> {
  return send("/auth/logout", "POST");
}

export function fetchMe(): Promise<MeResponse> {
  return get("/me");
}

export function switchTenant(tenantId: string): Promise<{ activeTenantId: string }> {
  return send("/switch-tenant", "POST", { tenantId });
}

export function fetchMembers(tenantId: string): Promise<Member[]> {
  return get(`/tenants/${encodeURIComponent(tenantId)}/members`);
}

export function addMember(
  tenantId: string,
  payload: { email: string; role: TenantRole }
): Promise<Member> {
  return send(`/tenants/${encodeURIComponent(tenantId)}/members`, "POST", payload);
}

export function updateMemberRole(
  tenantId: string,
  userId: string,
  role: TenantRole
): Promise<{ ok: boolean }> {
  return send(`/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}`, "PUT", {
    role,
  });
}

export function removeMember(tenantId: string, userId: string): Promise<void> {
  return send(`/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}`, "DELETE");
}

// --- Administración global (superadmin) ---

export function fetchAdminSettings(): Promise<AdminSettings> {
  return get("/admin/settings");
}

export function updateAdminSettings(payload: {
  enabledProviders?: string[];
}): Promise<AdminSettings> {
  return send("/admin/settings", "PUT", payload);
}

export function fetchAdminTenants(): Promise<AdminTenant[]> {
  return get("/admin/tenants");
}

export function createAdminTenant(payload: AdminTenantPayload): Promise<AdminTenant> {
  return send("/admin/tenants", "POST", payload);
}

export function adminRenameTenant(tenantId: string, name: string): Promise<{ name: string }> {
  return send(`/admin/tenants/${encodeURIComponent(tenantId)}/name`, "PUT", { name });
}

export function fetchAdminTenantMembers(tenantId: string): Promise<Member[]> {
  return get(`/admin/tenants/${encodeURIComponent(tenantId)}/members`);
}

export function adminAddMember(
  tenantId: string,
  payload: { email: string; role: TenantRole }
): Promise<Member> {
  return send(`/admin/tenants/${encodeURIComponent(tenantId)}/members`, "POST", payload);
}

export function adminUpdateMemberRole(
  tenantId: string,
  userId: string,
  role: TenantRole
): Promise<{ ok: boolean }> {
  return send(
    `/admin/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}`,
    "PUT",
    { role }
  );
}

export function adminRemoveMember(tenantId: string, userId: string): Promise<void> {
  return send(
    `/admin/tenants/${encodeURIComponent(tenantId)}/members/${encodeURIComponent(userId)}`,
    "DELETE"
  );
}

export function fetchAiSettings(): Promise<AiSettings> {
  return get("/ai-settings");
}

export function updateAiSettings(payload: {
  provider: string;
  apiKey: string;
  model: string | null;
  baseUrl?: string | null;
  currency?: string;
  pricing?: Record<string, { input_per_mtok?: number; output_per_mtok?: number }>;
}): Promise<{ ok: boolean }> {
  return send("/ai-settings", "PUT", payload);
}

export function testAiSettings(): Promise<{ ok: boolean }> {
  return send("/ai-settings/test", "POST");
}

export function fetchAiConfigs(): Promise<AiConfigsResponse> {
  return get("/ai-configs");
}

export function createAiConfig(payload: AiConfigPayload): Promise<{ id: string }> {
  return send("/ai-configs", "POST", payload);
}

export function updateAiConfig(
  configId: string,
  payload: Partial<AiConfigPayload>
): Promise<{ ok: boolean }> {
  return send(`/ai-configs/${encodeURIComponent(configId)}`, "PUT", payload);
}

export function deleteAiConfig(configId: string): Promise<void> {
  return send(`/ai-configs/${encodeURIComponent(configId)}`, "DELETE");
}

export function setDefaultAiConfig(configId: string): Promise<{ ok: boolean }> {
  return send(`/ai-configs/${encodeURIComponent(configId)}/default`, "POST");
}

export function testAiConfig(configId: string): Promise<{ ok: boolean }> {
  return send(`/ai-configs/${encodeURIComponent(configId)}/test`, "POST");
}



export function fetchApiKeys(): Promise<ApiKey[]> {
  return get("/api-keys");
}

export function createApiKey(payload: {
  name: string;
  role: "admin" | "visitor";
}): Promise<{ apiKey: string }> {
  return send("/api-keys", "POST", payload);
}

export function deleteApiKey(id: string): Promise<void> {
  return send(`/api-keys/${encodeURIComponent(id)}`, "DELETE");
}

export function fetchAiLogs(options: {
  limit?: number;
  offset?: number;
  ok?: "ok" | "error";
  provider?: string;
} = {}): Promise<AiLogsPage> {
  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.offset != null) params.set("offset", String(options.offset));
  if (options.ok) params.set("ok", options.ok);
  if (options.provider) params.set("provider", options.provider);
  const qs = params.toString();
  return get(`/ai-logs${qs ? `?${qs}` : ""}`);
}

export function fetchEquipment(): Promise<EquipmentResponse> {
  return get("/equipment");
}

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  reason?: "ok" | "missing_keys" | "invalid_keypair";
}

export function fetchPushConfig(): Promise<PushConfig> {
  return get("/push/config");
}

export function savePushSubscription(subscription: PushSubscriptionJSON): Promise<{ ok: boolean }> {
  return send("/push/subscriptions", "POST", subscription);
}

export function deletePushSubscription(endpoint: string): Promise<void> {
  return send("/push/subscriptions", "DELETE", { endpoint });
}

export function saveEquipment(
  payload: { items: { item: string; category: string; quantity: number }[]; catalog?: EquipmentCategory[] }
): Promise<{ ok: boolean }> {
  return send("/equipment", "PUT", payload);
}

export function fetchPrompts(): Promise<AiPrompt[]> {
  return get("/prompts");
}

export function createPrompt(payload: { name: string; content: string }): Promise<{ id: string }> {
  return send("/prompts", "POST", payload);
}

export function updatePrompt(
  promptId: string,
  payload: { name: string; content: string }
): Promise<{ ok: boolean }> {
  return send(`/prompts/${encodeURIComponent(promptId)}`, "PUT", payload);
}

export function setActivePrompt(promptId: string): Promise<{ ok: boolean }> {
  return send(`/prompts/${encodeURIComponent(promptId)}/active`, "PUT");
}

export function duplicatePrompt(promptId: string): Promise<{ id: string }> {
  return send(`/prompts/${encodeURIComponent(promptId)}/duplicate`, "POST");
}

export function deletePrompt(promptId: string): Promise<void> {
  return send(`/prompts/${encodeURIComponent(promptId)}`, "DELETE");
}

export function fetchAdminPrompts(): Promise<DefaultPrompt[]> {
  return get("/admin/prompts");
}

export function createAdminPrompt(payload: { name: string; content: string }): Promise<{ id: string }> {
  return send("/admin/prompts", "POST", payload);
}

export function updateAdminPrompt(
  promptId: string,
  payload: { name: string; content: string }
): Promise<{ ok: boolean }> {
  return send(`/admin/prompts/${encodeURIComponent(promptId)}`, "PUT", payload);
}

export function deleteAdminPrompt(promptId: string): Promise<void> {
  return send(`/admin/prompts/${encodeURIComponent(promptId)}`, "DELETE");
}
