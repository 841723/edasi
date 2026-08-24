import { createHash } from "node:crypto";
import {
  getAthleteProfile,
  getTenantId,
  getTenantSettings,
  loadCompletedSessions,
  loadCompletedSessionsSince,
  loadPlannedSessions,
  saveAthleteProfile,
} from "./sessions.js";
import { saveProfileVersion } from "./profile-history.js";
import { getRolePrompt, getActivePrompt } from "./ai-prompts.js";
import { callAiChat } from "./ai-provider.js";
import {
  listChatMessages,
  addChatMessage,
  getChatState,
  updateChatContextHash,
  replaceFuturePlannedSessions,
} from "./coach-chat.js";
import { getEquipmentLabels } from "./equipment.js";
import { getFocusSports } from "./meta.js";
import { getGoals } from "./goals.js";
import { subDays, subWeeks, format, parseISO, differenceInCalendarDays } from "date-fns";
import { es } from "date-fns/locale";
import { getSelectedCompletedSessions } from "./sessions.js";

const MAX_CHAT_RESPONSE_CHARS = 200_000;
const MAX_CHAT_SESSIONS = 100;
const CHAT_SPORTS = new Set([
  "running", "cycling", "virtual_ride", "indoor_cycling", "lap_swimming",
  "open_water_swimming", "strength_training", "paddelball", "hiking", "walking",
]);

function requireRolePrompt(role) {
  const prompt = getRolePrompt(getTenantId(), role);
  if (!prompt?.content) {
    throw new Error(`No se pudo cargar el prompt de "${role}" del tenant`);
  }
  return prompt.content;
}

function sanitizeProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return profile;
  const out = JSON.parse(JSON.stringify(profile));
  delete out.nombre;
  delete out.filosofia;
  delete out.trainer_behavior;
  delete out.analisis_requerido;
  delete out.goal;
  const d = out.datos_del_atleta;
  if (d && typeof d === "object") {
    if (d.datos_personales && typeof d.datos_personales === "object") {
      delete d.datos_personales.nombre;
    }
    delete d.objetivo;
    if (d.estado_fisico && typeof d.estado_fisico === "object") {
      delete d.estado_fisico.semanas_consecutivas;
    }
  }
  return out;
}

export function getRecentSessions(weeks = 8) {
  const allSessions = loadCompletedSessions();
  const now = new Date();
  const cutoffDate = subWeeks(now, weeks);

  return allSessions
    .filter((s) => {
      if (!s.start_date_local) return false;
      const sessionDate = new Date(s.start_date_local);
      return sessionDate >= cutoffDate;
    })
    .sort((a, b) => (a.start_date_local ?? "").localeCompare(b.start_date_local ?? ""));
}

function formatTrainingDayForPrompt(value) {
  const date = parseISO(value);
  return format(date, "d MMMM yyyy", { locale: es });
}

function formatPlannedSessionForPrompt(session) {
  const date = session.start_date_local ? formatTrainingDayForPrompt(session.start_date_local) : "sin fecha";
  const status = session.merged_with ? "[COMPLETADA]" : "[PENDIENTE]";
  return `- ${date} | ${status} | ${session.sport} | ${session.title ?? session.name} | ${session.workout_text ?? ""}`.trim();
}

function formatCompletedSessionForPrompt(session) {
  const date = session.start_date_local ? formatTrainingDayForPrompt(session.start_date_local) : "sin fecha";
  const metrics = [
    session.distance_m != null ? `distancia=${Math.round(session.distance_m)}m` : null,
    session.time_s != null ? `tiempo=${Math.round(session.time_s)}s` : null,
    session.avg_pace_s_per_km != null ? `ritmo=${Math.round(session.avg_pace_s_per_km)}s/km` : null,
    session.avg_speed_ms != null ? `velocidad=${session.avg_speed_ms}m/s` : null,
    session.avg_heartrate != null ? `FC=${Math.round(session.avg_heartrate)}ppm` : null,
    session.avg_watts != null ? `potencia=${Math.round(session.avg_watts)}W` : null,
    session.rpe != null ? `RPE=${Math.round(session.rpe / 10)}/10` : null,
    session.feel != null ? `sensacion=${Math.round(session.feel / 10)}/10` : null,
  ].filter(Boolean).join(", ");
  const notes = session.notes?.trim() ? ` | notas: ${session.notes.trim()}` : "";
  return `- ${date} | ${session.sport} | ${session.title ?? session.name} | ${metrics || "sin métricas"}${notes}`;
}

