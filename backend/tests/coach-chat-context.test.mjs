import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DB_PATH = `/tmp/athlete-tests/coach-chat-context-${randomUUID()}.db`;

const { getDb } = await import("../lib/db.js");
const { withTenant, upsertSession, getAthleteProfile, saveAthleteProfile } = await import("../lib/sessions.js");
const { listPlanned } = await import("../lib/planned.js");
const { buildChatUserPrompt, getRecentSessions, computeContextHash, parseChatResponse, applyChatProfileUpdate, chatDailyBriefing } = await import("../lib/trainer.js");
const { getRolePrompt, getPrompts, savePrompt, setActivePrompt, getActivePrompt, getDefaultPrompts, createDefaultPrompt, updateDefaultPrompt, deleteDefaultPrompt, propagateDefaultPrompts } = await import("../lib/ai-prompts.js");
const {
  addChatMessage,
  listChatMessages,
  getChatState,
  setChatPending,
  updateChatResponseId,
  updateChatContextHash,
  recoverStaleChat,
  replaceFuturePlannedSessions,
  updateChatInstructions,
  deleteChatMessages,
  COACH_PLAN_ID,
} = await import("../lib/coach-chat.js");
const { getProfileHistory } = await import("../lib/profile-history.js");
const { getSessionAnalysisSummary, listPendingSessionAnalyses, claimSessionAnalysis, completeSessionAnalysis } = await import("../lib/session-analysis.js");

