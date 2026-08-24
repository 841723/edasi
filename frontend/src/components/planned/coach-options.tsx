import { useEffect, useState } from "react";
import { Dumbbell, History, Save, Settings, UserRound } from "lucide-react";
import { Link } from "react-router-dom";

import { tenantPath } from "@/lib/tenant";
import { useAuth } from "@/components/auth/auth-context";
import { useEquipment } from "@/hooks/use-equipment";
import { useProfile } from "@/hooks/use-profile";
import { useCoachChat, useUpdateCoachChatInstructions } from "@/hooks/use-coach-chat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ChipProps {
  children: React.ReactNode;
}

function Chip({ children }: ChipProps) {
  return (
    <span className="rounded-full bg-dark-300 px-3 py-1 text-xs text-gray-300">{children}</span>
  );
}

function ListRow({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-200">{value ?? "—"}</span>
    </div>
  );
}

export function CoachOptions() {
  const { activeTenantId } = useAuth();
  const equipment = useEquipment();
  const profile = useProfile();
  const { data: chat, isLoading: chatLoading } = useCoachChat(true);
  const updateInstructions = useUpdateCoachChatInstructions();
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    if (chat) setInstructions(chat.chatInstructions ?? "");
  }, [chat]);

  const athlete = profile.data ?? {};
  const datos = (athlete.datos_del_atleta ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <UserRound className="h-4 w-4 text-accent-light" />
          Datos personales
        </h2>
        <div className="flex flex-col gap-1">
          <ListRow label="Edad" value={datum(datos, ["datos_personales", "edad"])} />
          <ListRow label="Peso (kg)" value={datum(datos, ["datos_personales", "peso_kg"])} />
          <ListRow label="Altura (cm)" value={datum(datos, ["datos_personales", "altura_cm"])} />
          <ListRow label="Fatiga" value={datum(datos, ["estado_fisico", "fatiga"])} />
          <ListRow label="Carga" value={datum(datos, ["estado_fisico", "carga_actual"])} />
          <ListRow label="Lesiones / molestias" value={datum(datos, ["estado_fisico", "lesiones"])} />
        </div>
        <Link
          to={tenantPath(activeTenantId, "/config/general")}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent-light hover:text-accent"
        >
          <SettingsIcon />
          Editar en configuración
        </Link>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
          <Dumbbell className="h-4 w-4 text-accent-light" />
          Equipamiento
        </h2>
        {equipment.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : (equipment.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">Sin equipamiento registrado.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {(equipment.data?.items ?? []).map((item) => (
              <Chip key={item.item}>{item.item}</Chip>
            ))}
          </div>
        )}
        <Link
          to={tenantPath(activeTenantId, "/config/equipment")}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-accent-light hover:text-accent"
        >
          <SettingsIcon />
          Gestionar equipamiento
        </Link>
      </section>

      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
          <History className="h-4 w-4 text-accent-light" />
          Instrucciones para el entrenador
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          Estas instrucciones acompañan a cada pregunta del chat. Describe cómo quieres que
          prepare tus sesiones, objetivos o forma de responder.
        </p>
        {chatLoading ? (
          <Skeleton className="h-28 w-full" />
        ) : (
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={5}
            placeholder="Ej.: prioriza la natación en aguas abiertas, no me pongas más de dos sesiones de fuerza por semana..."
            className="input w-full resize-y"
          />
        )}
        <div className="mt-3 flex justify-end">
          <Button
            onClick={() => updateInstructions.mutate({ instructions })}
            disabled={updateInstructions.isPending || chatLoading}
          >
            <Save className="h-4 w-4" />
            Guardar instrucciones
          </Button>
        </div>
      </section>
    </div>
  );
}

function datum(source: Record<string, unknown>, path: string[]): string | number | null {
  let current: unknown = source;
  for (const key of path) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[key];
    } else {
      return null;
    }
  }
  if (typeof current === "string" || typeof current === "number") return current;
  return null;
}

function SettingsIcon() {
  return <Settings className="h-3.5 w-3.5" />;
}