// Objetivo principal y secundarios (dentro de las próximas 4 semanas) para
// incluirlos en TODOS los mensajes del chat, también los encadenados.
export function buildGoalsContext() {
  const goals = getGoals(getTenantId());
  const todayStart = new Date(`${format(new Date(), "yyyy-MM-dd")}T00:00:00`);
  const primary = goals.find((g) => g.isPrimary) ?? goals[0];
  const secondary = goals
    .filter((g) => g !== primary)
    .filter((g) => {
      if (!g.date) return false;
      const diff = differenceInCalendarDays(parseISO(g.date), todayStart);
      return diff >= 0 && diff <= 28;
    });

  const lines = ["OBJETIVO PRINCIPAL:"];
  lines.push(
    primary
      ? `- ${primary.label}${primary.date ? ` (${primary.date})` : ""}`
      : "- (no hay objetivo definido)"
  );
  if (secondary.length > 0) {
    lines.push("OBJETIVOS SECUNDARIOS (dentro de las próximas 4 semanas):");
    for (const g of secondary) {
      lines.push(`- ${g.label}${g.date ? ` (${g.date})` : ""}`);
    }
  }
  return lines.join("\n");
}

// Breve encabezado (fecha de hoy + objetivos) que acompaña a cada mensaje del
// chat, incluyendo los turnos encadenados que solo envían la pregunta.
export function chatDailyBriefing() {
  const today = formatTrainingDayForPrompt(new Date().toISOString());
  return `Hoy es: ${today}\n\n${buildGoalsContext()}`;
}

