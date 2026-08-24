import { getDefaultAiConfig, listAiConfigs, getAiConfig, setDefaultAiConfig } from "../lib/ai-configs.js";
import {
  getChatState,
  listChatMessages,
  addChatMessage,
  setChatPending,
  updateChatResponseId,
  updateChatInstructions,
  setChatExternal,
  deleteChatMessages,
  recoverStaleChat,
} from "../lib/coach-chat.js";
import { createJob, cancelJob } from "../lib/jobs.js";
import { sendJson, readBody, canWrite } from "../lib/http.js";
import { buildFullChatPrompt, parseChatResponse, applyChatResponse } from "../lib/trainer.js";
import { getSelectedCompletedSessions } from "../lib/sessions.js";
import { markSessionsAnalyzed } from "../lib/session-analysis.js";

export function register(router) {
  router.get("/api/chat", (c) => {
    recoverStaleChat(c.tenantId);
    const config = getDefaultAiConfig(c.tenantId, false);
    const state = getChatState(c.tenantId);
    return sendJson(c.res, 200, {
      canChat: Boolean(config) || state.chatExternal,
      chatPending: state.chatPending,
      chatInstructions: state.chatInstructions ?? "",
      providerMode: state.chatExternal ? "external" : "configured",
      activeConfigId: config?.id ?? null,
      configs: listAiConfigs(c.tenantId),
      messages: listChatMessages(),
    });
  });

  router.put("/api/chat/provider", async (c) => {
    if (!canWrite(c.membership)) return sendJson(c.res, 403, { error: "No tienes permisos para configurar el proveedor" });
    const body = await readBody(c.req);
    if (body?.mode === "external") {
      setChatExternal(c.tenantId, true);
      return sendJson(c.res, 200, { providerMode: "external", activeConfigId: getDefaultAiConfig(c.tenantId)?.id ?? null });
    }
    const configId = body?.configId;
    if (typeof configId !== "string" || !configId.trim()) {
      return sendJson(c.res, 400, { error: "Selecciona una configuración de IA válida" });
    }
    const selected = getAiConfig(c.tenantId, configId);
    if (!selected) return sendJson(c.res, 400, { error: "Configuración de IA no encontrada" });
    setDefaultAiConfig(c.tenantId, configId);
    setChatExternal(c.tenantId, false);
    return sendJson(c.res, 200, { providerMode: "configured", activeConfigId: configId });
  });

  router.put("/api/chat/settings", async (c) => {
    if (!canWrite(c.membership)) return sendJson(c.res, 403, { error: "No tienes permisos para esta acción" });
    const body = await readBody(c.req);
    const instructions = String(body?.instructions ?? "").trim();
    if (instructions.length > 5000) return sendJson(c.res, 400, { error: "Las instrucciones no pueden superar 5.000 caracteres" });
    updateChatInstructions(c.tenantId, instructions);
    return sendJson(c.res, 200, { instructions });
  });

  router.delete("/api/chat/messages", async (c) => {
    if (!canWrite(c.membership)) return sendJson(c.res, 403, { error: "No tienes permisos para esta acción" });
    if (getChatState(c.tenantId).chatPending) {
      return sendJson(c.res, 409, { error: "No puedes eliminar mensajes mientras el entrenador está respondiendo" });
    }
    const body = await readBody(c.req);
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    if (ids.length === 0 || ids.length > 50 || ids.some((id) => typeof id !== "string" || id.length > 100)) {
      return sendJson(c.res, 400, { error: "Selecciona entre 1 y 50 mensajes válidos" });
    }
    const deletedIds = deleteChatMessages(c.tenantId, ids);
    return sendJson(c.res, 200, { deletedIds });
  });

  router.post("/api/chat", async (c) => {
    if (!canWrite(c.membership)) {
      return sendJson(c.res, 403, { error: "No tienes permisos para esta acción" });
    }
    const config = getDefaultAiConfig(c.tenantId, true);
    const state = getChatState(c.tenantId);
    if (!config && !state.chatExternal) {
      return sendJson(c.res, 400, {
        error: "Configura un proveedor de IA en Configuración antes de chatear.",
      });
    }
    if (state.chatPending) {
      return sendJson(c.res, 409, {
        error: "El entrenador aún está escribiendo la respuesta al mensaje anterior.",
      });
    }
    const body = await readBody(c.req);
    const message = String(body?.message ?? "").trim();
    if (!message) {
      return sendJson(c.res, 400, { error: "El mensaje no puede estar vacío" });
    }
    let selectedSessions;
    try { selectedSessions = getSelectedCompletedSessions(c.tenantId, body?.sessionIds ?? []); }
    catch (error) { return sendJson(c.res, 400, { error: error.message }); }

    if (state.chatExternal) {
      const prompt = buildFullChatPrompt(message, { sessionIds: body?.sessionIds ?? [] });
      addChatMessage("user", message);
      setChatPending(c.tenantId, true);
      return sendJson(c.res, 200, { pending: true, external: true, prompt });
    }

    let job;
    try {
      // Crear primero el job evita dejar chat_pending bloqueado si falla la
      // inserción por una carrera o por un error de SQLite.
      job = createJob({
        tenantId: c.tenantId,
        userId: c.actor?.userId ?? null,
        type: "coach_chat",
        dedupeKey: `coach-chat`,
        payload: {
          message,
          previousResponseId: state.chatResponseId ?? null,
          sessionIds: selectedSessions.map((item) => item.id),
          selectedSessions,
        },
        deepLink: `/${c.tenantId}/trainer`,
      });
      addChatMessage("user", message);
      setChatPending(c.tenantId, true);
    } catch (error) {
      if (job?.id) cancelJob(c.tenantId, job.id);
      throw error;
    }

    return sendJson(c.res, 202, { pending: true, jobId: job.id });
  });

  router.post("/api/chat/prompt", async (c) => {
    if (!canWrite(c.membership)) return sendJson(c.res, 403, { error: "No tienes permisos para esta acción" });
    const body = await readBody(c.req);
    const message = String(body?.message ?? "").trim();
    if (!message) return sendJson(c.res, 400, { error: "El mensaje no puede estar vacío" });
    try { getSelectedCompletedSessions(c.tenantId, body?.sessionIds ?? []); }
    catch (error) { return sendJson(c.res, 400, { error: error.message }); }
    return sendJson(c.res, 200, { prompt: buildFullChatPrompt(message, { sessionIds: body?.sessionIds ?? [] }) });
  });

  router.post("/api/chat/import", async (c) => {
    if (!canWrite(c.membership)) return sendJson(c.res, 403, { error: "No tienes permisos para esta acción" });
    const body = await readBody(c.req);
    if (!getChatState(c.tenantId).chatPending) return sendJson(c.res, 409, { error: "No hay una respuesta externa pendiente" });
    let selected;
    try { selected = getSelectedCompletedSessions(c.tenantId, body?.sessionIds ?? []); const parsed = parseChatResponse(String(body?.response ?? body?.text ?? "")); const result = applyChatResponse(c.tenantId, parsed); markSessionsAnalyzed(c.tenantId, selected, { analysis: result.reply, profileChange: parsed.profile_change ?? "" }, result.profileVersionId); setChatPending(c.tenantId, false); return sendJson(c.res, 200, { ...result, parsed }); }
    catch (error) { return sendJson(c.res, 400, { error: error.message }); }
  });

  router.post("/api/chat/cancel", (c) => {
    if (!canWrite(c.membership)) {
      return sendJson(c.res, 403, { error: "No tienes permisos para esta acción" });
    }
    // Libera el bloqueo del chat y descarta el hilo anterior para que el
    // próximo mensaje arranque con contexto completo (sin quedar colgado del
    // hilo que no respondió). El propio entrenador, si la llamada IA aún sigue
    // en vuelo, añadirá su respuesta al final sin volver a bloquear.
    setChatPending(c.tenantId, false);
    updateChatResponseId(c.tenantId, null);
    return sendJson(c.res, 200, { cancelled: true });
  });
}
