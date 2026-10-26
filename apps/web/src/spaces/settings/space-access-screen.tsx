import { Badge, Button, ConfirmDialog, EmptyState, Field, Notice, Skeleton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { SpaceAccessRequests } from "../../sharing/access-requests.js";
import { ExplanationView } from "../../sharing/explanation.js";
import { GiveAccessButton } from "../../sharing/give-access.js";
import { type RestrictedPage, sharingKeys } from "../../sharing/sharing-api.js";
import { HolderPicker } from "../access/holders.js";
import { itemHref, itemSlug } from "../item-paths.js";
import { useSpace } from "../space-context.js";
import { pagePath } from "../space-queries.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

type Kind = "view" | "edit";

function RestrictedPages() {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<{ page: RestrictedPage; kind: Kind } | null>(null);
  const pages = useQuery({
    queryKey: sharingKeys.restricted(space.id),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/restricted-pages", { params: { path: { spaceId: space.id } } }),
      ),
    throwOnError: false,
  });
  if (pages.isPending) return <Skeleton className="h-card w-full" />;
  if (pages.isError) {
    return (
      <LoadError
        what={t("spaces.access.restrictedFailed")}
        error={pages.error}
        onRetry={() => pages.refetch()}
      />
    );
  }
  if (pages.data.length === 0) {
    return (
      <EmptyState
        icon={Lock}
        title={t("spaces.access.noRestrictedTitle")}
        description={t("spaces.access.noRestricted")}
      />
    );
  }
  return (
    <>
      <ul className="flex flex-col divide-y divide-border">
        {pages.data.map((page) => (
          <li key={page.itemId} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Lock aria-hidden="true" className="size-icon-md text-text-muted" />
              <Link
                to={
                  itemHref({ id: page.itemId, kind: page.kind, title: page.title, link: null }, space.key) ??
                  pagePath(space.key, page.itemId, itemSlug(page.title))
                }
                className="min-w-0 flex-1 truncate font-medium text-accent hover:underline focus-visible:focus-ring"
                title={page.title}
              >
                {page.title}
              </Link>
              {page.orphaned ? <Badge variant="warning">{t("spaces.access.orphaned")}</Badge> : null}
            </div>
            {(["view", "edit"] as const).map((kind) => {
              const info = page[kind];
              if (!info) return null;
              return (
                <div
                  key={kind}
                  className="flex flex-col items-start gap-2 ps-6 text-sm sm:flex-row sm:items-center"
                >
                  <span className="flex min-w-0 flex-col sm:flex-1">
                    <span className="font-medium">
                      {kind === "view"
                        ? t("spaces.access.viewRestricted")
                        : t("spaces.access.editRestricted")}
                    </span>
                    <span className="text-text-muted">
                      {t("sharing.restrict.setBy", {
                        name: info.setBy?.name ?? t("files.someone"),
                        date: format.date(info.setAt),
                      })}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setRemoving({ page, kind })}>
                    {t("spaces.access.remove")}
                  </Button>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("spaces.access.removeTitle", { title: removing?.page.title ?? "" })}
        description={
          removing?.kind === "edit"
            ? t("spaces.access.removeEditEffects")
            : t("spaces.access.removeViewEffects")
        }
        confirmLabel={t("spaces.access.removeConfirm")}
        cancelLabel={t("spaces.access.keep")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/spaces/{spaceId}/restricted-pages/{itemId}/restrictions/{kind}", {
                params: { path: { spaceId: space.id, itemId: removing.page.itemId, kind: removing.kind } },
              }),
            );
            await queryClient.invalidateQueries({ queryKey: sharingKeys.restricted(space.id) });
            await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
            toast({ title: t("spaces.access.removed", { title: removing.page.title }), variant: "success" });
            setRemoving(null);
          } catch (error) {
            toast({
              title: t("spaces.access.removeFailed"),
              description: problemMessage(t, error),
              variant: "error",
            });
          }
        }}
      />
    </>
  );
}

function WhyAccess() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const [person, setPerson] = useState<string | null>(null);
  const explanation = useQuery({
    queryKey: ["spaces", space.id, "explain", person],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/access/explain", {
          params: { path: { spaceId: space.id }, query: { accountId: person ?? "" } },
        }),
      ),
    enabled: person !== null,
    throwOnError: false,
  });
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("sharing.why.person")}>
        <HolderPicker
          organizationId={space.organizationId}
          organizationName={space.organizationName}
          personal
          groups={false}
          exclude={[]}
          value={person ? `account:${person}` : null}
          onValueChange={(next) => setPerson(next?.principalId ?? null)}
          label={t("sharing.why.person")}
          placeholder={t("sharing.why.placeholder")}
        />
      </Field>
      {person && explanation.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {explanation.isError ? (
        <LoadError
          what={t("sharing.why.loadFailed")}
          error={explanation.error}
          onRetry={() => explanation.refetch()}
        />
      ) : null}
      {explanation.data ? <ExplanationView explanation={explanation.data} subject="space" /> : null}
    </div>
  );
}

export function SpaceAccessScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const admin = space.role === "admin";
  return (
    <SpaceSettingsPage title={t("spaces.access.title")} description={t("spaces.access.description")}>
      <div className="flex flex-col gap-8">
        {admin ? (
          <Panel title={t("spaces.access.giveTitle")} actions={<GiveAccessButton spaceId={space.id} />}>
            <p className="text-sm text-text-muted">{t("spaces.access.giveHint")}</p>
          </Panel>
        ) : null}
        {admin ? (
          <Panel title={t("sharing.why.toggle")}>
            <WhyAccess />
          </Panel>
        ) : null}
        <Panel title={t("spaces.access.requestsTitle")} description={t("spaces.access.requestsDescription")}>
          <SpaceAccessRequests spaceId={space.id} />
        </Panel>
        {admin ? (
          <Panel
            title={t("spaces.access.restrictedTitle")}
            description={t("spaces.access.restrictedDescription")}
          >
            <RestrictedPages />
          </Panel>
        ) : (
          <Notice variant="info" title={t("spaces.access.adminsOnlyTitle")}>
            {t("spaces.access.adminsOnly")}
          </Notice>
        )}
      </div>
    </SpaceSettingsPage>
  );
}