export function buildChatUserPrompt(message, options = {}) {
  const planned = loadPlannedSessions();
  const planText =
    planned.length > 0
      ? planned.map(formatPlannedSessionForPrompt).join("\n")
      : "(no hay sesiones planificadas)";
  const cutoff = format(subDays(new Date(), 30), "yyyy-MM-dd");
  const completed = loadCompletedSessionsSince(cutoff);
  const completedText = completed.length > 0
    ? completed.map(formatCompletedSessionForPrompt).join("\n")
    : "(no hay actividades realizadas en los últimos 30 días)";
  const selected = options.sessionIds?.length ? getSelectedCompletedSessions(getTenantId(), options.sessionIds) : [];
  const selectedText = selected.length
    ? `\nSESIONES SELECCIONADAS POR EL ATLETA PARA ANALIZAR:\n${selected.map((item) => formatCompletedSessionForPrompt(item.session)).join("\n")}\n`
    : "";
  const profile = getAthleteProfile();
  const profileText =
    profile && Object.keys(profile).length > 0
      ? JSON.stringify(sanitizeProfile(profile), null, 2)
      : "(no hay perfil guardado)";

  const coachInstructions = formatCoachInstructions(profile);
  const coachText = coachInstructions
    ? `\nINSTRUCCIONES DEL ENTRENADOR (no forman parte del perfil del atleta; son directrices de comportamiento, filosofía y análisis a aplicar):\n${coachInstructions}\n`
    : "";

  let equipment = getEquipmentLabels(getTenantId());
  if (equipment.length === 0 && Array.isArray(profile?.equipment)) {
    equipment = profile.equipment.map(String);
  }
  const equipmentLine = equipment.length > 0 ? equipment.join(", ") : "sin datos";

  const focusSports = getFocusSports(getTenantId());
  const focusText = focusSports.length > 0 ? focusSports.join(", ") : "running, cycling, swimming";

  const todayIso = format(new Date(), "yyyy-MM-dd");

  let historyText = "";
  if (options.includeHistory) {
    const chatCutoff = subDays(new Date(), 30).toISOString();
    const messages = listChatMessages().filter((m) => m.created_at >= chatCutoff);
    historyText =
      messages.length > 0
        ? `\nHISTORIAL DE LA CONVERSACIÓN (preguntas y respuestas anteriores del chat con el entrenador):\n${messages
            .map((m) => `${m.role === "user" ? "Atleta" : "Entrenador"}: ${m.content}`)
            .join("\n")}\n`
        : "";
  }

  return `
${chatDailyBriefing()}

IMPORTANTE SOBRE LAS FECHAS: Hoy es ${todayIso}. Todas las "start_date_local" que incluyas en "sessions" deben ser de hoy en adelante (año actual o futuro), nunca de fechas anteriores.

PERFIL DEL ATLETA (JSON):
${profileText}
${coachText}
EQUIPAMIENTO DISPONIBLE:
${equipmentLine}

DEPORTES DE ENFOQUE:
${focusText}
El atleta quiere mejorar principalmente en estos deportes; las propuestas deben centrarse en ellos (puede haber otros deportes puntuales).

ACTIVIDADES PLANIFICADAS ([COMPLETADA] = ya realizada y fusionada con la actividad real, [PENDIENTE] = aún por hacer; incluyen tanto las propuestas por el entrenador como las añadidas manualmente por el atleta):
${planText}

ACTIVIDADES REALIZADAS — ÚLTIMOS 30 DÍAS (incluyen las fusionadas con sesiones planificadas y cualquier otra actividad registrada):
${completedText}
${selectedText}
${historyText}
MENSAJE DEL ATLETA:
${message}

Responde con el JSON indicado en el system prompt.
`.trim();
}

export function buildFullChatPrompt(message, options = {}) {
  const base = requireRolePrompt("chat");
  const state = getChatState(getTenantId());
  const custom = state.chatInstructions ? `\n\nINSTRUCCIONES PERSONALIZADAS DEL ENTRENADOR/ATLETA:\n${state.chatInstructions}` : "";
  const active = getActivePrompt(getTenantId());
  const objective = active?.content ? `\n\nOBJETIVO Y FILOSOFÍA DE ENTRENAMIENTO:\n${active.name}\n${active.content}` : "";
  const systemPrompt = `${base}${custom}${objective}`;
  const userPrompt = buildChatUserPrompt(message, { ...options, includeHistory: true });
  return `${systemPrompt}\n\n---\n\n${userPrompt}`;
}

function formatCoachInstructions(profile) {
  if (!profile || typeof profile !== "object") return "";
  const lines = [];
  const push = (label, value) => {
    if (typeof value === "string" && value.trim()) {
      lines.push(`- ${label}: ${value.trim()}`);
    } else if (value && typeof value === "object") {
      const text = JSON.stringify(value);
      if (text !== "{}") lines.push(`- ${label}: ${text}`);
    }
  };
  push("Comportamiento del entrenador", profile.trainer_behavior);
  push("Filosofía de entrenamiento", profile.filosofia);
  push("Análisis requerido", profile.analisis_requerido);
  return lines.join("\n");
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) objects.push(text.slice(start, i + 1));
    }
  }
  return objects;
}

