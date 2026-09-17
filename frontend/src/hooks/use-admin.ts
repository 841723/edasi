import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAdminSettings,
  updateAdminSettings,
  fetchAdminTenants,
  createAdminTenant,
  adminRenameTenant,
  fetchAdminTenantMembers,
  adminAddMember,
  adminUpdateMemberRole,
  adminRemoveMember,
  fetchAdminPrompts,
  createAdminPrompt,
  updateAdminPrompt,
  deleteAdminPrompt,
} from "@/services/api";
import { invalidateMany } from "@/lib/invalidate";

export function useAdminSettings() {
  return useQuery({ queryKey: ["admin", "settings"], queryFn: fetchAdminSettings });
}

export function useAdminTenants() {
  return useQuery({ queryKey: ["admin", "tenants"], queryFn: fetchAdminTenants });
}

export function useAdminPrompts() {
  return useQuery({ queryKey: ["admin", "prompts"], queryFn: fetchAdminPrompts });
}

export function useAdminTenantMembers(tenantId: string | null) {
  return useQuery({
    queryKey: ["admin", "tenants", tenantId, "members"],
    queryFn: () => fetchAdminTenantMembers(tenantId!),
    enabled: !!tenantId,
  });
}

export function useAdminMutations() {
  const qc = useQueryClient();

  const invalidate = () => invalidateMany(qc, ["admin", "tenants"]);
  const invalidateSettings = () => invalidateMany(qc, ["admin", "settings"]);

  return {
    settings: useMutation({
      mutationFn: updateAdminSettings,
      onSuccess: invalidateSettings,
    }),
    createTenant: useMutation({
      mutationFn: createAdminTenant,
      onSuccess: invalidate,
    }),
    renameTenant: useMutation({
      mutationFn: ({ tenantId, name }: { tenantId: string; name: string }) => adminRenameTenant(tenantId, name),
      onSuccess: invalidate,
    }),
    addMember: useMutation({
      mutationFn: ({ tenantId, payload }: { tenantId: string; payload: { email: string; role: "athlete" | "admin" | "visitor" } }) =>
        adminAddMember(tenantId, payload),
      onSuccess: invalidate,
    }),
    updateRole: useMutation({
      mutationFn: ({ tenantId, userId, role }: { tenantId: string; userId: string; role: "athlete" | "admin" | "visitor" }) =>
        adminUpdateMemberRole(tenantId, userId, role),
      onSuccess: invalidate,
    }),
    removeMember: useMutation({
      mutationFn: ({ tenantId, userId }: { tenantId: string; userId: string }) => adminRemoveMember(tenantId, userId),
      onSuccess: invalidate,
    }),
  };
}
