export type SportCategory =
  | "running"
  | "cycling"
  | "swimming"
  | "strength"
  | "hiking"
  | "walking"
  | "padel"
  | "other";

export const SPORT_COLORS: Record<SportCategory, string> = {
  running: "#f472b6",
  cycling: "#facc15",
  swimming: "#60a5fa",
  strength: "#a1a1aa",
  hiking: "#4ade80",
  walking: "#a78bfa",
  padel: "#84cc16",
  other: "#6b7280",
};

export const SPORT_LABELS: Record<SportCategory, string> = {
  running: "Carrera",
  cycling: "Bicicleta",
  swimming: "Natación",
  strength: "Fuerza",
  hiking: "Senderismo",
  walking: "Caminar",
  padel: "Padel",
  other: "Otros",
};

export interface Session {
  schema_version: number;
  id: string;
  source?: string;
  external_id?: string;
  sport: string;
  name: string;
  title?: string;
  start_date_local: string;
  workout_text?: string;
  distance_m?: number;
  moving_time_s?: number;
  elapsed_time_s?: number;
  avg_speed_ms?: number;
  avg_pace_s_per_km?: number;
  max_speed_ms?: number;
  avg_heartrate?: number;
  max_heartrate?: number;
  avg_watts?: number;
  max_watts?: number;
  total_elevation_gain_m?: number;
  total_elevation_loss_m?: number;
  average_temp_c?: number;
  training_effect?: number;
  calories_kcal?: number;
  rpe?: number;
  feel?: number;
  notes?: string;
  location_name?: string;
  segments?: SessionSegment[];
  best_efforts?: SessionBestEffort[];
  hr_zones?: HrZone[];
  workout?: PlannedWorkout;
  hr_from?: number;
  hr_to?: number;
  merged_with?: string;
  completed_session?: Session | null;
  plan_id?: string;
  category?: SportCategory;
  time_s?: number;
  weekNumber?: number | null;
  objectives?: ObjectiveLine[];
}

export interface SessionSegment {
  label?: string;
  pace_text?: string;
  speed_kmh?: number;
  name?: string;
  sets?: number;
  reps?: number;
  weight_kg?: number;
  distance_m?: number;
  time_s?: number;
  avg_speed_ms?: number;
  avg_pace_s_per_km?: number;
  max_speed_ms?: number;
  avg_heartrate?: number;
  max_heartrate?: number;
  avg_watts?: number;
  max_watts?: number;
  total_elevation_gain_m?: number;
  total_elevation_loss_m?: number;
  intensity?: "ACTIVE" | "REST" | "WARMUP" | "COOLDOWN" | string;
}

export interface HrZone {
  zoneNumber: number;
  zoneLowBoundary: number;
  secsInZone: number;
}

export interface WorkoutBlock {
  type?: "steady" | "intervals";
  repeat?: number;
  distance_m?: number;
  time_s?: number;
  pace_s_per_km?: number;
  rest_s?: number;
  hr_from?: number;
  hr_to?: number;
}

export interface PlannedWorkout {
  warmup_s?: number;
  cooldown_s?: number;
  blocks?: WorkoutBlock[];
}

export interface SessionBestEffort {
  name: string;
  distance_m: number;
  elapsed_time_s: number;
}

export interface PlannedSession {
  id: string;
  sport: SportCategory;
  name: string;
  date: string;
  duration_min?: number;
  distance_km?: number;
  notes?: string;
  status: "planned" | "completed";
}

export interface SessionWithStatus extends Session {
  status: "completed" | "planned";
}

export interface FilterState {
  sport: SportCategory | "all";
  dateFrom: string | null;
  dateTo: string | null;
  showCompleted: boolean;
  showPlanned: boolean;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  weekNumber: number;
  sessions: number;
  hours: number;
  distance_km: number;
  elevation_m: number;
  bySport: Record<SportCategory, number>;
}

export interface Goal {
  week: number;
  label: string;
  subtitle: string;
  date: string;
  targetPace?: string;
  daysRemaining: number;
  progress: number;
  status: "upcoming" | "current" | "completed";
}

export interface StatItem {
  label: string;
  value: string | number;
  icon: string;
  trend?: "up" | "down" | "neutral";
}

export interface ObjectiveLine {
  label?: string;
  text: string;
}

export interface RaceGoal {
  week: number;
  label: string;
  date: string;
  targetPace?: string;
  url?: string;
  color?: string;
  isPrimary?: boolean;
}

export interface MetaData {
  trainingWeekOneStart: string;
  planStart: string;
  goalDate: string;
  minDate?: string | null;
  focusSports?: string[];
}

export interface MetaPayload {
  plan_start?: string | null;
  training_week_one_start?: string | null;
  goal_date?: string | null;
  min_date?: string | null;
  focus_sports?: string[];
}

