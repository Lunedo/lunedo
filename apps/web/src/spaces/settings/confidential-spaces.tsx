import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  Notice,
  RadioGroup,
  Skeleton,
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

interface Summary {
  id: string;
  key: string;
  createdAt: string;
  members: number;
  activeMembers: number;
  pages: number;
  lastChangedAt: string;
  needsAdministrator: boolean;
}

type Kind = "confidential" | "personal";

const keys = {
  list: (organizationId: string, kind: Kind) => ["organization", organizationId, `${kind}Spaces`] as const,
  remaining: (organizationId: string, kind: Kind, spaceId: string) =>
    ["organization", organizationId, `${kind}Spaces`, spaceId, "remaining"] as const,
};

function listSpaces(organizationId: string, kind: Kind) {
  const params = { params: { path: { organizationId }, query: { limit: 200 } } };
  return request(() =>
    kind === "confidential"
      ? api.GET("/api/v1/organizations/{organizationId}/confidential-spaces", params)
      : api.GET("/api/v1/organizations/{organizationId}/personal-spaces", params),
  );
}

function remainingMembers(organizationId: string, kind: Kind, spaceId: string) {
  const params = { params: { path: { organizationId, spaceId } } };
  return request(() =>
    kind === "confidential"
      ? api.GET(
          "/api/v1/organizations/{organizationId}/confidential-spaces/{spaceId}/remaining-members",
          params,
        )
      : api.GET("/api/v1/organizations/{organizationId}/personal-spaces/{spaceId}/remaining-members", params),
  );
}

function appoint(organizationId: string, kind: Kind, spaceId: string, accountId: string) {
  const options = { params: { path: { organizationId, spaceId } }, body: { accountId } };
  return request(() =>
    kind === "confidential"
      ? api.POST(
          "/api/v1/organizations/{organizationId}/confidential-spaces/{spaceId}/administrator",
          options,
        )
      : api.POST("/api/v1/organizations/{organizationId}/personal-spaces/{spaceId}/administrator", options),
  );
}

export function ConfidentialSpaces({
  organizationId,
  canManage,
  kind = "confidential",
}: {
  organizationId: string;
  canManage: boolean;
  kind?: Kind;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [appointing, setAppointing] = useState<Summary | null>(null);
  const spaces = useQuery({
    queryKey: keys.list(organizationId, kind),
    queryFn: () => listSpaces(organizationId, kind),
  });
  if (kind === "personal" && !spaces.isError && !spaces.data?.items.length) return null;
  const texts = kind === "confidential" ? "confidential.organization" : "personalSpaces.organization";
  return (
    <Panel title={t(`${texts}.title`)} description={t(`${texts}.description`)}>
      {spaces.isPending ? <Skeleton className="h-field w-full" /> : null}
      {spaces.isError ? (
        <LoadError what={t(`${texts}.loadFailed`)} error={spaces.error} onRetry={() => spaces.refetch()} />
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
            </li>
          ))}
        </ul>
      ) : null}
      {appointing ? (
        <AppointDialog
          organizationId={organizationId}
          kind={kind}
          space={appointing}
          onClose={() => setAppointing(null)}
        />
      ) : null}
    </Panel>
  );
}

function AppointDialog({
  organizationId,
  kind,
  space,
  onClose,
}: {
  organizationId: string;
  kind: Kind;
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
    queryKey: keys.remaining(organizationId, kind, space.id),
    queryFn: () => remainingMembers(organizationId, kind, space.id),
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
      await appoint(organizationId, kind, space.id, chosen.id);
      await queryClient.invalidateQueries({ queryKey: keys.list(organizationId, kind) });
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
