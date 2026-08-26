import { useState } from "react";
import {
  CircleCheck,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
  ExternalLink,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";
import { usePlanned, useDeletePlanned } from "@/hooks/use-planned";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/components/auth/auth-context";
import { tenantPath } from "@/lib/tenant";
import { useSessionAnalysis } from "@/hooks/use-session-analysis";
import { CoachChat } from "@/components/planned/coach-chat";
import { CoachOptions } from "@/components/planned/coach-options";
import { PlannedFormModal } from "@/components/planned/planned-form";
import { WorkoutText } from "@/components/session/workout-text";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTrainerDate, getSportColor, getSportLabel, localDateKey, formatDistance, formatDuration } from "@/lib/utils";
import type { PlannedSessionView, SessionAnalysisItem } from "@/types/session";

export function TrainerPage() {
  const { data: sessions, isLoading, error, refetch } = usePlanned();
  const permissions = usePermissions();
  const deleteMutation = useDeletePlanned();
  const { data: analysis } = useSessionAnalysis();

  const [formOpen, setFormOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<PlannedSessionView | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [showTrainingPanel, setShowTrainingPanel] = useState(true);
  const [showOptionsPanel, setShowOptionsPanel] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"training" | "options" | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [trainingTab, setTrainingTab] = useState<"planned" | "completed" | "analysis">("planned");

  const orderedSessions = (sessions ?? []).sort((a, b) =>
    a.start_date_local.localeCompare(b.start_date_local)
  );
  const pendingSessions = orderedSessions.filter((session) => !session.merged_with);
  const completedSessions = orderedSessions.filter((session) => session.merged_with);
  const analysesBySession = new Map((analysis?.latest ?? []).filter((item) => item.session_id).map((item) => [item.session_id!, item]));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,25rem)_minmax(0,1fr)_minmax(15rem,25rem)]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-red-300">No se pudieron cargar las sesiones planificadas.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => void refetch()}>Reintentar</button>
      </div>
    );
  }

  return (
      <div className="mx-auto flex h-[calc(100dvh-64px-6rem)] min-h-0 w-full max-w-full flex-none flex-col gap-3 overflow-x-hidden animate-fade-in md:h-[calc(100dvh-74px-3rem)]">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-outline h-7 px-2 py-0 text-[11px] xl:hidden" onClick={() => setMobilePanel("training")}>Entrenamientos</button>
          <button type="button" className="btn btn-outline h-7 px-2 py-0 text-[11px] xl:hidden" onClick={() => setMobilePanel("options")}>Configuración</button>
        </div>
      </header>
      <div className="hidden shrink-0 justify-end gap-2 xl:flex">
         <button type="button" className="btn btn-outline h-7 px-2 py-0 text-[11px]" onClick={() => setShowTrainingPanel((value) => !value)}>
           <PanelLeftClose className="h-3 w-3" />
          {showTrainingPanel ? "Ocultar entrenamientos" : "Mostrar entrenamientos"}
        </button>
         <button type="button" className="btn btn-outline h-7 px-2 py-0 text-[11px]" onClick={() => setShowOptionsPanel((value) => !value)}>
           <PanelRightClose className="h-3 w-3" />
          {showOptionsPanel ? "Ocultar configuración" : "Mostrar configuración"}
        </button>
      </div>
      <div className={`grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] items-stretch gap-5 ${showTrainingPanel && showOptionsPanel ? "xl:grid-cols-[minmax(15rem,25rem)_minmax(0,1fr)_minmax(15rem,25rem)]" : showTrainingPanel ? "xl:grid-cols-[minmax(15rem,25rem)_minmax(0,1fr)]" : showOptionsPanel ? "xl:grid-cols-[minmax(0,1fr)_minmax(15rem,25rem)]" : "xl:grid-cols-1"}`}>
           {showTrainingPanel && <div className="hidden min-h-0 min-w-0 space-y-3 overflow-x-hidden overflow-y-auto xl:block">
           <TrainingTabs active={trainingTab} setActive={setTrainingTab} />
           {trainingTab === "planned" && <PlannedSessions
            sessions={pendingSessions}
            heading="Entrenamientos"
            canEdit={permissions.canEdit}
            expandedSessions={expandedSessions}
            setExpandedSessions={setExpandedSessions}
            onEditSession={permissions.canEdit ? setEditingSession : undefined}
            onDeleteSession={
              permissions.canEdit
                ? (id) => {
                    if (window.confirm("¿Eliminar esta sesión planificada?")) {
                      deleteMutation.mutate(id);
                    }
                  }
                : undefined
            }
            analysisBySession={analysesBySession}
            onAdd={permissions.canEdit ? () => setFormOpen(true) : undefined}
           />}
           {trainingTab === "completed" && <PlannedSessions
              sessions={completedSessions}
               heading="Completados"
              canEdit={false}
              expandedSessions={expandedSessions}
              setExpandedSessions={setExpandedSessions}
              onEditSession={undefined}
              onDeleteSession={undefined}
              analysisBySession={analysesBySession}
             />}
           {trainingTab === "analysis" && <AnalysisPicker analysis={(analysis?.items ?? []).filter((item) => item.status !== "completed")} selected={selectedSessions} setSelected={setSelectedSessions} />}
        </div>
        }

          <div className="h-full min-h-0 min-w-0">
           <CoachChat selectedSessions={selectedSessions} />
        </div>

          {showOptionsPanel && <div className="hidden min-h-0 min-w-0 overflow-y-auto xl:block">
          <CoachOptions />
        </div>}
      </div>

      {mobilePanel && <div className="fixed inset-0 z-50 flex items-end overflow-x-hidden bg-black/70 sm:items-center sm:p-4" onClick={() => setMobilePanel(null)}><div className="max-h-[90vh] w-full overflow-x-hidden overflow-y-auto rounded-t-2xl bg-dark-200 p-4 sm:max-w-lg sm:rounded-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex justify-end"><button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setMobilePanel(null)}>Cerrar</button></div>{mobilePanel === "training" ? <><TrainingTabs active={trainingTab} setActive={setTrainingTab} />{trainingTab === "planned" && <PlannedSessions sessions={pendingSessions} heading="Planeados" canEdit={permissions.canEdit} expandedSessions={expandedSessions} setExpandedSessions={setExpandedSessions} onEditSession={permissions.canEdit ? setEditingSession : undefined} onDeleteSession={permissions.canEdit ? (id) => { if (window.confirm("¿Eliminar esta sesión planificada?")) deleteMutation.mutate(id); } : undefined} analysisBySession={analysesBySession} onAdd={permissions.canEdit ? () => setFormOpen(true) : undefined} />}{trainingTab === "completed" && <PlannedSessions sessions={completedSessions} heading="Completados" canEdit={false} expandedSessions={expandedSessions} setExpandedSessions={setExpandedSessions} analysisBySession={analysesBySession} />}{trainingTab === "analysis" && <AnalysisPicker analysis={(analysis?.items ?? []).filter((item) => item.status !== "completed")} selected={selectedSessions} setSelected={setSelectedSessions} />}</> : <CoachOptions />}</div></div>}

      <PlannedFormModal
        open={formOpen}
        session={null}
        defaultDate={localDateKey()}
        onClose={() => setFormOpen(false)}
      />
      {editingSession && (
        <PlannedFormModal
          open
          session={editingSession}
          onClose={() => setEditingSession(null)}
        />
      )}
    </div>
  );
}