export function parseChatResponse(response) {
  if (typeof response !== "string" || response.length > MAX_CHAT_RESPONSE_CHARS) {
    throw new Error("La respuesta del chat supera el tamaño permitido");
  }
  const objects = extractJsonObjects(response);
  let parsed = null;
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const candidate = JSON.parse(objects[i]);
      if (candidate && typeof candidate === "object" && typeof candidate.reply === "string") {
        parsed = candidate;
        break;
      }
    } catch {
      // Sigue buscando un objeto JSON válido posterior a texto repetido.
    }
  }
  if (!parsed) {
    throw new Error("No se pudo encontrar JSON válido en la respuesta del chat");
  }
  return {
    reply: parsed.reply.trim(),
    modified_sessions: parsed.modified_sessions === true,
    sessions: parsed.sessions,
    modified_profile: parsed.modified_profile === true,
    updated_profile: parsed.updated_profile,
    profile_change: typeof parsed.profile_change === "string" ? parsed.profile_change.trim() : "",
  };
}

// Huella del contexto que se le envía al entrenador: perfil del atleta,
// configuración relevante, equipamiento, actividades planificadas (con estado
// de merge) y actividades completadas de los últimos 30 días. Si nada de esto
// cambia, el contexto que ya conoce el proveedor sigue siendo válido y el chat
// puede reutilizar el hilo anterior enviando solo el mensaje nuevo.
export function computeContextHash() {
  const profile = getAthleteProfile();
  const settings = getTenantSettings();
  const planned = loadPlannedSessions();
  const cutoff = format(subDays(new Date(), 30), "yyyy-MM-dd");
  const completed = loadCompletedSessionsSince(cutoff);
  const state = {
    today: format(new Date(), "yyyy-MM-dd"),
    profile: sanitizeProfile(profile),
    settings: {
      focusSports: getFocusSports(getTenantId()),
      planStart: settings?.plan_start ?? null,
      goalDate: settings?.goal_date ?? null,
      trainingWeekOneStart: settings?.training_week_one_start ?? null,
    },
    equipment: getEquipmentLabels(getTenantId()),
    chatInstructions: getChatState()?.chatInstructions ?? null,
    activePromptId: getActivePrompt(getTenantId())?.id ?? null,
    goals: getGoals(getTenantId()).map((g) => ({
      week: g.week,
      label: g.label,
      date: g.date ?? null,
      isPrimary: g.isPrimary,
    })),
    planned: planned.map((s) => ({
      id: s.id,
      date: (s.start_date_local ?? "").slice(0, 10),
      sport: s.sport,
      title: s.title ?? s.name,
      merged: Boolean(s.merged_with),
    })),
    completed: completed.map((s) => ({
      id: s.id,
      date: (s.start_date_local ?? "").slice(0, 10),
      sport: s.sport,
      title: s.title ?? s.name,
      time_s: s.time_s ?? null,
      distance_m: s.distance_m ?? null,
      avg_heartrate: s.avg_heartrate ?? null,
      avg_watts: s.avg_watts ?? null,
      notes: s.notes ?? null,
    })),
  };
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function validateChatSessions(rawSessions) {
  if (!Array.isArray(rawSessions)) {
    throw new Error("La respuesta del chat no contiene la lista de sesiones futura requerida");
  }
  if (rawSessions.length > MAX_CHAT_SESSIONS) {
    throw new Error(`La respuesta del chat no puede contener más de ${MAX_CHAT_SESSIONS} sesiones`);
  }
  for (const session of rawSessions) {
    if (!session || typeof session !== "object" || Array.isArray(session)) {
      throw new Error("La respuesta del chat contiene una sesión inválida");
    }
    if (!session.sport || typeof session.sport !== "string" || !CHAT_SPORTS.has(session.sport) || !session.start_date_local) {
      throw new Error("Cada sesión del chat debe incluir sport y start_date_local");
    }
    const date = String(session.start_date_local).slice(0, 10);
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error("Cada sesión del chat debe tener una fecha válida");
    }
    for (const [key, max] of [["title", 200], ["name", 200], ["workout_text", 10_000]]) {
      if (session[key] != null && (typeof session[key] !== "string" || session[key].length > max)) {
        throw new Error(`El campo ${key} de una sesión del chat no es válido`);
      }
    }
  }
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
  if (Object.keys(profile).length === 0) return null;
  if (profile.datos_del_atleta) return profile;

  const out = {};
  const d = (out.datos_del_atleta = {});
  const estado = (d.estado_actual = {});
  if (profile.strengths?.running?.current) {
    estado.running = { fc_z2: profile.strengths.running.current };
  }
  if (profile.weaknesses?.cycling?.current_power) {
    estado.cycling = { potencia_w: profile.weaknesses.cycling.current_power };
  }
  if (profile.weaknesses?.swimming?.current_pace) {
    estado.swimming = { ritmo_100m: profile.weaknesses.swimming.current_pace };
  }
  if (profile.goal?.current_week) {
    d.estado_fisico = { semanas_consecutivas: String(profile.goal.current_week) };
  }
  if (profile.objetivo) d.objetivo = profile.objetivo;
  if (profile.nombre) d.datos_personales = { nombre: profile.nombre };
  if (profile.filosofia) out.filosofia = profile.filosofia;
  if (profile.trainer_behavior) out.trainer_behavior = profile.trainer_behavior;

  if (Object.keys(d).length === 0 && Object.keys(out).length === 0) return profile;
  return out;
}

