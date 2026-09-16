import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useAdminSettings, useAdminMutations } from "@/hooks/use-admin";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminProviderInfo } from "@/types/session";

export function AdminProviders() {
  const { data, isLoading } = useAdminSettings();
  const mutations = useAdminMutations();
  const { toast } = useToast();

  const [enabled, setEnabled] = useState<string[]>([]);

  useEffect(() => {
    if (data) {
      setEnabled(data.enabledProviders);
    }
  }, [data]);

  function toggle(p: AdminProviderInfo) {
    setEnabled((prev) =>
      prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
    );
  }

  function handleSave() {
    mutations.settings.mutate(
      { enabledProviders: enabled },
      {
        onSuccess: () => toast({ type: "success", title: "Ajustes guardados" }),
        onError: (e) => toast({ type: "error", title: "Error al guardar", description: e.message }),
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          Proveedores de IA disponibles
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Los proveedores desactivados no aparecen para los tenants y el backend rechaza sus llamadas.
        </p>
        {isLoading ? (
          <Skeleton className="h-24 rounded-xl" />
        ) : (
          <div className="space-y-2">
            {data?.providers.map((p) => (
              <label
                key={p.id}
                className="flex items-center justify-between p-3 rounded-xl bg-dark-300/50 cursor-pointer"
              >
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.id}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled.includes(p.id)}
                  onClick={() => toggle(p)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    enabled.includes(p.id) ? "bg-accent" : "bg-dark-400"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      enabled.includes(p.id) ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={mutations.settings.isPending || isLoading}>
          {mutations.settings.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          Guardar ajustes
        </Button>
      </div>
    </div>
  );
}
