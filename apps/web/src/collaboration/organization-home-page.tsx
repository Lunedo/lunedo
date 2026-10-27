import {
  Button,
  Combobox,
  type ComboboxLoader,
  Field,
  InlineField,
  type SaveState,
  SaveStatus,
  Skeleton,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { contentHref } from "../spaces/item-paths.js";
import { collaborationKeys, organizationHomePageQuery } from "./queries.js";

const pageLoader: ComboboxLoader = async (query) => {
  const items = await request(() =>
    api.GET("/api/v1/items", { params: { query: { q: query, kind: "page", limit: 20 } } }),
  );
  return {
    items: items.map((item) => ({ value: item.id, label: item.title, description: item.spaceName })),
    nextCursor: null,
  };
};

export function OrganizationHomePage({
  organizationId,
  canManage,
}: {
  organizationId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const current = useQuery(organizationHomePageQuery(organizationId));
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async (itemId: string | null) => {
    setState("saving");
    setError(null);
    try {
      const result = await request(() =>
        api.PUT("/api/v1/organizations/{organizationId}/home-page", {
          params: { path: { organizationId } },
          body: { itemId },
        }),
      );
      queryClient.setQueryData(collaborationKeys.organizationHomePage(organizationId), result);
      setState("saved");
    } catch (failure) {
      setState("error");
      setError(problemMessage(t, failure));
    }
  };

  if (current.isPending) return <Skeleton className="h-field w-full" />;
  if (current.isError) {
    return (
      <LoadError
        what={t("home.organizationPageFailed")}
        error={current.error}
        onRetry={() => current.refetch()}
      />
    );
  }
  const page = current.data.page;
  const href = page
    ? contentHref({ kind: page.kind, number: page.number, title: page.title }, page.spaceKey)
    : null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {page && href ? (
          <>
            {t("home.organizationPageCurrent")}{" "}
            <Link to={href} className="text-accent underline focus-visible:focus-ring">
              {page.title}
            </Link>{" "}
            <span className="text-text-muted">· {page.spaceName}</span>
          </>
        ) : (
          <span className="text-text-muted">{t("home.organizationPageNone")}</span>
        )}
      </p>
      {canManage ? (
        <div className="flex flex-wrap items-end gap-2">
          <InlineField>
            <Field label={t("home.choosePage")} error={error}>
              <Combobox
                aria-label={t("home.choosePage")}
                placeholder={t("home.searchPage")}
                value={page?.id ?? null}
                selectedItem={page ? { value: page.id, label: page.title } : null}
                load={pageLoader}
                onValueChange={(value) => void save(value)}
              />
            </Field>
          </InlineField>
          {page ? (
            <Button variant="secondary" icon={X} onClick={() => void save(null)}>
              {t("home.removeOrganizationPage")}
            </Button>
          ) : null}
          <SaveStatus state={state} />
        </div>
      ) : null}
    </div>
  );
}
