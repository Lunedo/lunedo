import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  Notice,
  RadioGroup,
  Skeleton,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { Panel } from "./panel.js";

const REASON_MAX = 500;

interface Summary {
  id: string;
  key: string;
  createdAt: string;
  members: number;
  activeMembers: number;
  pages: number;
  lastChangedAt: string;
  needsAdministrator: boolean;
  deletable: boolean;
}

const keys = {
  list: (organizationId: string) => ["organization", organizationId, "confidentialSpaces"] as const,
  remaining: (organizationId: string, spaceId: string) =>
    ["organization", organizationId, "confidentialSpaces", spaceId, "remaining"] as const,
};

export function ConfidentialSpaces({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [appointing, setAppointing] = useState<Summary | null>(null);
  const [deleting, setDeleting] = useState<Summary | null>(null);
  const spaces = useQuery({
    queryKey: keys.list(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/confidential-spaces", {
          params: { path: { organizationId }, query: { limit: 200 } },
        }),
      ),
  });
  return (
    <Panel
      title={t("confidential.organization.title")}
      description={t("confidential.organization.description")}
    >
      {spaces.isPending ? <Skeleton className="h-field w-full" /> : null}
      {spaces.isError ? (
        <LoadError
          what={t("confidential.organization.loadFailed")}
          error={spaces.error}
          onRetry={() => spaces.refetch()}
        />
      ) : null}
      {spaces.data && spaces.data.items.length === 0 ? (
        <EmptyState
          icon={Lock}
          title={t("confidential.organization.none")}
          description={t("confidential.organization.noneDescription")}
        />
      ) : null}
      {spaces.data && spaces.data.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {spaces.data.items.map((space) => (
            <li key={space.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="flex min-w-0 flex-1 basis-field flex-col">
                <span className="flex items-center gap-2 font-medium">
                  <Lock aria-hidden className="size-icon-md text-text-muted" />
                  {space.key}
                  {space.needsAdministrator ? (
                    <Badge variant="warning">{t("confidential.organization.noAdmin")}</Badge>
                  ) : null}
                  {space.deletable ? (
                    <Badge variant="danger">{t("confidential.organization.noMembers")}</Badge>
                  ) : null}
                </span>
                <span className="text-sm text-text-muted">
                  {[
                    t("confidential.organization.created", { date: format.date(space.createdAt) }),
                    t("confidential.organization.members", { count: space.members }),
                    t("confidential.organization.pages", { count: space.pages }),
                    t("confidential.organization.changed", { date: format.date(space.lastChangedAt) }),
                  ].join(" · ")}
                </span>
              </div>
              {canManage && space.needsAdministrator ? (
                <Button variant="secondary" onClick={() => setAppointing(space)}>
                  {t("confidential.organization.appoint")}
                </Button>
              ) : null}
              {canManage && space.deletable ? (
                <Button variant="danger" onClick={() => setDeleting(space)}>
                  {t("confidential.organization.delete")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {appointing ? (
        <AppointDialog
          organizationId={organizationId}
          space={appointing}
          onClose={() => setAppointing(null)}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog organizationId={organizationId} space={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </Panel>
  );
}

function AppointDialog({
  organizationId,
  space,
  onClose,
}: {
  organizationId: string;
  space: Summary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [person, setPerson] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const remaining = useQuery({
    queryKey: keys.remaining(organizationId, space.id),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/confidential-spaces/{spaceId}/remaining-members", {
          params: { path: { organizationId, spaceId: space.id } },
        }),
      ),
  });
  const submit = async () => {
    const chosen = remaining.data?.find((member) => member.id === person);
    if (!chosen) {
      setError(t("confidential.organization.choosePerson"));
      focusFirstInvalidSoon();
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/confidential-spaces/{spaceId}/administrator", {
          params: { path: { organizationId, spaceId: space.id } },
          body: { accountId: chosen.id },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: keys.list(organizationId) });
      toast({
        variant: "success",
        title: t("confidential.organization.appointed", { person: chosen.name, key: space.key }),
      });
      onClose();
    } catch (problem) {
      setFailure(problemMessage(t, problem));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("confidential.organization.appointTitle", { key: space.key })}
      description={t("confidential.organization.appointDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {t("confidential.organization.appointConfirm")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {failure ? (
          <Notice variant="danger" title={t("confidential.organization.appointFailed")}>
            {failure}
          </Notice>
        ) : null}
        {remaining.isPending ? <Skeleton className="h-field w-full" /> : null}
        {remaining.isError ? (
          <LoadError
            what={t("confidential.organization.remainingFailed")}
            error={remaining.error}
            onRetry={() => remaining.refetch()}
          />
        ) : null}
        {remaining.data && remaining.data.length === 0 ? (
          <p className="text-sm text-text-muted">{t("confidential.organization.noRemaining")}</p>
        ) : null}
        {remaining.data && remaining.data.length > 0 ? (
          <Field label={t("confidential.organization.remaining")} error={error ?? undefined}>
            <RadioGroup
              label={t("confidential.organization.remaining")}
              value={person ?? ""}
              onValueChange={(value) => {
                setPerson(value);
                setError(null);
              }}
              options={remaining.data.map((member) => ({ value: member.id, label: member.name }))}
            />
          </Field>
        ) : null}
        <Notice variant="info" title={t("confidential.organization.appointNoticeTitle")}>
          {t("confidential.organization.appointNotice")}
        </Notice>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  organizationId,
  space,
  onClose,
}: {
  organizationId: string;
  space: Summary;
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
      title={t("confidential.organization.deleteTitle", { key: space.key })}
      description={t("confidential.organization.deleteDescription", { count: space.pages })}
      confirmLabel={t("confidential.organization.deleteConfirm")}
      cancelLabel={t("common.cancel")}
      destructive
      typedConfirmation={{
        value: space.key,
        label: t("confidential.organization.typeKey", { key: space.key }),
        mismatch: t("confidential.organization.keyMismatch"),
      }}
      onConfirm={async () => {
        const value = reason.trim();
        if (value.length === 0 || value.length > REASON_MAX) {
          setError(t("confidential.organization.reasonRequired", { max: REASON_MAX }));
          focusFirstInvalidSoon();
          throw new Error("reason");
        }
        try {
          await request(() =>
            api.POST("/api/v1/organizations/{organizationId}/confidential-spaces/{spaceId}/delete", {
              params: { path: { organizationId, spaceId: space.id } },
              body: { confirmation: space.key, reason: value },
            }),
          );
          await queryClient.invalidateQueries({ queryKey: keys.list(organizationId) });
          toast({ variant: "success", title: t("confidential.organization.deleted", { key: space.key }) });
          onClose();
        } catch (problem) {
          toast({
            variant: "error",
            title: t("confidential.organization.deleteFailed"),
            description: problemMessage(t, problem),
          });
          throw problem;
        }
      }}
    >
      <Field
        label={t("confidential.organization.reason")}
        hint={t("confidential.organization.reasonHint")}
        error={error ?? undefined}
      >
        <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

export function DeletedConfidentialNotice({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const deleted = useQuery({
    queryKey: ["organization", organizationId, "confidentialSpaces", "deleted"],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/trash/confidential-spaces", {
          params: { path: { organizationId } },
        }),
      ),
  });
  if (!deleted.data || deleted.data.deleted === 0) return null;
  return (
    <Notice variant="info" title={t("confidential.deletedCountTitle", { count: deleted.data.deleted })}>
      {t("confidential.deletedCount")}
    </Notice>
  );
}
