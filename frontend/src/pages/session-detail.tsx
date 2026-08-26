import { useState, useMemo, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, Save, Loader2, ExternalLink } from "lucide-react";
import { parseISO } from "date-fns";
import { format } from "@/lib/date-format";
import { useSession } from "@/hooks/use-session";
import { useSessions } from "@/hooks/use-sessions";
import { useUpdateSession } from "@/hooks/use-update-session";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/components/auth/auth-context";
import { tenantPath } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getSportColor,
  getSportLabel,
  formatDistance,
  formatDuration,
  formatPace,
  formatPacePer100m,
  formatSpeed,
  pacePer100m,
  getFeelLabel,
  formatFullDate,
} from "@/lib/utils";
import { SessionLapsChart } from "@/components/charts/session-laps-chart";
import { WorkoutText } from "@/components/session/workout-text";
import { AutoTextarea } from "@/components/ui/auto-textarea";

export function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { activeTenantId } = useAuth();
  const requestedBack = (location.state as { from?: string } | null)?.from;
  const tenantPrefix = activeTenantId ? `/${activeTenantId}/` : "";
  const backTo = activeTenantId && requestedBack?.startsWith(tenantPrefix)
    ? requestedBack
    : tenantPath(activeTenantId, "/calendar");
  const { data: session, isLoading, error } = useSession(id);
  const { data: allSessions } = useSessions();
  const updateMutation = useUpdateSession();
  const perms = usePermissions();
  const [notes, setNotes] = useState("");
  const [notesLoaded, setNotesLoaded] = useState(false);

  useEffect(() => {
    setNotesLoaded(false);
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    if (session && !notesLoaded) {
      setNotes(session.notes ?? "");
      setNotesLoaded(true);
    }
  }, [session, notesLoaded]);

  const completedSorted = useMemo(
    () =>
      (allSessions?.completed ?? [])
        .slice()
        .sort((a, b) => (a.start_date_local ?? "").localeCompare(b.start_date_local ?? "")),
    [allSessions]
  );
  const index = completedSorted.findIndex((s) => s.id === id);
  const prevSession = index > 0 ? completedSorted[index - 1] : null;
  const nextSession = index >= 0 && index < completedSorted.length - 1 ? completedSorted[index + 1] : null;

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error || !session) {
    return (
      <div className="animate-fade-in">
        <button
          onClick={() => navigate(backTo)}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="card p-10 text-center">
          <p className="text-gray-500">Sesión no encontrada</p>
        </div>
      </div>
    );
  }

  const color = getSportColor(session.category);
  const label = getSportLabel(session.category);
  const time = session.time_s ?? 0;
  const isSwim = session.category === "swimming";
  const isCycling = session.category === "cycling";
  const isStrength = session.category === "strength";
  const showPace = !isCycling && !isStrength && session.avg_pace_s_per_km != null;
  const showSpeed = !isSwim && !isStrength && session.avg_speed_ms != null;
  const swimPace = isSwim ? pacePer100m(session.moving_time_s ?? session.elapsed_time_s, session.distance_m) : undefined;
  const swimMaxPace = isSwim && session.max_speed_ms ? 100 / session.max_speed_ms : undefined;

  function handleSaveNotes() {
    if (!session) return;
    updateMutation.mutate(
      { id: session.id, payload: { notes } },
    );
  }

  return (
    <div className="animate-fade-in mx-auto w-full max-w-6xl">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          onClick={() => navigate(backTo)}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <div className="flex-1" />
        <button
          onClick={() => prevSession && navigate(tenantPath(activeTenantId, `/session/${prevSession.id}`), { state: { from: backTo } })}
          disabled={!prevSession}
          className="btn btn-ghost text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          title={prevSession ? prevSession.title ?? prevSession.name : undefined}
        >
          <ArrowLeft className="w-4 h-4" /> Anterior
        </button>
        <button
          onClick={() => nextSession && navigate(tenantPath(activeTenantId, `/session/${nextSession.id}`), { state: { from: backTo } })}
          disabled={!nextSession}
          className="btn btn-ghost text-sm px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          title={nextSession ? nextSession.title ?? nextSession.name : undefined}
        >
          Siguiente <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <div
          className="w-4 h-4 rounded-full mt-1 flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{session.title ?? session.name}</h1>
          {session.title && session.title !== session.name && (
            <p className="text-sm text-gray-500 mt-1">{session.name}</p>
          )}
          <p className="text-xs text-gray-500 mt-1">
            {label} · {formatFullDate(session.start_date_local)}
          </p>
          {session.location_name && (
            <p className="text-xs text-gray-400 mt-1">📍 {session.location_name}</p>
          )}
        </div>
      </div>

      {/* Comentarios - PRIMERO */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Comentarios</h2>
          {perms.canEdit && (
            <div className="flex items-center gap-2">
              {updateMutation.isPending && (
                <span className="text-xs text-gray-500">Guardando...</span>
              )}
              <Button
                variant="ghost"
                className="text-xs px-2 py-1"
                onClick={handleSaveNotes}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                Guardar
              </Button>
            </div>
          )}
        </div>
        <AutoTextarea
          className="w-full rounded-lg bg-dark-300/50 border border-dark-400 px-3 py-2 text-sm focus:outline-none focus:border-accent/60"
          minRows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          readOnly={!perms.canEdit}
          placeholder="Añade tus comentarios sobre esta sesión..."
        />
      </div>

      {/* Estadísticas principales */}
      <div className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">Estadísticas</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          <InfoItem label="Fecha" value={formatFullDate(session.start_date_local)} />
          <InfoItem label="Hora" value={format(parseISO(session.start_date_local), "HH:mm")} />
          <InfoItem label="Deporte" value={label} />
          <InfoItem label="Duración" value={time > 0 ? formatDuration(time) : "—"} />
          {session.distance_m != null && !isStrength && <InfoItem label="Distancia" value={formatDistance(session.distance_m)} />}
          {isSwim ? (
            <>
              {swimPace != null && <InfoItem label="Ritmo medio" value={formatPacePer100m(swimPace)} />}
              {swimMaxPace != null && <InfoItem label="Ritmo máx" value={formatPacePer100m(swimMaxPace)} />}
            </>
          ) : (
            <>
              {showPace && <InfoItem label="Ritmo medio" value={formatPace(session.avg_pace_s_per_km)} />}
              {showSpeed && <InfoItem label="Velocidad media" value={formatSpeed(session.avg_speed_ms)} />}
              {!isStrength && session.max_speed_ms != null && <InfoItem label="Velocidad máx" value={formatSpeed(session.max_speed_ms)} />}
            </>
          )}
          {session.avg_heartrate != null && <InfoItem label="FC media" value={`${session.avg_heartrate} bpm`} />}
          {session.max_heartrate != null && <InfoItem label="FC máx" value={`${session.max_heartrate} bpm`} />}
          {!isStrength && session.avg_watts != null && <InfoItem label="Potencia media" value={`${session.avg_watts} W`} />}
          {!isStrength && session.max_watts != null && <InfoItem label="Potencia máx" value={`${session.max_watts} W`} />}
          {(session.total_elevation_gain_m != null || session.total_elevation_loss_m != null) && (
            <InfoItem
              label="Desnivel"
              value={`↑${session.total_elevation_gain_m ?? 0} m ↓${session.total_elevation_loss_m ?? 0} m`}
            />
          )}
          {session.calories_kcal != null && <InfoItem label="Calorías" value={`${session.calories_kcal} kcal`} />}
          {session.training_effect != null && <InfoItem label="Efecto entrenamiento" value={`${session.training_effect}`} />}
          {session.rpe != null && <InfoItem label="RPE" value={`${Math.round(session.rpe / 10)} / 10`} />}
          {session.feel != null && <InfoItem label="Sensación" value={getFeelLabel(session.feel)} />}
          {session.average_temp_c != null && <InfoItem label="Temperatura" value={`${session.average_temp_c}°C`} />}
        </div>
      </div>

      {/* Trabajo / Vueltas (planificadas) */}
      {session.workout_text && (
        <div className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Trabajo / Vueltas
          </h2>
          <WorkoutText text={session.workout_text} />
        </div>
      )}

      {/* Segmentos / Vueltas */}
      {session.segments && session.segments.length > 0 && (
        <div className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Segmentos
            <span className="text-gray-500 font-normal ml-1">({session.segments.length})</span>
          </h2>
          <div className="space-y-2">
            {session.segments.map((seg, i) => {
              const badge = intensityBadge(seg.intensity ?? "Lap");
              return (
                <div key={i} className="text-sm p-3 rounded-lg bg-dark-300/50">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-gray-400">{seg.label ?? `Lap ${i + 1}`}</span>
                  </div>
                  {isStrength && (seg.name || seg.sets != null || seg.reps != null) ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                      <SegStat label="Ejercicio" value={seg.name ?? seg.label ?? "—"} />
                      <SegStat label="Series" value={seg.sets != null ? String(seg.sets) : "—"} />
                      <SegStat label="Repeticiones" value={seg.reps != null ? String(seg.reps) : "—"} />
                      <SegStat label="Peso" value={seg.weight_kg != null ? `${seg.weight_kg} kg` : "—"} />
                    </div>
                  ) : <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                    <SegStat label="Distancia" value={seg.distance_m ? formatDistance(seg.distance_m) : "—"} />
                    <SegStat label="Tiempo" value={seg.time_s ? formatDuration(seg.time_s) : "—"} />
                    <SegStat
                      label={isSwim ? "Ritmo" : isCycling ? "Velocidad" : "Ritmo"}
                      value={
                        isSwim
                          ? pacePer100m(seg.time_s, seg.distance_m)
                            ? formatPacePer100m(pacePer100m(seg.time_s, seg.distance_m))
                            : "—"
                          : isCycling
                          ? seg.avg_speed_ms
                            ? formatSpeed(seg.avg_speed_ms)
                            : "—"
                          : seg.avg_pace_s_per_km
                          ? formatPace(seg.avg_pace_s_per_km)
                          : seg.pace_text
                          ? seg.pace_text
                          : seg.avg_speed_ms
                          ? formatSpeed(seg.avg_speed_ms)
                          : "—"
                      }
                    />
                    <SegStat
                      label="FC"
                      value={
                        seg.avg_heartrate
                          ? `${seg.avg_heartrate}${seg.max_heartrate ? `/${seg.max_heartrate}` : ""} bpm`
                          : "—"
                      }
                    />
                    {!isStrength && (
                      <SegStat
                        label="Potencia"
                        value={
                          seg.avg_watts
                            ? `${seg.avg_watts}${seg.max_watts ? `/${seg.max_watts}` : ""} W`
                            : "—"
                        }
                      />
                    )}
                    <SegStat
                      label="Desnivel"
                      value={
                        seg.total_elevation_gain_m != null || seg.total_elevation_loss_m != null
                          ? `↑${seg.total_elevation_gain_m ?? 0} m ↓${seg.total_elevation_loss_m ?? 0} m`
                          : "—"
                      }
                    />
                  </div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gráficos por vueltas */}
      {session.segments && session.segments.length > 1 && (
        <SessionLapsChart segments={session.segments} category={session.category} />
      )}

      {/* Zonas de FC */}
      {session.hr_zones && session.hr_zones.length > 0 && (
        <div className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-4">
            Tiempo por zonas de FC
          </h2>
          <div className="space-y-2">
            {session.hr_zones.map((z, i) => {
              const zones = session.hr_zones!;
              const total = zones.reduce((s, x) => s + x.secsInZone, 0) || 1;
              const pct = (z.secsInZone / total) * 100;
              const upper =
                zones[i + 1]?.zoneLowBoundary != null ? zones[i + 1].zoneLowBoundary - 1 : z.zoneLowBoundary + 19;
              const zoneColor = HR_ZONE_COLORS[z.zoneNumber - 1] ?? "#6b7280";
              return (
                <div key={z.zoneNumber} className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ backgroundColor: `${zoneColor}22`, color: zoneColor }}
                  >
                    Z{z.zoneNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">
                        {z.zoneLowBoundary}–{upper} bpm
                      </span>
                      <span className="text-gray-300 font-medium">
                        {formatDuration(z.secsInZone)} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-dark-400/40 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(pct, 2)}%`,
                          backgroundColor: zoneColor,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mejores esfuerzos */}
      {session.best_efforts && session.best_efforts.length > 0 && (
        <div className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
            Mejores esfuerzos
          </h2>
          <div className="flex gap-2 flex-wrap">
            {session.best_efforts.map((effort, i) => (
              <div key={i} className="px-3 py-1.5 rounded-lg bg-dark-300/50 text-sm">
                <span className="font-medium">{effort.name}</span>
                <span className="text-gray-400 ml-2">
                  {formatDistance(effort.distance_m)} · {formatDuration(effort.elapsed_time_s)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enlaces externos */}
      {session.external_id && (
      <div className="flex gap-2 mb-8">
        <a
          href={`https://connect.garmin.com/modern/activity/${session.external_id ?? session.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary text-sm inline-flex items-center gap-1.5"
        >
          <ExternalLink className="w-4 h-4" /> Ver en Garmin
        </a>
      </div>
      )}
    </div>
  );
}

const HR_ZONE_COLORS = ["#60a5fa", "#4ade80", "#facc15", "#fb923c", "#f87171"];

function intensityBadge(intensity: string): { label: string; className: string } {
  switch (intensity) {
    case "ACTIVE":
      return { label: "Serie", className: "bg-accent/20 text-accent-light" };
    case "REST":
      return { label: "Recuperación", className: "bg-dark-400/50 text-gray-300" };
    case "WARMUP":
      return { label: "Calentamiento", className: "bg-yellow-500/15 text-yellow-400" };
    case "COOLDOWN":
      return { label: "Vuelta a la calma", className: "bg-sky-500/15 text-sky-400" };
    default:
      return { label: "Lap", className: "bg-dark-400/50 text-gray-300" };
  }
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SegStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between sm:flex-col sm:justify-start text-xs">
      <span className="text-gray-500 sm:mb-0.5">{label}</span>
      <span className="font-medium text-gray-200">{value}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-fade-in mx-auto w-full max-w-6xl">
      <Skeleton className="h-4 w-20 mb-6" />
      <Skeleton className="h-8 w-64 mb-2" />
      <Skeleton className="h-4 w-48 mb-6" />
      <Skeleton className="card h-32 mb-4" />
      <Skeleton className="card h-48 mb-4" />
      <Skeleton className="card h-40 mb-4" />
    </div>
  );
}
