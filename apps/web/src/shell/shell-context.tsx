import type { Areas, RoleScope } from "@lunedo/shared";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import {
  type OwnOrganization,
  organizationsQuery,
  permissionsQuery,
  type SessionInfo,
  sessionQuery,
} from "../api/queries.js";
import { isAccentColor } from "../preferences/preferences.js";
import { setAccentColor } from "../preferences/preferences-provider.js";

const STORAGE_PREFIX = "lunedo.organization.";

export interface OrganizationState {
  session: SessionInfo;
  organizations: OwnOrganization[];
  organization: OwnOrganization | null;
  organizationId: string | null;
  multipleOrganizations: boolean;
  can(action: string): boolean;
  grantableAreas(scope: RoleScope): Areas;
  permissionsLoaded: boolean;
}

const OrganizationContext = createContext<OrganizationState | null>(null);

export function rememberOrganization(accountId: string, organizationId: string): void {
  try {
    globalThis.localStorage?.setItem(`${STORAGE_PREFIX}${accountId}`, organizationId);
  } catch {
    return;
  }
}

function rememberedOrganization(accountId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(`${STORAGE_PREFIX}${accountId}`) ?? null;
  } catch {
    return null;
  }
}

export function chooseOrganization(
  organizations: readonly OwnOrganization[],
  fromRoute: string | undefined,
  remembered: string | null,
): OwnOrganization | null {
  const byId = (id: string | null | undefined) =>
    organizations.find((organization) => organization.id === id);
  return (
    byId(fromRoute) ??
    byId(remembered) ??
    organizations.find((organization) => organization.membershipKind === "member") ??
    organizations[0] ??
    null
  );
}

export function OrganizationProvider({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const params = useParams({ strict: false }) as { organizationId?: string };
  const organizations = useQuery({ ...organizationsQuery, throwOnError: false });
  const accountId = session.account?.id ?? "";
  const list = organizations.data ?? [];
  const organization = chooseOrganization(list, params.organizationId, rememberedOrganization(accountId));
  const routeOrganization = params.organizationId ?? null;
  const organizationId = routeOrganization ?? organization?.id ?? null;
  const permissions = useQuery({ ...permissionsQuery(organizationId), throwOnError: false });

  useEffect(() => {
    if (accountId && organization && params.organizationId === organization.id) {
      rememberOrganization(accountId, organization.id);
    }
  }, [accountId, organization, params.organizationId]);

  useEffect(() => {
    if (organization && isAccentColor(organization.accentColor)) setAccentColor(organization.accentColor);
  }, [organization]);

  const value = useMemo<OrganizationState>(() => {
    const allowed = permissions.data;
    return {
      session,
      organizations: list,
      organization: organizationId === organization?.id ? organization : null,
      organizationId,
      multipleOrganizations: list.length > 1,
      can: (action) => (allowed ? allowed.instance.has(action) || allowed.organization.has(action) : false),
      grantableAreas: (scope) => (allowed?.grantableAreas[scope] as Areas | undefined) ?? {},
      permissionsLoaded: allowed !== undefined,
    };
  }, [session, list, organization, organizationId, permissions.data]);

  return <OrganizationContext value={value}>{children}</OrganizationContext>;
}

export function useOrganizationState(): OrganizationState {
  const value = useContext(OrganizationContext);
  if (!value) throw new Error("useOrganizationState needs an OrganizationProvider");
  return value;
}

export function useCan(action: string): boolean {
  return useContext(OrganizationContext)?.can(action) ?? false;
}

export function useSession(): SessionInfo {
  const session = useQuery({ ...sessionQuery, throwOnError: false });
  const state = useContext(OrganizationContext);
  const value = session.data ?? state?.session;
  if (!value) throw new Error("useSession needs a signed-in session");
  return value;
}

export function useCurrentOrganizationId(): string | null {
  return useContext(OrganizationContext)?.organizationId ?? null;
}
