import { useToast } from "@lunedo/ui";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { useFailureToast } from "../errors/failure.js";

export interface RemovableAssignment {
  id: string;
  builtInRole?: string | null;
  customRoleId?: string | null;
  principalKind: string;
  principalId?: string | null;
  expiresAt?: string | null;
}

type Scope = { organizationId: string } | "instance";

function restorable(assignment: RemovableAssignment): boolean {
  if (!assignment.principalId) return false;
  if (assignment.principalKind !== "account" && assignment.principalKind !== "group") return false;
  if (assignment.expiresAt && new Date(assignment.expiresAt).getTime() <= Date.now()) return false;
  return Boolean(assignment.builtInRole || assignment.customRoleId);
}

function removeAssignment(scope: Scope, assignmentId: string) {
  return scope === "instance"
    ? request(() =>
        api.DELETE("/api/v1/instance/role-assignments/{assignmentId}", {
          params: { path: { assignmentId } },
        }),
      )
    : request(() =>
        api.DELETE("/api/v1/organizations/{organizationId}/role-assignments/{assignmentId}", {
          params: { path: { organizationId: scope.organizationId, assignmentId } },
        }),
      );
}

function restoreAssignment(scope: Scope, assignment: RemovableAssignment) {
  const expiry = assignment.expiresAt ? { expiresAt: assignment.expiresAt } : {};
  const id = assignment.principalId ?? "";
  if (scope === "instance") {
    return request(() =>
      api.POST("/api/v1/instance/role-assignments", {
        body: {
          role: assignment.builtInRole
            ? { builtIn: assignment.builtInRole as "administrator" | "securityAuditor" }
            : { customRoleId: assignment.customRoleId ?? "" },
          principal: { kind: "account", id },
          ...expiry,
        },
      }),
    );
  }
  return request(() =>
    api.POST("/api/v1/organizations/{organizationId}/role-assignments", {
      params: { path: { organizationId: scope.organizationId } },
      body: {
        role: assignment.builtInRole
          ? { builtIn: assignment.builtInRole as "owner" | "administrator" }
          : { customRoleId: assignment.customRoleId ?? "" },
        principal: { kind: assignment.principalKind as "account" | "group", id },
        ...expiry,
      },
    }),
  );
}

export function useUnassignWithUndo(scope: Scope, onChanged: () => Promise<unknown>) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  return async (assignment: RemovableAssignment, title: string): Promise<boolean> => {
    try {
      await removeAssignment(scope, assignment.id);
      await onChanged();
    } catch (failure) {
      showFailure(t("failures.unassignRole"), failure);
      return false;
    }
    toast({
      title,
      ...(restorable(assignment)
        ? {
            undo: {
              onUndo: () => {
                restoreAssignment(scope, assignment)
                  .then(onChanged)
                  .catch((failure: unknown) => showFailure(t("failures.assignRole"), failure));
              },
            },
          }
        : { variant: "success" as const }),
    });
    return true;
  };
}