export type FocusSport = "running" | "cycling" | "swimming" | "strength";

export interface SessionTotals {
  totalDistance: number;
  totalHours: number;
  totalSessions: number;
}

export interface SessionTotalsCompleted {
  totalDistance: number;
  totalHours: number;
}

export interface SessionsResponse {
  completed: Session[];
  planned: Session[];
  totals: SessionTotals;
  totalsCompleted: SessionTotalsCompleted;
}

export interface ManualLap {
  label?: string;
  duration_min?: number;
  distance?: number;
  pace_text?: string;
  speed_kmh?: number;
  heartrate?: number;
  name?: string;
  sets?: number;
  reps?: number;
  weight_kg?: number;
}

export interface PlannedSessionView extends Session {
  category: SportCategory;
  time_s: number;
  weekNumber: number | null;
  objectives: ObjectiveLine[];
}

export interface StatsTotals {
  totalDistance: number;
  totalHours: number;
  totalElevation: number;
  totalCalories: number;
  totalMovingSec: number;
  totalSessions: number;
  distPerSession: number | null;
  kcalPerSession: number | null;
}

export interface SportStats {
  cat: SportCategory;
  sessions: number;
  sessionsPct: number;
  hours: number;
  hoursPct: number;
  distanceKm: number;
  avgDistanceKm: number | null;
  maxDistanceKm: number | null;
  avgDurationSec: number | null;
  maxDurationSec: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgPaceSecPerKm: number | null;
  bestPaceSecPerKm: number | null;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  avgWatts: number | null;
  maxWatts: number | null;
  avgPace100: number | null;
  bestPace100: number | null;
  avgElevationGain: number | null;
  maxElevationGain: number | null;
}

export interface StatsGlobal {
  dominantZone?: [string, number];
  bestEfforts: Record<string, { name: string; time_s: number }>;
  avgTemp: number | null;
  avgTe: number | null;
  totalTe: number;
  avgRpe: number | null;
  avgFeel: number | null;
  rpeCount: number;
  streak: number;
  streakActive: boolean;
  longestStreak: number;
  activeWeeks: number;
  avgHr: number | null;
  maxHr: number;
  maxWatts: number;
  avgSessionsPerWeek: number | null;
  avgHoursPerWeek: number | null;
  avgDistancePerWeek: number | null;
}

export interface StatsData {
  totals: StatsTotals;
  bySport: Record<SportCategory, SportStats>;
  global: StatsGlobal;
  dates: { firstDate?: string; lastDate?: string };
}

export interface ChartsData {
  weeklyHours: { week: string; hours: number }[];
  trainingLoad: { week: string; load: number }[];
  volumeEvolution: { date: string; hours: number; distance: number }[];
  cumulativeDistance: { date: string; cumulative: number }[];
  distanceBySport: Record<string, number | string>[];
  runningPaces: { date: string; pace: number }[];
  cyclingSpeeds: { date: string; speed: number }[];
  swimMinutes: { date: string; minutes: number }[];
  weekChart: { week: string; hours: number; distance: number }[];
  sportDistribution: { sport: string; value: number }[];
}

export interface SyncResult {
  synced: number;
  skipped: number;
  filtered: number;
  missing: number;
  ids: string[];
  message?: string;
}

