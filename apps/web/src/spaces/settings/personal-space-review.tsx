import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  Notice,
  RadioGroup,
  Skeleton,
  Table,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { contentKeys } from "../content-queries.js";
import { spaceKeys } from "../space-queries.js";
import { DeletedContent } from "../trash/deleted-content.js";
import { withParentsQuery } from "../trash/restore-with-parents.js";
import { Panel } from "./panel.js";

interface ReviewEntry {
  spaceId: string;
  key: string;
  name: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerState: string | null;
  pages: number;
  remainingMembers: number;
  lastChangedAt: string;
}

export function PersonalSpaceReview() {
  const { t } = useTranslation();
  const format = useFormat();
  const state = useOrganizationState();
  const review = useQuery({
    queryKey: spaceKeys.personalReview,
    queryFn: () =>
      request(() => api.GET("/api/v1/instance/personal-spaces", { params: { query: { limit: 200 } } })),
  });
  const [transferring, setTransferring] = useState<ReviewEntry | null>(null);
  const [deleting, setDeleting] = useState<ReviewEntry | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = state.can("instance.personalSpaces.manage");
  return (
    <>
      <Panel title={t("spaces.instance.review")} description={t("spaces.instance.reviewDescription")}>
        {review.isError ? (
          <LoadError
            what={t("spaces.instance.reviewFailed")}
            error={review.error}
            onRetry={() => review.refetch()}
          />
        ) : null}
        {review.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {review.data && review.data.items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t("spaces.instance.none")}
            description={t("spaces.instance.noneDescription")}
          />
        ) : null}
        {review.data && review.data.items.length > 0 ? (
          <Table
            caption={t("spaces.instance.review")}
            rowKey={(entry) => entry.spaceId}
            rows={review.data.items}
            columns={[
              {
                key: "owner",
                header: t("spaces.instance.owner"),
                cell: (entry) => (
                  <span className="font-medium">{entry.ownerName ?? t("spaces.instance.formerOwner")}</span>
                ),
              },
              {
                key: "state",
                header: t("spaces.instance.ownerState"),
                hideBelow: "sm",
                cell: (entry) =>
                  t(
                    `spaces.instance.states.${entry.ownerState === "anonymized" ? "anonymized" : "deactivated"}`,
                  ),
              },
              {
                key: "pages",
                header: t("spaces.instance.pages"),
                align: "end",
                cell: (entry) => format.number(entry.pages),
              },
              {
                key: "changed",
                header: t("spaces.instance.lastChange"),
                hideBelow: "md",
                cell: (entry) => format.dateTime(entry.lastChangedAt),
              },
              {
                key: "actions",
                header: t("spaces.instance.actions"),
                cell: (entry) =>
                  canManage ? (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {entry.remainingMembers > 0 ? (
                        <Button variant="secondary" size="sm" onClick={() => setTransferring(entry)}>
                          {t("spaces.instance.transfer")}
                        </Button>
                      ) : (
                        <span className="text-sm text-text-muted">{t("spaces.instance.nobodyRemains")}</span>
                      )}
                      <Button variant="danger" size="sm" onClick={() => setDeleting(entry)}>
                        {t("spaces.instance.delete")}
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        ) : null}
      </Panel>
      <TransferDialog entry={transferring} onOpenChange={(open) => !open && setTransferring(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("spaces.instance.deleteTitle", {
          owner: deleting?.ownerName ?? t("spaces.instance.formerOwner"),
        })}
        description={t("content.deletePersonalSpaceConsequences")}
        confirmLabel={t("spaces.instance.delete")}
        cancelLabel={t("content.keepSpace")}
        destructive
        typedConfirmation={{
          value: deleting?.name || deleting?.key || "",
          label: t("content.typeName", { name: deleting?.name || deleting?.key || "" }),
          mismatch: t("content.nameMismatch"),
        }}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await request(() =>
              api.POST("/api/v1/instance/personal-spaces/{spaceId}/delete", {
                params: { path: { spaceId: deleting.spaceId } },
                body: { confirmation: deleting.name || deleting.key },
              }),
            );
            await queryClient.invalidateQueries({ queryKey: spaceKeys.personalReview });
            toast({ title: t("spaces.instance.deleted"), variant: "success" });
          } catch (error) {
            toast({
              title: t("content.deleteFailed"),
              description: problemMessage(t, error),
              variant: "error",
            });
          }
        }}
      />
      {canManage ? <DeletedPersonalSpaces /> : null}
    </>
  );
}

function DeletedPersonalSpaces() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const trash = useQuery({
    queryKey: contentKeys.personalTrash,
    queryFn: () => request(() => api.GET("/api/v1/instance/personal-spaces/trash")),
  });
  const refreshTrash = async () => {
    await queryClient.invalidateQueries({ queryKey: contentKeys.personalTrash });
    await queryClient.invalidateQueries({ queryKey: spaceKeys.personalReview });
  };
  return (
    <Panel title={t("trash.deletedPersonal")}>
      <DeletedContent
        entries={trash.data}
        loading={trash.isPending}
        error={trash.error}
        onRetry={() => void trash.refetch()}
        onRestore={async (entry, withParents) => {
          const result = await request(() =>
            api.POST("/api/v1/instance/personal-spaces/trash/{entryId}/restore", {
              params: { path: { entryId: entry.id }, query: withParentsQuery(withParents) },
            }),
          );
          await refreshTrash();
          return result;
        }}
        onDelete={async (entry, reason) => {
          await request(() =>
            api.POST("/api/v1/instance/personal-spaces/trash/{entryId}/delete", {
              params: { path: { entryId: entry.id } },
              body: { reason },
            }),
          );
          await refreshTrash();
        }}
      />
    </Panel>
  );
}

