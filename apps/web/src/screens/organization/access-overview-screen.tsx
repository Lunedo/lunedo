import { Badge, EmptyState, Field, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Download, Lock, UserSearch } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { accessRoleLabel, reasonText } from "../../sharing/explanation.js";
import type { PersonAccess } from "../../sharing/sharing-api.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { HolderPicker } from "../../spaces/access/holders.js";
import { itemSlug } from "../../spaces/item-paths.js";
import { pagePath } from "../../spaces/space-queries.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/access");

type Entry = PersonAccess["entries"][number];

function exportHref(organizationId: string, accountId?: string): string {
  const query = accountId ? `?accountId=${accountId}` : "";
  return `/api/v1/organizations/${organizationId}/access-overview${query}`;
}

function EntryRow({ entry }: { entry: Entry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const where =
    entry.kind === "restrictedPages"
      ? t("organization.access.restrictedPages", { count: entry.count })
      : entry.itemId && entry.itemTitle
        ? entry.itemTitle
        : t("organization.access.wholeSpace");
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{entry.spaceName}</span>
          <span className="text-text-muted"> · </span>
          {entry.kind === "restrictedPages" ? (
            <span className="inline-flex items-center gap-1 text-text-muted">
              <Lock aria-hidden="true" className="size-icon-sm" />
              {where}
            </span>
          ) : entry.itemId && entry.itemTitle ? (
            <Link
              to={pagePath(entry.spaceKey, entry.itemId, itemSlug(entry.itemTitle))}
              className="text-accent underline focus-visible:focus-ring"
            >
              {where}
            </Link>
          ) : (
            <span>{where}</span>
          )}
          {entry.count === 2 ? (
            <span className="text-text-muted"> {t("organization.access.withPagesBelow")}</span>
          ) : null}
        </span>
        {entry.role ? <Badge>{accessRoleLabel(t, entry.role)}</Badge> : null}
        {entry.kind === "link" ? <Badge>{t("sharing.people.viaLink")}</Badge> : null}
        {entry.inactive ? <Badge variant="warning">{t("organization.access.inactive")}</Badge> : null}
        {entry.reasons.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="min-h-hit rounded-sm px-2 text-sm font-medium text-accent hover:underline focus-visible:focus-ring"
          >
            {t("organization.access.why")}
          </button>
        ) : null}
      </div>
      {entry.inactive ? (
        <p className="text-sm text-text-muted">{t("organization.access.inactiveHint")}</p>
      ) : null}
      {open ? (
        <ul className="list-disc ps-5 text-sm">
          {entry.reasons.map((reason) => (
            <li key={JSON.stringify(reason)}>{reasonText(t, reason)}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function PersonOverview({ organizationId, accountId }: { organizationId: string; accountId: string }) {
  const { t } = useTranslation();
  const access = useQuery({
    queryKey: ["organization", organizationId, "personAccess", accountId],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/people/{accountId}/access", {
          params: { path: { organizationId, accountId } },
        }),
      ),
    throwOnError: false,
  });
  if (access.isPending) return <Skeleton className="h-card w-full" />;
  if (access.isError) {
    return (
      <LoadError
        what={t("organization.access.loadFailed")}
        error={access.error}
        onRetry={() => access.refetch()}
      />
    );
  }
  const name = access.data.name ?? t("spaces.holders.unknownPerson");
  return (
    <section aria-labelledby="person-access" className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <h2 id="person-access" className="min-w-0 text-lg font-semibold sm:flex-1">
          {t("organization.access.whatCan", { name })}
        </h2>
        <a
          href={exportHref(organizationId, accountId)}
          download
          className="inline-flex min-h-hit items-center gap-2 self-start rounded-md border border-border px-3 font-medium hover:bg-hover focus-visible:focus-ring sm:self-auto"
        >
          <Download aria-hidden="true" className="size-icon" />
          {t("organization.access.exportPerson")}
        </a>
      </div>
      {access.data.entries.length === 0 && access.data.confidentialSpaceCount === 0 ? (
        <p className="text-sm text-text-muted">{t("organization.access.nothing", { name })}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {access.data.entries.map((entry) => (
            <EntryRow key={`${entry.kind}-${entry.spaceId}-${entry.itemId ?? ""}`} entry={entry} />
          ))}
          {access.data.confidentialSpaceCount > 0 ? (
            <li className="flex flex-wrap items-center gap-2 py-3">
              <Lock aria-hidden="true" className="size-icon-sm text-text-muted" />
              <span className="min-w-0 flex-1">
                {t("organization.access.confidentialSpaces", {
                  count: access.data.confidentialSpaceCount,
                })}
              </span>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

export function AccessOverviewScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const [person, setPerson] = useState<string | null>(null);
  return (
    <SettingsPage
      width="wide"
      title={t("organization.access.title")}
      description={t("organization.access.description")}
      organizationId={organizationId}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="w-full min-w-0 sm:flex-1">
            <Field label={t("organization.access.person")} hint={t("organization.access.personHint")}>
              <HolderPicker
                organizationId={organizationId}
                organizationName={state.organization?.name ?? null}
                personal
                groups={false}
                exclude={[]}
                value={person ? `account:${person}` : null}
                onValueChange={(holder) => setPerson(holder?.principalId ?? null)}
                label={t("organization.access.person")}
              />
            </Field>
          </div>
          <a
            href={exportHref(organizationId)}
            download
            className="inline-flex min-h-hit items-center gap-2 self-start rounded-md border border-border px-3 font-medium hover:bg-hover focus-visible:focus-ring sm:self-auto"
          >
            <Download aria-hidden="true" className="size-icon" />
            {t("organization.access.exportAll")}
          </a>
        </div>
        {person ? (
          <PersonOverview organizationId={organizationId} accountId={person} />
        ) : (
          <EmptyState
            icon={UserSearch}
            title={t("organization.access.chooseTitle")}
            description={t("organization.access.choose")}
          />
        )}
      </div>
    </SettingsPage>
  );
}