function isMeaningful(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function mergePreserving(current, updated) {
  if (updated == null || typeof updated !== "object" || Array.isArray(updated)) {
    return current == null ? null : current;
  }
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? JSON.parse(JSON.stringify(current))
      : {};
  for (const [key, newValue] of Object.entries(updated)) {
    if (!isMeaningful(newValue)) continue;
    if (
      base[key] != null &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key]) &&
      typeof newValue === "object" &&
      !Array.isArray(newValue)
    ) {
      base[key] = mergePreserving(base[key], newValue);
    } else {
      base[key] = newValue;
    }
  }
  return base;
}

function mergeProfilePreserving(currentProfile, updatedProfile) {
  return mergePreserving(currentProfile, updatedProfile);
}

export function applyChatProfileUpdate(tenantId, updatedProfile, { includeVersionId = false } = {}) {
  if (!isMeaningful(updatedProfile)) return { updated: false };
  const normalized = normalizeProfile(updatedProfile);
  if (!normalized) throw new Error("El perfil actualizado recibido del chat no es válido");

  const current = getAthleteProfile() ?? {};
  const merged = sanitizeProfile(mergeProfilePreserving(current, normalized));
  for (const key of ["trainer_behavior", "filosofia", "analisis_requerido"]) {
    if (current[key] != null && merged[key] == null) merged[key] = current[key];
  }
  if (JSON.stringify(merged) === JSON.stringify(current)) {
    return { updated: false };
  }

  const versionId = saveProfileVersion(tenantId, merged, "ai");
  if (!versionId) return { updated: false };
  saveAthleteProfile(tenantId, merged);
  return includeVersionId ? { updated: true, versionId } : { updated: true };
}

export function applyChatResponse(tenantId, parsed, { includeAssistant = true } = {}) {
  if (!parsed.reply) throw new Error("La respuesta del chat no contiene un reply válido");
  if (parsed.modified_sessions) validateChatSessions(parsed.sessions);
  let profileUpdated = false;
  let profileVersionId = null;
  if (parsed.modified_profile && isMeaningful(parsed.updated_profile)) {
    const result = applyChatProfileUpdate(tenantId, parsed.updated_profile, { includeVersionId: true });
    profileUpdated = result.updated;
    profileVersionId = result.versionId ?? null;
  }
  let reply = parsed.reply;
  if (parsed.modified_profile) reply += `\n\nActualización del perfil: ${parsed.profile_change || "He incorporado la información relevante del estado físico y las observaciones deportivas al perfil."}`;
  let sessionsUpdated = [];
  if (parsed.modified_sessions) sessionsUpdated = replaceFuturePlannedSessions(parsed.sessions).created;
  if (includeAssistant) addChatMessage("assistant", reply);
  return { reply, sessionsUpdated, profileUpdated, profileVersionId };
}

