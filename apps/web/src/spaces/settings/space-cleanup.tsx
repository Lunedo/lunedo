import {
  ConfirmDialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Menu,
  Skeleton,
  Table,
  Textarea,
  TruncatedText,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, MoreHorizontal, ShieldCheck, Trash2, User, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import type { SettingEntry } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import type { SettingChange } from "../../settings/setting-mutations.js";
import { Panel } from "./panel.js";

const REASON_MAX = 500;

type CleanupKind = "personal" | "oneOnOne" | "confidential";

interface OrphanedSpace {
  id: string;
  key: string;
  kind: CleanupKind;
  storageBytes: number;
  pages: number;
  lastActivityAt: string;
  orphanedAt: string;
  formerMembers: { id: string; name: string }[];
}

const KIND_ICONS = { personal: User, oneOnOne: Users, confidential: Lock } as const;

export const cleanupKeys = {
  list: (organizationId: string) => ["organization", organizationId, "spaceCleanup"] as const,
};

export function SpaceCleanup({
  organizationId,
  organizationName,
  canManage,
  canChangeSetting,
  settings,
  onSettingChange,
}: {
  organizationId: string;
  organizationName: string | undefined;
  canManage: boolean;
  canChangeSetting: boolean;
  settings: SettingEntry[] | undefined;
  onSettingChange: (key: string, change: SettingChange) => Promise<void>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [deleting, setDeleting] = useState<OrphanedSpace | null>(null);
  const spaces = useQuery({
    queryKey: cleanupKeys.list(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/space-cleanup", {
          params: { path: { organizationId }, query: { limit: 200 } },
        }),
      ),
  });
  const kindLabel = (kind: CleanupKind) => t(`spaces.cleanup.kinds.${kind}`);
  let content: ReactNode = null;
  if (spaces.isPending) content = <Skeleton className="h-field w-full" />;
  else if (spaces.isError)
    content = (
      <LoadError
        what={t("spaces.cleanup.loadFailed")}
        error={spaces.error}
        onRetry={() => spaces.refetch()}
      />
    );
  else if (spaces.data.items.length === 0)
    content = (
      <EmptyState
        icon={ShieldCheck}
        title={t("spaces.cleanup.none")}
        description={t("spaces.cleanup.noneDescription")}
      />
    );
  else
    content = (
      <Table
        caption={t("spaces.cleanup.caption")}
        rowKey={(space) => space.id}
        rows={spaces.data.items as OrphanedSpace[]}
        columns={[
          {
            key: "key",
            header: t("spaces.cleanup.key"),
            cell: (space) => (
              <span className="flex flex-col leading-tight">
                <span className="font-medium">{space.key}</span>
                <span className="text-xs text-text-muted whitespace-nowrap">
                  {t("spaces.cleanup.emptySince", { date: format.date(space.orphanedAt) })}
                </span>
              </span>
            ),
          },
          {
            key: "kind",
            header: t("spaces.cleanup.kind"),
            cell: (space) => {
              const Icon = KIND_ICONS[space.kind] ?? Lock;
              return (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <Icon aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
                  {kindLabel(space.kind)}
                </span>
              );
            },
          },
          {
            key: "size",
            header: t("spaces.cleanup.size"),
            align: "end",
            hideBelow: "md",
            cell: (space) => (
              <span className="whitespace-nowrap tabular-nums">{format.bytes(space.storageBytes)}</span>
            ),
          },
          {
            key: "pages",
            header: t("spaces.cleanup.pages"),
            align: "end",
            hideBelow: "md",
            cell: (space) => <span className="tabular-nums">{format.number(space.pages)}</span>,
          },
          {
            key: "activity",
            header: t("spaces.cleanup.lastActivity"),
            hideBelow: "md",
            cell: (space) => (
              <span className="whitespace-nowrap text-text-muted">{format.date(space.lastActivityAt)}</span>
            ),
          },
          {
            key: "members",
            header: t("spaces.cleanup.formerMembers"),
            grow: true,
            hideBelow: "sm",
            cell: (space) =>
              space.formerMembers.length === 0 ? (
                <span className="text-text-muted">{t("spaces.cleanup.noFormerMembers")}</span>
              ) : (
                <TruncatedText
                  text={space.formerMembers.map((member) => member.name).join(", ")}
                  className="max-w-field"
                />
              ),
          },
          {
            key: "actions",
            sticky: true,
            align: "end",
            header: <span className="sr-only">{t("settings.actions")}</span>,
            cell: (space) =>
              canManage ? (
                <Menu
                  align="end"
                  trigger={
                    <IconButton
                      label={t("spaces.cleanup.actionsFor", { key: space.key })}
                      icon={MoreHorizontal}
                    />
                  }
                  items={[
                    {
                      label: t("spaces.cleanup.delete"),
                      icon: Trash2,
                      danger: true,
                      onSelect: () => setDeleting(space),
                    },
                  ]}
                />
              ) : null,
          },
        ]}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={t("spaces.cleanup.title")}
        {...(spaces.data
          ? { description: t("spaces.cleanup.description", { days: spaces.data.graceDays }) }
          : {})}
      >
        {content}
      </Panel>
      <Panel title={t("spaces.cleanup.waitingTitle")}>
        <SettingsList
          settings={settings}
          keys={["spaces.cleanupGraceDays"]}
          level="organization"
          {...(organizationName ? { organizationName } : {})}
          canManage={() => canChangeSetting}
          onChange={onSettingChange}
        />
      </Panel>
      {deleting ? (
        <DeleteDialog organizationId={organizationId} space={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </div>
  );
}

function DeleteDialog({
  organizationId,
  space,
  onClose,
}: {
  organizationId: string;
  space: OrphanedSpace;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("spaces.cleanup.deleteTitle", { key: space.key })}
      description={t("spaces.cleanup.deleteDescription", { count: space.pages })}
      confirmLabel={t("spaces.cleanup.deleteConfirm")}
      cancelLabel={t("common.cancel")}
      destructive
      typedConfirmation={{
        value: space.key,
        label: t("spaces.cleanup.typeKey", { key: space.key }),
        mismatch: t("spaces.cleanup.keyMismatch"),
      }}
      onConfirm={async () => {
        const value = reason.trim();
        if (value.length === 0 || value.length > REASON_MAX) {
          setError(t("spaces.cleanup.reasonRequired", { max: REASON_MAX }));
          focusFirstInvalidSoon();
          throw new Error("reason");
        }
        setError(null);
        try {
          await request(() =>
            api.POST("/api/v1/organizations/{organizationId}/space-cleanup/{spaceId}/delete", {
              params: { path: { organizationId, spaceId: space.id } },
              body: { confirmation: space.key, reason: value },
            }),
          );
          await queryClient.invalidateQueries({ queryKey: cleanupKeys.list(organizationId) });
          toast({ variant: "success", title: t("spaces.cleanup.deleted", { key: space.key }) });
          onClose();
        } catch (problem) {
          toast({
            variant: "error",
            title: t("spaces.cleanup.deleteFailed", { key: space.key }),
            description: problemMessage(t, problem),
          });
          throw problem;
        }
      }}
    >
      <Field
        label={t("spaces.cleanup.reason")}
        hint={t("spaces.cleanup.reasonHint")}
        help={t("spaces.cleanup.reasonHelp")}
        {...(error ? { error } : {})}
      >
        <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}
