import { getDefaultAiConfig } from "../lib/ai-configs.js";
import { createJob } from "../lib/jobs.js";
import { getSessionAnalysis, getSessionAnalysisSummary, listPendingSessionAnalyses, listSessionAnalyses, MAX_ANALYSIS_SESSIONS } from "../lib/session-analysis.js";
import { sendJson, canWrite } from "../lib/http.js";

export function register(router) {
  router.get("/api/session-analysis", (c) => {
    return sendJson(c.res, 200, { ...getSessionAnalysisSummary(c.tenantId), items: listSessionAnalyses(c.tenantId) });
  });

  router.post("/api/session-analysis", (c) => {
    if (!canWrite(c.membership)) return sendJson(c.res, 403, { error: "No tienes permisos para esta acción" });
    if (!getDefaultAiConfig(c.tenantId, false)) {
      return sendJson(c.res, 400, { error: "Configura un proveedor de IA antes de analizar entrenamientos" });
    }
    const pending = listPendingSessionAnalyses(c.tenantId, MAX_ANALYSIS_SESSIONS);
    if (pending.length === 0) return sendJson(c.res, 200, { pending: 0, jobId: null });
    try {
      const job = createJob({
        tenantId: c.tenantId,
        userId: c.actor?.userId ?? null,
        type: "analyze_sessions",
        dedupeKey: "analyze-sessions",
        payload: { sessions: pending },
        deepLink: `/${c.tenantId}/trainer`,
      });
      return sendJson(c.res, 202, { pending: pending.length, jobId: job.id });
    } catch (error) {
      if (error.status === 409 && error.job?.id) {
        return sendJson(c.res, 409, { error: error.message, jobId: error.job.id });
      }
      throw error;
    }
  });

  router.get("/api/session-analysis/:sessionId", (c) => {
    const item = getSessionAnalysis(c.tenantId, c.params.sessionId);
    if (!item) return sendJson(c.res, 404, { error: "Análisis no encontrado" });
    return sendJson(c.res, 200, item);
  });
}