const tenantId = randomUUID();
const coachPlannedId = randomUUID();
const manualPlannedId = randomUUID();
const completedId = "garmin-completed-1";
const manualPastId = "manual-past-session";
const now = new Date().toISOString();
const dateAt = (daysFromNow) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T08:00:00`;
};

getDb().prepare(
  "INSERT INTO tenants (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
).run(tenantId, "Test", `test-${tenantId}`, now);

withTenant(tenantId, () => {
  upsertSession(tenantId, "planned", {
    id: coachPlannedId,
    plan_id: COACH_PLAN_ID,
    sport: "running",
    title: "Carrera Z2",
    name: "Carrera planificada",
    start_date_local: `${dateAt(-1).slice(0, 10)}T08:00:00`,
    workout_text: "45 min @ Z2",
    merged_with: completedId,
  });
  upsertSession(tenantId, "completed", {
    id: completedId,
    sport: "running",
    title: "Carrera Z2 realizada",
    name: "Morning Run",
    start_date_local: `${dateAt(-1).slice(0, 10)}T08:12:00`,
    moving_time_s: 2700,
    distance_m: 7000,
    avg_heartrate: 138,
    notes: "Me encontré bien; terminé algo más rápido.",
  });
  upsertSession(tenantId, "completed", {
    id: "other-completed-1",
    sport: "swimming",
    name: "Natación real anterior",
    start_date_local: `${dateAt(-2).slice(0, 10)}T07:00:00`,
    moving_time_s: 1800,
    notes: "Actividad real fuera del plan.",
  });
  upsertSession(tenantId, "completed", {
    id: "older-completed-1",
    sport: "cycling",
    name: "Actividad antigua",
    start_date_local: `${dateAt(-35).slice(0, 10)}T07:00:00`,
    moving_time_s: 3600,
  });
  upsertSession(tenantId, "planned", {
    id: randomUUID(),
    plan_id: COACH_PLAN_ID,
    sport: "cycling",
    title: "Rodaje suave",
    name: "Rodaje suave",
    start_date_local: `${dateAt(0).slice(0, 10)}T08:00:00`,
    workout_text: "60 min suaves",
  });
  upsertSession(tenantId, "planned", {
    id: manualPlannedId,
    sport: "swimming",
    title: "Natación manual del atleta",
    name: "Natación manual",
    start_date_local: `${dateAt(3).slice(0, 10)}T07:00:00`,
    workout_text: "Piscina 30 min",
  });
  upsertSession(tenantId, "planned", {
    id: manualPastId,
    sport: "running",
    title: "Rodaje pasado no hecho (manual)",
    name: "Rodaje pasado",
    start_date_local: `${dateAt(-1).slice(0, 10)}T08:00:00`,
    workout_text: "45 min @ Z2",
  });
});

test("el contexto del chat incluye solo actividades de los últimos 30 días y sus notas", () => {
  withTenant(tenantId, () => {
    upsertSession(tenantId, "completed", {
      id: "completed-within-thirty-days",
      sport: "cycling",
      name: "Actividad dentro de treinta días",
      start_date_local: `${dateAt(-29).slice(0, 10)}T07:00:00`,
    });
    upsertSession(tenantId, "completed", {
      id: "completed-outside-thirty-days",
      sport: "cycling",
      name: "Actividad fuera de treinta días",
      start_date_local: `${dateAt(-31).slice(0, 10)}T07:00:00`,
    });
  });
  const prompt = withTenant(tenantId, () => buildChatUserPrompt("Analiza mi semana"));

  assert.match(prompt, /ACTIVIDADES REALIZADAS — ÚLTIMOS 30 DÍAS/);
  assert.match(prompt, /Me encontré bien; terminé algo más rápido/);
  assert.match(prompt, /Carrera Z2 realizada/);
  assert.match(prompt, /Actividad real fuera del plan/);
  assert.match(prompt, /Actividad dentro de treinta días/);
  assert.doesNotMatch(prompt, /Actividad fuera de treinta días/);
  const completedSection = prompt.split("ACTIVIDADES REALIZADAS — ÚLTIMOS 30 DÍAS")[1].split("MENSAJE DEL ATLETA")[0];
  assert.doesNotMatch(completedSection, /60 min suaves/);
  assert.doesNotMatch(completedSection, /Actividad antigua/);
});

test("el contexto del chat incluye la fecha real además del día de entrenamiento", () => {
  const prompt = withTenant(tenantId, () => buildChatUserPrompt("Prepara la próxima semana"));
  assert.match(prompt, /Hoy es: \d{1,2} [a-záéíóú]+ \d{4}/);
});

test("los mensajes del chat incluyen la fecha de hoy y los objetivos relevantes", () => {
  withTenant(tenantId, () => {
    getDb().prepare("DELETE FROM goals WHERE tenant_id = ?").run(tenantId);
    getDb().prepare("INSERT INTO goals (tenant_id, week, label, date, is_primary) VALUES (?, ?, ?, ?, ?)").run(tenantId, 1, "Ironman 70.3", dateAt(20).slice(0, 10), 1);
    getDb().prepare("INSERT INTO goals (tenant_id, week, label, date, is_primary) VALUES (?, ?, ?, ?, ?)").run(tenantId, 2, "Media maratón", dateAt(5).slice(0, 10), 0);
    getDb().prepare("INSERT INTO goals (tenant_id, week, label, date, is_primary) VALUES (?, ?, ?, ?, ?)").run(tenantId, 3, "Objetivo lejano", dateAt(60).slice(0, 10), 0);
  });

  const briefing = withTenant(tenantId, () => chatDailyBriefing());
  assert.match(briefing, /Hoy es: \d{1,2} [a-záéíóú]+ \d{4}/);
  assert.match(briefing, /OBJETIVO PRINCIPAL:/);
  assert.match(briefing, /Ironman 70\.3/);
  assert.match(briefing, /Media maratón/);
  assert.doesNotMatch(briefing, /Objetivo lejano/);

  const prompt = withTenant(tenantId, () => buildChatUserPrompt("¿Sigo bien el plan?"));
  assert.match(prompt, /OBJETIVO PRINCIPAL:/);
  assert.match(prompt, /Ironman 70\.3/);
});

test("el hash de contexto cambia cuando cambian los objetivos", () => {
  const before = withTenant(tenantId, () => computeContextHash());
  withTenant(tenantId, () => {
    getDb().prepare("UPDATE goals SET label = ? WHERE tenant_id = ? AND is_primary = 1").run("Ironman 70.3 (nuevo)", tenantId);
  });
  const after = withTenant(tenantId, () => computeContextHash());
  assert.notEqual(before, after);
});

test("el parser del chat respeta los flags de sesiones y perfil", () => {
  const parsed = parseChatResponse(JSON.stringify({
    reply: "He ajustado la semana.",
    modified_sessions: true,
    sessions: [],
    modified_profile: true,
    updated_profile: { datos_del_atleta: { estado_fisico: { fatiga: "Alta" } } },
    profile_change: "He actualizado la fatiga por la carga acumulada.",
  }));
  assert.equal(parsed.modified_sessions, true);
  assert.deepEqual(parsed.sessions, []);
  assert.equal(parsed.modified_profile, true);
  assert.equal(parsed.profile_change, "He actualizado la fatiga por la carga acumulada.");
});

test("el parser ignora el prompt repetido antes del JSON de respuesta", () => {
  const parsed = parseChatResponse([
    "PERFIL DEL ATLETA (JSON): {\"datos_del_atleta\": {}}",
    "MENSAJE DEL ATLETA: prepara la semana",
    JSON.stringify({
      reply: "He preparado la semana.",
      modified_sessions: false,
      sessions: [],
      modified_profile: false,
      updated_profile: {},
      profile_change: "",
    }),
  ].join("\n"));

  assert.equal(parsed.reply, "He preparado la semana.");
});

test("los mensajes del atleta solo muestran la pregunta aunque reciban un prompt completo", () => {
  withTenant(tenantId, () => addChatMessage(
    "user",
    "PERFIL DEL ATLETA (JSON): {}\n\nMENSAJE DEL ATLETA:\n¿Qué hago esta semana?\n\nResponde con el JSON indicado en el system prompt.",
  ));
  const message = withTenant(tenantId, () => listChatMessages()).at(-1);
  assert.equal(message.content, "¿Qué hago esta semana?");
  getDb().prepare("DELETE FROM chat_messages WHERE tenant_id = ? AND content = ?").run(
    tenantId,
    "¿Qué hago esta semana?",
  );
});

test("el contexto del chat marca las planificadas realizadas como completadas", () => {
  const prompt = withTenant(tenantId, () => buildChatUserPrompt("Analiza mi semana"));
  assert.match(prompt, /\[COMPLETADA\]/);
  assert.match(prompt, /\[PENDIENTE\]/);
});

test("el contexto del chat incluye las planificadas manuales del atleta", () => {
  const prompt = withTenant(tenantId, () => buildChatUserPrompt("Analiza mi semana"));
  assert.match(prompt, /Natación manual del atleta/);
});

test("las planificadas fusionadas exponen la actividad completada", () => {
  const planned = withTenant(tenantId, () => listPlanned());
  const merged = planned.find((session) => session.id === coachPlannedId);

  assert.equal(merged.completed_session.id, completedId);
  assert.equal(merged.completed_session.notes, "Me encontré bien; terminé algo más rápido.");
});

test("el feedback del chat no borra planificadas ya realizadas", () => {
  withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Nueva sesión futura",
      start_date_local: `${dateAt(1).slice(0, 10)}T08:00:00`,
      workout_text: "30 min suaves",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());
  assert.ok(planned.some((session) => session.id === coachPlannedId));
  assert.ok(planned.some((session) => session.title === "Nueva sesión futura"));
});

test("el feedback del chat conserva las planificadas manuales del atleta", () => {
  withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Otra sesión futura",
      start_date_local: `${dateAt(2).slice(0, 10)}T08:00:00`,
      workout_text: "30 min suaves",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());
  assert.ok(planned.some((session) => session.id === manualPlannedId), "la manual futura se conserva");
  assert.ok(planned.some((session) => session.title === "Otra sesión futura"), "la futura del entrenador se crea");
});

test("el feedback del chat no crea sesiones en fechas pasadas", () => {
  withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Sesión en el pasado",
      start_date_local: `${dateAt(-2).slice(0, 10)}T08:00:00`,
      workout_text: "No debería crearse",
    },
    {
      sport: "running",
      title: "Sesión de hoy",
      start_date_local: `${dateAt(0).slice(0, 10)}T08:00:00`,
      workout_text: "Sí debería crearse",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());
  assert.ok(!planned.some((session) => session.title === "Sesión en el pasado"));
  assert.ok(planned.some((session) => session.title === "Sesión de hoy"));
});

test("el feedback del chat conserva el futuro si todas las sesiones propuestas son inválidas", () => {
  const preservedTitle = "Plan futuro que no se debe perder";
  withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "cycling",
      title: preservedTitle,
      start_date_local: `${dateAt(3).slice(0, 10)}T08:00:00`,
      workout_text: "60 min suaves",
    },
  ]));

  const result = withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Sesión con fecha pasada",
      start_date_local: `${dateAt(-2).slice(0, 10)}T08:00:00`,
      workout_text: "No debería sustituir el plan",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());

  assert.equal(result.aborted, true);
  assert.ok(planned.some((session) => session.title === preservedTitle));
  assert.ok(!planned.some((session) => session.title === "Sesión con fecha pasada"));
});

test("el feedback del chat corrige sesiones con el año anterior al actual", () => {
  const target = dateAt(1).slice(0, 10);
  const lastYear = `${Number(target.slice(0, 4)) - 1}${target.slice(4)}`;
  const result = withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Sesión con año corregido",
      start_date_local: `${lastYear}T08:00:00`,
      workout_text: "40 min @ Z2",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());
  const created = planned.find((s) => s.title === "Sesión con año corregido");

  assert.equal(result.aborted, false);
  assert.ok(created, "la sesión con el año corregido debe crearse");
  assert.equal(created.start_date_local.slice(0, 10), target);
});

test("el feedback del chat rechaza fechas pasadas que no admiten corrección de año", () => {
  const farPast = `${new Date().getFullYear() - 7}-06-01`;
  const result = withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Sesión demasiado antigua",
      start_date_local: `${farPast}T08:00:00`,
      workout_text: "No debería crearse",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());

  assert.equal(result.aborted, true);
  assert.equal(result.created.length, 0);
  assert.ok(!planned.some((s) => s.title === "Sesión demasiado antigua"));
});

test("el feedback del chat no re-planifica una actividad ya realizada el mismo día", () => {
  const today = dateAt(0).slice(0, 10);
  withTenant(tenantId, () => upsertSession(tenantId, "completed", {
    id: "garmin-today-running",
    sport: "running",
    name: "Rodaje de hoy realizado",
    start_date_local: `${today}T07:00:00`,
    moving_time_s: 1800,
  }));
  withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Rodaje duplicado de hoy",
      start_date_local: `${today}T18:00:00`,
      workout_text: "No debería aparecer en calendario",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());
  assert.ok(!planned.some((session) => session.title === "Rodaje duplicado de hoy"));
});

test("el feedback del chat conserva las planificadas pasadas no realizadas", () => {
  withTenant(tenantId, () => replaceFuturePlannedSessions([
    {
      sport: "running",
      title: "Nueva sesión futura",
      start_date_local: `${dateAt(2).slice(0, 10)}T08:00:00`,
      workout_text: "30 min suaves",
    },
  ]));
  const planned = withTenant(tenantId, () => listPlanned());
  assert.ok(planned.some((session) => session.id === manualPastId), "la pasada no realizada se conserva");
  assert.ok(planned.some((session) => session.title === "Nueva sesión futura"), "la futura se crea");
});

test("el hash de contexto cambia cuando se registra una actividad nueva", () => {
  const before = withTenant(tenantId, () => computeContextHash());
  const newId = "garmin-hash-change";
  withTenant(tenantId, () => upsertSession(tenantId, "completed", {
    id: newId,
    sport: "running",
    name: "Nueva actividad reciente",
    start_date_local: `${dateAt(0).slice(0, 10)}T07:30:00`,
    moving_time_s: 1800,
  }));
  const after = withTenant(tenantId, () => computeContextHash());
  assert.notEqual(before, after);
});

test("el hash de contexto cambia cuando cambian las instrucciones del chat", () => {
  const before = withTenant(tenantId, () => computeContextHash());
  withTenant(tenantId, () => updateChatInstructions(tenantId, "Domina el ritmo en las cuestas"));
  const after = withTenant(tenantId, () => computeContextHash());
  assert.notEqual(before, after);
});

test("el hash de contexto cambia al activar un prompt distinto en el chat", () => {
  const prompts = withTenant(tenantId, () => getPrompts(tenantId));
  assert.ok(prompts.length >= 2, "deben existir los prompts predefinidos");
  const before = withTenant(tenantId, () => computeContextHash());
  withTenant(tenantId, () => setActivePrompt(prompts[1].id, tenantId));
  const after = withTenant(tenantId, () => computeContextHash());
  assert.notEqual(before, after);
  const active = withTenant(tenantId, () => getActivePrompt(tenantId));
  assert.equal(active.id, prompts[1].id);
});

test("solo un prompt puede estar activo por tenant al activar otro", () => {
  const a = withTenant(tenantId, () => savePrompt(tenantId, { name: "Bajar de peso", content: "Quiere perder peso" }));
  withTenant(tenantId, () => setActivePrompt(a, tenantId));
  const b = withTenant(tenantId, () => savePrompt(tenantId, { name: "Ironman 70.3", content: "Quiere un Ironman" }));
  withTenant(tenantId, () => setActivePrompt(b, tenantId));
  const active = withTenant(tenantId, () => getActivePrompt(tenantId));
  assert.equal(active.id, b);
  const activeCount = withTenant(tenantId, () =>
    getDb().prepare("SELECT COUNT(*) as c FROM ai_prompts WHERE tenant_id = ? AND is_active = 1").get(tenantId).c
  );
  assert.equal(activeCount, 1);
});

test("guardar un prompt personalizado sin ninguno activo lo activa por defecto", () => {
  withTenant(tenantId, () =>
    getDb().prepare("UPDATE ai_prompts SET is_active = 0 WHERE tenant_id = ?").run(tenantId)
  );
  const id = withTenant(tenantId, () => savePrompt(tenantId, { name: "Sin activo", content: "Contenido" }));
  const active = withTenant(tenantId, () => getActivePrompt(tenantId));
  assert.equal(active.id, id);
});

test("el prompt de Ironman triatlón se activa por defecto en primera ejecución", () => {
  withTenant(tenantId, () =>
    getDb().prepare("UPDATE ai_prompts SET is_active = 0 WHERE tenant_id = ?").run(tenantId)
  );
  const prompts = withTenant(tenantId, () => getPrompts(tenantId));
  const ironman = prompts.find((p) => p.name === "Ironman Triatlón");
  assert.ok(ironman, "debe existir el prompt predefinido de Ironman");
  assert.ok(ironman.is_predefined);
  const active = withTenant(tenantId, () => getActivePrompt(tenantId));
  assert.equal(active.id, ironman.id);
  assert.match(active.content, /IRONMAN/);
});

test("los prompts por defecto se siembran globalmente y se pueden editar", () => {
  const defaults = getDefaultPrompts();
  assert.ok(defaults.length >= 1, "debe existir la plantilla global");
  const ironman = defaults.find((p) => p.name === "Ironman Triatlón");
  assert.ok(ironman, "la plantilla global incluye el prompt de Ironman");
  const id = createDefaultPrompt({ name: "También Natación", content: "Foco en natación" });
  assert.ok(updateDefaultPrompt(id, { name: "También Natación v2", content: "Foco en natación 2" }));
  const after = getDefaultPrompts().find((p) => p.id === id);
  assert.equal(after.name, "También Natación v2");
  assert.ok(deleteDefaultPrompt(id));
  assert.ok(!getDefaultPrompts().some((p) => p.id === id));
});

test("los prompts predefinidos de un tenant salen de la plantilla global", () => {
  withTenant(tenantId, () => {
    getDb().prepare("DELETE FROM ai_prompts WHERE tenant_id = ?").run(tenantId);
  });
  const prompts = withTenant(tenantId, () => getPrompts(tenantId));
  const defaults = getDefaultPrompts();
  for (const d of defaults) {
    assert.ok(
      prompts.some((p) => p.name === d.name && p.is_predefined),
      `el tenant debe tener el predefinido ${d.name}`
    );
  }
});

test("el catálogo incluye el prompt predefinido de calistenia", () => {
  const defaults = getDefaultPrompts();
  assert.ok(defaults.some((prompt) => prompt.name === "Calistenia"));
  const prompts = withTenant(tenantId, () => getPrompts(tenantId));
  assert.ok(prompts.some((prompt) => prompt.name === "Calistenia" && prompt.is_predefined));
});

test("editar una plantilla global propaga los cambios a tenants existentes", () => {
  const before = withTenant(tenantId, () =>
    getPrompts(tenantId).find((p) => p.name === "Maratón")
  );
  assert.ok(before);
  const ironman = getDefaultPrompts().find((p) => p.name === "Ironman Triatlón");
  assert.ok(updateDefaultPrompt(ironman.id, { name: "Ironman Triatlón", content: "Versión actualizada de Ironman" }));
  propagateDefaultPrompts();
  const after = withTenant(tenantId, () =>
    getPrompts(tenantId).find((p) => p.name === "Ironman Triatlón")
  );
  assert.equal(after.content, "Versión actualizada de Ironman", "el contenido debe propagarse al tenant existente");
  assert.ok(after.is_predefined);
});

test("crear una plantilla global añade el predefinido a tenants existentes", () => {
  const id = createDefaultPrompt({ name: "Sprint", content: "Velocidad y potencia" });
  propagateDefaultPrompts();
  const prompts = withTenant(tenantId, () => getPrompts(tenantId));
  assert.ok(prompts.some((p) => p.name === "Sprint" && p.is_predefined), "el nuevo predefinido debe llegar al tenant");
  assert.ok(deleteDefaultPrompt(id));
  propagateDefaultPrompts();
  const after = withTenant(tenantId, () => getPrompts(tenantId));
  assert.ok(!after.some((p) => p.name === "Sprint"), "al borrar la plantilla el predefinido desaparece del tenant");
});

test("el estado del chat vive en tenant_settings y guarda el hilo", () => {
  withTenant(tenantId, () => {
    setChatPending(tenantId, true);
    updateChatResponseId(tenantId, "thread-123");
  });
  const state = withTenant(tenantId, () => getChatState(tenantId));
  assert.equal(state.chatPending, true);
  assert.equal(state.chatResponseId, "thread-123");
});

test("el prompt de chat de un tenant existente se refresca con el seed actual", () => {
  getDb()
    .prepare("UPDATE ai_prompts SET content = ? WHERE tenant_id = ? AND role = 'chat'")
    .run("contenido obsoleto del chat", tenantId);
  const refreshed = withTenant(tenantId, () => getRolePrompt(tenantId, "chat"));
  assert.notEqual(refreshed.content, "contenido obsoleto del chat");
  assert.match(refreshed.content, /NUNCA modifiques, elimines ni vuelvas a incluir sesiones planificadas en fechas pasadas/);
});

test("la ventana de sesiones recientes sigue siendo configurable", () => {
  const recent = withTenant(tenantId, () => getRecentSessions(4));
  assert.ok(recent.some((session) => session.id === completedId));
  assert.ok(!recent.some((session) => session.id === "older-completed-1"));
});

test("la actualización de perfil del chat ignora vacíos y guarda cambios con historial IA", () => {
  withTenant(tenantId, () => saveAthleteProfile(tenantId, {
    datos_del_atleta: { datos_personales: { edad: 40 } },
  }));
  const before = withTenant(tenantId, () => getProfileHistory(tenantId).length);
  assert.deepEqual(withTenant(tenantId, () => applyChatProfileUpdate(tenantId, {})), { updated: false });
  assert.equal(withTenant(tenantId, () => getProfileHistory(tenantId).length), before);

  assert.deepEqual(
    withTenant(tenantId, () => applyChatProfileUpdate(tenantId, {
      datos_del_atleta: { datos_personales: { edad: 41 } },
    })),
    { updated: true }
  );
  assert.equal(withTenant(tenantId, () => getAthleteProfile().datos_del_atleta.datos_personales.edad), 41);
  assert.equal(withTenant(tenantId, () => getProfileHistory(tenantId)[0].author), "ai");
});

test("recoverStaleChat libera un chat atascado con mensaje antiguo", () => {
  withTenant(tenantId, () => {
    setChatPending(tenantId, true);
    addChatMessage("user", "mensaje antiguo");
  });
  getDb()
    .prepare("UPDATE chat_messages SET created_at = ? WHERE tenant_id = ? AND content = ?")
    .run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), tenantId, "mensaje antiguo");
  const recovered = withTenant(tenantId, () => recoverStaleChat(tenantId));
  assert.equal(recovered, 1);
  assert.equal(withTenant(tenantId, () => getChatState(tenantId).chatPending), false);
});

test("recoverStaleChat no libera un chat con mensaje reciente", () => {
  withTenant(tenantId, () => {
    setChatPending(tenantId, true);
    addChatMessage("user", "mensaje reciente");
  });
  const recovered = withTenant(tenantId, () => recoverStaleChat(tenantId));
  assert.equal(recovered, 0);
  assert.equal(withTenant(tenantId, () => getChatState(tenantId).chatPending), true);
});

test("los mensajes del chat se listan por tenant en orden", () => {
  const messages = withTenant(tenantId, () => listChatMessages());
  assert.ok(messages.length >= 1);
  assert.ok(messages.every((m) => m.content && m.role !== "system"));
  const times = messages.map((m) => new Date(m.created_at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("elimina mensajes seleccionados y reinicia el hilo del proveedor", () => {
  let userId;
  let assistantId;
  withTenant(tenantId, () => {
    addChatMessage("user", "pregunta para eliminar");
    addChatMessage("assistant", "respuesta para conservar");
    const messages = listChatMessages();
    userId = messages.find((message) => message.content === "pregunta para eliminar").id;
    assistantId = messages.find((message) => message.content === "respuesta para conservar").id;
    updateChatResponseId(tenantId, "thread-to-reset");
    updateChatContextHash(tenantId, "hash-to-reset");
  });

  assert.deepEqual(withTenant(tenantId, () => deleteChatMessages(tenantId, [userId])), [userId]);
  assert.ok(withTenant(tenantId, () => listChatMessages()).some((message) => message.id === assistantId));
  assert.equal(withTenant(tenantId, () => getChatState(tenantId).chatResponseId), null);
  assert.equal(withTenant(tenantId, () => getChatState(tenantId).chatContextHash), null);
});

test("las sesiones vuelven a quedar pendientes si cambian después del análisis", () => {
  const pending = withTenant(tenantId, () => listPendingSessionAnalyses(tenantId, 20));
  assert.ok(pending.length > 0);
  const item = pending[0];
  withTenant(tenantId, () => {
    claimSessionAnalysis(tenantId, item.id, item.inputHash, "mock", "mock-1");
    completeSessionAnalysis(tenantId, item.id, item.inputHash, { analysis: "ok" });
  });
  const after = withTenant(tenantId, () => listPendingSessionAnalyses(tenantId, 20));
  assert.ok(!after.some((candidate) => candidate.id === item.id));

  const row = getDb().prepare("SELECT data FROM sessions WHERE tenant_id = ? AND id = ?").get(tenantId, item.id);
  const updated = JSON.parse(row.data);
  updated.notes = `${updated.notes ?? ""} nota nueva`;
  getDb().prepare("UPDATE sessions SET data = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
    .run(JSON.stringify(updated), new Date().toISOString(), tenantId, item.id);
  assert.ok(withTenant(tenantId, () => listPendingSessionAnalyses(tenantId, 20)).some((candidate) => candidate.id === item.id));
  assert.ok(withTenant(tenantId, () => getSessionAnalysisSummary(tenantId)).pendingCount > 0);
});
