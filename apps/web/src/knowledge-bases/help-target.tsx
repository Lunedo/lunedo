import { type SaveState, SaveStatus, Section, Select, SettingRow, Skeleton } from "@lunedo/ui";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { docsUrl } from "../docs/docs-url.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";

const DOCUMENTATION = "documentation";

export function helpTargetQuery(organizationId: string) {
  return queryOptions({
    queryKey: ["organizations", organizationId, "help"] as const,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/help", { params: { path: { organizationId } } }),
      ),
    staleTime: 60_000,
  });
}

export function useHelpUrl(organizationId: string | null): { url: string; custom: boolean } {
  const help = useQuery({
    ...helpTargetQuery(organizationId ?? ""),
    enabled: organizationId !== null,
    throwOnError: false,
  });
  const current = help.data?.current;
  return current ? { url: current.url, custom: true } : { url: docsUrl("README.md"), custom: false };
}

export function HelpTargetSection({
  organizationId,
  editable,
}: {
  organizationId: string;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const help = useQuery({ ...helpTargetQuery(organizationId), throwOnError: false });
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const save = async (value: string) => {
    setLast(value);
    setState("saving");
    setError(null);
    try {
      const updated = await request(() =>
        api.PUT("/api/v1/organizations/{organizationId}/help", {
          params: { path: { organizationId } },
          body: { spaceId: value === DOCUMENTATION ? null : value },
        }),
      );
      queryClient.setQueryData(helpTargetQuery(organizationId).queryKey, updated);
      setState("saved");
    } catch (failure) {
      setError(problemMessage(t, failure));
      setState("error");
    }
  };
  return (
    <Section title={t("helpTarget.title")}>
      {help.isPending ? <Skeleton className="h-field w-full" /> : null}
      {help.isError ? (
        <div className="p-4">
          <LoadError
            what={t("helpTarget.loadFailed")}
            error={help.error}
            onRetry={() => void help.refetch()}
          />
        </div>
      ) : null}
      {help.data ? (
        <SettingRow
          label={t("helpTarget.label")}
          description={
            help.data.candidates.length === 0 ? t("helpTarget.noCandidates") : t("helpTarget.description")
          }
          help={t("helpTarget.help")}
          control={
            <Select
              value={help.data.current?.spaceId ?? DOCUMENTATION}
              disabled={!editable}
              aria-label={t("helpTarget.label")}
              onValueChange={(value) => void save(value)}
              options={[
                { value: DOCUMENTATION, label: t("helpTarget.documentation") },
                ...help.data.candidates.map((candidate) => ({
                  value: candidate.spaceId,
                  label: candidate.name,
                })),
              ]}
            />
          }
          status={
            <SaveStatus
              state={state}
              {...(error ? { error, onRetry: () => last !== null && void save(last) } : {})}
            />
          }
        />
      ) : null}
    </Section>
  );
}
