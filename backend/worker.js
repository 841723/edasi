import { withTenant } from "./lib/sessions.js";
import { getDefaultAiConfig } from "./lib/ai-configs.js";
import { chatWithCoach } from "./lib/trainer.js";
import { analyzeSessions, markSessionsAnalyzed } from "./lib/session-analysis.js";
import { setChatPending, updateChatResponseId, addChatMessage } from "./lib/coach-chat.js";
import { runSync } from "./lib/sync.js";
import { sendPushToUser } from "./lib/push.js";
import { claimNextJob, cancelJob, finishJob, heartbeatJob, isJobActive, updateJobProgress } from "./lib/jobs.js";

let started = false;
let timer = null;

function actorFor(job) {
  return {
    tenantId: job.tenant_id,
    userId: job.user_id ?? null,
    authMethod: "job",
    display: job.user_id ? `user:${job.user_id}` : "automatic",
  };
}

async function processJob(job) {
  const payload = job.payload ?? {};
  const actor = actorFor(job);
  return withTenant(job.tenant_id, async () => {
    heartbeatJob(job.id, job.lease_id);
    if (job.type === "sync") {
      const result = await runSync({ force: payload.force === true, isCancelled: () => !isJobActive(job.id, job.lease_id) });
      if (!isJobActive(job.id, job.lease_id)) return;
      if (result?.cancelled) {
        cancelJob(job.tenant_id, job.id);
        return;
      }
      finishJob(job.id, job.lease_id, "completed", { result });
      if ((result.synced ?? result.newActivities ?? 0) > 0) {
        await sendPushToUser(job.tenant_id, job.user_id, {
          title: "Sincronización completada",
          body: `${result.synced ?? result.newActivities} actividades nuevas`,
          url: job.deep_link ?? `/${job.tenant_id}/calendar`,
        });
      }
      return;
    }

    if (job.type === "coach_chat") {
      const settings = getDefaultAiConfig(job.tenant_id, true);
      if (!settings) throw new Error("La configuración de IA ya no existe");
      const result = await chatWithCoach({
        message: payload.message,
        previousResponseId: payload.previousResponseId ?? null,
        sessionIds: payload.sessionIds ?? [],
        settings,
        actor,
        isCancelled: () => !isJobActive(job.id, job.lease_id),
      });
      if (result?.cancelled || !isJobActive(job.id, job.lease_id)) return;
      if (result.responseId) updateChatResponseId(job.tenant_id, result.responseId);
      if (result.selectedSessions?.length) markSessionsAnalyzed(job.tenant_id, result.selectedSessions, { analysis: result.reply, profileChange: result.parsed?.profile_change ?? "" }, result.profileVersionId ?? null);
      setChatPending(job.tenant_id, false);
      finishJob(job.id, job.lease_id, "completed", { result: { reply: result.reply, profileUpdated: result.profileUpdated } });
      await sendPushToUser(job.tenant_id, job.user_id, {
        title: "El entrenador ha respondido",
        body: "Hay una nueva respuesta en el chat del entrenador.",
        url: job.deep_link ?? `/${job.tenant_id}/trainer`,
      });
      return;
    }

    if (job.type === "analyze_sessions") {
      const settings = getDefaultAiConfig(job.tenant_id, true);
      if (!settings) throw new Error("La configuración de IA ya no existe");
      const result = await analyzeSessions({
        tenantId: job.tenant_id,
        sessionItems: payload.sessions ?? [],
        settings,
        actor,
        isCancelled: () => !isJobActive(job.id, job.lease_id),
        onProgress: (progress) => updateJobProgress(job.id, progress),
      });
      if (result?.cancelled || !isJobActive(job.id, job.lease_id)) return;
      finishJob(job.id, job.lease_id, "completed", { result });
      await sendPushToUser(job.tenant_id, job.user_id, {
        title: "Análisis de entrenamientos completado",
        body: `${result.analyzed} entrenamiento${result.analyzed === 1 ? "" : "s"} analizado${result.analyzed === 1 ? "" : "s"}.`,
        url: job.deep_link ?? `/${job.tenant_id}/trainer`,
      });
      return;
    }

    throw new Error(`Tipo de job desconocido: ${job.type}`);
  });
}

async function tick() {
  const job = claimNextJob();
  if (!job) return;
  const heartbeat = setInterval(() => heartbeatJob(job.id, job.lease_id), 30_000);
  try {
    await processJob(job);
  } catch (error) {
    const active = isJobActive(job.id, job.lease_id);
    finishJob(job.id, job.lease_id, "failed", { error: error?.message ?? String(error) });
    if (job.type === "coach_chat" && active) {
      withTenant(job.tenant_id, () => {
        setChatPending(job.tenant_id, false);
        addChatMessage("assistant", "No se pudo completar la respuesta en este momento. Vuelve a preguntar cuando quieras.");
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
}

export function startWorker({ intervalMs = 1000 } = {}) {
  if (started) return;
  started = true;
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  startWorker();
  console.log("Background worker iniciado");
}
