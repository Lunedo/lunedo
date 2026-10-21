import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "./client.js";
import { request, setMaintenanceHandler } from "./request.js";

export const maintenanceKeys = { status: ["maintenance"] as const };

export const maintenanceQuery = queryOptions({
  queryKey: maintenanceKeys.status,
  queryFn: () => request(() => api.GET("/api/v1/maintenance"), { sessionHandling: false }),
  staleTime: Number.POSITIVE_INFINITY,
});

export type Maintenance = Awaited<ReturnType<NonNullable<(typeof maintenanceQuery)["queryFn"]>>>;

export function maintenanceChanged(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: maintenanceKeys.status });
}

export function useMaintenanceUpdates(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    setMaintenanceHandler(() => maintenanceChanged(queryClient));
    return () => setMaintenanceHandler(null);
  }, [queryClient]);
}

export function useMaintenance(): Maintenance | null {
  const status = useQuery({ ...maintenanceQuery, throwOnError: false, retry: false });
  return status.data?.enabled ? status.data : null;
}