function TransferDialog({
  entry,
  onOpenChange,
}: {
  entry: ReviewEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<{ value: string; label: string } | null>(null);
  const remaining = useQuery({
    queryKey: [...spaceKeys.personalReview, entry?.spaceId, "remaining"],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/personal-spaces/{spaceId}/remaining-members", {
          params: { path: { spaceId: entry?.spaceId ?? "" } },
        }),
      ),
    enabled: entry !== null,
  });
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const owner = entry?.ownerName ?? t("spaces.instance.formerOwner");
  const submit = async () => {
    if (!entry) return;
    if (!account) {
      setError(t("spaces.instance.chooseAccount"));
      focusFirstInvalidSoon();
      return;
    }
    setError(null);
    setFailure(null);
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/instance/personal-spaces/{spaceId}/transfer", {
          params: { path: { spaceId: entry.spaceId } },
          body: { accountId: account.value },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.personalReview });
      toast({
        title: t("spaces.instance.transferred", { owner, account: account.label }),
        variant: "success",
      });
      setAccount(null);
      onOpenChange(false);
    } catch (problem) {
      setFailure(problemMessage(t, problem));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={entry !== null}
      onOpenChange={onOpenChange}
      title={t("spaces.instance.transferTitle", { owner })}
      size="sm"
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {failure ? (
          <Notice variant="danger" title={t("spaces.instance.transferFailed")}>
            {failure}
          </Notice>
        ) : null}
        <Field
          label={t("spaces.instance.newOwner")}
          hint={t("spaces.instance.newOwnerHint")}
          help={t("spaces.instance.newOwnerHelp")}
          {...(error ? { error } : {})}
        >
          {remaining.isPending ? <Skeleton className="h-field w-full" /> : null}
          {remaining.isError ? (
            <LoadError
              what={t("spaces.instance.remainingFailed")}
              error={remaining.error}
              onRetry={() => remaining.refetch()}
            />
          ) : null}
          {remaining.data && remaining.data.length === 0 ? (
            <p className="text-sm text-text-muted">{t("spaces.instance.nobodyRemainsDescription")}</p>
          ) : null}
          {remaining.data && remaining.data.length > 0 ? (
            <RadioGroup
              label={t("spaces.instance.newOwner")}
              value={account?.value ?? ""}
              onValueChange={(value) => {
                const chosen = remaining.data.find((member) => member.id === value);
                setAccount(chosen ? { value: chosen.id, label: chosen.name } : null);
                setError(null);
              }}
              options={remaining.data.map((member) => ({ value: member.id, label: member.name }))}
            />
          ) : null}
        </Field>
        <Notice variant="warning" title={t("spaces.instance.transferEffectTitle")}>
          {t("spaces.instance.transferEffect", { owner })}
        </Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {t("spaces.instance.transferSubmit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
