import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { instanceKeys } from "../api/instance-queries.js";
import { organizationKeys } from "../api/organization-queries.js";
import { request } from "../api/request.js";

export type SettingChange = { value: unknown } | { clear: true } | { locked: boolean };

export function useOrganizationSettingMutation(organizationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, change }: { key: string; change: SettingChange }) =>
      request(() =>
        api.PUT("/api/v1/organizations/{organizationId}/settings/{key}", {
          params: { path: { organizationId, key } },
          body: change as never,
        }),
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKeys.settings(organizationId) });
      await queryClient.invalidateQueries({ queryKey: organizationKeys.organization(organizationId) });
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}

export function useInstanceSettingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, change }: { key: string; change: SettingChange }) =>
      request(() =>
        api.PUT("/api/v1/instance/settings/{key}", { params: { path: { key } }, body: change as never }),
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: instanceKeys.settings });
      await queryClient.invalidateQueries({ queryKey: ["instance", "info"] });
    },
  });
}
