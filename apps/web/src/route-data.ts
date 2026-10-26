import type { QueryClient } from "@tanstack/react-query";
import { maintenanceQuery } from "./api/maintenance.js";
import { permissionsQuery, preferencesQuery, type SessionInfo } from "./api/queries.js";
import { shownAnnouncementsQuery } from "./shell/announcement-banners.js";
import { withheldRolesQuery } from "./shell/app-shell.js";
import { currentOrganizationId } from "./shell/shell-context.js";

export async function settle(...loads: readonly Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(loads);
}

export async function loadShell(
  queryClient: QueryClient,
  session: SessionInfo,
  fromRoute: string | undefined,
): Promise<void> {
  if (session.account?.type === "portal") return;
  const organizationId = await currentOrganizationId(queryClient, session, fromRoute);
  await settle(
    queryClient.ensureQueryData(permissionsQuery(organizationId)),
    queryClient.ensureQueryData(preferencesQuery),
    queryClient.ensureQueryData({ ...maintenanceQuery, retry: false }),
    queryClient.ensureQueryData(shownAnnouncementsQuery),
    queryClient.ensureQueryData(withheldRolesQuery),
  );
}
