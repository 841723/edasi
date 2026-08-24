import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelJob, fetchJobs } from "@/services/api";
import { useAuth } from "@/components/auth/auth-context";
import type { Job } from "@/types/session";

export const jobsKey = (tenantId: string | null) => ["jobs", tenantId];

export function useJobs(active = false) {
  const { activeTenantId } = useAuth();
  return useQuery<Job[]>({
    queryKey: [...jobsKey(activeTenantId), active],
    queryFn: () => fetchJobs(active),
    enabled: Boolean(activeTenantId),
    refetchInterval: (query) => query.state.data?.some((job) => job.status === "pending" || job.status === "running") ? 2000 : false,
    staleTime: 1000,
  });
}

export function useCancelJob() {
  const queryClient = useQueryClient();
  const { activeTenantId } = useAuth();
  return useMutation({
    mutationFn: (id: string) => cancelJob(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: jobsKey(activeTenantId) });
    },
  });
}