function TrainingTabs({ active, setActive }: { active: "planned" | "completed" | "analysis"; setActive: (tab: "planned" | "completed" | "analysis") => void }) {
  return <div className="grid grid-cols-3 gap-1 rounded-lg border border-dark-400 bg-dark-300/30 p-1">
    {([['planned', 'Planeados'], ['completed', 'Completados'], ['analysis', 'Por analizar']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setActive(id)} className={`min-w-0 rounded-md px-1 py-1.5 text-[11px] font-medium ${active === id ? "bg-accent/20 text-accent-light" : "text-gray-500 hover:text-gray-200"}`}>{label}</button>)}
  </div>;
}

function AnalysisPicker({ analysis, selected, setSelected }: { analysis: SessionAnalysisItem[]; selected: Set<string>; setSelected: (next: Set<string>) => void }) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  return <section className="card min-w-0 overflow-x-hidden p-3">
    <div className="mb-2 flex items-center justify-between gap-2">
      <div><h2 className="text-sm font-semibold">Analizar entrenamientos</h2><p className="text-[11px] text-gray-500">Selecciona los que quieres incluir en tu próximo mensaje.</p></div>
      <button type="button" className="btn btn-ghost h-6 px-2 py-0 text-[10px]" onClick={() => setSelected(new Set(analysis.filter((item) => item.status !== "completed" && item.id).map((item) => item.id!)))}>Pendientes</button>
    </div>
    <div className="space-y-1 pr-1">
      {analysis.slice(0, 30).map((item) => {
        const session = item.session ?? {};
        const id = item.id;
        if (!id) return null;
        return <button key={id} type="button" onClick={() => toggle(id)} className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${selected.has(id) ? "border-accent/50 bg-accent/10" : "border-dark-400 bg-dark-300/20"}`}>
          <span className="min-w-0 truncate">{String(session.title ?? session.name ?? session.sport ?? "Entrenamiento")} <span className="text-gray-500">{String(session.start_date_local ?? "").slice(0, 10)}</span></span>
          <span className={item.status === "completed" ? "text-green-400" : "text-amber-300"}>{item.status === "completed" ? "Analizado" : "Pendiente"}</span>
        </button>;
      })}
      {analysis.length === 0 && <p className="py-3 text-center text-xs text-gray-500">No hay entrenamientos completados.</p>}
    </div>
  </section>;
}

interface PlannedSessionsProps {
  sessions: PlannedSessionView[];
  heading: string;
  canEdit: boolean;
  expandedSessions: Set<string>;
  setExpandedSessions: (next: (prev: Set<string>) => Set<string>) => void;
  onEditSession?: (session: PlannedSessionView) => void;
  onDeleteSession?: (id: string) => void;
  analysisBySession?: Map<string, SessionAnalysisItem>;
  onAdd?: () => void;
}

function PlannedSessions({
  sessions,
  heading,
  canEdit,
  expandedSessions,
  setExpandedSessions,
  onEditSession,
  onDeleteSession,
  analysisBySession,
  onAdd,
}: PlannedSessionsProps) {
  const { activeTenantId } = useAuth();
  const expandAll = () =>
    setExpandedSessions(() => new Set(sessions.map((s) => s.id)));
  const collapseAll = () => setExpandedSessions(() => new Set());

  return (
      <section className="card min-w-0 overflow-x-hidden p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-accent-light" />
          <h2 className="text-lg font-bold">{heading}</h2>
          <span className="text-xs text-gray-500">{sessions.length} sesiones</span>
        </div>
        <div className="flex items-center gap-2">
          {onAdd && <button type="button" className="btn btn-primary px-2 py-1 text-xs" onClick={onAdd}><Plus className="h-3.5 w-3.5" /> Añadir</button>}
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-dark-300 hover:text-gray-200"
            onClick={expandAll}
            title="Extender todo"
            aria-label="Extender todo"
          >
            <ChevronsUpDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-dark-300 hover:text-gray-200"
            onClick={collapseAll}
            title="Colapsar todo"
            aria-label="Colapsar todo"
          >
            <ChevronsDownUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-500">
          Todavía no hay sesiones planificadas.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {sessions.map((session) => {
            const open = expandedSessions.has(session.id);
            return (
              <details
                key={session.id}
                open={open}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setExpandedSessions((prev) => {
                    const next = new Set(prev);
                    if (open) next.add(session.id);
                    else next.delete(session.id);
                    return next;
                  });
                }}
                 className="min-w-0 overflow-x-hidden rounded-xl border border-dark-400 bg-dark-300/30 p-4"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1 h-3 w-3 rounded-full"
                      style={{ backgroundColor: getSportColor(session.category) }}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">
                        {session.title ?? session.name}
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">
                        {getSportLabel(session.category)} ·{" "}
                        {formatTrainerDate(session.start_date_local)}
                      </p>
                    </div>
                    {canEdit && onEditSession && (
                      <button
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onEditSession(session); }}
                        title="Editar sesión (fecha, título, texto)"
                        aria-label={`Editar ${session.title ?? session.name}`}
                        className="shrink-0 rounded-lg text-gray-500 transition-colors hover:bg-dark-300 hover:text-gray-200"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canEdit && onDeleteSession && (
                      <button
                        onClick={(event) => { event.preventDefault(); event.stopPropagation(); onDeleteSession(session.id); }}
                        title="Eliminar sesión"
                        aria-label={`Eliminar ${session.title ?? session.name}`}
                        className="shrink-0 rounded-lg text-gray-500 transition-colors hover:bg-dark-300 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    { session.merged_with && session.completed_session && (
                      <div className="text-green-400">
                        <CircleCheck className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                </summary>

                <div className="mt-3">
                  {session.merged_with && session.completed_session && (
                    <a
                      href={tenantPath(activeTenantId, `/session/${session.completed_session.id}`)}
                      className="mb-4 hover:underline font-semibold rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-xs text-green-200 inline-flex gap-2 w-full"
                    >
                      Ya realizada
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {session.completed_session && analysisBySession?.get(session.completed_session.id)?.analysis?.analysis && (
                    <div className="mb-4 rounded-xl border border-accent/20 bg-accent/5 p-3">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-accent-light">Análisis del entrenador</p>
                      <p className="whitespace-pre-wrap text-xs leading-5 text-gray-300">{analysisBySession.get(session.completed_session.id)?.analysis?.analysis}</p>
                      {analysisBySession.get(session.completed_session.id)?.analysis?.profileChange && (
                        <p className="mt-2 border-t border-accent/10 pt-2 text-[11px] text-accent-light">
                          Perfil actualizado: {analysisBySession.get(session.completed_session.id)?.analysis?.profileChange}
                        </p>
                      )}
                    </div>
                  )}
                  {session.workout_text ? (
                    <WorkoutText text={session.workout_text} />
                  ) : (
                    <div className="space-y-1">
                      {(session.objectives ?? []).map((objective, index) => (
                        <p key={index} className="text-sm text-gray-300">
                          {objective.label && (
                            <span className="mr-2 text-[10px] uppercase text-accent-light">
                              {objective.label}
                            </span>
                          )}
                          {objective.text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
