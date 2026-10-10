import { Button, Dialog, Notice, Skeleton } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useOrganizationState, useSession } from "../shell/shell-context.js";
import type { Grant } from "../spaces/access/holders.js";
import { GrantsField, VisibilityField, WhoGetsAccess } from "../spaces/access/space-access-fields.js";
import { type SpaceVisibility, spaceDefaultsQuery } from "../spaces/space-queries.js";
import { importTitle } from "./import-labels.js";
import { acceptImport, type ImportView, importKeys } from "./imports-api.js";

export function AcceptDialog({
  open,
  onOpenChange,
  organizationId,
  entry,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  entry: ImportView;
  onAccepted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("imports.accept.title", { name: importTitle(t, entry) })}
      size="lg"
    >
      {open ? (
        <AcceptForm
          organizationId={organizationId}
          entry={entry}
          onDone={() => onOpenChange(false)}
          onAccepted={onAccepted}
        />
      ) : null}
    </Dialog>
  );
}

function AcceptForm({
  organizationId,
  entry,
  onDone,
  onAccepted,
}: {
  organizationId: string;
  entry: ImportView;
  onDone: () => void;
  onAccepted: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const session = useSession();
  const ownId = session.account?.id ?? "";
  const organization = state.organizations.find((candidate) => candidate.id === organizationId) ?? null;
  const defaults = useQuery({ ...spaceDefaultsQuery(organizationId), throwOnError: false });
  const [visibility, setVisibility] = useState<SpaceVisibility>("organization");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (defaults.data && !initialized) {
    setInitialized(true);
    setVisibility(defaults.data.visibility);
    const reviewers: Grant[] = entry.reviewers.map((reviewer) => ({
      principalKind: "account",
      principalId: reviewer.id,
      role: "admin",
      name: reviewer.name,
    }));
    const others = defaults.data.grants
      .filter((grant) => !reviewers.some((reviewer) => reviewer.principalId === grant.principalId))
      .map((grant) => ({ ...grant }));
    setGrants([...others, ...reviewers]);
  }

  if (defaults.isPending) return <Skeleton className="h-control-field w-full" />;
  if (defaults.isError) {
    return (
      <LoadError
        what={t("imports.accept.defaultsFailed")}
        error={defaults.error}
        onRetry={defaults.refetch}
      />
    );
  }

  const submit = async () => {
    setFailure(null);
    setSubmitting(true);
    try {
      const accepted = await acceptImport(entry.id, {
        visibility,
        grants: grants
          .filter((grant) => !(grant.principalKind === "account" && grant.principalId === ownId))
          .map(({ principalKind, principalId, role }) => ({ principalKind, principalId, role })),
      });
      queryClient.setQueryData(importKeys.detail(entry.id), accepted);
      await onAccepted();
      onDone();
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {failure ? (
        <Notice variant="danger" title={t("imports.accept.failed")}>
          {failure}
        </Notice>
      ) : null}
      <p>
        {t("imports.accept.intro", { name: importTitle(t, entry), organization: organization?.name ?? "" })}
      </p>
      <VisibilityField
        value={visibility}
        onChange={setVisibility}
        organizationName={organization?.name ?? ""}
      />
      <GrantsField
        organizationId={organizationId}
        organizationName={organization?.name ?? null}
        grants={grants}
        onChange={setGrants}
        ownId={ownId}
      />
      <WhoGetsAccess
        visibility={visibility}
        grants={grants}
        ownId={ownId}
        organizationName={organization?.name ?? null}
      />
      <ul className="flex list-disc flex-col gap-1 ps-5 text-sm text-text-muted">
        {entry.archived ? <li>{t("imports.accept.archived")}</li> : null}
        <li>{t("imports.accept.placeholders")}</li>
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={submitting}>
          {t("imports.accept.submit")}
        </Button>
      </div>
    </form>
  );
}