export async function chatWithCoach({ message, previousResponseId, settings, actor, sessionIds = [], isCancelled = () => false }) {
  const tenantId = getTenantId();
  const selectedSessions = sessionIds.length ? getSelectedCompletedSessions(tenantId, sessionIds) : [];
  const state = getChatState(tenantId);
  const baseSystemPrompt = requireRolePrompt("chat");
  const systemPrompt = state.chatInstructions
    ? `${baseSystemPrompt}\n\nINSTRUCCIONES PERSONALIZADAS DEL ENTRENADOR/ATLETA:\n${state.chatInstructions}`
    : baseSystemPrompt;

  // Objetivo del atleta definido en Configuración → Prompts: se marca un prompt
  // como activo y se incluye en CADA mensaje del chat para que el modelo sepa
  // exactamente qué busca el atleta (perder peso, Ironman, 5K, etc.).
  const activePrompt = getActivePrompt(tenantId);
  const objectivePrompt = `${systemPrompt}${
    activePrompt?.content
      ? `\n\nOBJETIVO Y FILOSOFÍA DE ENTRENAMIENTO (definidos por el atleta en Configuración → Prompts):\n${activePrompt.name}\n${activePrompt.content}`
      : ""
  }`;

  // El contexto completo (perfil, actividades planeadas, actividades recientes)
  // solo se reenvía cuando cambia de verdad: nueva actividad realizada, perfil
  // editado, actividades planeadas modificadas o día nuevo. Si no ha cambiado y
  // el proveedor mantiene hilo (opencode con sesión por tenanta, gemini con
  // previous_interaction_id), se reutiliza la interacción anterior enviando
  // SOLO el mensaje nuevo. El mock no mantiene un hilo real, así que siempre
  // recibe el contexto completo.
  const currentHash = computeContextHash();
  const contextChanged = currentHash !== state.chatContextHash;

  const threaded =
    settings?.provider !== "mock" && Boolean(previousResponseId) && !contextChanged;

  let text;
  let responseId;

  if (threaded) {
    try {
      ({ text, responseId } = await callAiChat(
        settings,
        { systemPrompt: objectivePrompt, input: `${chatDailyBriefing()}\n\nMENSAJE DEL ATLETA:\n${message}`, previousResponseId },
        actor
      ));
      if (isCancelled()) return { cancelled: true, tenantId };
    } catch (err) {
      // La interacción anterior caducó (gemini devuelve error por un
      // previous_interaction_id no válido; opencode perdió la sesión) o el
      // proveedor no puede seguir el hilo: se arranca una interacción nueva
      // enviando TODO el contexto y el historial, sin depender de la sesión.
      const fullPrompt = buildChatUserPrompt(message, { includeHistory: true, sessionIds });
      ({ text, responseId } = await callAiChat(
        settings,
        { systemPrompt: objectivePrompt, input: fullPrompt, previousResponseId: null },
        actor
      ));
      if (isCancelled()) return { cancelled: true, tenantId };
      updateChatContextHash(tenantId, currentHash);
    }
  } else {
    // Primera pregunta de la conversación, hilo no soportado o contexto
    // cambiado: se envía el contexto completo actualizado y se arranca un hilo
    // nuevo (el hilo anterior, si existe, tiene contexto desactualizado).
    const fullPrompt = buildChatUserPrompt(message, { includeHistory: true, sessionIds });
    ({ text, responseId } = await callAiChat(
      settings,
      { systemPrompt: objectivePrompt, input: fullPrompt, previousResponseId: null },
      actor
    ));
    if (isCancelled()) return { cancelled: true, tenantId };
    updateChatContextHash(tenantId, currentHash);
  }

  const parsed = parseChatResponse(text);
  if (isCancelled()) return { cancelled: true, tenantId };
  return { ...applyChatResponse(tenantId, parsed), responseId, tenantId, parsed, sessionIds, selectedSessions };
}
