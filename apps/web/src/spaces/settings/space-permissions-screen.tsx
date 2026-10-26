import { Button, DangerAction, DangerZone, IconButton, Notice, Skeleton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useSession } from "../../shell/shell-context.js";
import { holderLabel, holderValue, RoleSelect, roleLabel } from "../access/holders.js";
import { ImpactConfirmDialog } from "../access/impact.js";
import { useSpace } from "../space-context.js";
import { permissionsQuery, type SpacePermission, type SpaceRole, spaceKeys } from "../space-queries.js";
import { AddHoldersDialog } from "./add-holders-dialog.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

type Change =
  | { action: "change"; permissionId: string; role: SpaceRole; label: string }
  | { action: "remove"; permissionId: string; label: string };

function body(change: Change) {
  switch (change.action) {
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
  const [adding, setAdding] = useState(false);
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
        title={t("spaces.settings.permissions")}
        description={t("spaces.settings.permissionsDescription")}
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
    } catch (failure) {
      toast({
        title: t("spaces.permissions.failed"),
        description: problemMessage(t, failure),
        variant: "error",
      });
    }
  };

  const confirmTitle =
    change?.action === "change"
      ? t("spaces.permissions.changeTitle", { holder: change.label, role: roleLabel(t, change.role) })
      : change
        ? t("spaces.permissions.removeTitle", { holder: change.label })
        : "";

  return (
    <SpaceSettingsPage
      title={t("spaces.settings.permissions")}
      description={t("spaces.settings.permissionsDescription")}
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
          {permissions.isPending ? <Skeleton className="h-12 w-full" /> : null}
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
                  <div className="flex min-w-0 grow basis-field flex-col">
                    <span
                      className="truncate font-medium"
                      title={own ? t("spaces.permissions.you", { name: text }) : text}
                    >
                      {own ? t("spaces.permissions.you", { name: text }) : text}
                    </span>
                    {entry.email || entry.organizationName ? (
                      <span
                        className="truncate text-sm text-text-muted"
                        title={entry.email ?? entry.organizationName ?? ""}
                      >
                        {entry.email ?? entry.organizationName}
                      </span>
                    ) : null}
                  </div>
                  <div className="w-unit-field">
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
                    size="field"
                    label={t("spaces.permissions.remove", { holder: text })}
                    icon={X}
                    onClick={() => setChange({ action: "remove", permissionId: entry.id, label: text })}
                  />
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <Button variant="secondary" icon={UserPlus} onClick={() => setAdding(true)}>
              {t("spaces.permissions.addPeople")}
            </Button>
          </div>
          <AddHoldersDialog
            space={space}
            existing={entries.map(holderValue)}
            open={adding}
            onOpenChange={setAdding}
          />
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
            : t("spaces.permissions.confirmChange")
        }
        destructive={change?.action === "remove"}
        impact={impact}
        onConfirm={apply}
      />
    </SpaceSettingsPage>
  );
}
