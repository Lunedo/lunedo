import {
  Button,
  DangerAction,
  DangerZone,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Notice,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Shield, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useSession } from "../../shell/shell-context.js";
import {
  type Holder,
  HolderPicker,
  holderLabel,
  holderValue,
  RoleSelect,
  roleLabel,
} from "../access/holders.js";
import { ImpactConfirmDialog } from "../access/impact.js";
import { useSpace } from "../space-context.js";
import { permissionsQuery, type SpacePermission, type SpaceRole, spaceKeys } from "../space-queries.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

type Change =
  | {
      action: "grant";
      principalKind: Holder["principalKind"];
      principalId: string | null;
      role: SpaceRole;
      label: string;
    }
  | { action: "change"; permissionId: string; role: SpaceRole; label: string }
  | { action: "remove"; permissionId: string; label: string };

function body(change: Change) {
  switch (change.action) {
    case "grant":
      return {
        action: "grant" as const,
        principalKind: change.principalKind,
        principalId: change.principalId,
        role: change.role,
      };
    case "change":
      return { action: "change" as const, permissionId: change.permissionId, role: change.role };
    case "remove":
      return { action: "remove" as const, permissionId: change.permissionId };
  }
}

export function SpacePermissionsScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const permissions = useQuery({ ...permissionsQuery(space.id), enabled: space.role === "admin" });
  const [change, setChange] = useState<Change | null>(null);
  const [adding, setAdding] = useState<(Holder & { name: string }) | null>(null);
  const [addingRole, setAddingRole] = useState<SpaceRole>("reader");
  const [addError, setAddError] = useState<string | null>(null);
  const impact = useQuery({
    queryKey: ["spaces", space.id, "permissionImpact", change ? JSON.stringify(body(change)) : null],
    enabled: change !== null,
    retry: false,
    queryFn: () =>
      request(() =>
        api.POST("/api/v1/spaces/{spaceId}/permissions/preview", {
          params: { path: { spaceId: space.id } },
          body: body(change as Change),
        }),
      ),
  });

  if (space.role !== "admin") {
    return (
      <SpaceSettingsPage
        tab="permissions"
        title={t("spaces.settings.permissions")}
        description={t("spaces.settings.permissionsDescription")}
        icon={Shield}
      >
        <Notice variant="info" title={t("spaces.settings.adminsOnlyTitle")}>
          {t("spaces.settings.adminsOnly", { role: roleLabel(t, space.role ?? "reader") })}
        </Notice>
      </SpaceSettingsPage>
    );
  }

  const entries = permissions.data ?? [];
  const label = (entry: SpacePermission) => holderLabel(t, entry, space.organizationName);
  const ownId = session.account?.id;

  const apply = async () => {
    if (!change) return;
    try {
      await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/permissions", {
          params: { path: { spaceId: space.id } },
          body: body(change),
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.permissions(space.id) });
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      toast({
        title: t(`spaces.permissions.${change.action}Done`, { holder: change.label }),
        variant: "success",
      });
      setChange(null);
      if (change.action === "grant") setAdding(null);
    } catch (failure) {
      toast({
        title: t("spaces.permissions.failed"),
        description: problemMessage(t, failure),
        variant: "error",
      });
    }
  };

  const confirmTitle =
    change?.action === "grant"
      ? t("spaces.permissions.grantTitle", { holder: change.label, role: roleLabel(t, change.role) })
      : change?.action === "change"
        ? t("spaces.permissions.changeTitle", { holder: change.label, role: roleLabel(t, change.role) })
        : change
          ? t("spaces.permissions.removeTitle", { holder: change.label })
          : "";

  return (
    <SpaceSettingsPage
      tab="permissions"
      title={t("spaces.settings.permissions")}
      description={t("spaces.settings.permissionsDescription")}
      icon={Shield}
    >
      <div className="flex flex-col gap-8">
        <Panel title={t("spaces.permissions.visibilityTitle")}>
          <p className="text-text-muted">
            {space.visibility === "private"
              ? t("spaces.permissions.visibilityPrivate")
              : t(`spaces.visibility.${space.visibility}.summary`, {
                  organization: space.organizationName ?? "",
                })}
          </p>
        </Panel>
        <Panel
          title={t("spaces.permissions.holders")}
          description={t("spaces.permissions.holdersDescription")}
        >
          {permissions.isPending ? <Skeleton className="h-24 w-full" /> : null}
          {permissions.isError ? (
            <LoadError
              what={t("spaces.permissions.loadFailed")}
              error={permissions.error}
              onRetry={() => permissions.refetch()}
            />
          ) : null}
          <ul aria-label={t("spaces.permissions.holders")} className="flex flex-col divide-y divide-border">
            {entries.map((entry) => {
              const text = label(entry);
              const own = entry.principalKind === "account" && entry.principalId === ownId;
              return (
                <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium" title={text}>
                      {own ? t("spaces.permissions.you", { name: text }) : text}
                    </span>
                    {entry.email || entry.organizationName ? (
                      <span className="truncate text-sm text-text-muted">
                        {entry.email ?? entry.organizationName}
                      </span>
                    ) : null}
                  </div>
                  <div className="w-44">
                    <RoleSelect
                      label={t("spaces.create.roleOf", { holder: text })}
                      value={entry.role}
                      onValueChange={(role) =>
                        role !== entry.role &&
                        setChange({ action: "change", permissionId: entry.id, role, label: text })
                      }
                    />
                  </div>
                  <IconButton
                    label={t("spaces.permissions.remove", { holder: text })}
                    icon={X}
                    onClick={() => setChange({ action: "remove", permissionId: entry.id, label: text })}
                  />
                </li>
              );
            })}
          </ul>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!adding) {
                setAddError(t("spaces.create.chooseHolderFirst"));
                focusFirstInvalidSoon();
                return;
              }
              setAddError(null);
              setChange({
                action: "grant",
                principalKind: adding.principalKind,
                principalId: adding.principalId,
                role: addingRole,
                label: holderLabel(t, adding, space.organizationName),
              });
            }}
          >
            <div className="min-w-0 flex-1">
              <Field label={t("spaces.create.addHolder")} {...(addError ? { error: addError } : {})}>
                <HolderPicker
                  label={t("spaces.create.addHolder")}
                  organizationId={space.organizationId}
                  organizationName={space.organizationName}
                  personal={space.personal}
                  exclude={entries.map(holderValue)}
                  value={adding ? holderValue(adding) : null}
                  onValueChange={setAdding}
                />
              </Field>
            </div>
            <div className="sm:w-44">
              <RoleSelect
                label={t("spaces.create.newRole")}
                value={addingRole}
                onValueChange={setAddingRole}
              />
            </div>
            <Button type="submit" variant="secondary" icon={Plus}>
              {t("spaces.permissions.add")}
            </Button>
          </form>
        </Panel>
        <Panel title={t("spaces.permissions.rolesTitle")}>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-4">
            {(["reader", "commenter", "editor", "admin"] as const).map((role) => (
              <div key={role} className="flex flex-col gap-1">
                <dt className="font-medium">{roleLabel(t, role)}</dt>
                <dd className="text-sm text-text-muted">{t(`spaces.roleDescriptions.${role}`)}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        {ownId && entries.some((entry) => entry.principalId === ownId && entry.role === "admin") ? (
          <DangerZone title={t("spaces.permissions.dangerZone")}>
            <DangerAction
              title={t("spaces.permissions.stepDownTitle")}
              description={t("spaces.permissions.stepDownDescription")}
              action={
                <Button
                  variant="danger"
                  onClick={() => {
                    const own = entries.find(
                      (entry) => entry.principalId === ownId && entry.principalKind === "account",
                    );
                    if (own) setChange({ action: "remove", permissionId: own.id, label: label(own) });
                  }}
                >
                  {t("spaces.permissions.stepDown")}
                </Button>
              }
            />
          </DangerZone>
        ) : null}
      </div>
      <ImpactConfirmDialog
        open={change !== null}
        onOpenChange={(open) => !open && setChange(null)}
        title={confirmTitle}
        description={t("spaces.permissions.confirmDescription")}
        confirmLabel={
          change?.action === "remove"
            ? t("spaces.permissions.confirmRemove")
            : change?.action === "grant"
              ? t("spaces.permissions.confirmGrant")
              : t("spaces.permissions.confirmChange")
        }
        destructive={change?.action === "remove"}
        impact={impact}
        onConfirm={apply}
      />
    </SpaceSettingsPage>
  );
}