export interface Job {
  id: string;
  tenant_id: string;
  type: "sync" | "coach_chat" | string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  related_resource_type?: string | null;
  related_resource_id?: string | null;
  deep_link?: string | null;
  error?: string | null;
  progress?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface SyncSource {
  provider: "garmin" | "strava";
  name: string;
  connected: boolean;
  status: string;
  account_name?: string | null;
  error?: string | null;
  min_date?: string | null;
  max_date?: string | null;
  config?: Record<string, unknown>;
}

export interface SyncSourcesResponse {
  items: SyncSource[];
  stravaConfigured: boolean;
  defaultMinDate?: string | null;
}

export interface StatRecord {
  id: string;
  icon: string;
  label: string;
  display: string;
  value?: number;
  sessionId?: string;
  sessionName?: string;
  sessionDate?: string;
}

export interface BestEffortRecord {
  name: string;
  distance_m: number;
  time_s: number;
  sessionId: string;
  sessionName: string;
  sessionDate: string;
}

export interface StatsRecordsData {
  records: StatRecord[];
  bestEfforts: {
    running: BestEffortRecord[];
    cycling: BestEffortRecord[];
    swimming: BestEffortRecord[];
  };
}

export interface AiProviderInfo {
  id: string;
  name: string;
  needsApiKey: boolean;
  defaultModel?: string | null;
  defaultPricing?: AiProviderPricing | null;
}

export interface AiProviderPricing {
  input_per_mtok?: number;
  output_per_mtok?: number;
}

// Para la mayoría de proveedores pricing[providerId] es {input/output}. Para
// opencode es pricing.opencode[modelId] = {input/output} (override por modelo;
// los precios del API se mantienen salvo que se sobreescriban aquí).
export type AiPricingValue = AiProviderPricing | Record<string, AiProviderPricing>;

export interface AiConfig {
  id: string;
  name: string;
  provider: string;
  model: string | null;
  base_url?: string | null;
  currency: string;
  chat_duration_hours: number;
  pricing?: Record<string, AiPricingValue> | null;
  is_default: boolean;
}

export interface AiConfigsResponse {
  items: AiConfig[];
  providers: AiProviderInfo[];
  maxConfigs: number;
}

export interface AiConfigPayload {
  name: string;
  provider: string;
  apiKey?: string;
  model?: string | null;
  baseUrl?: string | null;
  currency?: string;
  pricing?: Record<string, AiPricingValue>;
  isDefault?: boolean;
}

export interface AiSettings {
  provider: string;
  model: string | null;
  base_url?: string | null;
  currency?: string;
  chat_duration_hours?: number | null;
  chatDurationLabel?: string;
  pricing?: Record<string, AiPricingValue> | null;
  providers?: AiProviderInfo[];
}

export interface AiSettingsFull extends AiSettings {
  apiKey: string;
}

export interface AiPrompt {
  id: string;
  role: string;
  name: string;
  content: string;
  is_predefined: boolean;
  is_active: boolean;
}

export interface DefaultPrompt {
  id: string;
  name: string;
  content: string;
  updated_at: string;
}

export interface OpencodeModelInfo {
  id: string;
  providerID: string;
  name: string;
  enabled: boolean;
  input_per_mtok?: number | null;
  output_per_mtok?: number | null;
  overridden?: boolean;
}

export interface AdminProviderInfo extends AiProviderInfo {
  enabled: boolean;
}

export interface AdminSettings {
  enabledProviders: string[];
  opencodeBaseUrl: string;
  providers: AdminProviderInfo[];
}

export interface AdminOpencodeModelsResponse {
  baseUrl: string;
  models: OpencodeModelInfo[];
  error?: string;
}

export interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  ownerEmail: string | null;
  ownerName: string | null;
  membersCount: number;
  completedCount: number;
  plannedCount: number;
}

export interface AdminTenantPayload {
  name: string;
  ownerEmail: string;
  slug?: string;
  minDate?: string;
  profile?: Record<string, unknown>;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  role: "admin" | "visitor";
  active: boolean;
  created_at: string;
  last_used_at?: string | null;
  created_by?: string | null;
}

export interface AiLog {
  id: string;
  user_id: string | null;
  api_key_id: string | null;
  auth_method: string;
  actor: string | null;
  provider: string;
  model: string | null;
  endpoint: string | null;
  api_key_masked: string | null;
  input: string | null;
  response: string | null;
  status: number | null;
  ok: number;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost: number | null;
  currency: string | null;
  created_at: string;
}

export interface AiLogsPage {
  items: AiLog[];
  total: number;
  costTotal: number;
  currency: string;
}

export interface ProfileVersion {
  id: string;
  author: "user" | "ai";
  created_at: string;
}

export interface ProfileVersionFull extends ProfileVersion {
  data: Record<string, unknown>;
  tenant_id: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  localStatus?: "sending" | "failed";
}

export interface CoachChat {
  canChat: boolean;
  chatPending: boolean;
  chatInstructions: string;
  messages: ChatMessage[];
  providerMode: "configured" | "external";
  activeConfigId: string | null;
  configs: AiConfig[];
  externalPrompt?: string | null;
}

export interface CoachChatReply {
  pending: boolean;
  jobId?: string;
  external?: boolean;
  prompt?: string;
}

export interface SessionAnalysisSummary {
  pendingCount: number;
  completedCount: number;
  latest: SessionAnalysisItem[];
  items: SessionAnalysisItem[];
}

export interface SessionAnalysisItem {
  id?: string;
  session?: Record<string, unknown>;
  inputHash?: string;
  session_id?: string;
  analysis: { analysis?: string; profileChange?: string } | null;
  profileVersionId?: string | null;
  profile_version_id?: string | null;
  updatedAt?: string | null;
  updated_at?: string;
  status: "pending" | "running" | "completed" | "failed";
}

export interface EquipmentItem {
  item: string;
  category: string;
  quantity: number;
}

export interface EquipmentCatalogEntry {
  id: string;
  label: string;
  emoji: string;
}

export interface EquipmentCategory {
  category: string;
  label: string;
  emoji?: string;
  items: EquipmentCatalogEntry[];
}

export interface EquipmentResponse {
  items: EquipmentItem[];
  catalog: EquipmentCategory[];
}
