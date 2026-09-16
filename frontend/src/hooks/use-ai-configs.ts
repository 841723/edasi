import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type {
  AiConfig,
  AiConfigPayload,
  AiConfigsResponse,
} from "@/types/session";
import {
  fetchAiConfigs,
  createAiConfig,
  updateAiConfig,
  deleteAiConfig,
  setDefaultAiConfig,
  testAiConfig,
} from "@/services/api";
import { invalidateMany } from "@/lib/invalidate";
import { useAuth } from "@/components/auth/auth-context";

export function useAiConfigs() {
  const { activeTenantId } = useAuth();
  return useQuery({
    queryKey: ["ai-configs", activeTenantId],
    queryFn: fetchAiConfigs,
    enabled: !!activeTenantId,
  });
}

export function useAiConfig(configId?: string | null) {
  const { data } = useAiConfigs();
  const config = data?.items.find((c) => c.id === configId);
  return config ?? null;
}

export function useAiConfigsMutations() {
  const qc = useQueryClient();
  const invalidate = () => invalidateMany(qc, ["ai-configs", "ai-settings"]);

  const create = useMutation({
    mutationFn: (payload: AiConfigPayload) => createAiConfig(payload),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<AiConfigPayload> }) =>
      updateAiConfig(id, payload),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAiConfig(id),
    onSuccess: invalidate,
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => setDefaultAiConfig(id),
    onSuccess: invalidate,
  });

  const test = useMutation({
    mutationFn: (id: string) => testAiConfig(id),
  });

  return { create, update, remove, setDefault, test };
}

export type { AiConfig, AiConfigsResponse };
